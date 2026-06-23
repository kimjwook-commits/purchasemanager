from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, joinedload

from app.core.security import verify_password, create_access_token
from app.database import get_db
from app.models.auth import AppUser, UserRole, Role
from app.schemas.auth import TokenResponse
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = (
        db.query(AppUser)
        .options(joinedload(AppUser.user_roles).joinedload(UserRole.role))
        .filter(AppUser.username == form.username, AppUser.is_active == True)
        .first()
    )
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(data={"sub": str(user.user_id)})
    return TokenResponse(
        access_token=token,
        user_id=user.user_id,
        username=user.username,
        permissions=list(user.permissions),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(current_user: AppUser = Depends(get_current_user)):
    """유효한 토큰을 새 토큰으로 갱신 — 만료 전 자동 연장용"""
    token = create_access_token(data={"sub": str(current_user.user_id)})
    return TokenResponse(
        access_token=token,
        user_id=current_user.user_id,
        username=current_user.username,
        permissions=list(current_user.permissions),
    )


@router.get("/me", response_model=dict)
def me_info(db: Session = Depends(get_db)):
    """토큰 없이 호출 가능한 서버 상태 확인"""
    return {"status": "ok"}
