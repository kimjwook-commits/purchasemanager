"""
인증/권한: APP_USER, ROLE, USER_ROLE
"""
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Role(Base):
    """역할 — permissions는 JSON 배열 (예: ["price_view_brewery", "po_approve"])"""
    __tablename__ = "role"

    role_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(200))
    permissions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    user_roles: Mapped[list["UserRole"]] = relationship(back_populates="role")


class AppUser(Base, TimestampMixin):
    """시스템 사용자"""
    __tablename__ = "app_user"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("entity.entity_id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    entity: Mapped[Optional["Entity"]] = relationship(back_populates="users")
    user_roles: Mapped[list["UserRole"]] = relationship(back_populates="user")

    @property
    def permissions(self) -> set[str]:
        perms: set[str] = set()
        for ur in self.user_roles:
            perms.update(ur.role.permissions)
        return perms

    def has_permission(self, perm: str) -> bool:
        return perm in self.permissions


class UserRole(Base):
    """사용자 ↔ 역할 (N:M)"""
    __tablename__ = "user_role"
    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_role"),)

    ur_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("app_user.user_id"), nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("role.role_id"), nullable=False)

    user: Mapped[AppUser] = relationship(back_populates="user_roles")
    role: Mapped[Role] = relationship(back_populates="user_roles")
