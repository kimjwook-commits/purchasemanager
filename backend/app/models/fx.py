"""
환율: FX_RATE
"""
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class FxRate(Base, TimestampMixin):
    """환율 스냅샷 (발주일 기준으로 고정)"""
    __tablename__ = "fx_rate"
    __table_args__ = (UniqueConstraint("base_currency", "quote_currency", "rate_date", name="uq_fx_rate"),)

    rate_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)   # JPY
    quote_currency: Mapped[str] = mapped_column(String(3), nullable=False)  # KRW
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(14, 6), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="manual")
