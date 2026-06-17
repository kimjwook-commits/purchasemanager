"""
발주 계획: PLAN_RUN, PLAN_LINE (Module 1 신규 테이블)
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class PlanRun(Base, TimestampMixin):
    """계획 실행 이력 — 버전 관리"""
    __tablename__ = "plan_run"
    __table_args__ = (UniqueConstraint("run_ym", "version", name="uq_plan_run_version"),)

    plan_run_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_ym: Mapped[str] = mapped_column(String(7), nullable=False)   # YYYY-MM (기준년월)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    horizon_months: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    service_z: Mapped[float] = mapped_column(Numeric(5, 3), nullable=False, default=2.05)
    # DRAFT / APPROVED / ARCHIVED
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("app_user.user_id"), nullable=False)
    approved_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("app_user.user_id"))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    plan_lines: Mapped[list["PlanLine"]] = relationship(back_populates="plan_run", cascade="all, delete-orphan")
    demand_forecasts: Mapped[list["DemandForecast"]] = relationship(back_populates="plan_run")


class PlanLine(Base):
    """계획 품목 라인"""
    __tablename__ = "plan_line"
    __table_args__ = (
        Index("ix_plan_line_run_product", "plan_run_id", "product_id"),
    )

    plan_line_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_run_id: Mapped[int] = mapped_column(Integer, ForeignKey("plan_run.plan_run_id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("product.product_id"), nullable=False)
    ep_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("exporter_product.ep_id"))
    order_ym: Mapped[str] = mapped_column(String(7), nullable=False)          # 발주년월 (짝수달)
    order_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    order_layers: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_arrival_ym: Mapped[str] = mapped_column(String(7), nullable=False)  # order_ym + 1month
    projected_inv_end: Mapped[Optional[int]] = mapped_column(Integer)           # 기간말 예상 재고(박스)
    is_committed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # True → Module 3 PO 생성
    alert: Mapped[Optional[str]] = mapped_column(Text)  # 타당성 경고 메시지

    plan_run: Mapped[PlanRun] = relationship(back_populates="plan_lines")
    product: Mapped["Product"] = relationship()
    exporter_product: Mapped[Optional["ExporterProduct"]] = relationship(back_populates="plan_lines")
