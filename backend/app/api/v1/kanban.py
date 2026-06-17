"""
Module 2 — SKU Kanban 보드

컬럼 정의:
  backlog          : is_committed=False
  scheduled        : is_committed=True, plan DRAFT, PO 미생성
  pending_approval : is_committed=True, plan APPROVED, PO 미생성
  confirmed        : PO 생성 완료
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import Exporter
from app.models.order import PoLine, PurchaseOrder
from app.models.planning import PlanLine, PlanRun
from app.models.product import ExporterProduct, Product
from app.schemas.order import KanbanBoard, KanbanColumn, KanbanLine

router = APIRouter(prefix="/kanban", tags=["kanban"])


def _build_kanban_line(
    line: PlanLine,
    product: Optional[Product],
    ep: Optional[ExporterProduct],
    exporter: Optional[Exporter],
    po_id: Optional[int],
    po_no: Optional[str],
) -> KanbanLine:
    return KanbanLine(
        plan_line_id=line.plan_line_id,
        product_id=line.product_id,
        product_code=product.product_code if product else None,
        name_ja=product.name_ja if product else None,
        tier_code=product.tier.code if product and product.tier else None,
        order_ym=line.order_ym,
        order_boxes=line.order_boxes,
        order_layers=line.order_layers,
        expected_arrival_ym=line.expected_arrival_ym,
        exporter_id=exporter.exporter_id if exporter else None,
        exporter_code=exporter.code if exporter else None,
        alert=line.alert,
        po_id=po_id,
        po_no=po_no,
    )


def _get_confirmed_po_map(db: Session, plan_run_id: int) -> dict[int, tuple]:
    """product_id → (po_id, po_no) — 이 plan_run에서 생성된 PO 기준"""
    pos = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.lines))
        .filter(PurchaseOrder.plan_run_id == plan_run_id)
        .all()
    )
    result: dict[int, tuple] = {}
    for po in pos:
        for pol in po.lines:
            result[pol.product_id] = (po.po_id, po.po_no)
    return result


@router.get("/board/{plan_run_id}", response_model=KanbanBoard)
def get_kanban_board(
    plan_run_id: int,
    db: DB,
    _: CurrentUser,
    order_ym: Optional[str] = None,
    exporter_id: Optional[int] = None,
):
    """
    발주계획 기준 Kanban 보드 반환

    컬럼: backlog → scheduled → pending_approval → confirmed
    """
    run = db.query(PlanRun).filter(PlanRun.plan_run_id == plan_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="계획 실행을 찾을 수 없습니다")

    # 사전 로드
    lines_q = (
        db.query(PlanLine)
        .options(
            joinedload(PlanLine.product).joinedload(Product.tier),
            joinedload(PlanLine.exporter_product).joinedload(ExporterProduct.exporter),
        )
        .filter(PlanLine.plan_run_id == plan_run_id)
    )
    if order_ym:
        lines_q = lines_q.filter(PlanLine.order_ym == order_ym)
    if exporter_id:
        lines_q = lines_q.join(ExporterProduct).filter(
            ExporterProduct.exporter_id == exporter_id
        )
    all_lines = lines_q.all()

    # 확정 PO 매핑 (product_id → po 정보)
    confirmed_map = _get_confirmed_po_map(db, plan_run_id)

    columns: dict[str, list[KanbanLine]] = {
        "backlog": [],
        "scheduled": [],
        "pending_approval": [],
        "confirmed": [],
    }

    for line in all_lines:
        product = line.product
        ep = line.exporter_product
        exporter = ep.exporter if ep else None

        po_info = confirmed_map.get(line.product_id)
        po_id = po_info[0] if po_info else None
        po_no = po_info[1] if po_info else None

        kl = _build_kanban_line(line, product, ep, exporter, po_id, po_no)

        if po_id is not None:
            columns["confirmed"].append(kl)
        elif line.is_committed and run.status == "APPROVED":
            columns["pending_approval"].append(kl)
        elif line.is_committed:
            columns["scheduled"].append(kl)
        else:
            columns["backlog"].append(kl)

    LABELS = {
        "backlog": "대기",
        "scheduled": "예정",
        "pending_approval": "HQ 승인 대기",
        "confirmed": "확정",
    }

    return KanbanBoard(
        plan_run_id=plan_run_id,
        run_ym=run.run_ym,
        plan_status=run.status,
        columns=[
            KanbanColumn(
                column=col,
                label_ko=LABELS[col],
                count=len(items),
                lines=items,
            )
            for col, items in columns.items()
        ],
    )


@router.patch("/board/{plan_run_id}/lines/{plan_line_id}/move", response_model=dict)
def move_kanban_line(
    plan_run_id: int,
    plan_line_id: int,
    target_column: str,
    db: DB,
    _=Depends(require_permission("plan_approve")),
):
    """
    Kanban 카드 이동 (scheduled ↔ backlog 토글)
    target_column: "scheduled" | "backlog"
    """
    if target_column not in ("scheduled", "backlog"):
        raise HTTPException(
            status_code=400,
            detail="이동 가능한 컬럼: 'scheduled' 또는 'backlog'"
        )
    line = db.query(PlanLine).filter(
        PlanLine.plan_line_id == plan_line_id,
        PlanLine.plan_run_id == plan_run_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="계획 라인을 찾을 수 없습니다")

    line.is_committed = (target_column == "scheduled")
    db.commit()
    return {"plan_line_id": plan_line_id, "is_committed": line.is_committed, "column": target_column}
