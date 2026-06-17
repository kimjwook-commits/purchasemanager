"""initial schema — 전체 테이블 생성

Revision ID: 001
Revises:
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. entity ──────────────────────────────────────────────────────────
    op.create_table(
        "entity",
        sa.Column("entity_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("business_no", sa.String(20), unique=True),
        sa.Column("address", sa.String(255)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 2. role ────────────────────────────────────────────────────────────
    op.create_table(
        "role",
        sa.Column("role_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(50), unique=True, nullable=False),
        sa.Column("description", sa.String(200)),
        sa.Column("permissions", sa.JSON(), nullable=False, server_default="[]"),
    )

    # ── 3. brewery ─────────────────────────────────────────────────────────
    op.create_table(
        "brewery",
        sa.Column("brewery_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("name_ja", sa.String(100)),
        sa.Column("country", sa.String(3), nullable=False, server_default="JPN"),
        sa.Column("region", sa.String(50)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 4. temperature_tier ────────────────────────────────────────────────
    op.create_table(
        "temperature_tier",
        sa.Column("tier_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(10), unique=True, nullable=False),
        sa.Column("name_ko", sa.String(20), nullable=False),
        sa.Column("shelf_life_months", sa.Integer(), nullable=False),
        sa.Column("review_cycle_months", sa.Integer(), nullable=False),
        sa.Column("lead_time_months", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("default_zone_code", sa.String(20), nullable=False),
    )

    # ── 5. container_spec ──────────────────────────────────────────────────
    op.create_table(
        "container_spec",
        sa.Column("spec_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("container_type", sa.String(10), nullable=False),
        sa.Column("tier_id", sa.Integer(), sa.ForeignKey("temperature_tier.tier_id"), nullable=False),
        sa.Column("max_pallets", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(10, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.UniqueConstraint("container_type", "tier_id", name="uq_container_spec"),
    )

    # ── 6. warehouse_zone ──────────────────────────────────────────────────
    op.create_table(
        "warehouse_zone",
        sa.Column("zone_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(20), unique=True, nullable=False),
        sa.Column("name_ko", sa.String(30), nullable=False),
        sa.Column("tier_id", sa.Integer(), sa.ForeignKey("temperature_tier.tier_id"), nullable=False),
        sa.Column("capacity_pallets", sa.Integer()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 7. exporter ────────────────────────────────────────────────────────
    op.create_table(
        "exporter",
        sa.Column("exporter_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.entity_id")),
        sa.Column("code", sa.String(20), unique=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("country", sa.String(3), nullable=False, server_default="JPN"),
        sa.Column("contact_email", sa.String(100)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 8. product ─────────────────────────────────────────────────────────
    op.create_table(
        "product",
        sa.Column("product_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("product_code", sa.String(30), unique=True, nullable=False),
        sa.Column("name_ja", sa.String(200), nullable=False),
        sa.Column("name_ko", sa.String(200)),
        sa.Column("brewery_id", sa.Integer(), sa.ForeignKey("brewery.brewery_id")),
        sa.Column("tier_id", sa.Integer(), sa.ForeignKey("temperature_tier.tier_id"), nullable=False),
        sa.Column("boxes_per_pallet", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("weight_per_layer_kg", sa.Numeric(8, 2)),
        sa.Column("alcohol_pct", sa.Numeric(4, 1)),
        sa.Column("volume_ml", sa.Integer()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 9. app_user ────────────────────────────────────────────────────────
    op.create_table(
        "app_user",
        sa.Column("user_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(50), unique=True, nullable=False),
        sa.Column("email", sa.String(100), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.entity_id")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 10. user_role ──────────────────────────────────────────────────────
    op.create_table(
        "user_role",
        sa.Column("ur_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_user.user_id"), nullable=False),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("role.role_id"), nullable=False),
        sa.UniqueConstraint("user_id", "role_id", name="uq_user_role"),
    )

    # ── 11. exporter_product ───────────────────────────────────────────────
    op.create_table(
        "exporter_product",
        sa.Column("ep_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("exporter_id", sa.Integer(), sa.ForeignKey("exporter.exporter_id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("item_code", sa.String(50)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("exporter_id", "product_id", name="uq_exporter_product"),
    )

    # ── 12. supply_price ───────────────────────────────────────────────────
    op.create_table(
        "supply_price",
        sa.Column("price_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ep_id", sa.Integer(), sa.ForeignKey("exporter_product.ep_id"), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="JPY"),
        sa.Column("brewery_price", sa.Numeric(14, 2)),
        sa.Column("supply_price", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.Text()),
    )

    # ── 13. planning_param ─────────────────────────────────────────────────
    op.create_table(
        "planning_param",
        sa.Column("param_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), unique=True, nullable=False),
        sa.Column("no_mix_flag", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("min_order_layers", sa.Integer()),
        sa.Column("max_order_layers", sa.Integer()),
        sa.Column("override_review_cycle", sa.Integer()),
        sa.Column("override_lead_time", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 14. fx_rate ────────────────────────────────────────────────────────
    op.create_table(
        "fx_rate",
        sa.Column("rate_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("quote_currency", sa.String(3), nullable=False),
        sa.Column("rate_date", sa.Date(), nullable=False),
        sa.Column("rate", sa.Numeric(14, 6), nullable=False),
        sa.Column("source", sa.String(50), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("base_currency", "quote_currency", "rate_date", name="uq_fx_rate"),
    )

    # ── 15. plan_run ───────────────────────────────────────────────────────
    op.create_table(
        "plan_run",
        sa.Column("plan_run_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_ym", sa.String(7), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("horizon_months", sa.Integer(), nullable=False, server_default="12"),
        sa.Column("service_z", sa.Numeric(5, 3), nullable=False, server_default="2.050"),
        sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("app_user.user_id"), nullable=False),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("app_user.user_id")),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("run_ym", "version", name="uq_plan_run_version"),
    )

    # ── 16. purchase_order ─────────────────────────────────────────────────
    op.create_table(
        "purchase_order",
        sa.Column("po_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("po_no", sa.String(30), unique=True, nullable=False),
        sa.Column("exporter_id", sa.Integer(), sa.ForeignKey("exporter.exporter_id"), nullable=False),
        sa.Column("order_ym", sa.String(7), nullable=False),
        sa.Column("plan_run_id", sa.Integer(), sa.ForeignKey("plan_run.plan_run_id")),
        sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("app_user.user_id"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 17. po_line ────────────────────────────────────────────────────────
    op.create_table(
        "po_line",
        sa.Column("po_line_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("po_id", sa.Integer(), sa.ForeignKey("purchase_order.po_id"), nullable=False),
        sa.Column("ep_id", sa.Integer(), sa.ForeignKey("exporter_product.ep_id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("order_boxes", sa.Integer(), nullable=False),
        sa.Column("order_layers", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(14, 2)),
        sa.Column("currency", sa.String(3), nullable=False, server_default="JPY"),
        sa.Column("note", sa.Text()),
    )
    op.create_index("ix_po_line_po", "po_line", ["po_id"])

    # ── 18. plan_line ──────────────────────────────────────────────────────
    op.create_table(
        "plan_line",
        sa.Column("plan_line_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("plan_run_id", sa.Integer(), sa.ForeignKey("plan_run.plan_run_id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("ep_id", sa.Integer(), sa.ForeignKey("exporter_product.ep_id")),
        sa.Column("order_ym", sa.String(7), nullable=False),
        sa.Column("order_boxes", sa.Integer(), nullable=False),
        sa.Column("order_layers", sa.Integer(), nullable=False),
        sa.Column("expected_arrival_ym", sa.String(7), nullable=False),
        sa.Column("projected_inv_end", sa.Integer()),
        sa.Column("is_committed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("alert", sa.Text()),
    )
    op.create_index("ix_plan_line_run_product", "plan_line", ["plan_run_id", "product_id"])

    # ── 19. demand_actual ──────────────────────────────────────────────────
    op.create_table(
        "demand_actual",
        sa.Column("da_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("ym", sa.String(7), nullable=False),
        sa.Column("qty_boxes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "ym", name="uq_demand_actual"),
    )

    # ── 20. demand_forecast ────────────────────────────────────────────────
    op.create_table(
        "demand_forecast",
        sa.Column("df_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("plan_run_id", sa.Integer(), sa.ForeignKey("plan_run.plan_run_id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("ym", sa.String(7), nullable=False),
        sa.Column("forecast_boxes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("plan_run_id", "product_id", "ym", name="uq_demand_forecast"),
    )
    op.create_index("ix_forecast_run", "demand_forecast", ["plan_run_id"])

    # ── 21. inventory_lot ──────────────────────────────────────────────────
    op.create_table(
        "inventory_lot",
        sa.Column("lot_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("zone_id", sa.Integer(), sa.ForeignKey("warehouse_zone.zone_id"), nullable=False),
        sa.Column("po_line_id", sa.Integer(), sa.ForeignKey("po_line.po_line_id")),
        sa.Column("lot_no", sa.String(50), unique=True, nullable=False),
        sa.Column("qty_boxes", sa.Integer(), nullable=False),
        sa.Column("mfg_date", sa.Date()),
        sa.Column("exp_date", sa.Date()),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="AVAILABLE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lot_product_exp", "inventory_lot", ["product_id", "exp_date"])
    op.create_index("ix_lot_zone", "inventory_lot", ["zone_id"])

    # ── 22. shipment ───────────────────────────────────────────────────────
    op.create_table(
        "shipment",
        sa.Column("shipment_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("po_id", sa.Integer(), sa.ForeignKey("purchase_order.po_id"), nullable=False),
        sa.Column("bl_no", sa.String(50)),
        sa.Column("do_no", sa.String(50)),
        sa.Column("vessel_name", sa.String(100)),
        sa.Column("departure_port", sa.String(50)),
        sa.Column("arrival_port", sa.String(50)),
        sa.Column("departure_date", sa.Date()),
        sa.Column("arrival_date", sa.Date()),
        sa.Column("inland_date", sa.Date()),
        sa.Column("inspection_date", sa.Date()),
        sa.Column("customs_clearance_date", sa.Date()),
        sa.Column("received_date", sa.Date()),
        sa.Column("rcep_cert_no", sa.String(50)),
        sa.Column("customs_declaration_no", sa.String(50)),
        sa.Column("status", sa.String(20), nullable=False, server_default="DEPARTED"),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 23. container ──────────────────────────────────────────────────────
    op.create_table(
        "container",
        sa.Column("container_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("shipment_id", sa.Integer(), sa.ForeignKey("shipment.shipment_id"), nullable=False),
        sa.Column("spec_id", sa.Integer(), sa.ForeignKey("container_spec.spec_id"), nullable=False),
        sa.Column("container_no", sa.String(20)),
        sa.Column("seal_no", sa.String(20)),
        sa.Column("pallets_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(10, 2)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── 24. container_load ─────────────────────────────────────────────────
    op.create_table(
        "container_load",
        sa.Column("load_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("container_id", sa.Integer(), sa.ForeignKey("container.container_id"), nullable=False),
        sa.Column("po_line_id", sa.Integer(), sa.ForeignKey("po_line.po_line_id"), nullable=False),
        sa.Column("pallet_no", sa.Integer(), nullable=False),
        sa.Column("layers_loaded", sa.Integer(), nullable=False),
        sa.Column("boxes_loaded", sa.Integer(), nullable=False),
        sa.Column("is_mixed", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_container_load_container", "container_load", ["container_id"])

    # ── 25. inspection ─────────────────────────────────────────────────────
    op.create_table(
        "inspection",
        sa.Column("inspection_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("shipment_id", sa.Integer(), sa.ForeignKey("shipment.shipment_id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.product_id"), nullable=False),
        sa.Column("sample_boxes", sa.Integer(), nullable=False),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("inspector_id", sa.Integer(), sa.ForeignKey("app_user.user_id")),
        sa.Column("inspected_at", sa.DateTime(timezone=True)),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("inspection")
    op.drop_index("ix_container_load_container", table_name="container_load")
    op.drop_table("container_load")
    op.drop_table("container")
    op.drop_table("shipment")
    op.drop_index("ix_lot_zone", table_name="inventory_lot")
    op.drop_index("ix_lot_product_exp", table_name="inventory_lot")
    op.drop_table("inventory_lot")
    op.drop_index("ix_forecast_run", table_name="demand_forecast")
    op.drop_table("demand_forecast")
    op.drop_table("demand_actual")
    op.drop_index("ix_plan_line_run_product", table_name="plan_line")
    op.drop_table("plan_line")
    op.drop_index("ix_po_line_po", table_name="po_line")
    op.drop_table("po_line")
    op.drop_table("purchase_order")
    op.drop_table("plan_run")
    op.drop_table("fx_rate")
    op.drop_table("planning_param")
    op.drop_table("supply_price")
    op.drop_table("exporter_product")
    op.drop_table("user_role")
    op.drop_table("app_user")
    op.drop_table("product")
    op.drop_table("exporter")
    op.drop_table("warehouse_zone")
    op.drop_table("container_spec")
    op.drop_table("temperature_tier")
    op.drop_table("brewery")
    op.drop_table("role")
    op.drop_table("entity")
