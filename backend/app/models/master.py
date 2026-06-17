"""
마스터 테이블: ENTITY, EXPORTER, BREWERY, TEMPERATURE_TIER, WAREHOUSE_ZONE, CONTAINER_SPEC
"""
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Entity(Base, TimestampMixin):
    """법인/거래처 (당사 포함)"""
    __tablename__ = "entity"

    entity_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    business_no: Mapped[Optional[str]] = mapped_column(String(20), unique=True)
    address: Mapped[Optional[str]] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    exporters: Mapped[list["Exporter"]] = relationship(back_populates="entity")
    users: Mapped[list["AppUser"]] = relationship(back_populates="entity")


class Exporter(Base, TimestampMixin):
    """수출자 (CR JPN, NZN, JFC, SAKURA)"""
    __tablename__ = "exporter"

    exporter_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("entity.entity_id"))
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    country: Mapped[str] = mapped_column(String(3), nullable=False, default="JPN")
    contact_email: Mapped[Optional[str]] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    entity: Mapped[Optional[Entity]] = relationship(back_populates="exporters")
    exporter_products: Mapped[list["ExporterProduct"]] = relationship(back_populates="exporter")
    purchase_orders: Mapped[list["PurchaseOrder"]] = relationship(back_populates="exporter")


class Brewery(Base, TimestampMixin):
    """양조장"""
    __tablename__ = "brewery"

    brewery_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    name_ja: Mapped[Optional[str]] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(3), nullable=False, default="JPN")
    region: Mapped[Optional[str]] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    products: Mapped[list["Product"]] = relationship(back_populates="brewery")


class TemperatureTier(Base):
    """온도 티어 (냉/일반/상온)"""
    __tablename__ = "temperature_tier"

    tier_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)  # cold / ambient / room
    name_ko: Mapped[str] = mapped_column(String(20), nullable=False)            # 냉 / 일반 / 상온
    shelf_life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    review_cycle_months: Mapped[int] = mapped_column(Integer, nullable=False)
    lead_time_months: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    default_zone_code: Mapped[str] = mapped_column(String(20), nullable=False)  # 냉장 / 상온

    products: Mapped[list["Product"]] = relationship(back_populates="tier")
    warehouse_zones: Mapped[list["WarehouseZone"]] = relationship(back_populates="tier")
    container_specs: Mapped[list["ContainerSpec"]] = relationship(back_populates="tier")


class WarehouseZone(Base, TimestampMixin):
    """창고 구역"""
    __tablename__ = "warehouse_zone"

    zone_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # COLD, AMBIENT
    name_ko: Mapped[str] = mapped_column(String(30), nullable=False)
    tier_id: Mapped[int] = mapped_column(Integer, ForeignKey("temperature_tier.tier_id"), nullable=False)
    capacity_pallets: Mapped[Optional[int]] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    tier: Mapped[TemperatureTier] = relationship(back_populates="warehouse_zones")
    inventory_lots: Mapped[list["InventoryLot"]] = relationship(back_populates="zone")


class ContainerSpec(Base):
    """컨테이너 스펙 (20ft/40ft × 냉장/상온)"""
    __tablename__ = "container_spec"
    __table_args__ = (UniqueConstraint("container_type", "tier_id", name="uq_container_spec"),)

    spec_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    container_type: Mapped[str] = mapped_column(String(10), nullable=False)  # 20ft / 40ft
    tier_id: Mapped[int] = mapped_column(Integer, ForeignKey("temperature_tier.tier_id"), nullable=False)
    max_pallets: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    tier: Mapped[TemperatureTier] = relationship(back_populates="container_specs")
    containers: Mapped[list["Container"]] = relationship(back_populates="spec")
