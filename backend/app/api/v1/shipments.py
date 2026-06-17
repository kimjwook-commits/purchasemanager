"""
Phase 5: 선적 스테퍼 API
상태 전이: DEPARTED → ARRIVED → IN_TRANSIT → INSPECTING → CUSTOMS → RECEIVED
취소: 어떤 상태에서도 → CANCELLED
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_permission
from app.database import get_db
from app.models.inventory import InventoryLot
from app.models.auth import AppUser
from app.models.master import Exporter, WarehouseZone
from app.models.order import PoLine, PurchaseOrder
from app.models.shipment import Container, ContainerLoad, Inspection, Shipment
from app.schemas.shipment import (
    InspectionCreate,
    InspectionRead,
    InventoryLotRead,
    LotInput,
    ReceiveRequest,
    ShipmentAdvanceRequest,
    ShipmentCancelRequest,
    ShipmentDetail,
    ShipmentListItem,
)

router = APIRouter(prefix="/shipments", tags=["shipments"])

# 상태 전이 순서
STATUS_ORDER = ["DEPARTED", "ARRIVED", "IN_TRANSIT", "INSPECTING", "CUSTOMS", "RECEIVED"]
NEXT_STATUS = {STATUS_ORDER[i]: STATUS_ORDER[i + 1] for i in range(len(STATUS_ORDER) - 1)}


def _shipment_or_404(db: Session, shipment_id: int) -> Shipment:
    s = db.get(Shipment, shipment_id)
    if not s:
        raise HTTPException(404, f"선적 {shipment_id} 없음")
    return s


def _build_detail(db: Session, s: Shipment) -> ShipmentDetail:
    """Shipment → ShipmentDetail 조립"""
    po = db.get(PurchaseOrder, s.po_id)
    containers = (
        db.execute(
            select(Container).where(Container.shipment_id == s.shipment_id)
        ).scalars().all()
    )
    inspections = (
        db.execute(
            select(Inspection).where(Inspection.shipment_id == s.shipment_id)
        ).scalars().all()
    )

    insp_reads = []
    for ins in inspections:
        from app.models.product import Product as ProductModel
        prod = db.get(ProductModel, ins.product_id)
        insp_reads.append(InspectionRead(
            inspection_id=ins.inspection_id,
            shipment_id=ins.shipment_id,
            product_id=ins.product_id,
            product_code=prod.product_code if prod else None,
            name_ja=prod.name_ja if prod else None,
            sample_boxes=ins.sample_boxes,
            result=ins.result,
            inspector_id=ins.inspector_id,
            inspected_at=ins.inspected_at,
            note=ins.note,
        ))

    from app.schemas.shipment import ContainerRead
    c_reads = []
    for c in containers:
        load_count = db.execute(
            select(ContainerLoad).where(ContainerLoad.container_id == c.container_id)
        ).scalars().all()
        c_reads.append(ContainerRead(
            container_id=c.container_id,
            shipment_id=c.shipment_id,
            spec_id=c.spec_id,
            container_no=c.container_no,
            seal_no=c.seal_no,
            pallets_used=c.pallets_used,
            cost_usd=float(c.cost_usd) if c.cost_usd else None,
            load_count=len(load_count),
        ))

    total_cost = sum(float(c.cost_usd or 0) for c in containers)

    return ShipmentDetail(
        shipment_id=s.shipment_id,
        po_id=s.po_id,
        po_no=po.po_no if po else None,
        status=s.status,
        bl_no=s.bl_no,
        do_no=s.do_no,
        vessel_name=s.vessel_name,
        departure_port=s.departure_port,
        arrival_port=s.arrival_port,
        departure_date=s.departure_date,
        arrival_date=s.arrival_date,
        inland_date=s.inland_date,
        inspection_date=s.inspection_date,
        customs_clearance_date=s.customs_clearance_date,
        received_date=s.received_date,
        rcep_cert_no=s.rcep_cert_no,
        customs_declaration_no=s.customs_declaration_no,
        note=s.note,
        container_count=len(containers),
        total_cost_usd=total_cost,
        containers=c_reads,
        inspections=insp_reads,
    )


# ── 선적 목록 ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[ShipmentListItem])
def list_shipments(
    status: Optional[str] = Query(None),
    exporter_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    q = select(Shipment)
    if status:
        q = q.where(Shipment.status == status)
    ships = db.execute(q.order_by(Shipment.shipment_id.desc())).scalars().all()

    result = []
    for s in ships:
        po = db.get(PurchaseOrder, s.po_id)
        if exporter_id and po and po.exporter_id != exporter_id:
            continue

        exporter = db.get(Exporter, po.exporter_id) if po else None
        containers = db.execute(
            select(Container).where(Container.shipment_id == s.shipment_id)
        ).scalars().all()
        total_cost = sum(float(c.cost_usd or 0) for c in containers)

        result.append(ShipmentListItem(
            shipment_id=s.shipment_id,
            po_id=s.po_id,
            po_no=po.po_no if po else None,
            exporter_code=exporter.code if exporter else None,
            exporter_name=exporter.name if exporter else None,
            order_ym=po.order_ym if po else None,
            status=s.status,
            bl_no=s.bl_no,
            vessel_name=s.vessel_name,
            departure_date=s.departure_date,
            arrival_date=s.arrival_date,
            container_count=len(containers),
            total_cost_usd=total_cost,
        ))
    return result


# ── 선적 상세 ────────────────────────────────────────────────────────────────

@router.get("/{shipment_id}", response_model=ShipmentDetail)
def get_shipment(
    shipment_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    s = _shipment_or_404(db, shipment_id)
    return _build_detail(db, s)


# ── 단계 전진 ────────────────────────────────────────────────────────────────

@router.post("/{shipment_id}/advance", response_model=ShipmentDetail)
def advance_shipment(
    shipment_id: int,
    req: ShipmentAdvanceRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_permission("po_approve")),
):
    s = _shipment_or_404(db, shipment_id)
    if s.status not in NEXT_STATUS:
        raise HTTPException(400, f"'{s.status}' 상태에서는 더 이상 전진할 수 없습니다")
    if s.status == "CUSTOMS":
        raise HTTPException(400, "CUSTOMS → RECEIVED 는 /receive 엔드포인트를 사용하세요")

    # 선택 필드 업데이트
    for field, value in req.model_dump(exclude_none=True).items():
        setattr(s, field, value)

    s.status = NEXT_STATUS[s.status]
    db.commit()
    db.refresh(s)
    return _build_detail(db, s)


# ── 선적 취소 ────────────────────────────────────────────────────────────────

@router.post("/{shipment_id}/cancel", response_model=ShipmentDetail)
def cancel_shipment(
    shipment_id: int,
    req: ShipmentCancelRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_permission("po_approve")),
):
    s = _shipment_or_404(db, shipment_id)
    if s.status in ("RECEIVED", "CANCELLED"):
        raise HTTPException(400, f"'{s.status}' 상태는 취소 불가")
    if req.note:
        s.note = req.note
    s.status = "CANCELLED"
    db.commit()
    db.refresh(s)
    return _build_detail(db, s)


# ── 컨테이너 번호 / 씰 업데이트 ──────────────────────────────────────────────

@router.patch("/{shipment_id}/containers/{container_id}")
def update_container(
    shipment_id: int,
    container_id: int,
    container_no: Optional[str] = None,
    seal_no: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_permission("po_approve")),
):
    c = db.get(Container, container_id)
    if not c or c.shipment_id != shipment_id:
        raise HTTPException(404, "컨테이너 없음")
    if container_no is not None:
        c.container_no = container_no
    if seal_no is not None:
        c.seal_no = seal_no
    db.commit()
    return {"container_id": c.container_id, "container_no": c.container_no, "seal_no": c.seal_no}


# ── 검수 ─────────────────────────────────────────────────────────────────────

@router.post("/{shipment_id}/inspections", response_model=InspectionRead)
def add_inspection(
    shipment_id: int,
    req: InspectionCreate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(get_current_user),
):
    s = _shipment_or_404(db, shipment_id)
    if s.status not in ("ARRIVED", "IN_TRANSIT", "INSPECTING"):
        raise HTTPException(400, f"'{s.status}' 상태에서는 검수 등록 불가")
    ins = Inspection(
        shipment_id=shipment_id,
        product_id=req.product_id,
        sample_boxes=req.sample_boxes,
        result=req.result,
        inspector_id=current_user.user_id,
        inspected_at=datetime.now(timezone.utc),
        note=req.note,
    )
    db.add(ins)
    db.commit()
    db.refresh(ins)

    from app.models.product import Product as ProductModel
    prod = db.get(ProductModel, ins.product_id)
    return InspectionRead(
        inspection_id=ins.inspection_id,
        shipment_id=ins.shipment_id,
        product_id=ins.product_id,
        product_code=prod.product_code if prod else None,
        name_ja=prod.name_ja if prod else None,
        sample_boxes=ins.sample_boxes,
        result=ins.result,
        inspector_id=ins.inspector_id,
        inspected_at=ins.inspected_at,
        note=ins.note,
    )


@router.get("/{shipment_id}/inspections", response_model=List[InspectionRead])
def list_inspections(
    shipment_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    rows = db.execute(
        select(Inspection).where(Inspection.shipment_id == shipment_id)
    ).scalars().all()

    result = []
    for ins in rows:
        from app.models.product import Product as ProductModel
        prod = db.get(ProductModel, ins.product_id)
        result.append(InspectionRead(
            inspection_id=ins.inspection_id,
            shipment_id=ins.shipment_id,
            product_id=ins.product_id,
            product_code=prod.product_code if prod else None,
            name_ja=prod.name_ja if prod else None,
            sample_boxes=ins.sample_boxes,
            result=ins.result,
            inspector_id=ins.inspector_id,
            inspected_at=ins.inspected_at,
            note=ins.note,
        ))
    return result


# ── 입고 확정 (CUSTOMS → RECEIVED + InventoryLot 생성) ───────────────────────

@router.post("/{shipment_id}/receive", response_model=List[InventoryLotRead])
def receive_shipment(
    shipment_id: int,
    req: ReceiveRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_permission("po_approve")),
):
    s = _shipment_or_404(db, shipment_id)
    if s.status != "CUSTOMS":
        raise HTTPException(400, f"CUSTOMS 상태여야 입고 확정 가능 (현재: {s.status})")

    # PO 라인 → 상품 / 창고존 매핑
    po_lines: dict[int, PoLine] = {}
    for line_input in req.lots:
        pl = db.get(PoLine, line_input.po_line_id)
        if not pl:
            raise HTTPException(404, f"PO 라인 {line_input.po_line_id} 없음")
        po_lines[line_input.po_line_id] = pl

    now = datetime.now(timezone.utc)
    created_lots = []

    for lot_input in req.lots:
        pl = po_lines[lot_input.po_line_id]

        # 상품 → 온도 티어 → 창고존 결정
        from app.models.product import Product as ProductModel
        prod = db.get(ProductModel, pl.product_id)
        if not prod:
            raise HTTPException(404, f"상품 {pl.product_id} 없음")

        zone = db.execute(
            select(WarehouseZone)
            .where(WarehouseZone.tier_id == prod.tier_id, WarehouseZone.is_active == True)
            .limit(1)
        ).scalar_one_or_none()
        if not zone:
            raise HTTPException(500, f"상품 {prod.product_code}의 창고존을 찾을 수 없음")

        # 로트 번호: LOT-{shipment_id}-{po_line_id}-{yyyymmdd}
        lot_no = f"LOT-{shipment_id}-{pl.po_line_id}-{now.strftime('%Y%m%d')}"

        lot = InventoryLot(
            product_id=pl.product_id,
            zone_id=zone.zone_id,
            po_line_id=pl.po_line_id,
            lot_no=lot_no,
            qty_boxes=lot_input.qty_boxes,
            mfg_date=lot_input.mfg_date,
            exp_date=lot_input.exp_date,
            received_at=now,
            status="AVAILABLE",
        )
        db.add(lot)
        created_lots.append(lot)

    s.status = "RECEIVED"
    s.received_date = now.date()
    db.commit()
    for lot in created_lots:
        db.refresh(lot)

    return [InventoryLotRead.model_validate(lot) for lot in created_lots]
