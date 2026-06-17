"""
재고 / 수요: INVENTORY_LOT, DEMAND_ACTUAL, DEMAND_FORECAST
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class InventoryLot(Base, TimestampMixin):
    """입고 로트 (FEFO 출고 관리)"""
    __tablename__ = "inventory_lot"
    __table_args__ = (
        Index("ix_lot_product_exp", "product_id", "exp_date"),
        Index("ix_lot_zone", "zone_id"),
    )

    lot_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    zone_id: Mapped[int] = mapped_column(Integer, ForeignKey("warehouse_zone.zone_id"), nullable=False)
    po_line_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("po_line.po_line_id"))
    lot_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    qty_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    mfg_date: Mapped[Optional[date]] = mapped_column(Date)
    exp_date: Mapped[Optional[date]] = mapped_column(Date)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # AVAILABLE / RESERVED / EXPIRED / CONSUMED
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="AVAILABLE")

    product: Mapped["Product"] = relationship(back_populates="inventory_lots")
    zone: Mapped["WarehouseZone"] = relationship(back_populates="inventory_lots")
    po_line: Mapped[Optional["PoLine"]] = relationship(back_populates="inventory_lots")


class DemandActual(Base, TimestampMixin):
    """실제 판매/출고 실적 (월별)"""
    __tablename__ = "demand_actual"
    __table_args__ = (UniqueConstraint("product_id", "ym", name="uq_demand_actual"),)

    da_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    ym: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    qty_boxes: Mapped[int] = mapped_column(Integer, nullable=False)

    product: Mapped["Product"] = relationship(back_populates="demand_actuals")


class DemandForecast(Base, TimestampMixin):
    """롤링 수요 예측 (PLAN_RUN별)"""
    __tablename__ = "demand_forecast"
    __table_args__ = (
        UniqueConstraint("plan_run_id", "product_id", "ym", name="uq_demand_forecast"),
        Index("ix_forecast_run", "plan_run_id"),
    )

    df_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_run_id: Mapped[int] = mapped_column(Integer, ForeignKey("plan_run.plan_run_id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    ym: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    forecast_boxes: Mapped[int] = mapped_column(Integer, nullable=False)

    product: Mapped["Product"] = relationship(back_populates="demand_forecasts")
    plan_run: Mapped["PlanRun"] = relationship(back_populates="demand_forecasts")
