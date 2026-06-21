"""
Module 3 — 발주서(PO) 관리 API

흐름: DRAFT → SUBMITTED → CONFIRMED → RECEIVED
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import Brewery, Exporter
from app.models.order import PoLine, PurchaseOrder
from app.models.product import ExporterProduct, Product
from app.schemas.order import (
    PoLineRead,
    PurchaseOrderCreate,
    PurchaseOrderRead,
    PurchaseOrderStatusUpdate,
)
from app.services.po_service import create_pos_from_plan

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])

# 허용된 상태 전이
VALID_TRANSITIONS: dict[str, list[str]] = {
    "DRAFT": ["SUBMITTED", "CANCELLED"],
    "SUBMITTED": ["CONFIRMED", "CANCELLED"],
    "CONFIRMED": ["RECEIVED", "CANCELLED"],
    "RECEIVED": [],
    "CANCELLED": [],
}


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _enrich_po(db: Session, po: PurchaseOrder) -> PurchaseOrderRead:
    exporter = db.query(Exporter).filter(Exporter.exporter_id == po.exporter_id).first()
    lines = db.query(PoLine).filter(PoLine.po_id == po.po_id).all()
    return PurchaseOrderRead(
        po_id=po.po_id,
        po_no=po.po_no,
        exporter_id=po.exporter_id,
        exporter_code=exporter.code if exporter else None,
        exporter_name=exporter.name if exporter else None,
        order_ym=po.order_ym,
        status=po.status,
        plan_run_id=po.plan_run_id,
        created_by=po.created_by,
        submitted_at=po.submitted_at,
        confirmed_at=po.confirmed_at,
        note=po.note,
        created_at=po.created_at,
        line_count=len(lines),
        total_boxes=sum(l.order_boxes for l in lines),
        total_layers=sum(l.order_layers for l in lines),
    )


def _enrich_line(db: Session, pol: PoLine) -> PoLineRead:
    product = (
        db.query(Product)
        .options(joinedload(Product.tier), joinedload(Product.brewery))
        .filter(Product.product_id == pol.product_id)
        .first()
    )
    amount = float(pol.unit_price) * pol.order_boxes if pol.unit_price else None
    return PoLineRead(
        po_line_id=pol.po_line_id,
        po_id=pol.po_id,
        ep_id=pol.ep_id,
        product_id=pol.product_id,
        product_code=product.product_code if product else None,
        name_ja=product.name_ja if product else None,
        tier_code=product.tier.code if product and product.tier else None,
        brewery_id=product.brewery_id if product else None,
        brewery_name=product.brewery.name if product and product.brewery else None,
        order_boxes=pol.order_boxes,
        order_layers=pol.order_layers,
        unit_price=float(pol.unit_price) if pol.unit_price else None,
        currency=pol.currency,
        amount_jpy=amount,
    )


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/from-plan", response_model=list[PurchaseOrderRead], status_code=status.HTTP_201_CREATED)
def create_from_plan(
    data: PurchaseOrderCreate,
    db: DB,
    current_user=Depends(require_permission("po_approve")),
):
    """
    승인된 계획(APPROVED PLAN_RUN)의 committed 라인에서 PO 일괄 생성.
    수출자별 + 발주월별로 자동 분리.
    """
    try:
        pos = create_pos_from_plan(
            db=db,
            plan_run_id=data.plan_run_id,
            created_by=current_user.user_id,
            exporter_id=data.exporter_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if not pos:
        raise HTTPException(
            status_code=409,
            detail="생성할 PO가 없습니다 (이미 생성됐거나 committed 라인 없음)"
        )
    return [_enrich_po(db, po) for po in pos]


@router.get("/", response_model=list[PurchaseOrderRead])
def list_pos(
    db: DB,
    _: CurrentUser,
    exporter_id: Optional[int] = None,
    order_ym: Optional[str] = None,
    po_status: Optional[str] = None,
    plan_run_id: Optional[int] = None,
):
    """발주서 목록 — 필터: 수출자 / 발주월 / 상태 / 계획 실행"""
    q = db.query(PurchaseOrder)
    if exporter_id:
        q = q.filter(PurchaseOrder.exporter_id == exporter_id)
    if order_ym:
        q = q.filter(PurchaseOrder.order_ym == order_ym)
    if po_status:
        q = q.filter(PurchaseOrder.status == po_status)
    if plan_run_id:
        q = q.filter(PurchaseOrder.plan_run_id == plan_run_id)
    pos = q.order_by(PurchaseOrder.order_ym, PurchaseOrder.po_no).all()
    return [_enrich_po(db, po) for po in pos]


@router.get("/{po_id}", response_model=PurchaseOrderRead)
def get_po(po_id: int, db: DB, _: CurrentUser):
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="발주서를 찾을 수 없습니다")
    return _enrich_po(db, po)


@router.get("/{po_id}/lines", response_model=list[PoLineRead])
def get_po_lines(po_id: int, db: DB, _: CurrentUser):
    """발주서 라인 목록 (품목별 수량 + 단가 + 금액)"""
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="발주서를 찾을 수 없습니다")
    lines = db.query(PoLine).filter(PoLine.po_id == po_id).all()
    return [_enrich_line(db, l) for l in lines]


@router.put("/{po_id}/status", response_model=PurchaseOrderRead)
def update_po_status(
    po_id: int,
    data: PurchaseOrderStatusUpdate,
    db: DB,
    current_user=Depends(require_permission("po_approve")),
):
    """
    PO 상태 전이:
      DRAFT → SUBMITTED → CONFIRMED → RECEIVED
      모든 상태 → CANCELLED
    """
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="발주서를 찾을 수 없습니다")

    allowed = VALID_TRANSITIONS.get(po.status, [])
    if data.status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"'{po.status}' 상태에서 '{data.status}'로 전이할 수 없습니다. 가능: {allowed}"
        )

    now = datetime.now(timezone.utc)
    po.status = data.status
    if data.status == "SUBMITTED":
        po.submitted_at = now
    elif data.status == "CONFIRMED":
        po.confirmed_at = now
    if data.note:
        po.note = data.note

    db.commit()
    db.refresh(po)
    return _enrich_po(db, po)


@router.get("/{po_id}/preview", response_model=dict)
def preview_po(po_id: int, db: DB, _: CurrentUser):
    """
    패킹리스트 미리보기 — PO 전송 전 최종 확인용
    """
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="발주서를 찾을 수 없습니다")

    exporter = db.query(Exporter).filter(Exporter.exporter_id == po.exporter_id).first()
    lines = db.query(PoLine).filter(PoLine.po_id == po_id).all()
    enriched = [_enrich_line(db, l) for l in lines]

    total_boxes = sum(l.order_boxes for l in lines)
    total_layers = sum(l.order_layers for l in lines)
    total_pallets = -(-total_boxes // 40)  # 40박스/팔레트, 올림
    total_amount = sum(
        (l.unit_price or 0) * l.order_boxes for l in lines
    )

    return {
        "po_no": po.po_no,
        "order_ym": po.order_ym,
        "exporter": {
            "code": exporter.code if exporter else None,
            "name": exporter.name if exporter else None,
        },
        "summary": {
            "line_count": len(lines),
            "total_boxes": total_boxes,
            "total_layers": total_layers,
            "total_pallets": total_pallets,
            "total_amount_jpy": round(total_amount, 2),
        },
        "lines": [l.model_dump() for l in enriched],
    }
