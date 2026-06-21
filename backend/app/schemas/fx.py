from datetime import date
from typing import Optional
from pydantic import BaseModel


class FxRateCreate(BaseModel):
    base_currency: str = "JPY"
    quote_currency: str = "KRW"
    rate_date: date
    rate: float
    source: str = "manual"


class FxRateUpdate(BaseModel):
    rate: Optional[float] = None
    source: Optional[str] = None


class FxRateRead(BaseModel):
    model_config = {"from_attributes": True}
    rate_id: int
    base_currency: str
    quote_currency: str
    rate_date: date
    rate: float
    source: str
