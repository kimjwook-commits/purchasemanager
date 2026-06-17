from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload

from app.core.security import decode_token
from app.database import get_db
from app.models.auth import AppUser, UserRole, Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> AppUser:
    payload = decode_token(token)
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 토큰이 유효하지 않습니다")

    user = (
        db.query(AppUser)
        .options(joinedload(AppUser.user_roles).joinedload(UserRole.role))
        .filter(AppUser.user_id == int(user_id_str), AppUser.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다")
    return user


def require_permission(perm: str):
    """팩토리 함수 — 특정 권한이 필요한 엔드포인트에 Depends()로 사용"""
    def _check(current_user: Annotated[AppUser, Depends(get_current_user)]) -> AppUser:
        if not current_user.has_permission(perm):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"권한이 없습니다: {perm}",
            )
        return current_user
    return _check


CurrentUser = Annotated[AppUser, Depends(get_current_user)]
DB = Annotated[Session, Depends(get_db)]
