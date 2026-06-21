"""
Module 1 — R,S (Periodic Review, Order-Up-To) 발주계획 엔진

상수 (inventory_planner.py 시뮬레이션 검증값 기준)
  LAYER_BOXES = 10  (레이어당 박스)
  PALLET_LAYERS = 4 (팔레트당 레이어)
  SERVICE_Z = 2.05  (서비스레벨 ~98%)
  FORECAST_CV = 0.15

발주 가능월: 매달 (1~12월)
도착월 = 발주월 + lead_time (1개월)
타당성 조건: review_cycle + lead_time ≤ shelf_life_months
"""
import math
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.inventory import DemandActual, DemandForecast, InventoryLot
from app.models.order import PoLine, PurchaseOrder
from app.models.planning import PlanLine, PlanRun
from app.models.product import ExporterProduct, PlanningParam, Product

# ── 상수 ────────────────────────────────────────────────────────────────────
LAYER_BOXES = 10
PALLET_LAYERS = 4
BOXES_PER_PALLET = LAYER_BOXES * PALLET_LAYERS  # 40
SERVICE_Z = 2.05
FORECAST_CV = 0.15
DEFAULT_AVG_DEMAND = 10.0  # 수요 실적이 없을 때 기본값 (박스/월)


# ── 날짜 헬퍼 ────────────────────────────────────────────────────────────────

def add_months(ym: str, n: int) -> str:
    """YYYY-MM 에 n개월 더하기"""
    year, month = int(ym[:4]), int(ym[5:7])
    month += n
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}"


def prev_ym_list(ym: str, n: int) -> list[str]:
    """ym 기준 과거 n개월 목록 (과거→현재 순)"""
    return [add_months(ym, -(n - i)) for i in range(n)]


def ceil_to_layer(boxes: float, layer_boxes: int = LAYER_BOXES) -> int:
    """레이어 단위로 올림 (상품별 단당 박스수 적용)"""
    if boxes <= 0:
        return 0
    return math.ceil(boxes / layer_boxes) * layer_boxes


# ── 데이터 사전 로드 ─────────────────────────────────────────────────────────

def _load_demand_map(db: Session, run_ym: str) -> dict[int, list[int]]:
    """product_id → 최근 12개월 수요 리스트 (박스)"""
    months = prev_ym_list(run_ym, 12)
    rows = (
        db.query(DemandActual.product_id, DemandActual.ym, DemandActual.qty_boxes)
        .filter(DemandActual.ym.in_(months))
        .all()
    )
    demand: dict[int, dict[str, int]] = {}
    for pid, ym, qty in rows:
        demand.setdefault(pid, {})[ym] = qty

    return {
        pid: [ym_map.get(m, 0) for m in months]
        for pid, ym_map in demand.items()
    }


def _load_inventory_map(db: Session) -> dict[int, int]:
    """product_id → 현재 가용 재고 합계(박스)"""
    rows = (
        db.query(InventoryLot.product_id, func.sum(InventoryLot.qty_boxes))
        .filter(InventoryLot.status == "AVAILABLE")
        .group_by(InventoryLot.product_id)
        .all()
    )
    return {pid: int(qty) for pid, qty in rows}


def _load_onorder_map(db: Session, run_ym: str) -> dict[int, int]:
    """product_id → 미입고 확정 PO 합계(박스) — run_ym 이후 도착 예정"""
    rows = (
        db.query(PoLine.product_id, func.sum(PoLine.order_boxes))
        .join(PurchaseOrder)
        .filter(
            PurchaseOrder.status.in_(["SUBMITTED", "CONFIRMED"]),
            PurchaseOrder.order_ym >= run_ym,
        )
        .group_by(PoLine.product_id)
        .all()
    )
    return {pid: int(qty) for pid, qty in rows}


def _next_version(db: Session, run_ym: str) -> int:
    """같은 run_ym의 최대 version + 1"""
    max_v = (
        db.query(func.max(PlanRun.version))
        .filter(PlanRun.run_ym == run_ym)
        .scalar()
    )
    return (max_v or 0) + 1


# ── SKU별 계획 계산 ──────────────────────────────────────────────────────────

def _plan_one_sku(
    product: Product,
    demand_history: list[int],
    initial_position: int,
    plan_run_id: int,
    run_ym: str,
    horizon_months: int,
    service_z: float,
) -> list[PlanLine]:
    """단일 SKU에 대한 R,S 발주계획 라인 생성"""
    tier = product.tier
    param: Optional[PlanningParam] = product.planning_param

    review = (param.override_review_cycle if param and param.override_review_cycle
              else tier.review_cycle_months)
    lead = (param.override_lead_time if param and param.override_lead_time
            else tier.lead_time_months)
    shelf = tier.shelf_life_months

    # 평균 수요
    recent = [d for d in demand_history if d > 0]
    avg_demand = sum(recent) / len(recent) if recent else DEFAULT_AVG_DEMAND

    # 안전재고: z × CV × sqrt(review+lead) × avg_demand
    safety_stock = service_z * FORECAST_CV * math.sqrt(review + lead) * avg_demand

    # 목표 재고수준 S
    target_S = avg_demand * (review + lead) + safety_stock

    # 상품별 단당 박스수 (없으면 전역 상수 fallback)
    layer_boxes = product.boxes_per_layer or LAYER_BOXES

    # 최소/최대 발주 단수 (PlanningParam 오버라이드)
    min_layers = param.min_order_layers if param and param.min_order_layers else None
    max_layers = param.max_order_layers if param and param.max_order_layers else None

    # 유통기한 상한: (shelf - lead) × avg_demand
    shelf_cap = ceil_to_layer(max(0, (shelf - lead) * avg_demand), layer_boxes)

    # 타당성 경고
    feasibility_alert: Optional[str] = None
    if review + lead > shelf:
        feasibility_alert = (
            f"타당성 위반: review({review}m)+lead({lead}m) > shelf_life({shelf}m)"
        )

    # 수출자-상품 ep_id (첫 번째 활성 매핑)
    ep_id: Optional[int] = None
    for ep in product.exporter_products:
        if ep.is_active:
            ep_id = ep.ep_id
            break

    # ── 롤링 시뮬레이션 ─────────────────────────────────────────────────────
    position = float(initial_position)
    arrivals: dict[str, float] = {}
    lines: list[PlanLine] = []

    for i in range(horizon_months):
        order_ym = add_months(run_ym, i)

        raw_order = target_S - position
        order_qty = ceil_to_layer(raw_order, layer_boxes)

        # 최소/최대 발주 단수 적용
        if min_layers and order_qty > 0:
            order_qty = max(order_qty, min_layers * layer_boxes)
        if max_layers:
            order_qty = min(order_qty, max_layers * layer_boxes)
        if shelf_cap > 0:
            order_qty = min(order_qty, shelf_cap)

        if order_qty > 0:
            order_layers = order_qty // layer_boxes
            arrival_ym = add_months(order_ym, lead)
            projected = int(position + order_qty - avg_demand * (review + lead))

            lines.append(PlanLine(
                plan_run_id=plan_run_id,
                product_id=product.product_id,
                ep_id=ep_id,
                order_ym=order_ym,
                order_boxes=order_qty,
                order_layers=order_layers,
                expected_arrival_ym=arrival_ym,
                projected_inv_end=max(0, projected),
                is_committed=(i == 0),   # 당월 발주월만 committed
                alert=feasibility_alert,
            ))
            # 발주분을 포지션에 즉시 반영 (재고포지션 = 현재고 + 미착)
            position += order_qty

        # 월 소비
        position = max(0, position - avg_demand)

    return lines


# ── 수요 예측 저장 ────────────────────────────────────────────────────────────

def _save_forecasts(
    db: Session,
    plan_run_id: int,
    product: Product,
    avg_demand: float,
    run_ym: str,
    horizon_months: int,
) -> None:
    for i in range(horizon_months):
        ym = add_months(run_ym, i)
        db.add(DemandForecast(
            plan_run_id=plan_run_id,
            product_id=product.product_id,
            ym=ym,
            forecast_boxes=max(1, round(avg_demand)),
        ))


# ── 메인 진입점 ──────────────────────────────────────────────────────────────

def run_plan(
    db: Session,
    run_ym: str,
    created_by: int,
    horizon_months: int = 12,
    service_z: float = SERVICE_Z,
) -> PlanRun:
    """
    발주계획 실행 — PLAN_RUN 및 PLAN_LINE, DEMAND_FORECAST 생성

    Args:
        run_ym:          계획 기준 년월 (YYYY-MM)
        created_by:      실행 사용자 ID
        horizon_months:  계획 기간 (기본 12개월)
        service_z:       서비스 레벨 z 값 (기본 2.05 ≈ 98%)

    Returns:
        저장된 PlanRun 인스턴스
    """
    version = _next_version(db, run_ym)
    plan_run = PlanRun(
        run_ym=run_ym,
        version=version,
        horizon_months=horizon_months,
        service_z=service_z,
        status="DRAFT",
        created_by=created_by,
    )
    db.add(plan_run)
    db.flush()  # plan_run_id 확보

    # 사전 데이터 로드 (N+1 쿼리 방지)
    demand_map = _load_demand_map(db, run_ym)
    inventory_map = _load_inventory_map(db)
    onorder_map = _load_onorder_map(db, run_ym)

    # 활성 상품 전체 로드
    products = (
        db.query(Product)
        .options(
            joinedload(Product.tier),
            joinedload(Product.planning_param),
            joinedload(Product.exporter_products),
        )
        .filter(Product.is_active == True)
        .all()
    )

    total_lines = 0
    for product in products:
        demand_history = demand_map.get(product.product_id, [])
        on_hand = inventory_map.get(product.product_id, 0)
        on_order = onorder_map.get(product.product_id, 0)
        initial_position = on_hand + on_order

        lines = _plan_one_sku(
            product=product,
            demand_history=demand_history,
            initial_position=initial_position,
            plan_run_id=plan_run.plan_run_id,
            run_ym=run_ym,
            horizon_months=horizon_months,
            service_z=service_z,
        )
        for line in lines:
            db.add(line)
        total_lines += len(lines)

        # 수요 예측 저장
        recent = [d for d in demand_history if d > 0]
        avg_d = sum(recent) / len(recent) if recent else DEFAULT_AVG_DEMAND
        _save_forecasts(db, plan_run.plan_run_id, product, avg_d, run_ym, horizon_months)

    db.commit()
    db.refresh(plan_run)

    print(f"✅ PLAN_RUN #{plan_run.plan_run_id} 완료 — {len(products)}개 SKU, {total_lines}개 라인")
    return plan_run
