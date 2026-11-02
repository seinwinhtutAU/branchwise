"""a supplier discount can be given in Baht

Revision ID: 20261020_discount_baht
Revises: 20261019_issue_colors
Create Date: 2026-10-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261020_discount_baht"
down_revision: Union[str, Sequence[str], None] = "20261019_issue_colors"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_supplier_vouchers",
        sa.Column("discount_exchange_rate", sa.Numeric(precision=24, scale=12), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("wholesale_supplier_vouchers", "discount_exchange_rate")
