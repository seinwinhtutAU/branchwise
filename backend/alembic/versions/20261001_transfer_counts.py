"""stock transfers: a move can be between any two places, and the destination counts on arrival

Revision ID: 20261001_transfer_counts
Revises: 20260930_stock_transfers
"""

from alembic import op
import sqlalchemy as sa


revision = "20261001_transfer_counts"
down_revision = "20260930_stock_transfers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("wholesale_stock_transfers", "voucher_id", existing_type=sa.String(36), nullable=True)
    op.alter_column(
        "wholesale_stock_transfers", "voucher_no", existing_type=sa.String(30), nullable=False, server_default=""
    )
    op.add_column("wholesale_stock_transfers", sa.Column("counted_on", sa.Date(), nullable=True))
    op.add_column("wholesale_stock_transfer_lines", sa.Column("counted_color_qty", sa.String(1000), nullable=True))
    op.add_column("wholesale_stock_transfer_lines", sa.Column("counted_quantity_pairs", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("wholesale_stock_transfer_lines", "counted_quantity_pairs")
    op.drop_column("wholesale_stock_transfer_lines", "counted_color_qty")
    op.drop_column("wholesale_stock_transfers", "counted_on")
    op.alter_column("wholesale_stock_transfers", "voucher_no", existing_type=sa.String(30), server_default=None)
    op.alter_column("wholesale_stock_transfers", "voucher_id", existing_type=sa.String(36), nullable=False)
