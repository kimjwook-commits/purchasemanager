"""
TemperatureTier / WarehouseZone / ContainerSpec 관리 API
"""
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.master import ContainerSpec, TemperatureTier, WarehouseZone
from app.schemas.master import (
    ContainerSpecCreate, ContainerSpecRead, ContainerSpecUpdate,
    TemperatureTierRead, TemperatureTierUpdate,
    WarehouseZoneCreate, WarehouseZoneRead, WarehouseZoneUpdate,
)

router = APIRouter(tags=["master"])


# ── TemperatureTier (조회 전용) ───────────────────────────────────────────────

@router.get("/temperature-tiers", response_model=list[TemperatureTierRead])
def list_tiers(db: DB, _: CurrentUser):
    return db.query(TemperatureTier).order_by(TemperatureTier.tier_id).all()


@router.get("/temperature-tiers/{tier_id}", response_model=TemperatureTierRead)
def get_tier(tier_id: int, db: DB, _: CurrentUser):
    obj = db.query(TemperatureTier).filter(TemperatureTier.tier_id == tier_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="온도 티어를 찾을 수 없습니다")
    return obj


@router.patch("/temperature-tiers/{tier_id}", response_model=TemperatureTierRead)
def update_tier(
    tier_id: int,
    data: TemperatureTierUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(TemperatureTier).filter(TemperatureTier.tier_id == tier_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="온도 티어를 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


# ── WarehouseZone ─────────────────────────────────────────────────────────────

@router.get("/warehouse-zones", response_model=list[WarehouseZoneRead])
def list_zones(db: DB, _: CurrentUser, active_only: bool = True):
    q = db.query(WarehouseZone)
    if active_only:
        q = q.filter(WarehouseZone.is_active == True)
    return q.order_by(WarehouseZone.code).all()


@router.post("/warehouse-zones", response_model=WarehouseZoneRead, status_code=status.HTTP_201_CREATED)
def create_zone(
    data: WarehouseZoneCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    if db.query(WarehouseZone).filter(WarehouseZone.code == data.code).first():
        raise HTTPException(status_code=409, detail=f"구역 코드 '{data.code}' 이미 존재합니다")
    obj = WarehouseZone(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.patch("/warehouse-zones/{zone_id}", response_model=WarehouseZoneRead)
def update_zone(
    zone_id: int,
    data: WarehouseZoneUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(WarehouseZone).filter(WarehouseZone.zone_id == zone_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="창고 구역을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


# ── ContainerSpec ─────────────────────────────────────────────────────────────

@router.get("/container-specs", response_model=list[ContainerSpecRead])
def list_specs(db: DB, _: CurrentUser, active_only: bool = True):
    q = db.query(ContainerSpec)
    if active_only:
        q = q.filter(ContainerSpec.is_active == True)
    return q.order_by(ContainerSpec.tier_id, ContainerSpec.container_type).all()


@router.post("/container-specs", response_model=ContainerSpecRead, status_code=status.HTTP_201_CREATED)
def create_spec(
    data: ContainerSpecCreate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = ContainerSpec(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.patch("/container-specs/{spec_id}", response_model=ContainerSpecRead)
def update_spec(
    spec_id: int,
    data: ContainerSpecUpdate,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(ContainerSpec).filter(ContainerSpec.spec_id == spec_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="컨테이너 스펙을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj
