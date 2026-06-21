import client from './client'
import type {
  LoginResponse, Exporter, Brewery, Product, ExporterProduct,
  SupplyPrice, PlanRun, PlanLine, MonthSummary, PlanAlert,
  PurchaseOrder, PoLine, KanbanBoard, PackingPlanResult,
  ShipmentListItem, ShipmentDetail, InspectionRead, InventoryLotRead,
  FxRate, DemandActualRead, DemandActualSummary, InvLotRead, InvLotSummary,
} from './types'

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (username: string, password: string) =>
  client.post<LoginResponse>('/auth/login',
    new URLSearchParams({ username, password }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

// ── Master ────────────────────────────────────────────────────────────────────
export const getExporters = () => client.get<Exporter[]>('/v1/exporters/')
export const createExporter = (data: Partial<Exporter>) => client.post<Exporter>('/v1/exporters/', data)
export const updateExporter = (id: number, data: Partial<Exporter>) => client.put<Exporter>(`/v1/exporters/${id}`, data)

export const getBreweries = () => client.get<Brewery[]>('/v1/breweries/')
export const createBrewery = (data: Partial<Brewery>) => client.post<Brewery>('/v1/breweries/', data)

export const getProducts = (params?: { q?: string; tier?: string; exporter_id?: number; page?: number; size?: number }) =>
  client.get<{ items: Product[]; total: number; page: number; size: number }>('/v1/products/', { params })

export const getExporterProducts = (params?: { exporter_id?: number; product_id?: number }) =>
  client.get<ExporterProduct[]>('/v1/exporter-products/', { params })
export const bulkCreateExporterProducts = (exporter_id: number, product_codes: string[]) =>
  client.post<{ created: number; skipped: number; errors: string[] }>('/v1/exporter-products/bulk', {
    exporter_id, items: product_codes.map(c => ({ product_code: c })),
  })

export const getTiers = () =>
  client.get<import('./types').TemperatureTier[]>('/v1/master/temperature-tiers')
export const updateTier = (tier_id: number, data: { review_cycle_months?: number; lead_time_months?: number; shelf_life_months?: number }) =>
  client.patch<import('./types').TemperatureTier>(`/v1/master/temperature-tiers/${tier_id}`, data)
export const updateContainerSpec = (spec_id: number, data: { max_pallets?: number; cost_usd?: number }) =>
  client.patch<import('./types').ContainerSpec>(`/v1/master/container-specs/${spec_id}`, data)

export const createProduct = (data: {
  product_code: string; name_ja: string; name_ko?: string
  brewery_id?: number; tier_id: number
  boxes_per_pallet?: number; volume_ml?: number; alcohol_pct?: number
}) => client.post<import('./types').Product>('/v1/products/', data)

export const getSupplyPrices = (params?: { ep_id?: number; exporter_id?: number; current_only?: boolean }) =>
  client.get<SupplyPrice[]>('/v1/supply-prices/', { params })
export const getCurrentSupplyPrices = (exporter_id: number) =>
  client.get<SupplyPrice[]>('/v1/supply-prices/current', { params: { exporter_id } })
export const getContainerSpecs = () =>
  client.get<import('./types').ContainerSpec[]>('/v1/master/container-specs')

export const createSupplyPrice = (data: { ep_id: number; supply_price: number; currency?: string; effective_date: string; brewery_price?: number }) =>
  client.post<SupplyPrice>('/v1/supply-prices/', data)

// ── Planning ──────────────────────────────────────────────────────────────────
export const getPlanRuns = (params?: { run_ym?: string; status_filter?: string }) =>
  client.get<PlanRun[]>('/v1/plan/runs', { params })
export const runPlan = (run_ym: string, horizon_months = 12, service_z = 2.05) =>
  client.post<PlanRun>('/v1/plan/runs', { run_ym, horizon_months, service_z })
export const approvePlan = (plan_run_id: number, comment?: string) =>
  client.put<PlanRun>(`/v1/plan/runs/${plan_run_id}/approve`, { comment })
export const getPlanLines = (plan_run_id: number, params?: { order_ym?: string; tier?: string; committed_only?: boolean; has_alert?: boolean }) =>
  client.get<PlanLine[]>(`/v1/plan/runs/${plan_run_id}/lines`, { params })
export const getPlanSummary = (plan_run_id: number) =>
  client.get<{ plan_run_id: number; run_ym: string; months: MonthSummary[] }>(`/v1/plan/runs/${plan_run_id}/summary`)
export const getPlanAlerts = (plan_run_id: number) =>
  client.get<PlanAlert[]>(`/v1/plan/runs/${plan_run_id}/alerts`)

// ── Kanban ────────────────────────────────────────────────────────────────────
export const getKanbanBoard = (plan_run_id: number, params?: { order_ym?: string; exporter_id?: number }) =>
  client.get<KanbanBoard>(`/v1/kanban/board/${plan_run_id}`, { params })

export const moveKanbanLine = (plan_run_id: number, plan_line_id: number, target_column: string) =>
  client.patch(`/v1/kanban/board/${plan_run_id}/lines/${plan_line_id}/move`, null, { params: { target_column } })

// ── Purchase Order ────────────────────────────────────────────────────────────
export const getPurchaseOrders = (params?: { exporter_id?: number; order_ym?: string; po_status?: string; plan_run_id?: number }) =>
  client.get<PurchaseOrder[]>('/v1/purchase-orders/', { params })

export const getPurchaseOrder = (id: number) => client.get<PurchaseOrder>(`/v1/purchase-orders/${id}`)
export const getPoLines = (po_id: number) => client.get<PoLine[]>(`/v1/purchase-orders/${po_id}/lines`)
export const createPOsFromPlan = (plan_run_id: number, exporter_id?: number) =>
  client.post<PurchaseOrder[]>('/v1/purchase-orders/from-plan', { plan_run_id, exporter_id })
export const updatePoStatus = (po_id: number, status: string, note?: string) =>
  client.put<PurchaseOrder>(`/v1/purchase-orders/${po_id}/status`, { status, note })
export const getPoPreview = (po_id: number) => client.get(`/v1/purchase-orders/${po_id}/preview`)

// ── Shipments ─────────────────────────────────────────────────────────────────
export const getShipments = (params?: { status?: string; exporter_id?: number }) =>
  client.get<ShipmentListItem[]>('/v1/shipments/', { params })

export const getShipment = (shipment_id: number) =>
  client.get<ShipmentDetail>(`/v1/shipments/${shipment_id}`)

export const advanceShipment = (shipment_id: number, data: Record<string, unknown>) =>
  client.post<ShipmentDetail>(`/v1/shipments/${shipment_id}/advance`, data)

export const cancelShipment = (shipment_id: number, note?: string) =>
  client.post<ShipmentDetail>(`/v1/shipments/${shipment_id}/cancel`, { note })

export const addInspection = (shipment_id: number, data: { product_id: number; sample_boxes: number; result: string; note?: string }) =>
  client.post<InspectionRead>(`/v1/shipments/${shipment_id}/inspections`, data)

export const getInspections = (shipment_id: number) =>
  client.get<InspectionRead[]>(`/v1/shipments/${shipment_id}/inspections`)

export const receiveShipment = (shipment_id: number, lots: { po_line_id: number; qty_boxes: number; mfg_date?: string; exp_date?: string }[]) =>
  client.post<InventoryLotRead[]>(`/v1/shipments/${shipment_id}/receive`, { lots })

export const updateContainer = (shipment_id: number, container_id: number, params: { container_no?: string; seal_no?: string }) =>
  client.patch(`/v1/shipments/${shipment_id}/containers/${container_id}`, null, { params })

// ── Container Plan ────────────────────────────────────────────────────────────
export const generateContainerPlan = (po_id: number) =>
  client.post<PackingPlanResult>('/v1/container-plan/generate', { po_id })
export const confirmContainerPlan = (po_id: number) =>
  client.post('/v1/container-plan/confirm', { po_id })
export const getPackingList = (po_id: number) =>
  client.get(`/v1/container-plan/${po_id}/packing-list`)

// ── FX Rate ───────────────────────────────────────────────────────────────────
export const getFxRates = (params?: { base_currency?: string; quote_currency?: string }) =>
  client.get<FxRate[]>('/v1/fx-rates/', { params })
export const getLatestFxRates = () =>
  client.get<FxRate[]>('/v1/fx-rates/latest')
export const createFxRate = (data: { base_currency: string; quote_currency: string; rate_date: string; rate: number; source?: string }) =>
  client.post<FxRate>('/v1/fx-rates/', data)
export const deleteFxRate = (rate_id: number) =>
  client.delete(`/v1/fx-rates/${rate_id}`)

// ── Inventory / Demand ────────────────────────────────────────────────────────
export const getDemandActual = (params?: { product_id?: number; ym_from?: string; ym_to?: string }) =>
  client.get<DemandActualRead[]>('/v1/inventory/demand-actual', { params })
export const bulkUpsertDemandActual = (rows: { product_code: string; ym: string; qty_boxes: number }[], overwrite = true) =>
  client.post<DemandActualSummary>('/v1/inventory/demand-actual/bulk', { rows, overwrite })

export const getInventoryLots = (params?: { product_id?: number; zone_id?: number; status?: string }) =>
  client.get<InvLotRead[]>('/v1/inventory/lots', { params })
export const getInventoryLotsSummary = () =>
  client.get<InvLotSummary>('/v1/inventory/lots/summary')
export const registerInitialLots = (rows: { product_code: string; zone_code: string; lot_no: string; qty_boxes: number; mfg_date?: string; exp_date?: string }[]) =>
  client.post<{ created: number; skipped: number }>('/v1/inventory/lots/initial', { rows })
