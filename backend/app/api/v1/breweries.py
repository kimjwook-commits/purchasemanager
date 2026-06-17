from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import Brewery
from app.schemas.master import BreweryCreate, BreweryRead, BreweryUpdate

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
