// ── Auth ─────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  access_token: string
  user_id: number
  username: string
  permissions: string[]
}

// ── Master ────────────────────────────────────────────────────────────────────
export interface Exporter {
  exporter_id: number
  code: string
  name: string
  country: string
  contact_email: string | null
  is_active: boolean
}

export interface Brewery {
  brewery_id: number
  name: string
  name_ja: string | null
  country: string
  region: string | null
  is_active: boolean
}

export interface TemperatureTier {
  tier_id: number
  code: string
  name_ko: string
  shelf_life_months: number
  review_cycle_months: number
  lead_time_months: number
}

export type ProductType = 'regular' | 'spot' | 'pb'

export interface Product {
  product_id: number
  product_code: string
  name_ja: string | null
  name_ko: string | null
  tier_id: number
  tier_code: string | null
  tier_name: string | null
  brewery_id: number | null
  brewery_name: string | null
  product_type: ProductType
  boxes_per_pallet: number
  boxes_per_layer: number
  bottles_per_box: number
  alcohol_pct: number | null
  volume_ml: number | null
  is_active: boolean
}

export interface ExporterProduct {
  ep_id: number
  exporter_id: number
  exporter_code: string | null
  product_id: number
  product_code: string | null
  name_ja: string | null
  is_active: boolean
}

export interface SupplyPrice {
  price_id: number
  ep_id: number
  supply_price: number
  brewery_price: number | null
  currency: string
  effective_date: string
  note: string | null
}

export interface ContainerSpec {
  spec_id: number
  container_type: string
  tier_id: number
  max_pallets: number
  cost_usd: number
  is_active: boolean
}

// ── Planning ──────────────────────────────────────────────────────────────────
export interface PlanRun {
  plan_run_id: number
  run_ym: string
  version: number
  status: string
  horizon_months: number
  service_z: number
  created_by: number
  created_at: string
  line_count?: number
}

export interface MonthSummary {
  order_ym: string
  cold_pallets: number
  ambient_pallets: number
  room_pallets: number
  total_pallets: number
  line_count: number
  alert_count: number
}

export interface PlanAlert {
  plan_line_id: number
  product_id: number
  product_code: string | null
  order_ym: string
  alert: string
}

export interface PlanLine {
  plan_line_id: number
  plan_run_id: number
  product_id: number
  product_code: string | null
  name_ja: string | null
  tier_code: string | null
  order_ym: string
  order_boxes: number
  order_layers: number
  expected_arrival_ym: string
  is_committed: boolean
  alert: string | null
}

// ── Purchase Order ────────────────────────────────────────────────────────────
export interface PurchaseOrder {
  po_id: number
  po_no: string
  exporter_id: number
  exporter_code: string | null
  exporter_name: string | null
  order_ym: string
  status: string
  plan_run_id: number | null
  created_by: number
  submitted_at: string | null
  confirmed_at: string | null
  note: string | null
  created_at: string
  line_count: number
  total_boxes: number
  total_layers: number
}

export interface PoLine {
  po_line_id: number
  po_id: number
  product_id: number
  product_code: string | null
  name_ja: string | null
  tier_code: string | null
  brewery_id: number | null
  brewery_name: string | null
  order_boxes: number
  order_layers: number
  unit_price: number | null
  currency: string
  amount_jpy: number | null
}

// ── Kanban ─────────────────────────────────────────────────────────────────────
export interface KanbanLine {
  plan_line_id: number
  product_id: number
  product_code: string | null
  name_ja: string | null
  tier_code: string | null
  product_type: string | null
  order_ym: string
  order_boxes: number
  order_layers: number
  expected_arrival_ym: string
  exporter_id: number | null
  exporter_code: string | null
  alert: string | null
  po_id: number | null
  po_no: string | null
  committed_jun: number | null
  committed_jul: number | null
}

export interface KanbanColumn {
  column: string
  label_ko: string
  count: number
  lines: KanbanLine[]
}

export interface KanbanBoard {
  plan_run_id: number
  run_ym: string
  plan_status: string
  columns: KanbanColumn[]
}

// ── Shipment ──────────────────────────────────────────────────────────────────

export interface ShipmentListItem {
  shipment_id: number
  po_id: number
  po_no: string | null
  exporter_code: string | null
  exporter_name: string | null
  order_ym: string | null
  status: string
  bl_no: string | null
  vessel_name: string | null
  departure_date: string | null
  arrival_date: string | null
  container_count: number
  total_cost_usd: number
}

export interface InspectionRead {
  inspection_id: number
  shipment_id: number
  product_id: number
  product_code: string | null
  name_ja: string | null
  sample_boxes: number
  result: string
  inspector_id: number | null
  inspected_at: string | null
  note: string | null
}

export interface ShipmentDetail extends ShipmentListItem {
  do_no: string | null
  departure_port: string | null
  arrival_port: string | null
  inland_date: string | null
  inspection_date: string | null
  customs_clearance_date: string | null
  received_date: string | null
  rcep_cert_no: string | null
  customs_declaration_no: string | null
  note: string | null
  total_cost_usd: number
  containers: ContainerSlot[]
  inspections: InspectionRead[]
}

export interface InventoryLotRead {
  lot_id: number
  product_id: number
  zone_id: number
  po_line_id: number | null
  lot_no: string
  qty_boxes: number
  mfg_date: string | null
  exp_date: string | null
  received_at: string
  status: string
}

// ── Container Plan ────────────────────────────────────────────────────────────
export interface LineAssignment {
  po_line_id: number
  product_id: number
  product_code: string | null
  name_ja: string | null
  tier_code: string | null
  total_boxes: number
  pallets_in_container: number
  boxes_in_container: number
  layers_in_container: number
  pallet_start: number
}

export interface ContainerSlot {
  seq: number
  spec_id: number
  container_type: string
  tier_code: string
  cost_usd: number
  max_pallets: number
  pallets_used: number
  assignments: LineAssignment[]
}

export interface PackingPlanResult {
  po_id: number
  po_no: string
  total_boxes: number
  total_pallets: number
  container_count: number
  total_cost_usd: number
  containers: ContainerSlot[]
}

// ── FX Rate ───────────────────────────────────────────────────────────────────
export interface FxRate {
  rate_id: number
  base_currency: string
  quote_currency: string
  rate_date: string
  rate: number
  source: string
}

// ── Inventory / Demand ────────────────────────────────────────────────────────
export interface DemandActualRead {
  da_id: number
  product_id: number
  product_code: string | null
  ym: string
  qty_boxes: number
}

export interface DemandActualSummary {
  upserted: number
  skipped: number
}

export interface InvLotRead {
  lot_id: number
  product_id: number
  product_code: string | null
  zone_id: number
  zone_code: string | null
  lot_no: string
  qty_boxes: number
  mfg_date: string | null
  exp_date: string | null
  status: string
}

export interface InvLotSummary {
  total_lots: number
  total_boxes: number
  product_count: number
}
