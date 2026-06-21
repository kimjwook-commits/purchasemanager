"""
환율 관리 API
GET  /fx-rates/          — 전체 조회 (최신순)
GET  /fx-rates/latest    — 통화쌍별 최신 환율
POST /fx-rates/          — 등록
PATCH /fx-rates/{id}     — 수정
DELETE /fx-rates/{id}    — 삭제
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.fx import FxRate
from app.schemas.fx import FxRateCreate, FxRateRead, FxRateUpdate

router = APIRouter(prefix="/fx-rates", tags=["fx-rates"])


@router.get("/", response_model=list[FxRateRead])
def list_fx_rates(
    db: DB,
    _: CurrentUser,
    base_currency: Optional[str] = None,
    quote_currency: Optional[str] = None,
    limit: int = 60,
):
    q = db.query(FxRate)
    if base_currency:
        q = q.filter(FxRate.base_currency == base_currency.upper())
    if quote_currency:
        q = q.filter(FxRate.quote_currency == quote_currency.upper())
    return q.order_by(FxRate.rate_date.desc()).limit(limit).all()


@router.get("/latest", response_model=list[FxRateRead])
def latest_fx_rates(db: DB, _: CurrentUser):
    """통화쌍별 가장 최신 환율 1건씩"""
    from sqlalchemy import func
    subq = (
        db.query(
            FxRate.base_currency,
            FxRate.quote_currency,
            func.max(FxRate.rate_date).label("max_date"),
        )
        .group_by(FxRate.base_currency, FxRate.quote_currency)
        .subquery()
    )
    rows = (
        db.query(FxRate)
        .join(
            subq,
            (FxRate.base_currency == subq.c.base_currency)
            & (FxRate.quote_currency == subq.c.quote_currency)
            & (FxRate.rate_date == subq.c.max_date),
        )
        .all()
    )
    return rows


@router.post("/", response_model=FxRateRead, status_code=status.HTTP_201_CREATED)
def create_fx_rate(
    data: FxRateCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    existing = (
        db.query(FxRate)
        .filter(
            FxRate.base_currency == data.base_currency.upper(),
            FxRate.quote_currency == data.quote_currency.upper(),
            FxRate.rate_date == data.rate_date,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"{data.base_currency}/{data.quote_currency} {data.rate_date} 환율이 이미 존재합니다",
        )
    obj = FxRate(
        base_currency=data.base_currency.upper(),
        quote_currency=data.quote_currency.upper(),
        rate_date=data.rate_date,
        rate=data.rate,
        source=data.source,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.patch("/{rate_id}", response_model=FxRateRead)
def update_fx_rate(
    rate_id: int,
    data: FxRateUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(FxRate).filter(FxRate.rate_id == rate_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="환율 정보를 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fx_rate(
    rate_id: int,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(FxRate).filter(FxRate.rate_id == rate_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="환율 정보를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
