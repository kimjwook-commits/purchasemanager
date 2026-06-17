"""
Module 4 — 팔레트/컨테이너 배정 API

흐름:
  POST /generate      — FFD 계획 미리보기 (DB 저장 없음)
  POST /confirm       — 계획 확정 → Shipment + Container + ContainerLoad 저장
  GET  /{po_id}       — 확정 계획 조회 (ContainerLoad 기준)
  GET  /{po_id}/shipment    — 선적 헤더 조회
  GET  /{po_id}/packing-list — 패킹리스트 출력
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import ContainerSpec, TemperatureTier
from app.models.order import PoLine, PurchaseOrder
from app.models.product import Product
from app.models.shipment import Container, ContainerLoad, Shipment
from app.schemas.shipment import (
    ContainerConfirmRequest,
    ContainerPlanRequest,
    ContainerRead,
    ContainerSlotRead,
    LineAssignmentRead,
    PackingPlanResult,
    ShipmentRead,
)
from app.services.packing_service import (
    confirm_packing_plan,
    generate_packing_plan,
    get_confirmed_plan,
)

router = APIRouter(prefix="/container-plan", tags=["container-plan"])


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _plan_to_response(plan) -> PackingPlanResult:
    containers = []
    for seq, slot in enumerate(plan.containers, start=1):
        assignments = [
            LineAssignmentRead(
                po_line_id=a.po_line_id,
                product_id=a.product_id,
                product_code=a.product_code,
                name_ja=a.name_ja,
                tier_code=a.tier_code,
                total_boxes=a.total_boxes,
                pallets_in_container=a.pallets_in_container,
                boxes_in_container=a.boxes_in_container,
                layers_in_container=a.layers_in_container,
                pallet_start=a.pallet_start,
            )
            for a in slot.assignments
        ]
        containers.append(ContainerSlotRead(
            seq=seq,
            spec_id=slot.spec_id,
            container_type=slot.container_type,
            tier_code=slot.tier_code,
            cost_usd=slot.cost_usd,
            max_pallets=slot.max_pallets,
            pallets_used=slot.pallets_used,
            assignments=assignments,
        ))
    return PackingPlanResult(
        po_id=plan.po_id,
        po_no=plan.po_no,
        total_boxes=plan.total_boxes,
        total_pallets=plan.total_pallets,
        container_count=len(containers),
        total_cost_usd=plan.total_cost_usd,
        containers=containers,
    )


def _enrich_shipment(db: Session, shipment: Shipment) -> ShipmentRead:
    """Shipment → ShipmentRead (컨테이너 리스트 포함)"""
    all_specs = {s.spec_id: s for s in db.query(ContainerSpec).all()}
    all_tiers = {t.tier_id: t for t in db.query(TemperatureTier).all()}

    containers_out: List[ContainerRead] = []
    for c in shipment.containers:
        spec = all_specs.get(c.spec_id)
        tier_code = None
        if spec:
            tier = all_tiers.get(spec.tier_id)
            tier_code = tier.code if tier else None

        load_count = (
            db.query(ContainerLoad)
            .filter(ContainerLoad.container_id == c.container_id)
            .count()
        )
        containers_out.append(ContainerRead(
            container_id=c.container_id,
            shipment_id=c.shipment_id,
            spec_id=c.spec_id,
            container_type=spec.container_type if spec else None,
            tier_code=tier_code,
            container_no=c.container_no,
            seal_no=c.seal_no,
            pallets_used=c.pallets_used,
            cost_usd=float(c.cost_usd) if c.cost_usd else None,
            load_count=load_count,
        ))

    total_cost = sum(c.cost_usd or 0.0 for c in containers_out)

    dep_date = (
        shipment.departure_date.isoformat() if shipment.departure_date else None
    )
    arr_date = (
        shipment.arrival_date.isoformat() if shipment.arrival_date else None
    )

    return ShipmentRead(
        shipment_id=shipment.shipment_id,
        po_id=shipment.po_id,
        status=shipment.status,
        bl_no=shipment.bl_no,
        vessel_name=shipment.vessel_name,
        departure_date=dep_date,
        arrival_date=arr_date,
        container_count=len(containers_out),
        total_cost_usd=total_cost,
        containers=containers_out,
    )


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────

@router.post(
    "/generate",
    response_model=PackingPlanResult,
    summary="FFD 팔레트/컨테이너 계획 생성 (미저장 미리보기)",
)
def generate(
    body: ContainerPlanRequest,
    db: DB,
    _: CurrentUser,
):
    """
    PO 라인의 박스 수 기준으로 FFD 알고리즘을 실행하여 팔레트/컨테이너 배정 계획을
    반환합니다. **DB에는 저장하지 않습니다.** 확정 전 검토용입니다.
    """
    try:
        plan = generate_packing_plan(db, body.po_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _plan_to_response(plan)


@router.post(
    "/confirm",
    response_model=ShipmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="컨테이너 계획 확정 → Shipment / Container / ContainerLoad 저장",
)
def confirm(
    body: ContainerConfirmRequest,
    db: DB,
    _=Depends(require_permission("po_approve")),
):
    """
    FFD 계획을 확정하여 SHIPMENT (DEPARTED), CONTAINER, CONTAINER_LOAD 레코드를
    생성합니다. 동일 PO에 이미 선적 건이 있으면 409를 반환합니다.
    """
    try:
        shipment = confirm_packing_plan(db, body.po_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # eager load containers
    shipment = (
        db.query(Shipment)
        .options(joinedload(Shipment.containers))
        .filter(Shipment.shipment_id == shipment.shipment_id)
        .first()
    )
    return _enrich_shipment(db, shipment)


@router.get(
    "/{po_id}",
    response_model=PackingPlanResult,
    summary="확정 컨테이너 계획 조회 (ContainerLoad 기반 재구성)",
)
def get_plan(po_id: int, db: DB, _: CurrentUser):
    """
    이미 확정된 컨테이너 계획을 ContainerLoad 레코드에서 재구성하여 반환합니다.
    미확정 상태면 404를 반환합니다.
    """
    shipment = (
        db.query(Shipment)
        .options(
            joinedload(Shipment.containers).joinedload(Container.loads)
        )
        .filter(Shipment.po_id == po_id)
        .first()
    )
    if not shipment:
        raise HTTPException(
            status_code=404,
            detail="확정된 컨테이너 계획이 없습니다. /generate 로 계획을 먼저 확인하세요."
        )

    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    all_specs = {s.spec_id: s for s in db.query(ContainerSpec).all()}
    all_tiers = {t.tier_id: t for t in db.query(TemperatureTier).all()}
    all_products = {
        p.product_id: p
        for p in db.query(Product).options(joinedload(Product.tier)).all()
    }

    containers_out: List[ContainerSlotRead] = []
    total_boxes = 0

    for seq, c in enumerate(shipment.containers, start=1):
        spec = all_specs.get(c.spec_id)
        tier_code = None
        if spec:
            tier = all_tiers.get(spec.tier_id)
            tier_code = tier.code if tier else None

        assignments: List[LineAssignmentRead] = []
        for load in c.loads:
            product = all_products.get(load.po_line_id)  # note: load has po_line_id
            # reload product via po_line
            pol = db.query(PoLine).filter(PoLine.po_line_id == load.po_line_id).first()
            product = all_products.get(pol.product_id) if pol else None

            assignments.append(LineAssignmentRead(
                po_line_id=load.po_line_id,
                product_id=pol.product_id if pol else 0,
                product_code=product.product_code if product else None,
                name_ja=product.name_ja if product else None,
                tier_code=product.tier.code if product and product.tier else None,
                total_boxes=load.boxes_loaded,
                pallets_in_container=load.layers_loaded // 4 or 1,
                boxes_in_container=load.boxes_loaded,
                layers_in_container=load.layers_loaded,
                pallet_start=load.pallet_no,
            ))
            total_boxes += load.boxes_loaded

        containers_out.append(ContainerSlotRead(
            seq=seq,
            spec_id=c.spec_id,
            container_type=spec.container_type if spec else "unknown",
            tier_code=tier_code or "unknown",
            cost_usd=float(c.cost_usd) if c.cost_usd else 0.0,
            max_pallets=spec.max_pallets if spec else 0,
            pallets_used=c.pallets_used,
            assignments=assignments,
        ))

    total_pallets = sum(c.pallets_used for c in containers_out)
    total_cost = sum(c.cost_usd for c in containers_out)

    return PackingPlanResult(
        po_id=po_id,
        po_no=po.po_no if po else "",
        total_boxes=total_boxes,
        total_pallets=total_pallets,
        container_count=len(containers_out),
        total_cost_usd=round(total_cost, 2),
        containers=containers_out,
    )


@router.get(
    "/{po_id}/shipment",
    response_model=ShipmentRead,
    summary="PO의 선적 헤더 조회",
)
def get_shipment(po_id: int, db: DB, _: CurrentUser):
    shipment = (
        db.query(Shipment)
        .options(joinedload(Shipment.containers))
        .filter(Shipment.po_id == po_id)
        .first()
    )
    if not shipment:
        raise HTTPException(status_code=404, detail="선적 건이 없습니다")
    return _enrich_shipment(db, shipment)


@router.get(
    "/{po_id}/packing-list",
    response_model=dict,
    summary="패킹리스트 출력 (컨테이너별 적재 명세)",
)
def packing_list(po_id: int, db: DB, _: CurrentUser):
    """
    컨테이너별 적재 명세를 반환합니다.
    선적 확정 전이면 generate 결과로, 확정 후면 DB 기준으로 표시합니다.
    """
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="발주서를 찾을 수 없습니다")

    # 확정 여부 확인
    shipment = db.query(Shipment).filter(Shipment.po_id == po_id).first()
    is_confirmed = shipment is not None

    try:
        plan = generate_packing_plan(db, po_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from app.models.master import Exporter
    exporter = db.query(Exporter).filter(Exporter.exporter_id == po.exporter_id).first()

    containers_detail = []
    for seq, slot in enumerate(plan.containers, start=1):
        lines_detail = []
        for a in slot.assignments:
            lines_detail.append({
                "po_line_id": a.po_line_id,
                "product_code": a.product_code,
                "name_ja": a.name_ja,
                "tier": a.tier_code,
                "boxes": a.boxes_in_container,
                "layers": a.layers_in_container,
                "pallets": a.pallets_in_container,
                "pallet_positions": f"{a.pallet_start}~{a.pallet_start + a.pallets_in_container - 1}",
            })
        containers_detail.append({
            "seq": seq,
            "type": slot.container_type,
            "tier": slot.tier_code,
            "max_pallets": slot.max_pallets,
            "pallets_used": slot.pallets_used,
            "cost_usd": slot.cost_usd,
            "lines": lines_detail,
        })

    return {
        "status": "CONFIRMED" if is_confirmed else "DRAFT",
        "shipment_id": shipment.shipment_id if shipment else None,
        "po_no": po.po_no,
        "order_ym": po.order_ym,
        "exporter": {
            "code": exporter.code if exporter else None,
            "name": exporter.name if exporter else None,
        },
        "summary": {
            "total_boxes": plan.total_boxes,
            "total_pallets": plan.total_pallets,
            "container_count": len(plan.containers),
            "total_cost_usd": plan.total_cost_usd,
        },
        "containers": containers_detail,
    }
