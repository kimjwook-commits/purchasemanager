from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Query

from app.api.deps import DB, CurrentUser
from app.models.inventory import DemandActual
from app.models.product import Product
from app.services.demand_forecast import run_demand_forecast

router = APIRouter(prefix="/demand-forecast", tags=["demand-forecast"])


@router.get("", response_model=List[dict])
def get_demand_forecast(
    db: DB,
    _: CurrentUser,
    today_ym: Optional[str] = None,
    horizon: int = Query(default=6, ge=1, le=24),
):
    """
    STEP 1-7 알고리즘으로 품목별 월별 출고량 예측.
    반환: [{product_code, product_id, ym, qty_boxes}]
    """
    if not today_ym:
        t = date.today()
        today_ym = f"{t.year:04d}-{t.month:02d}"

    rows = (
        db.query(DemandActual, Product.product_code, Product.product_id)
        .join(Product, DemandActual.product_id == Product.product_id)
        .all()
    )

    demand_data = [
        {"product_code": pc, "ym": da.ym, "qty_boxes": da.qty_boxes}
        for da, pc, _ in rows
    ]
    pc_to_pid = {pc: pid for _, pc, pid in rows}

    forecasts = run_demand_forecast(demand_data, today_ym, horizon)

    return [
        {
            "product_code": product_code,
            "product_id": pc_to_pid.get(product_code),
            "ym": ym,
            "qty_boxes": qty,
        }
        for product_code, month_fcst in forecasts.items()
        for ym, qty in month_fcst.items()
        if qty > 0
    ]
