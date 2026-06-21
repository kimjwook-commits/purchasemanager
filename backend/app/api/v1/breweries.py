from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import Brewery
from app.schemas.master import BreweryBulkCreate, BreweryBulkResult, BreweryCreate, BreweryRead, BreweryUpdate

router = APIRouter(prefix="/breweries", tags=["breweries"])


@router.get("/", response_model=list[BreweryRead])
def list_breweries(db: DB, _: CurrentUser, active_only: bool = True):
    q = db.query(Brewery)
    if active_only:
        q = q.filter(Brewery.is_active == True)
    return q.order_by(Brewery.name).all()


@router.post("/", response_model=BreweryRead, status_code=status.HTTP_201_CREATED)
def create_brewery(
    data: BreweryCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = Brewery(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/bulk", response_model=BreweryBulkResult, status_code=status.HTTP_200_OK)
def bulk_create_breweries(
    data: BreweryBulkCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    """엑셀 템플릿 기반 양조장 일괄 등록/수정 (upsert=True 이면 기존 양조장 업데이트)"""
    existing_map = {b.name: b for b in db.query(Brewery).all()}
    created, updated, skipped, errors = 0, 0, 0, []

    for i, item in enumerate(data.items):
        row_no = i + 2
        name = item.name.strip()
        if not name:
            errors.append(f"행{row_no}: 양조장명이 비어 있습니다")
            continue
        try:
            existing = existing_map.get(name)
            if existing:
                if data.upsert:
                    existing.name_ja = item.name_ja or existing.name_ja
                    existing.country = item.country or existing.country
                    existing.region  = item.region or existing.region
                    db.flush()
                    updated += 1
                else:
                    skipped += 1
            else:
                obj = Brewery(
                    name=name,
                    name_ja=item.name_ja or None,
                    country=item.country or "JPN",
                    region=item.region or None,
                )
                db.add(obj)
                db.flush()
                existing_map[name] = obj
                created += 1
        except Exception as e:
            db.rollback()
            errors.append(f"행{row_no}({name}): {str(e)[:120]}")

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"저장 실패: {str(e)[:200]}")
    return BreweryBulkResult(created=created, updated=updated, skipped=skipped, errors=errors)


@router.get("/{brewery_id}", response_model=BreweryRead)
def get_brewery(brewery_id: int, db: DB, _: CurrentUser):
    obj = db.query(Brewery).filter(Brewery.brewery_id == brewery_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="양조장을 찾을 수 없습니다")
    return obj


@router.patch("/{brewery_id}", response_model=BreweryRead)
def update_brewery(
    brewery_id: int,
    data: BreweryUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(Brewery).filter(Brewery.brewery_id == brewery_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="양조장을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj
