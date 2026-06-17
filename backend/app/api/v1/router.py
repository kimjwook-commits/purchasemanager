from fastapi import APIRouter

from app.api.v1 import (
    breweries,
    container_plan,
    exporter_products,
    exporters,
    kanban,
    master,
    planning,
    planning_params,
    products,
    purchase_orders,
    roles,
    shipments,
    supply_prices,
)

router = APIRouter(prefix="/api/v1")

router.include_router(exporters.router)
router.include_router(breweries.router)
router.include_router(master.router)
router.include_router(products.router)
router.include_router(exporter_products.router)
router.include_router(supply_prices.router)
router.include_router(planning_params.router)
router.include_router(planning.router)
router.include_router(kanban.router)
router.include_router(purchase_orders.router)
router.include_router(container_plan.router)
router.include_router(shipments.router)
router.include_router(roles.router)
