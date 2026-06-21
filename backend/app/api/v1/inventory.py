"""
재고·수요 실적 API

DemandActual (과거 출고 실적)
  GET  /inventory/demand-actual         — 조회 (상품별 월별)
  POST /inventory/demand-actual/bulk    — 일괄 업로드
  DELETE /inventory/demand-actual/{id}  — 삭제

InventoryLot (기초 재고)
  GET  /inventory/lots                  — 로트 목록 + 합계
  GET  /inventory/lots/summary          — 재고 요약 (상품·구역별 집계)
  POST /inventory/lots/initial          — 초기재고 일괄 등록
  DELETE /inventory/lots/{lot_id}       — 로트 삭제
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import DB, CurrentUser, require_permission
from app.models.inventory import DemandActual, InventoryLot
from app.models.master import WarehouseZone
from app.models.product import Product
from app.schemas.inventory import (
    DemandActualBulk,
    DemandActualRead,
    DemandActualSummary,
    InitialLotBulk,
    InventoryLotRead,
    InventoryLotSummary,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])


# ── DemandActual ──────────────────────────────────────────────────────────────

@router.get("/demand-actual", response_model=list[DemandActualRead])
def list_demand_actual(
    db: DB,
    _: CurrentUser,
    product_id: Optional[int] = None,
    ym_from: Optional[str] = None,
    ym_to: Optional[str] = None,
):
    q = db.query(DemandActual)
    if product_id:
        q = q.filter(DemandActual.product_id == product_id)
    if ym_from:
        q = q.filter(DemandActual.ym >= ym_from)
    if ym_to:
        q = q.filter(DemandActual.ym <= ym_to)
    rows = q.order_by(DemandActual.product_id, DemandActual.ym).all()

    # product_code 붙이기
    product_map = {p.product_id: p.product_code for p in db.query(Product).all()}
    result = []
    for r in rows:
        d = DemandActualRead.model_validate(r)
        d.product_code = product_map.get(r.product_id)
        result.append(d)
    return result


@router.post("/demand-actual/bulk", response_model=DemandActualSummary)
def bulk_upsert_demand_actual(
    data: DemandActualBulk,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    """제품코드+월 기준 upsert. overwrite=True면 기존 값 덮어씀."""
    product_map = {p.product_code: p.product_id for p in db.query(Product).all()}
    upserted = 0
    skipped = 0

    for row in data.rows:
        product_id = product_map.get(row.product_code)
        if not product_id:
            skipped += 1
            continue

        existing = (
            db.query(DemandActual)
            .filter(DemandActual.product_id == product_id, DemandActual.ym == row.ym)
            .first()
        )
        if existing:
            if data.overwrite:
                existing.qty_boxes = row.qty_boxes
                upserted += 1
            else:
                skipped += 1
        else:
            db.add(DemandActual(product_id=product_id, ym=row.ym, qty_boxes=row.qty_boxes))
            upserted += 1

    db.commit()
    return DemandActualSummary(upserted=upserted, skipped=skipped)


@router.delete("/demand-actual/{da_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_demand_actual(
    da_id: int,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(DemandActual).filter(DemandActual.da_id == da_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="실적 데이터를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()


# ── InventoryLot ──────────────────────────────────────────────────────────────

def _enrich_lot(lot: InventoryLot, product_map: dict, zone_map: dict) -> InventoryLotRead:
    r = InventoryLotRead.model_validate(lot)
    r.product_code = product_map.get(lot.product_id)
    r.zone_code = zone_map.get(lot.zone_id)
    return r


@router.get("/lots", response_model=list[InventoryLotRead])
def list_lots(
    db: DB,
    _: CurrentUser,
    product_id: Optional[int] = None,
    zone_id: Optional[int] = None,
    status: Optional[str] = None,
):
    q = db.query(InventoryLot)
    if product_id:
        q = q.filter(InventoryLot.product_id == product_id)
    if zone_id:
        q = q.filter(InventoryLot.zone_id == zone_id)
    if status:
        q = q.filter(InventoryLot.status == status.upper())
    else:
        q = q.filter(InventoryLot.status == "AVAILABLE")
    lots = q.order_by(InventoryLot.exp_date.asc().nullslast(), InventoryLot.lot_id).all()

    product_map = {p.product_id: p.product_code for p in db.query(Product).all()}
    zone_map = {z.zone_id: z.code for z in db.query(WarehouseZone).all()}
    return [_enrich_lot(l, product_map, zone_map) for l in lots]


@router.get("/lots/summary", response_model=InventoryLotSummary)
def lots_summary(db: DB, _: CurrentUser):
    from sqlalchemy import func
    row = (
        db.query(
            func.count(InventoryLot.lot_id).label("total_lots"),
            func.coalesce(func.sum(InventoryLot.qty_boxes), 0).label("total_boxes"),
            func.count(func.distinct(InventoryLot.product_id)).label("product_count"),
        )
        .filter(InventoryLot.status == "AVAILABLE")
        .one()
    )
    return InventoryLotSummary(
        total_lots=row.total_lots,
        total_boxes=row.total_boxes,
        product_count=row.product_count,
    )


@router.post("/lots/initial", response_model=dict)
def register_initial_lots(
    data: InitialLotBulk,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    """초기재고 일괄 등록. lot_no 중복 시 건너뜀."""
    product_map = {p.product_code: p.product_id for p in db.query(Product).all()}
    zone_map = {z.code: z.zone_id for z in db.query(WarehouseZone).all()}

    created = 0
    skipped = 0

    for row in data.rows:
        product_id = product_map.get(row.product_code)
        zone_id = zone_map.get(row.zone_code.upper())
        if not product_id or not zone_id:
            skipped += 1
            continue

        if db.query(InventoryLot).filter(InventoryLot.lot_no == row.lot_no).first():
            skipped += 1
            continue

        db.add(InventoryLot(
            product_id=product_id,
            zone_id=zone_id,
            lot_no=row.lot_no,
            qty_boxes=row.qty_boxes,
            mfg_date=row.mfg_date,
            exp_date=row.exp_date,
            received_at=datetime.now(timezone.utc),
            status="AVAILABLE",
        ))
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped}


@router.delete("/lots/{lot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lot(
    lot_id: int,
    db: DB,
    _=Depends(require_permission("item_register")),
):
    obj = db.query(InventoryLot).filter(InventoryLot.lot_id == lot_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="로트를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
