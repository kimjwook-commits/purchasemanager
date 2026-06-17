from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.product import PlanningParam, Product
from app.schemas.product import PlanningParamCreate, PlanningParamRead, PlanningParamUpdate

router = APIRouter(prefix="/planning-params", tags=["planning-params"])


@router.get("/", response_model=list[PlanningParamRead])
def list_params(db: DB, _: CurrentUser):
    return db.query(PlanningParam).all()


@router.get("/{product_id}", response_model=PlanningParamRead)
def get_param(product_id: int, db: DB, _: CurrentUser):
    obj = db.query(PlanningParam).filter(PlanningParam.product_id == product_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="발주 파라미터가 없습니다 (tier 기본값 사용)")
    return obj


@router.post("/", response_model=PlanningParamRead, status_code=status.HTTP_201_CREATED)
def create_param(
    data: PlanningParamCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    if not db.query(Product).filter(Product.product_id == data.product_id).first():
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")
    if db.query(PlanningParam).filter(PlanningParam.product_id == data.product_id).first():
        raise HTTPException(status_code=409, detail="이미 파라미터가 존재합니다 (PATCH 사용)")
    obj = PlanningParam(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.patch("/{product_id}", response_model=PlanningParamRead)
def update_param(
    product_id: int,
    data: PlanningParamUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(PlanningParam).filter(PlanningParam.product_id == product_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="발주 파라미터를 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj
