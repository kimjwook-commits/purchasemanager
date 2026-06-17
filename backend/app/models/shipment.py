"""
선적/통관/입고: SHIPMENT, CONTAINER, CONTAINER_LOAD, INSPECTION
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Shipment(Base, TimestampMixin):
    """선적 건 (5단계 스테퍼: 출항→입항→내륙운송→검수→통관→입고)"""
    __tablename__ = "shipment"

    shipment_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_id: Mapped[int] = mapped_column(Integer, ForeignKey("purchase_order.po_id"), nullable=False)
    bl_no: Mapped[Optional[str]] = mapped_column(String(50))       # B/L 번호
    do_no: Mapped[Optional[str]] = mapped_column(String(50))       # D/O 번호
    vessel_name: Mapped[Optional[str]] = mapped_column(String(100))
    departure_port: Mapped[Optional[str]] = mapped_column(String(50))
    arrival_port: Mapped[Optional[str]] = mapped_column(String(50))
    departure_date: Mapped[Optional[date]] = mapped_column(Date)
    arrival_date: Mapped[Optional[date]] = mapped_column(Date)
    inland_date: Mapped[Optional[date]] = mapped_column(Date)      # 내륙운송 도착일
    inspection_date: Mapped[Optional[date]] = mapped_column(Date)
    customs_clearance_date: Mapped[Optional[date]] = mapped_column(Date)
    received_date: Mapped[Optional[date]] = mapped_column(Date)    # 창고 입고일
    rcep_cert_no: Mapped[Optional[str]] = mapped_column(String(50))  # RCEP 원산지증명서
    customs_declaration_no: Mapped[Optional[str]] = mapped_column(String(50))  # 수입신고번호
    # DEPARTED / ARRIVED / IN_TRANSIT / INSPECTING / CUSTOMS / RECEIVED / CANCELLED
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DEPARTED")
    note: Mapped[Optional[str]] = mapped_column(Text)

    po: Mapped["PurchaseOrder"] = relationship(back_populates="shipments")
    containers: Mapped[list["Container"]] = relationship(back_populates="shipment")
    inspections: Mapped[list["Inspection"]] = relationship(back_populates="shipment")


class Container(Base, TimestampMixin):
    """개별 컨테이너"""
    __tablename__ = "container"

    container_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shipment_id: Mapped[int] = mapped_column(Integer, ForeignKey("shipment.shipment_id"), nullable=False)
    spec_id: Mapped[int] = mapped_column(Integer, ForeignKey("container_spec.spec_id"), nullable=False)
    container_no: Mapped[Optional[str]] = mapped_column(String(20))   # 컨테이너 번호 (ABCU1234567)
    seal_no: Mapped[Optional[str]] = mapped_column(String(20))
    pallets_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(10, 2))

    shipment: Mapped[Shipment] = relationship(back_populates="containers")
    spec: Mapped["ContainerSpec"] = relationship(back_populates="containers")
    loads: Mapped[list["ContainerLoad"]] = relationship(back_populates="container")


class ContainerLoad(Base):
    """컨테이너 적재 내역 (팔레트 단위)"""
    __tablename__ = "container_load"
    __table_args__ = (Index("ix_container_load_container", "container_id"),)

    load_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    container_id: Mapped[int] = mapped_column(Integer, ForeignKey("container.container_id"), nullable=False)
    po_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("po_line.po_line_id"), nullable=False)
    pallet_no: Mapped[int] = mapped_column(Integer, nullable=False)       # 팔레트 번호 (컨테이너 내)
    layers_loaded: Mapped[int] = mapped_column(Integer, nullable=False)
    boxes_loaded: Mapped[int] = mapped_column(Integer, nullable=False)
    is_mixed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # 혼재 팔레트

    container: Mapped[Container] = relationship(back_populates="loads")
    po_line: Mapped["PoLine"] = relationship(back_populates="container_loads")


class Inspection(Base, TimestampMixin):
    """검수 결과 (품목별)"""
    __tablename__ = "inspection"

    inspection_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shipment_id: Mapped[int] = mapped_column(Integer, ForeignKey("shipment.shipment_id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    sample_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    # PASS / FAIL / CONDITIONAL
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    inspector_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("app_user.user_id"))
    inspected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    note: Mapped[Optional[str]] = mapped_column(Text)

    shipment: Mapped[Shipment] = relationship(back_populates="inspections")
    product: Mapped["Product"] = relationship()
