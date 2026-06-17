from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, require_permission
from app.models.product import ExporterProduct, Product
from app.schemas.product import (
    ExporterProductBulkCreate,
    ExporterProductCreate,
    ExporterProductRead,
)

router = APIRouter(prefix="/exporter-products", tags=["exporter-products"])


def _to_read(ep: ExporterProduct) -> ExporterProductRead:
    return ExporterProductRead(
        ep_id=ep.ep_id,
        exporter_id=ep.exporter_id,
        product_id=ep.product_id,
        item_code=ep.item_code,
        is_active=ep.is_active,
        product_code=ep.product.product_code if ep.product else None,
        name_ja=ep.product.name_ja if ep.product else None,
    )


@router.get("/", response_model=list[ExporterProductRead])
def list_exporter_products(
    db: DB,
    _: CurrentUser,
    exporter_id: Optional[int] = None,
    product_id: Optional[int] = None,
    active_only: bool = True,
):
    q = db.query(ExporterProduct)
    if exporter_id:
        q = q.filter(ExporterProduct.exporter_id == exporter_id)
    if product_id:
        q = q.filter(ExporterProduct.product_id == product_id)
    if active_only:
        q = q.filter(ExporterProduct.is_active == True)
    return [_to_read(ep) for ep in q.all()]


@router.post("/", response_model=ExporterProductRead, status_code=status.HTTP_201_CREATED)
def create_exporter_product(
    data: ExporterProductCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    existing = db.query(ExporterProduct).filter(
        ExporterProduct.exporter_id == data.exporter_id,
        ExporterProduct.product_id == data.product_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="해당 수출자-상품 매핑이 이미 존재합니다")
    ep = ExporterProduct(**data.model_dump())
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return _to_read(ep)


@router.post("/bulk", response_model=dict, status_code=status.HTTP_201_CREATED)
def bulk_create_exporter_products(
    data: ExporterProductBulkCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    """수출자 기준 상품 일괄 매핑 (엑셀 업로드 대응)"""
    created, skipped, errors = 0, 0, []

    for item in data.items:
        product = db.query(Product).filter(Product.product_code == item.product_code).first()
        if not product:
            errors.append(f"상품코드 미존재: {item.product_code}")
            continue

        existing = db.query(ExporterProduct).filter(
            ExporterProduct.exporter_id == data.exporter_id,
            ExporterProduct.product_id == product.product_id,
        ).first()
        if existing:
            skipped += 1
            continue

        db.add(ExporterProduct(
            exporter_id=data.exporter_id,
            product_id=product.product_id,
            item_code=item.item_code,
        ))
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.patch("/{ep_id}", response_model=ExporterProductRead)
def update_exporter_product(
    ep_id: int,
    item_code: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: DB = None,
    _=Depends(require_permission("item_register")),
):
    ep = db.query(ExporterProduct).filter(ExporterProduct.ep_id == ep_id).first()
    if not ep:
        raise HTTPException(status_code=404, detail="매핑을 찾을 수 없습니다")
    if item_code is not None:
        ep.item_code = item_code
    if is_active is not None:
        ep.is_active = is_active
    db.commit()
    db.refresh(ep)
    return _to_read(ep)
