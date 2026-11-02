"""supplier vouchers: where the goods are expected to arrive, known when the order is placed

Revision ID: 20261001_voucher_gate
Revises: 20261001_places
"""

from alembic import op
import sqlalchemy as sa


revision = "20261001_voucher_gate"
down_revision = "20261001_places"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_supplier_vouchers",
        sa.Column("receiving_gate", sa.String(255), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("wholesale_supplier_vouchers", "receiving_gate")
