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
import statistics
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


SPIKE_NEIGHBOR_MULT = 2.5   # 이웃달 대비 이 배수 초과면 스파이크로 간주


def _smooth_spikes(history: list[int]) -> list[int]:
    """주변 달 중앙값 대비 SPIKE_NEIGHBOR_MULT 초과 값을 이웃 평균으로 대체."""
    n = len(history)
    if n < 3:
        return history
    result = list(history)
    for i in range(n):
        if result[i] <= 0:
            continue
        neighbors = [result[j] for j in (i - 1, i + 1, i - 2, i + 2)
                     if 0 <= j < n and result[j] > 0]
        if not neighbors:
            continue
        neighbor_med = statistics.median(neighbors)
        if neighbor_med > 0 and result[i] > neighbor_med * SPIKE_NEIGHBOR_MULT:
            result[i] = round(neighbor_med)
    return result


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


def _load_committed_map(
    db: Session, run_ym: str, horizon_months: int
) -> dict[int, dict[str, "PlanLine"]]:
    """사용자가 직접 확정한 is_committed=True 라인을 로드.

    알고리즘이 자동으로 is_committed=True를 설정한 라인(첫 달만)을 배제하기 위해:
    plan_run 중 committed 라인이 첫 달(run_ym)이 아닌 달에도 존재하는 plan_run만
    '실제 확정 발주 run'으로 간주한다.

    horizon에 상관없이 모든 월의 확정 라인을 반환 — plan horizon 이전 달(과거 실적)도 포함.
    반환: {product_id: {order_ym: PlanLine}}
    """
    from collections import defaultdict

    # horizon 필터 없이 전체 is_committed=True 라인 조회
    rows = (
        db.query(PlanLine, PlanRun.run_ym.label("plan_run_ym"))
        .join(PlanRun, PlanLine.plan_run_id == PlanRun.plan_run_id)
        .filter(PlanLine.is_committed == True)
        .order_by(PlanLine.plan_run_id.desc())
        .all()
    )

    # 알고리즘이 자동 committed한 plan_run은 제외:
    # 첫 달(plan_run.run_ym)이 아닌 달에 confirmed 라인이 있는 plan_run = 사용자 확정
    genuine_run_ids: set[int] = set()
    for line, plan_run_ym in rows:
        if line.order_ym != plan_run_ym:
            genuine_run_ids.add(line.plan_run_id)

    best: dict[tuple, PlanLine] = {}
    for line, _ in rows:
        if line.plan_run_id not in genuine_run_ids:
            continue
        key = (line.product_id, line.order_ym)
        if key not in best:
            best[key] = line

    result: dict[int, dict[str, PlanLine]] = defaultdict(dict)
    for (pid, ym), line in best.items():
        result[pid][ym] = line
    return result


# ── SKU별 계획 계산 ──────────────────────────────────────────────────────────

def _plan_one_sku(
    product: Product,
    demand_history: list[int],
    initial_position: int,
    plan_run_id: int,
    run_ym: str,
    horizon_months: int,
    service_z: float,
    committed_orders: Optional[dict[str, "PlanLine"]] = None,
) -> list[PlanLine]:
    """단일 SKU에 대한 R,S 발주계획 라인 생성.
    committed_orders: {order_ym: 기존 PlanLine} — 확정 발주는 재계산 없이 복사.
    """
    tier = product.tier
    param: Optional[PlanningParam] = product.planning_param

    review = (param.override_review_cycle if param and param.override_review_cycle
              else tier.review_cycle_months)
    lead = (param.override_lead_time if param and param.override_lead_time
            else tier.lead_time_months)
    shelf = tier.shelf_life_months

    # 평균 수요 (스파이크 평활화 후 계산)
    smoothed = _smooth_spikes(demand_history)
    recent = [d for d in smoothed if d > 0]
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
    lines: list[PlanLine] = []
    locked = committed_orders or {}

    for i in range(horizon_months):
        order_ym = add_months(run_ym, i)

        if order_ym in locked:
            # 확정 발주: 재계산 없이 원본 그대로 복사
            orig = locked[order_ym]
            lines.append(PlanLine(
                plan_run_id=plan_run_id,
                product_id=product.product_id,
                ep_id=orig.ep_id,
                order_ym=order_ym,
                order_boxes=orig.order_boxes,
                order_layers=orig.order_layers,
                expected_arrival_ym=orig.expected_arrival_ym,
                projected_inv_end=orig.projected_inv_end,
                is_committed=True,
                alert=orig.alert,
            ))
            position += orig.order_boxes
        else:
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
                    is_committed=False,
                    alert=feasibility_alert,
                ))
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
    committed_map = _load_committed_map(db, run_ym, horizon_months)

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

        committed_orders = committed_map.get(product.product_id)

        # run_ym 이전 과거 확정 라인을 먼저 복사 (발주예측이 미래만 다루므로 별도 보존)
        if committed_orders:
            for order_ym, src in committed_orders.items():
                if order_ym < run_ym:
                    db.add(PlanLine(
                        plan_run_id=plan_run.plan_run_id,
                        product_id=src.product_id,
                        ep_id=src.ep_id,
                        order_ym=src.order_ym,
                        order_boxes=src.order_boxes,
                        order_layers=src.order_layers,
                        expected_arrival_ym=src.expected_arrival_ym,
                        projected_inv_end=src.projected_inv_end,
                        is_committed=True,
                        alert=src.alert,
                    ))

        lines = _plan_one_sku(
            product=product,
            demand_history=demand_history,
            initial_position=initial_position,
            plan_run_id=plan_run.plan_run_id,
            run_ym=run_ym,
            horizon_months=horizon_months,
            service_z=service_z,
            committed_orders=committed_orders,
        )
        for line in lines:
            db.add(line)
        total_lines += len(lines)

        # 수요 예측 저장 (스파이크 평활화 후 avg 사용)
        smoothed_h = _smooth_spikes(demand_history)
        recent_s = [d for d in smoothed_h if d > 0]
        avg_d = sum(recent_s) / len(recent_s) if recent_s else DEFAULT_AVG_DEMAND
        _save_forecasts(db, plan_run.plan_run_id, product, avg_d, run_ym, horizon_months)

    db.commit()
    db.refresh(plan_run)

    print(f"✅ PLAN_RUN #{plan_run.plan_run_id} 완료 — {len(products)}개 SKU, {total_lines}개 라인")
    return plan_run
