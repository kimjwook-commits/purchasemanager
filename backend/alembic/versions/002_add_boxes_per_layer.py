"""add boxes_per_layer to product

Revision ID: 002
Revises: 001
Create Date: 2026-06-21
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "product",
        sa.Column("boxes_per_layer", sa.Integer(), nullable=False, server_default="10"),
    )


def downgrade() -> None:
    op.drop_column("product", "boxes_per_layer")
