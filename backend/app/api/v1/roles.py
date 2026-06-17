"""
Phase 6: 역할/권한 관리 API
- GET  /roles/          역할 목록
- POST /roles/          역할 생성
- PUT  /roles/{id}      역할 수정 (권한 목록 포함)
- DELETE /roles/{id}    역할 삭제
- GET  /roles/users     유저+역할 목록
- POST /roles/users/{user_id}/assign  역할 부여
- DELETE /roles/users/{user_id}/roles/{role_id}  역할 회수
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_permission
from app.database import get_db
from app.models.auth import AppUser, Role, UserRole

router = APIRouter(prefix="/roles", tags=["roles"])

# ── 스키마 ───────────────────────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: List[str] = []


class RoleRead(BaseModel):
    model_config = {"from_attributes": True}
    role_id: int
    name: str
    description: Optional[str] = None
    permissions: List[str]


class UserWithRoles(BaseModel):
    user_id: int
    username: str
    email: str
    is_active: bool
    roles: List[RoleRead]


class AssignRoleRequest(BaseModel):
    role_id: int


# 시스템에서 지원하는 권한 목록
KNOWN_PERMISSIONS = [
    "po_approve",           # 발주 승인 / 선적 단계 전진
    "price_view_brewery",   # 양조장 원가 조회
    "role_manage",          # 역할 관리 (superadmin)
]


# ── 역할 목록 ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[RoleRead])
def list_roles(
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_user),
):
    rows = db.execute(select(Role).order_by(Role.role_id)).scalars().all()
    return [RoleRead.model_validate(r) for r in rows]


@router.get("/permissions")
def list_permissions(_: AppUser = Depends(get_current_user)):
    return KNOWN_PERMISSIONS


# ── 역할 생성 ────────────────────────────────────────────────────────────────

@router.post("/", response_model=RoleRead)
def create_role(
    req: RoleCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_permission("role_manage")),
):
    existing = db.execute(select(Role).where(Role.name == req.name)).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"역할 '{req.name}'이 이미 존재합니다")
    role = Role(name=req.name, description=req.description, permissions=req.permissions)
    db.add(role)
    db.commit()
    db.refresh(role)
    return RoleRead.model_validate(role)


# ── 역할 수정 ────────────────────────────────────────────────────────────────

@router.put("/{role_id}", response_model=RoleRead)
def update_role(
    role_id: int,
    req: RoleCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_permission("role_manage")),
):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "역할 없음")
    role.name = req.name
    role.description = req.description
    role.permissions = req.permissions
    db.commit()
    db.refresh(role)
    return RoleRead.model_validate(role)


# ── 역할 삭제 ────────────────────────────────────────────────────────────────

@router.delete("/{role_id}")
def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_permission("role_manage")),
):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "역할 없음")
    # 이 역할을 가진 유저 수 확인
    count = db.execute(
        select(UserRole).where(UserRole.role_id == role_id)
    ).scalars().all()
    if count:
        raise HTTPException(400, f"해당 역할을 가진 사용자 {len(count)}명이 있어 삭제 불가. 먼저 역할을 회수하세요.")
    db.delete(role)
    db.commit()
    return {"deleted": True}


# ── 유저+역할 목록 ───────────────────────────────────────────────────────────

@router.get("/users", response_model=List[UserWithRoles])
def list_users_with_roles(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_permission("role_manage")),
):
    users = db.execute(
        select(AppUser)
        .options(joinedload(AppUser.user_roles).joinedload(UserRole.role))
        .order_by(AppUser.user_id)
    ).unique().scalars().all()

    result = []
    for u in users:
        roles = [RoleRead.model_validate(ur.role) for ur in u.user_roles]
        result.append(UserWithRoles(
            user_id=u.user_id,
            username=u.username,
            email=u.email,
            is_active=u.is_active,
            roles=roles,
        ))
    return result


# ── 역할 부여 ────────────────────────────────────────────────────────────────

@router.post("/users/{user_id}/assign", response_model=UserWithRoles)
def assign_role(
    user_id: int,
    req: AssignRoleRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_permission("role_manage")),
):
    user = db.get(AppUser, user_id)
    if not user:
        raise HTTPException(404, "사용자 없음")
    role = db.get(Role, req.role_id)
    if not role:
        raise HTTPException(404, "역할 없음")

    existing = db.execute(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role_id == req.role_id)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "이미 부여된 역할입니다")

    ur = UserRole(user_id=user_id, role_id=req.role_id)
    db.add(ur)
    db.commit()

    db.refresh(user)
    user_refreshed = db.execute(
        select(AppUser)
        .options(joinedload(AppUser.user_roles).joinedload(UserRole.role))
        .where(AppUser.user_id == user_id)
    ).unique().scalar_one()
    roles = [RoleRead.model_validate(ur.role) for ur in user_refreshed.user_roles]
    return UserWithRoles(
        user_id=user_refreshed.user_id,
        username=user_refreshed.username,
        email=user_refreshed.email,
        is_active=user_refreshed.is_active,
        roles=roles,
    )


# ── 역할 회수 ────────────────────────────────────────────────────────────────

@router.delete("/users/{user_id}/roles/{role_id}")
def revoke_role(
    user_id: int,
    role_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_permission("role_manage")),
):
    ur = db.execute(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role_id == role_id)
    ).scalar_one_or_none()
    if not ur:
        raise HTTPException(404, "해당 역할 부여 내역 없음")
    db.delete(ur)
    db.commit()
    return {"revoked": True}
