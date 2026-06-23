from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ── PO Line ───────────────────────────────────────────────────────────────────

class PoLineRead(BaseModel):
    model_config = {"from_attributes": True}

    po_line_id: int
    po_id: int
    ep_id: int
    product_id: int
    product_code: Optional[str] = None
    name_ja: Optional[str] = None
    tier_code: Optional[str] = None
    brewery_id: Optional[int] = None
    brewery_name: Optional[str] = None
    order_boxes: int
    order_layers: int
    unit_price: Optional[float]
    currency: str
    amount_jpy: Optional[float] = None   # unit_price × order_boxes


# ── Purchase Order ─────────────────────────────────────────────────────────────

class PurchaseOrderCreate(BaseModel):
    """계획 실행 기준 PO 일괄 생성"""
    plan_run_id: int
    exporter_id: Optional[int] = None  # None → 전 수출자 대상


class PurchaseOrderStatusUpdate(BaseModel):
    status: str   # SUBMITTED / CONFIRMED / CANCELLED
    note: Optional[str] = None


class PurchaseOrderRead(BaseModel):
    model_config = {"from_attributes": True}

    po_id: int
    po_no: str
    exporter_id: int
    exporter_code: Optional[str] = None
    exporter_name: Optional[str] = None
    order_ym: str
    status: str
    plan_run_id: Optional[int]
    created_by: int
    submitted_at: Optional[datetime]
    confirmed_at: Optional[datetime]
    note: Optional[str]
    created_at: datetime
    line_count: int = 0
    total_boxes: int = 0
    total_layers: int = 0


# ── Kanban ────────────────────────────────────────────────────────────────────

class KanbanLine(BaseModel):
    plan_line_id: int
    product_id: int
    product_code: Optional[str]
    name_ja: Optional[str]
    tier_code: Optional[str]
    product_type: Optional[str] = None   # regular / spot / pb
    order_ym: str
    order_boxes: int
    order_layers: int
    expected_arrival_ym: str
    exporter_id: Optional[int]
    exporter_code: Optional[str]
    alert: Optional[str]
    po_id: Optional[int] = None
    po_no: Optional[str] = None
    committed_jun: Optional[int] = None  # 6월 확정 발주(박스)
    committed_jul: Optional[int] = None  # 7월 확정 발주(박스)


class KanbanColumn(BaseModel):
    column: str   # backlog / scheduled / pending_approval / confirmed
    label_ko: str
    count: int
    lines: list[KanbanLine]


class KanbanBoard(BaseModel):
    plan_run_id: int
    run_ym: str
    plan_status: str
    columns: list[KanbanColumn]
