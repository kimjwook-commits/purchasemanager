from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DB, CurrentUser, require_permission
from app.models.planning import PlanLine, PlanRun
from app.models.product import Product
from app.schemas.planning import (
    PlanAlert,
    PlanApproveRequest,
    PlanLineCreate,
    PlanLineRead,
    PlanLineUpdate,
    PlanRollingSummary,
    PlanRunCreate,
    PlanRunRead,
    MonthSummary,
)
from app.services.planner import BOXES_PER_PALLET, run_plan

router = APIRouter(prefix="/plan", tags=["plan"])


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _enrich_run(db: Session, plan_run: PlanRun) -> PlanRunRead:
    line_count = db.query(PlanLine).filter(PlanLine.plan_run_id == plan_run.plan_run_id).count()
    alert_count = (
        db.query(PlanLine)
        .filter(PlanLine.plan_run_id == plan_run.plan_run_id, PlanLine.alert.isnot(None))
        .count()
    )
    return PlanRunRead(
        plan_run_id=plan_run.plan_run_id,
        run_ym=plan_run.run_ym,
        version=plan_run.version,
        horizon_months=plan_run.horizon_months,
        service_z=float(plan_run.service_z),
        status=plan_run.status,
        created_by=plan_run.created_by,
        approved_by=plan_run.approved_by,
        approved_at=plan_run.approved_at,
        created_at=plan_run.created_at,
        line_count=line_count,
        alert_count=alert_count,
    )


def _enrich_line(db: Session, line: PlanLine) -> PlanLineRead:
    product = db.query(Product).options(
        joinedload(Product.tier)
    ).filter(Product.product_id == line.product_id).first()
    return _line_to_read(line, product)


def _line_to_read(line: PlanLine, product) -> PlanLineRead:
    return PlanLineRead(
        plan_line_id=line.plan_line_id,
        plan_run_id=line.plan_run_id,
        product_id=line.product_id,
        product_code=product.product_code if product else None,
        name_ja=product.name_ja if product else None,
        tier_code=product.tier.code if product and product.tier else None,
        ep_id=line.ep_id,
        order_ym=line.order_ym,
        order_boxes=line.order_boxes,
        order_layers=line.order_layers,
        expected_arrival_ym=line.expected_arrival_ym,
        projected_inv_end=line.projected_inv_end,
        is_committed=line.is_committed,
        alert=line.alert,
    )


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/runs", response_model=PlanRunRead, status_code=status.HTTP_201_CREATED)
def create_plan_run(
    data: PlanRunCreate,
    db: DB,
    current_user=Depends(require_permission("plan_approve")),
):
    """
    발주계획 실행 — 전 활성 SKU 대상 R,S Policy 계산 후 PLAN_RUN + PLAN_LINE 저장
    """
    plan_run = run_plan(
        db=db,
        run_ym=data.run_ym,
        created_by=current_user.user_id,
        horizon_months=data.horizon_months,
        service_z=data.service_z,
    )
    return _enrich_run(db, plan_run)


@router.get("/runs", response_model=list[PlanRunRead])
def list_plan_runs(
    db: DB,
    _: CurrentUser,
    run_ym: Optional[str] = None,
    status_filter: Optional[str] = None,
):
    """계획 실행 이력 목록"""
    q = db.query(PlanRun)
    if run_ym:
        q = q.filter(PlanRun.run_ym == run_ym)
    if status_filter:
        q = q.filter(PlanRun.status == status_filter)
    runs = q.order_by(PlanRun.run_ym.desc(), PlanRun.version.desc()).all()
    return [_enrich_run(db, r) for r in runs]


@router.get("/runs/{plan_run_id}", response_model=PlanRunRead)
def get_plan_run(plan_run_id: int, db: DB, _: CurrentUser):
    run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="계획 실행을 찾을 수 없습니다")
    return _enrich_run(db, run)


@router.get("/runs/{plan_run_id}/lines", response_model=list[PlanLineRead])
def get_plan_lines(
    plan_run_id: int,
    db: DB,
    _: CurrentUser,
    order_ym: Optional[str] = None,
    tier: Optional[str] = None,
    committed_only: bool = False,
    has_alert: bool = False,
):
    """계획 라인 목록 — 필터: 발주월 / 온도티어 / committed / 경고"""
    from app.models.master import TemperatureTier
    run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="계획 실행을 찾을 수 없습니다")

    # Product·Tier를 JOIN 한 방에 로드 (N+1 방지)
    q = (
        db.query(PlanLine, Product, TemperatureTier)
        .join(Product, PlanLine.product_id == Product.product_id)
        .outerjoin(TemperatureTier, Product.tier_id == TemperatureTier.tier_id)
        .filter(PlanLine.plan_run_id == plan_run_id)
    )
    if order_ym:
        q = q.filter(PlanLine.order_ym == order_ym)
    if committed_only:
        q = q.filter(PlanLine.is_committed == True)
    if has_alert:
        q = q.filter(PlanLine.alert.isnot(None))
    if tier:
        q = q.join(TemperatureTier, Product.tier_id == TemperatureTier.tier_id, isouter=False).filter(
            TemperatureTier.code == tier
        )

    rows = q.order_by(PlanLine.order_ym, PlanLine.product_id).all()

    result = []
    for line, product, t_tier in rows:
        result.append(PlanLineRead(
            plan_line_id=line.plan_line_id,
            plan_run_id=line.plan_run_id,
            product_id=line.product_id,
            product_code=product.product_code,
            name_ja=product.name_ja,
            tier_code=t_tier.code if t_tier else None,
            ep_id=line.ep_id,
            order_ym=line.order_ym,
            order_boxes=line.order_boxes,
            order_layers=line.order_layers,
            expected_arrival_ym=line.expected_arrival_ym,
            projected_inv_end=line.projected_inv_end,
            is_committed=line.is_committed,
            alert=line.alert,
        ))
    return result


@router.get("/runs/{plan_run_id}/alerts", response_model=list[PlanAlert])
def get_plan_alerts(plan_run_id: int, db: DB, _: CurrentUser):
    """타당성 위반 경고 목록"""
    lines = (
        db.query(PlanLine)
        .options(joinedload(PlanLine.product))
        .filter(PlanLine.plan_run_id == plan_run_id, PlanLine.alert.isnot(None))
        .all()
    )
    return [
        PlanAlert(
            plan_line_id=line.plan_line_id,
            product_id=line.product_id,
            product_code=line.product.product_code if line.product else None,
            order_ym=line.order_ym,
            alert=line.alert,
        )
        for line in lines
    ]


@router.get("/runs/{plan_run_id}/summary", response_model=PlanRollingSummary)
def get_plan_summary(plan_run_id: int, db: DB, _: CurrentUser):
    """
    3개월 롤링 뷰 (Module 1 UI) — 발주월별 팔레트 수 / 온도 티어 분류
    """
    run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="계획 실행을 찾을 수 없습니다")

    lines = (
        db.query(PlanLine)
        .options(joinedload(PlanLine.product).joinedload(Product.tier))
        .filter(PlanLine.plan_run_id == plan_run_id)
        .all()
    )

    # 발주월별 집계
    month_data: dict[str, dict] = {}
    for line in lines:
        ym = line.order_ym
        if ym not in month_data:
            month_data[ym] = {"cold": 0, "ambient": 0, "room": 0, "lines": 0, "alerts": 0}

        tier_code = line.product.tier.code if line.product and line.product.tier else "room"
        pallets = math.ceil(line.order_boxes / BOXES_PER_PALLET)
        month_data[ym][tier_code] += pallets
        month_data[ym]["lines"] += 1
        if line.alert:
            month_data[ym]["alerts"] += 1

    months = [
        MonthSummary(
            order_ym=ym,
            cold_pallets=data["cold"],
            ambient_pallets=data["ambient"],
            room_pallets=data["room"],
            total_pallets=data["cold"] + data["ambient"] + data["room"],
            line_count=data["lines"],
            alert_count=data["alerts"],
        )
        for ym, data in sorted(month_data.items())
    ]

    return PlanRollingSummary(
        plan_run_id=plan_run_id,
        run_ym=run.run_ym,
        months=months,
    )


@router.put("/runs/{plan_run_id}/approve", response_model=PlanRunRead)
def approve_plan_run(
    plan_run_id: int,
    data: PlanApproveRequest,
    db: DB,
    current_user=Depends(require_permission("plan_approve")),
):
    """계획 승인 — DRAFT → APPROVED, is_committed=True 라인이 Module 3으로 전달됨"""
    run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="계획 실행을 찾을 수 없습니다")
    if run.status != "DRAFT":
        raise HTTPException(status_code=409, detail=f"승인 불가 상태: {run.status}")

    run.status = "APPROVED"
    run.approved_by = current_user.user_id
    run.approved_at = datetime.now(timezone.utc)

    # 같은 run_ym의 이전 버전 ARCHIVED 처리
    db.query(PlanRun).filter(
        PlanRun.run_ym == run.run_ym,
        PlanRun.plan_run_id != plan_run_id,
        PlanRun.status == "APPROVED",
    ).update({"status": "ARCHIVED"})

    db.commit()
    db.refresh(run)
    return _enrich_run(db, run)


def _add_months(ym: str, n: int) -> str:
    year, month = map(int, ym.split('-'))
    month += n
    while month > 12: month -= 12; year += 1
    while month < 1:  month += 12; year -= 1
    return f"{year:04d}-{month:02d}"


@router.post("/runs/{plan_run_id}/lines", response_model=PlanLineRead, status_code=200)
def create_or_update_plan_line(
    plan_run_id: int,
    data: PlanLineCreate,
    db: DB,
    _=Depends(require_permission("plan_approve")),
):
    """발주 라인 수동 생성 — 동일 product+order_ym 존재 시 박스수 업데이트"""
    run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="계획 실행을 찾을 수 없습니다")

    existing = db.query(PlanLine).filter(
        PlanLine.plan_run_id == plan_run_id,
        PlanLine.product_id == data.product_id,
        PlanLine.order_ym == data.order_ym,
    ).first()

    arrival_ym = _add_months(data.order_ym, 1)
    layers = math.ceil(data.order_boxes / BOXES_PER_PALLET) if data.order_boxes > 0 else 0

    if existing:
        existing.order_boxes = data.order_boxes
        existing.order_layers = layers
        db.commit()
        db.refresh(existing)
        return _enrich_line(db, existing)

    line = PlanLine(
        plan_run_id=plan_run_id,
        product_id=data.product_id,
        order_ym=data.order_ym,
        order_boxes=data.order_boxes,
        order_layers=layers,
        expected_arrival_ym=arrival_ym,
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    return _enrich_line(db, line)


@router.patch("/runs/{plan_run_id}/lines/{plan_line_id}", response_model=PlanLineRead)
def update_plan_line(
    plan_run_id: int,
    plan_line_id: int,
    data: PlanLineUpdate,
    db: DB,
    _=Depends(require_permission("plan_approve")),
):
    """발주량 수동 수정 — order_boxes 직접 변경"""
    line = db.query(PlanLine).filter(
        PlanLine.plan_line_id == plan_line_id,
        PlanLine.plan_run_id == plan_run_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="계획 라인을 찾을 수 없습니다")
    if data.order_boxes is not None:
        if data.order_boxes < 0:
            raise HTTPException(status_code=422, detail="발주 박스수는 0 이상이어야 합니다")
        line.order_boxes = data.order_boxes
        line.order_layers = math.ceil(data.order_boxes / BOXES_PER_PALLET) if data.order_boxes > 0 else 0
    db.commit()
    db.refresh(line)
    return _enrich_line(db, line)


@router.patch("/runs/{plan_run_id}/lines/{plan_line_id}/commit", response_model=PlanLineRead)
def toggle_commit(
    plan_run_id: int,
    plan_line_id: int,
    is_committed: bool,
    db: DB,
    _=Depends(require_permission("plan_approve")),
):
    """라인 단위 committed 토글 (Module 2 Kanban 연동)"""
    line = db.query(PlanLine).filter(
        PlanLine.plan_line_id == plan_line_id,
        PlanLine.plan_run_id == plan_run_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="계획 라인을 찾을 수 없습니다")

    line.is_committed = is_committed
    db.commit()
    db.refresh(line)
    return _enrich_line(db, line)


# math 임포트 (summary 내부에서 사용)
import math
