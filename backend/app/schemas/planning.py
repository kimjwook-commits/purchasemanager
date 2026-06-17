from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ── PlanRun ───────────────────────────────────────────────────────────────────

class PlanRunCreate(BaseModel):
    run_ym: str           # YYYY-MM
    horizon_months: int = 12
    service_z: float = 2.05


class PlanRunRead(BaseModel):
    model_config = {"from_attributes": True}

    plan_run_id: int
    run_ym: str
    version: int
    horizon_months: int
    service_z: float
    status: str           # DRAFT / APPROVED / ARCHIVED
    created_by: int
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    created_at: datetime
    line_count: int = 0
    alert_count: int = 0


# ── PlanLine ──────────────────────────────────────────────────────────────────

class PlanLineRead(BaseModel):
    model_config = {"from_attributes": True}

    plan_line_id: int
    plan_run_id: int
    product_id: int
    product_code: Optional[str] = None
    name_ja: Optional[str] = None
    tier_code: Optional[str] = None
    ep_id: Optional[int]
    order_ym: str
    order_boxes: int
    order_layers: int
    expected_arrival_ym: str
    projected_inv_end: Optional[int]
    is_committed: bool
    alert: Optional[str]


# ── 3개월 롤링 요약 (Module 1 UI 화면) ──────────────────────────────────────

class MonthSummary(BaseModel):
    order_ym: str
    cold_pallets: int
    ambient_pallets: int
    room_pallets: int
    total_pallets: int
    line_count: int
    alert_count: int


class PlanRollingSummary(BaseModel):
    plan_run_id: int
    run_ym: str
    months: list[MonthSummary]   # 최대 6개 발주월 (짝수달)


# ── 타당성 경고 ───────────────────────────────────────────────────────────────

class PlanAlert(BaseModel):
    plan_line_id: int
    product_id: int
    product_code: Optional[str]
    order_ym: str
    alert: str


# ── 승인 ─────────────────────────────────────────────────────────────────────

class PlanApproveRequest(BaseModel):
    comment: Optional[str] = None
