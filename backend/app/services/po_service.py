"""
Module 3 — PO 생성 서비스

PLAN_RUN(APPROVED) → committed PLAN_LINE →
  수출자별 + 발주월별 그룹핑 →
    PURCHASE_ORDER(DRAFT) + PO_LINE 생성
"""
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.models.master import Exporter
from app.models.order import PoLine, PurchaseOrder
from app.models.planning import PlanLine, PlanRun
from app.models.product import ExporterProduct, SupplyPrice


def _generate_po_no(db: Session, order_ym: str, exporter_code: str) -> str:
    """PM-YYYY-MM-EXPCODE-NNN 형식 PO 번호 자동 생성"""
    prefix = f"PM-{order_ym}-{exporter_code}"
    count = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.po_no.like(f"{prefix}-%"))
        .count()
    )
    return f"{prefix}-{count + 1:03d}"


def _latest_supply_price(db: Session, ep_id: int) -> Optional[SupplyPrice]:
    return (
        db.query(SupplyPrice)
        .filter(SupplyPrice.ep_id == ep_id)
        .order_by(SupplyPrice.effective_date.desc())
        .first()
    )


def create_pos_from_plan(
    db: Session,
    plan_run_id: int,
    created_by: int,
    exporter_id: Optional[int] = None,
) -> list[PurchaseOrder]:
    """
    승인된 계획의 committed 라인 → PO 일괄 생성

    Args:
        plan_run_id:  APPROVED 상태의 PLAN_RUN ID
        created_by:   생성 사용자 ID
        exporter_id:  None이면 전 수출자, 지정 시 해당 수출자만

    Returns:
        생성된 PURCHASE_ORDER 목록
    """
    plan_run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not plan_run:
        raise ValueError("계획 실행을 찾을 수 없습니다")
    if plan_run.status != "APPROVED":
        raise ValueError(f"APPROVED 상태의 계획만 PO 생성 가능합니다 (현재: {plan_run.status})")

    # committed + ep_id 있는 라인만 대상
    q = (
        db.query(PlanLine)
        .options(joinedload(PlanLine.exporter_product))
        .filter(
            PlanLine.plan_run_id == plan_run_id,
            PlanLine.is_committed == True,
            PlanLine.ep_id.isnot(None),
        )
    )
    if exporter_id:
        q = q.join(ExporterProduct).filter(ExporterProduct.exporter_id == exporter_id)

    committed_lines = q.all()
    if not committed_lines:
        return []

    # 수출자 정보 사전 로드
    exporters: dict[int, Exporter] = {
        e.exporter_id: e
        for e in db.query(Exporter).all()
    }
    ep_map: dict[int, ExporterProduct] = {
        ep.ep_id: ep
        for ep in db.query(ExporterProduct).all()
    }

    # (exporter_id, order_ym) → [PlanLine] 그룹핑
    groups: dict[tuple, list[PlanLine]] = {}
    for line in committed_lines:
        ep = ep_map.get(line.ep_id)
        if not ep:
            continue
        key = (ep.exporter_id, line.order_ym)
        groups.setdefault(key, []).append(line)

    created: list[PurchaseOrder] = []

    for (exp_id, order_ym), lines in sorted(groups.items()):
        # 이미 생성된 PO 중복 방지
        existing = db.query(PurchaseOrder).filter(
            PurchaseOrder.plan_run_id == plan_run_id,
            PurchaseOrder.exporter_id == exp_id,
            PurchaseOrder.order_ym == order_ym,
        ).first()
        if existing:
            continue

        exporter = exporters.get(exp_id)
        if not exporter:
            continue

        po_no = _generate_po_no(db, order_ym, exporter.code)
        po = PurchaseOrder(
            po_no=po_no,
            exporter_id=exp_id,
            order_ym=order_ym,
            plan_run_id=plan_run_id,
            status="DRAFT",
            created_by=created_by,
        )
        db.add(po)
        db.flush()  # po_id 확보

        for line in lines:
            ep = ep_map.get(line.ep_id)
            price = _latest_supply_price(db, line.ep_id) if line.ep_id else None
            db.add(PoLine(
                po_id=po.po_id,
                ep_id=line.ep_id,
                product_id=line.product_id,
                order_boxes=line.order_boxes,
                order_layers=line.order_layers,
                unit_price=float(price.supply_price) if price else None,
                currency=price.currency if price else "JPY",
            ))

        created.append(po)

    db.commit()
    for po in created:
        db.refresh(po)

    return created
