"""
상품 관련: PRODUCT, EXPORTER_PRODUCT, SUPPLY_PRICE, PLANNING_PARAM
"""
from datetime import date
from typing import Optional

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Product(Base, TimestampMixin):
    """상품 (물리적 아이템 — 수출자 무관)"""
    __tablename__ = "product"

    product_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name_ja: Mapped[str] = mapped_column(String(200), nullable=False)
    name_ko: Mapped[Optional[str]] = mapped_column(String(200))
    brewery_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("brewery.brewery_id"))
    tier_id: Mapped[int] = mapped_column(Integer, ForeignKey("temperature_tier.tier_id"), nullable=False)
    product_type: Mapped[str] = mapped_column(String(20), nullable=False, default="regular")  # regular / spot / pb
    boxes_per_pallet: Mapped[int] = mapped_column(Integer, nullable=False, default=40)
    boxes_per_layer: Mapped[int] = mapped_column(Integer, nullable=False, default=10)  # 단당 박스수 (최소 발주 단위)
    bottles_per_box: Mapped[int] = mapped_column(Integer, nullable=False, default=12)  # 박스당 병수
    weight_per_layer_kg: Mapped[Optional[float]] = mapped_column(Numeric(8, 2))
    alcohol_pct: Mapped[Optional[float]] = mapped_column(Numeric(4, 1))
    volume_ml: Mapped[Optional[int]] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    brewery: Mapped[Optional["Brewery"]] = relationship(back_populates="products")
    tier: Mapped["TemperatureTier"] = relationship(back_populates="products")
    exporter_products: Mapped[list["ExporterProduct"]] = relationship(back_populates="product")
    inventory_lots: Mapped[list["InventoryLot"]] = relationship(back_populates="product")
    demand_actuals: Mapped[list["DemandActual"]] = relationship(back_populates="product")
    demand_forecasts: Mapped[list["DemandForecast"]] = relationship(back_populates="product")
    planning_param: Mapped[Optional["PlanningParam"]] = relationship(back_populates="product", uselist=False)


class ExporterProduct(Base, TimestampMixin):
    """수출자 × 상품 매핑 (중앙 조인 테이블)"""
    __tablename__ = "exporter_product"
    __table_args__ = (UniqueConstraint("exporter_id", "product_id", name="uq_exporter_product"),)

    ep_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exporter_id: Mapped[int] = mapped_column(Integer, ForeignKey("exporter.exporter_id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    item_code: Mapped[Optional[str]] = mapped_column(String(50))  # 수출자측 품번
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    exporter: Mapped["Exporter"] = relationship(back_populates="exporter_products")
    product: Mapped[Product] = relationship(back_populates="exporter_products")
    supply_prices: Mapped[list["SupplyPrice"]] = relationship(back_populates="exporter_product")
    po_lines: Mapped[list["PoLine"]] = relationship(back_populates="exporter_product")
    plan_lines: Mapped[list["PlanLine"]] = relationship(back_populates="exporter_product")


class SupplyPrice(Base):
    """공급가 이력 (INSERT-ONLY: 절대 UPDATE 금지)"""
    __tablename__ = "supply_price"

    price_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ep_id: Mapped[int] = mapped_column(Integer, ForeignKey("exporter_product.ep_id"), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="JPY")
    brewery_price: Mapped[Optional[float]] = mapped_column(Numeric(14, 2))   # 양조장 → 수출자 (HQ만 열람)
    supply_price: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)  # 수출자 → 당사
    note: Mapped[Optional[str]] = mapped_column(Text)

    exporter_product: Mapped[ExporterProduct] = relationship(back_populates="supply_prices")


class PlanningParam(Base, TimestampMixin):
    """발주 계획 파라미터 (상품별 오버라이드, 없으면 tier 기본값 사용)"""
    __tablename__ = "planning_param"

    param_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), unique=True, nullable=False)
    no_mix_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # 팔레트 혼재 금지
    min_order_layers: Mapped[Optional[int]] = mapped_column(Integer)
    max_order_layers: Mapped[Optional[int]] = mapped_column(Integer)
    override_review_cycle: Mapped[Optional[int]] = mapped_column(Integer)  # tier 기본값 무시시 사용
    override_lead_time: Mapped[Optional[int]] = mapped_column(Integer)

    product: Mapped[Product] = relationship(back_populates="planning_param")
