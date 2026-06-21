"""add product_type to product

Revision ID: 004
Revises: 003
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('product',
        sa.Column('product_type', sa.String(20), nullable=False, server_default='regular')
    )


def downgrade():
    op.drop_column('product', 'product_type')
