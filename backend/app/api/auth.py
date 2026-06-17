from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, joinedload

from app.core.security import verify_password, create_access_token
from app.database import get_db
from app.models.auth import AppUser, UserRole, Role
from app.schemas.auth import TokenResponse

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


@router.get("/me", response_model=dict)
def me_info(db: Session = Depends(get_db)):
    """토큰 없이 호출 가능한 서버 상태 확인"""
    return {"status": "ok"}
