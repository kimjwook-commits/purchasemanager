from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import Exporter
from app.schemas.master import ExporterCreate, ExporterRead, ExporterUpdate

router = APIRouter(prefix="/exporters", tags=["exporters"])


@router.get("/", response_model=list[ExporterRead])
def list_exporters(db: DB, _: CurrentUser, active_only: bool = True):
    q = db.query(Exporter)
    if active_only:
        q = q.filter(Exporter.is_active == True)
    return q.order_by(Exporter.code).all()


@router.post("/", response_model=ExporterRead, status_code=status.HTTP_201_CREATED)
def create_exporter(
    data: ExporterCreate,
    db: DB,
    _: Exporter = Depends(require_permission("item_register")),
):
    if db.query(Exporter).filter(Exporter.code == data.code).first():
        raise HTTPException(status_code=409, detail=f"수출자 코드 '{data.code}' 이미 존재합니다")
    exporter = Exporter(**data.model_dump())
    db.add(exporter)
    db.commit()
    db.refresh(exporter)
    return exporter


@router.get("/{exporter_id}", response_model=ExporterRead)
def get_exporter(exporter_id: int, db: DB, _: CurrentUser):
    obj = db.query(Exporter).filter(Exporter.exporter_id == exporter_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="수출자를 찾을 수 없습니다")
    return obj


@router.patch("/{exporter_id}", response_model=ExporterRead)
def update_exporter(
    exporter_id: int,
    data: ExporterUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(Exporter).filter(Exporter.exporter_id == exporter_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="수출자를 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj
