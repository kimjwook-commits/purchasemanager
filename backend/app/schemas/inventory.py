from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


# ── DemandActual ──────────────────────────────────────────────────────────────

class DemandActualItem(BaseModel):
    """단일 행 (제품코드 → 월별 실적)"""
    product_code: str
    ym: str           # YYYY-MM
    qty_boxes: int


class DemandActualBulk(BaseModel):
    """일괄 업로드 요청"""
    rows: list[DemandActualItem]
    overwrite: bool = True  # 기존 값 덮어쓰기


class DemandActualRead(BaseModel):
    model_config = {"from_attributes": True}
    da_id: int
    product_id: int
    product_code: Optional[str] = None
    ym: str
    qty_boxes: int


class DemandActualSummary(BaseModel):
    upserted: int
    skipped: int


# ── InventoryLot (초기재고) ───────────────────────────────────────────────────

class InitialLotItem(BaseModel):
    """초기재고 단일 행"""
    product_code: str
    zone_code: str
    lot_no: str
    qty_boxes: int
    mfg_date: Optional[date] = None
    exp_date: Optional[date] = None


class InitialLotBulk(BaseModel):
    rows: list[InitialLotItem]


class InventoryLotRead(BaseModel):
    model_config = {"from_attributes": True}
    lot_id: int
    product_id: int
    product_code: Optional[str] = None
    zone_id: int
    zone_code: Optional[str] = None
    lot_no: str
    qty_boxes: int
    mfg_date: Optional[date]
    exp_date: Optional[date]
    status: str


class InventoryLotSummary(BaseModel):
    total_lots: int
    total_boxes: int
    product_count: int
