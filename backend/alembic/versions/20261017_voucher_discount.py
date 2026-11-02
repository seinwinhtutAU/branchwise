"""Add a whole-voucher discount to wholesale supplier vouchers

Revision ID: 20261017_voucher_discount
Revises: 20261016_cached_tokens
"""

import sqlalchemy as sa
from alembic import op

revision = "20261017_voucher_discount"
down_revision = "20261016_cached_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_supplier_vouchers",
        sa.Column("discount_kind", sa.String(length=10), nullable=False, server_default="none"),
    )
    op.add_column(
        "wholesale_supplier_vouchers",
        sa.Column("discount_value", sa.Numeric(14, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("wholesale_supplier_vouchers", "discount_value")
    op.drop_column("wholesale_supplier_vouchers", "discount_kind")
