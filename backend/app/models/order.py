"""
발주: PURCHASE_ORDER, PO_LINE
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class PurchaseOrder(Base, TimestampMixin):
    """발주서 헤더"""
    __tablename__ = "purchase_order"

    po_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)  # PM-2026-06-001
    exporter_id: Mapped[int] = mapped_column(Integer, ForeignKey("exporter.exporter_id"), nullable=False)
    order_ym: Mapped[str] = mapped_column(String(7), nullable=False)   # YYYY-MM
    plan_run_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("plan_run.plan_run_id"))
    # DRAFT / SUBMITTED / CONFIRMED / RECEIVED / CANCELLED
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("app_user.user_id"), nullable=False)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    note: Mapped[Optional[str]] = mapped_column(Text)

    exporter: Mapped["Exporter"] = relationship(back_populates="purchase_orders")
    lines: Mapped[list["PoLine"]] = relationship(back_populates="po", cascade="all, delete-orphan")
    shipments: Mapped[list["Shipment"]] = relationship(back_populates="po")


class PoLine(Base):
    """발주 라인 (품목별)"""
    __tablename__ = "po_line"
    __table_args__ = (Index("ix_po_line_po", "po_id"),)

    po_line_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_id: Mapped[int] = mapped_column(Integer, ForeignKey("purchase_order.po_id"), nullable=False)
    ep_id: Mapped[int] = mapped_column(Integer, ForeignKey("exporter_product.ep_id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    order_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    order_layers: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="JPY")
    note: Mapped[Optional[str]] = mapped_column(Text)

    po: Mapped[PurchaseOrder] = relationship(back_populates="lines")
    exporter_product: Mapped["ExporterProduct"] = relationship(back_populates="po_lines")
    product: Mapped["Product"] = relationship()
    container_loads: Mapped[list["ContainerLoad"]] = relationship(back_populates="po_line")
    inventory_lots: Mapped[list["InventoryLot"]] = relationship(back_populates="po_line")
