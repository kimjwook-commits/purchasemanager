"""add bottles_per_box to product

Revision ID: 003
Revises: 002
Create Date: 2026-06-21
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "product",
        sa.Column("bottles_per_box", sa.Integer(), nullable=False, server_default="12"),
    )


def downgrade() -> None:
    op.drop_column("product", "bottles_per_box")
