"""
Module 4+5 — 컨테이너 계획 / 선적 스키마
"""
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel


# ── 팔레트 배정 라인 ─────────────────────────────────────────────────────────

class LineAssignmentRead(BaseModel):
    po_line_id: int
    product_id: int
    product_code: Optional[str]
    name_ja: Optional[str]
    tier_code: Optional[str]
    total_boxes: int
    pallets_in_container: int
    boxes_in_container: int
    layers_in_container: int
    pallet_start: int          # 컨테이너 내 팔레트 시작 번호


# ── 컨테이너 슬롯 ─────────────────────────────────────────────────────────────

class ContainerSlotRead(BaseModel):
    seq: int                   # 컨테이너 순번 (1-based)
    spec_id: int
    container_type: str        # 20ft / 40ft
    tier_code: str             # cold / room
    cost_usd: float
    max_pallets: int
    pallets_used: int
    assignments: List[LineAssignmentRead]


# ── 전체 팔레트/컨테이너 계획 ────────────────────────────────────────────────

class PackingPlanResult(BaseModel):
    po_id: int
    po_no: str
    total_boxes: int
    total_pallets: int
    container_count: int
    total_cost_usd: float
    containers: List[ContainerSlotRead]


# ── Shipment (확정 후) ───────────────────────────────────────────────────────

class ContainerRead(BaseModel):
    model_config = {"from_attributes": True}

    container_id: int
    shipment_id: int
    spec_id: int
    container_type: Optional[str] = None   # 조인 후 채움
    tier_code: Optional[str] = None
    container_no: Optional[str] = None
    seal_no: Optional[str] = None
    pallets_used: int
    cost_usd: Optional[float] = None
    load_count: int = 0                    # ContainerLoad 건수


class ShipmentRead(BaseModel):
    model_config = {"from_attributes": True}

    shipment_id: int
    po_id: int
    status: str
    bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None
    container_count: int = 0
    total_cost_usd: float = 0.0
    containers: List[ContainerRead] = []


# ── Requests ──────────────────────────────────────────────────────────────────

class ContainerPlanRequest(BaseModel):
    po_id: int


class ContainerConfirmRequest(BaseModel):
    po_id: int


# ── Phase 5: 선적 스테퍼 ─────────────────────────────────────────────────────

class ShipmentAdvanceRequest(BaseModel):
    """단계 전진 요청 — 각 단계에서 필요한 필드를 선택적으로 입력"""
    bl_no: Optional[str] = None
    do_no: Optional[str] = None
    vessel_name: Optional[str] = None
    departure_port: Optional[str] = None
    arrival_port: Optional[str] = None
    departure_date: Optional[date] = None
    arrival_date: Optional[date] = None
    inland_date: Optional[date] = None
    inspection_date: Optional[date] = None
    customs_clearance_date: Optional[date] = None
    rcep_cert_no: Optional[str] = None
    customs_declaration_no: Optional[str] = None
    note: Optional[str] = None


class ShipmentCancelRequest(BaseModel):
    note: Optional[str] = None


class InspectionCreate(BaseModel):
    product_id: int
    sample_boxes: int
    result: str          # PASS / FAIL / CONDITIONAL
    note: Optional[str] = None


class InspectionRead(BaseModel):
    model_config = {"from_attributes": True}

    inspection_id: int
    shipment_id: int
    product_id: int
    product_code: Optional[str] = None
    name_ja: Optional[str] = None
    sample_boxes: int
    result: str
    inspector_id: Optional[int] = None
    inspected_at: Optional[datetime] = None
    note: Optional[str] = None


class ShipmentDetail(BaseModel):
    """ShipmentRead 확장 — 검수 포함"""
    model_config = {"from_attributes": True}

    shipment_id: int
    po_id: int
    po_no: Optional[str] = None
    status: str
    bl_no: Optional[str] = None
    do_no: Optional[str] = None
    vessel_name: Optional[str] = None
    departure_port: Optional[str] = None
    arrival_port: Optional[str] = None
    departure_date: Optional[date] = None
    arrival_date: Optional[date] = None
    inland_date: Optional[date] = None
    inspection_date: Optional[date] = None
    customs_clearance_date: Optional[date] = None
    received_date: Optional[date] = None
    rcep_cert_no: Optional[str] = None
    customs_declaration_no: Optional[str] = None
    note: Optional[str] = None
    container_count: int = 0
    total_cost_usd: float = 0.0
    containers: List[ContainerRead] = []
    inspections: List[InspectionRead] = []


class InventoryLotRead(BaseModel):
    model_config = {"from_attributes": True}

    lot_id: int
    product_id: int
    zone_id: int
    po_line_id: Optional[int] = None
    lot_no: str
    qty_boxes: int
    mfg_date: Optional[date] = None
    exp_date: Optional[date] = None
    received_at: datetime
    status: str


class ReceiveRequest(BaseModel):
    """입고 확정 — 각 PO라인의 실입고 박스와 로트 정보"""
    lots: List["LotInput"]


class LotInput(BaseModel):
    po_line_id: int
    qty_boxes: int
    mfg_date: Optional[date] = None
    exp_date: Optional[date] = None


ReceiveRequest.model_rebuild()


class ShipmentListItem(BaseModel):
    model_config = {"from_attributes": True}

    shipment_id: int
    po_id: int
    po_no: Optional[str] = None
    exporter_code: Optional[str] = None
    exporter_name: Optional[str] = None
    order_ym: Optional[str] = None
    status: str
    bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    departure_date: Optional[date] = None
    arrival_date: Optional[date] = None
    container_count: int = 0
    total_cost_usd: float = 0.0
