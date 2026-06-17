from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.product import ExporterProduct, SupplyPrice
from app.schemas.product import SupplyPriceCreate, SupplyPriceRead

router = APIRouter(prefix="/supply-prices", tags=["supply-prices"])


def _mask(price: SupplyPrice, can_view_brewery: bool) -> SupplyPriceRead:
    return SupplyPriceRead(
        price_id=price.price_id,
        ep_id=price.ep_id,
        effective_date=price.effective_date,
        currency=price.currency,
        brewery_price=float(price.brewery_price) if (price.brewery_price and can_view_brewery) else None,
        supply_price=float(price.supply_price),
        note=price.note,
    )


@router.get("/", response_model=list[SupplyPriceRead])
def list_prices(
    db: DB,
    current_user: CurrentUser,
    ep_id: Optional[int] = None,
    exporter_id: Optional[int] = None,
    current_only: bool = True,   # ep별 최신 유효가격만 반환
):
    """
    current_only=True: 각 ep_id 기준 가장 최근 effective_date 1건만 반환
    """
    can_view = current_user.has_permission("price_view_brewery")

    if ep_id:
        q = db.query(SupplyPrice).filter(SupplyPrice.ep_id == ep_id)
        if current_only:
            q = q.order_by(SupplyPrice.effective_date.desc()).limit(1)
        return [_mask(p, can_view) for p in q.all()]

    # ep_id 미지정 시 exporter_id 기준 현재 유효가
    q = db.query(SupplyPrice)
    if exporter_id:
        q = (
            q.join(ExporterProduct)
            .filter(ExporterProduct.exporter_id == exporter_id)
        )
    return [_mask(p, can_view) for p in q.order_by(SupplyPrice.effective_date.desc()).all()]


@router.post("/", response_model=SupplyPriceRead, status_code=status.HTTP_201_CREATED)
def create_price(
    data: SupplyPriceCreate,
    db: DB,
    current_user=Depends(require_permission("item_register")),
):
    """INSERT-ONLY: 공급가는 절대 UPDATE 하지 않음 — 새 레코드로 이력 관리"""
    ep = db.query(ExporterProduct).filter(ExporterProduct.ep_id == data.ep_id).first()
    if not ep:
        raise HTTPException(status_code=404, detail="수출자-상품 매핑을 찾을 수 없습니다")

    # brewery_price는 price_view_brewery 권한 보유자만 입력 가능
    brewery_price = None
    if data.brewery_price is not None:
        if not current_user.has_permission("price_view_brewery"):
            raise HTTPException(status_code=403, detail="양조장 가격 입력 권한이 없습니다")
        brewery_price = data.brewery_price

    price = SupplyPrice(
        ep_id=data.ep_id,
        effective_date=data.effective_date,
        currency=data.currency,
        brewery_price=brewery_price,
        supply_price=data.supply_price,
        note=data.note,
    )
    db.add(price)
    db.commit()
    db.refresh(price)
    can_view = current_user.has_permission("price_view_brewery")
    return _mask(price, can_view)


@router.get("/current", response_model=list[SupplyPriceRead])
def current_prices_by_exporter(
    exporter_id: int,
    db: DB,
    current_user: CurrentUser,
):
    """수출자 기준 현재 유효가(ep별 최신 1건)를 일괄 반환"""
    can_view = current_user.has_permission("price_view_brewery")
    eps = (
        db.query(ExporterProduct)
        .filter(ExporterProduct.exporter_id == exporter_id, ExporterProduct.is_active == True)
        .all()
    )
    result = []
    for ep in eps:
        price = (
            db.query(SupplyPrice)
            .filter(SupplyPrice.ep_id == ep.ep_id)
            .order_by(SupplyPrice.effective_date.desc())
            .first()
        )
        if price:
            result.append(_mask(price, can_view))
    return result
