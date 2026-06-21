from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator


# ── TemperatureTier ─────────────────────────────────────────────────────────

class TemperatureTierUpdate(BaseModel):
    review_cycle_months: Optional[int] = None
    lead_time_months: Optional[int] = None
    shelf_life_months: Optional[int] = None


class TemperatureTierRead(BaseModel):
    model_config = {"from_attributes": True}

    tier_id: int
    code: str
    name_ko: str
    shelf_life_months: int
    review_cycle_months: int
    lead_time_months: int
    default_zone_code: str


# ── Entity ───────────────────────────────────────────────────────────────────

class EntityCreate(BaseModel):
    name: str
    business_no: Optional[str] = None
    address: Optional[str] = None


class EntityRead(EntityCreate):
    model_config = {"from_attributes": True}
    entity_id: int
    is_active: bool


# ── Exporter ─────────────────────────────────────────────────────────────────

class ExporterCreate(BaseModel):
    code: str
    name: str
    country: str = "JPN"
    contact_email: Optional[str] = None
    entity_id: Optional[int] = None


class ExporterUpdate(BaseModel):
    name: Optional[str] = None
    country: Optional[str] = None
    contact_email: Optional[str] = None
    is_active: Optional[bool] = None


class ExporterRead(BaseModel):
    model_config = {"from_attributes": True}
    exporter_id: int
    code: str
    name: str
    country: str
    contact_email: Optional[str]
    entity_id: Optional[int]
    is_active: bool
    created_at: datetime


# ── Brewery ───────────────────────────────────────────────────────────────────

class BreweryCreate(BaseModel):
    name: str
    name_ja: Optional[str] = None
    country: str = "JPN"
    region: Optional[str] = None


class BreweryUpdate(BaseModel):
    name: Optional[str] = None
    name_ja: Optional[str] = None
    region: Optional[str] = None
    is_active: Optional[bool] = None


class BreweryRead(BaseModel):
    model_config = {"from_attributes": True}
    brewery_id: int
    name: str
    name_ja: Optional[str]
    country: str
    region: Optional[str]
    is_active: bool


class BreweryBulkItem(BaseModel):
    name: str
    name_ja: Optional[str] = None
    country: str = "JPN"
    region: Optional[str] = None


class BreweryBulkCreate(BaseModel):
    items: list[BreweryBulkItem]
    upsert: bool = False


class BreweryBulkResult(BaseModel):
    created: int
    updated: int = 0
    skipped: int
    errors: list[str]


# ── WarehouseZone ─────────────────────────────────────────────────────────────

class WarehouseZoneCreate(BaseModel):
    code: str
    name_ko: str
    tier_id: int
    capacity_pallets: Optional[int] = None


class WarehouseZoneUpdate(BaseModel):
    name_ko: Optional[str] = None
    capacity_pallets: Optional[int] = None
    is_active: Optional[bool] = None


class WarehouseZoneRead(BaseModel):
    model_config = {"from_attributes": True}
    zone_id: int
    code: str
    name_ko: str
    tier_id: int
    capacity_pallets: Optional[int]
    is_active: bool


# ── ContainerSpec ─────────────────────────────────────────────────────────────

class ContainerSpecCreate(BaseModel):
    container_type: str  # 20ft / 40ft
    tier_id: int
    max_pallets: int
    cost_usd: float


class ContainerSpecUpdate(BaseModel):
    max_pallets: Optional[int] = None
    cost_usd: Optional[float] = None
    is_active: Optional[bool] = None


class ContainerSpecRead(BaseModel):
    model_config = {"from_attributes": True}
    spec_id: int
    container_type: str
    tier_id: int
    max_pallets: int
    cost_usd: float
    is_active: bool
