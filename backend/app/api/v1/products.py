import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import Brewery, TemperatureTier
from app.models.product import ExporterProduct, Product
from app.schemas.common import Page
from app.schemas.product import ProductBulkCreate, ProductBulkResult, ProductCreate, ProductRead, ProductUpdate

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
        product_type=p.product_type or "regular",
        boxes_per_pallet=p.boxes_per_pallet,
        boxes_per_layer=p.boxes_per_layer,
        bottles_per_box=p.bottles_per_box,
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


@router.post("/bulk", response_model=ProductBulkResult, status_code=status.HTTP_200_OK)
def bulk_create_products(
    data: ProductBulkCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    """엑셀 템플릿 기반 SKU 일괄 등록/수정 (upsert=True 이면 기존 상품 업데이트)"""
    tier_map = {t.code: t for t in db.query(TemperatureTier).all()}
    brewery_map = {b.name: b for b in db.query(Brewery).all()}

    created, updated, skipped, errors = 0, 0, 0, []

    for i, item in enumerate(data.items):
        row_no = i + 2

        tier = tier_map.get(item.tier_code.strip().lower())
        if not tier:
            errors.append(f"행{row_no}({item.product_code}): 온도대 '{item.tier_code}' 없음 (cold/ambient/room)")
            continue

        # 양조장명 → ID (정확일치 → 부분일치 순)
        brewery_id: Optional[int] = None
        if item.brewery_name:
            b = brewery_map.get(item.brewery_name)
            if not b:
                for name, obj in brewery_map.items():
                    if item.brewery_name in name or name in item.brewery_name:
                        b = obj
                        break
            if b:
                brewery_id = b.brewery_id

        # 도수 범위 검증 (컬럼 순서 오류 방지)
        alcohol = item.alcohol_pct
        if alcohol is not None and (alcohol < 0 or alcohol > 100):
            item = item.model_copy(update={"alcohol_pct": None})
            errors.append(f"행{row_no}({item.product_code}): 도수 값({alcohol:.1f}) 이상 — 도수 미입력으로 처리")

        existing = db.query(Product).filter(Product.product_code == item.product_code).first()

        try:
            ptype = item.product_type.strip().lower() if item.product_type else "regular"
            if ptype not in {"regular", "spot", "pb"}:
                ptype = "regular"

            if existing:
                if data.upsert:
                    existing.name_ja        = item.name_ja
                    existing.name_ko        = item.name_ko or None
                    existing.tier_id        = tier.tier_id
                    existing.brewery_id     = brewery_id
                    existing.product_type   = ptype
                    existing.boxes_per_layer  = item.boxes_per_layer
                    existing.boxes_per_pallet = item.boxes_per_pallet
                    existing.bottles_per_box  = item.bottles_per_box
                    existing.volume_ml      = item.volume_ml
                    existing.alcohol_pct    = item.alcohol_pct
                    db.flush()
                    updated += 1
                else:
                    skipped += 1
            else:
                db.add(Product(
                    product_code=item.product_code,
                    name_ja=item.name_ja,
                    name_ko=item.name_ko or None,
                    tier_id=tier.tier_id,
                    brewery_id=brewery_id,
                    product_type=ptype,
                    boxes_per_layer=item.boxes_per_layer,
                    boxes_per_pallet=item.boxes_per_pallet,
                    bottles_per_box=item.bottles_per_box,
                    volume_ml=item.volume_ml,
                    alcohol_pct=item.alcohol_pct,
                ))
                db.flush()
                created += 1
        except Exception as e:
            db.rollback()
            errors.append(f"행{row_no}({item.product_code}): {str(e)[:120]}")

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"저장 실패: {str(e)[:200]}")
    return ProductBulkResult(created=created, updated=updated, skipped=skipped, errors=errors)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(Product).filter(Product.product_id == product_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")
    db.delete(obj)
    db.commit()


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
