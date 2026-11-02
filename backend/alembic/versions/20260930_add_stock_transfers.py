"""add wholesale stock transfers: goods moved from a receiving gate to a warehouse

Revision ID: 20260930_stock_transfers
Revises: 20260930_supply_links
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260930_stock_transfers"
down_revision = "20260930_supply_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wholesale_stock_transfers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column(
            "voucher_id",
            sa.String(36),
            sa.ForeignKey("wholesale_supplier_vouchers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("voucher_no", sa.String(30), nullable=False),
        sa.Column("supplier_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("from_location", sa.String(255), nullable=False),
        sa.Column("to_location", sa.String(255), nullable=False),
        sa.Column("moved_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False, server_default=""),
        sa.Column("recorded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_wholesale_stock_transfers_voucher_id", "wholesale_stock_transfers", ["voucher_id"])
    op.create_index(
        "ix_wholesale_stock_transfers_branch_id_moved_on", "wholesale_stock_transfers", ["branch_id", "moved_on"]
    )
    op.create_table(
        "wholesale_stock_transfer_lines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "transfer_id",
            sa.String(36),
            sa.ForeignKey("wholesale_stock_transfers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stock_code", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=False, server_default=""),
        sa.Column(
            "product_group",
            postgresql.ENUM(name="wholesale_product_group", create_type=False),
            nullable=False,
        ),
        sa.Column("color_qty", sa.String(1000), nullable=False),
        sa.Column("unit", postgresql.ENUM(name="wholesale_unit", create_type=False), nullable=False),
        sa.Column("unit_conversions", sa.JSON(), nullable=False),
        sa.Column("quantity_pairs", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_wholesale_stock_transfer_lines_transfer_id", "wholesale_stock_transfer_lines", ["transfer_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_wholesale_stock_transfer_lines_transfer_id", table_name="wholesale_stock_transfer_lines")
    op.drop_table("wholesale_stock_transfer_lines")
    op.drop_index("ix_wholesale_stock_transfers_branch_id_moved_on", table_name="wholesale_stock_transfers")
    op.drop_index("ix_wholesale_stock_transfers_voucher_id", table_name="wholesale_stock_transfers")
    op.drop_table("wholesale_stock_transfers")
