from datetime import date
from typing import Optional
from pydantic import BaseModel


# ── Product ───────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    product_code: str
    name_ja: str
    name_ko: Optional[str] = None
    brewery_id: Optional[int] = None
    tier_id: int
    boxes_per_pallet: int = 40
    weight_per_layer_kg: Optional[float] = None
    alcohol_pct: Optional[float] = None
    volume_ml: Optional[int] = None


class ProductUpdate(BaseModel):
    name_ja: Optional[str] = None
    name_ko: Optional[str] = None
    brewery_id: Optional[int] = None
    tier_id: Optional[int] = None
    boxes_per_pallet: Optional[int] = None
    weight_per_layer_kg: Optional[float] = None
    alcohol_pct: Optional[float] = None
    volume_ml: Optional[int] = None
    is_active: Optional[bool] = None


class ProductRead(BaseModel):
    model_config = {"from_attributes": True}
    product_id: int
    product_code: str
    name_ja: str
    name_ko: Optional[str]
    brewery_id: Optional[int]
    tier_id: int
    tier_code: Optional[str] = None   # 조회 시 tier.code 포함
    boxes_per_pallet: int
    alcohol_pct: Optional[float]
    volume_ml: Optional[int]
    is_active: bool


# ── ExporterProduct ───────────────────────────────────────────────────────────

class ExporterProductCreate(BaseModel):
    exporter_id: int
    product_id: int
    item_code: Optional[str] = None


class ExporterProductBulkItem(BaseModel):
    """엑셀 일괄 업로드용 단일 행"""
    product_code: str
    item_code: Optional[str] = None


class ExporterProductBulkCreate(BaseModel):
    exporter_id: int
    items: list[ExporterProductBulkItem]


class ExporterProductRead(BaseModel):
    model_config = {"from_attributes": True}
    ep_id: int
    exporter_id: int
    product_id: int
    item_code: Optional[str]
    is_active: bool
    product_code: Optional[str] = None   # 조회 편의 필드
    name_ja: Optional[str] = None


# ── SupplyPrice ───────────────────────────────────────────────────────────────

class SupplyPriceCreate(BaseModel):
    ep_id: int
    effective_date: date
    currency: str = "JPY"
    brewery_price: Optional[float] = None
    supply_price: float
    note: Optional[str] = None


class SupplyPriceRead(BaseModel):
    model_config = {"from_attributes": True}
    price_id: int
    ep_id: int
    effective_date: date
    currency: str
    brewery_price: Optional[float] = None  # permission 없으면 None
    supply_price: float
    note: Optional[str]


# ── PlanningParam ─────────────────────────────────────────────────────────────

class PlanningParamCreate(BaseModel):
    product_id: int
    no_mix_flag: bool = False
    min_order_layers: Optional[int] = None
    max_order_layers: Optional[int] = None
    override_review_cycle: Optional[int] = None
    override_lead_time: Optional[int] = None


class PlanningParamUpdate(BaseModel):
    no_mix_flag: Optional[bool] = None
    min_order_layers: Optional[int] = None
    max_order_layers: Optional[int] = None
    override_review_cycle: Optional[int] = None
    override_lead_time: Optional[int] = None


class PlanningParamRead(BaseModel):
    model_config = {"from_attributes": True}
    param_id: int
    product_id: int
    no_mix_flag: bool
    min_order_layers: Optional[int]
    max_order_layers: Optional[int]
    override_review_cycle: Optional[int]
    override_lead_time: Optional[int]
