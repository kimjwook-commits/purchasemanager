import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import TemperatureTier
from app.models.product import ExporterProduct, Product
from app.schemas.common import Page
from app.schemas.product import ProductCreate, ProductRead, ProductUpdate

router = APIRouter(prefix="/products", tags=["products"])


def _to_read(p: Product) -> ProductRead:
    return ProductRead(
        product_id=p.product_id,
        product_code=p.product_code,
        name_ja=p.name_ja,
        name_ko=p.name_ko,
        brewery_id=p.brewery_id,
        tier_id=p.tier_id,
        tier_code=p.tier.code if p.tier else None,
        boxes_per_pallet=p.boxes_per_pallet,
        alcohol_pct=float(p.alcohol_pct) if p.alcohol_pct else None,
        volume_ml=p.volume_ml,
        is_active=p.is_active,
    )


@router.get("/", response_model=Page[ProductRead])
def list_products(
    db: DB,
    _: CurrentUser,
    q: Optional[str] = None,       # 상품명(ja/ko) 검색
    tier: Optional[str] = None,    # cold / ambient / room
    exporter_id: Optional[int] = None,
    active_only: bool = True,
    page: int = 1,
    size: int = 50,
):
    query = db.query(Product).options(joinedload(Product.tier))

    if active_only:
        query = query.filter(Product.is_active == True)
    if q:
        like = f"%{q}%"
        query = query.filter(
            Product.name_ja.ilike(like) | Product.name_ko.ilike(like) | Product.product_code.ilike(like)
        )
    if tier:
        query = query.join(TemperatureTier).filter(TemperatureTier.code == tier)
    if exporter_id:
        query = query.join(ExporterProduct).filter(
            ExporterProduct.exporter_id == exporter_id,
            ExporterProduct.is_active == True,
        )

    total = query.count()
    items = query.order_by(Product.product_code).offset((page - 1) * size).limit(size).all()
    return Page(
        items=[_to_read(p) for p in items],
        total=total,
        page=page,
        size=size,
        pages=math.ceil(total / size) if total else 0,
    )


@router.post("/", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    data: ProductCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    if db.query(Product).filter(Product.product_code == data.product_code).first():
        raise HTTPException(status_code=409, detail=f"상품코드 '{data.product_code}' 이미 존재합니다")
    obj = Product(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _to_read(db.query(Product).options(joinedload(Product.tier)).filter(Product.product_id == obj.product_id).first())


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, db: DB, _: CurrentUser):
    obj = db.query(Product).options(joinedload(Product.tier)).filter(Product.product_id == product_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")
    return _to_read(obj)


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    data: ProductUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(Product).options(joinedload(Product.tier)).filter(Product.product_id == product_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _to_read(obj)
