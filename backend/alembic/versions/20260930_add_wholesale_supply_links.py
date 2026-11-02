"""add wholesale_supply_links: which customer-order lines a voucher line was bought for

Revision ID: 20260930_supply_links
Revises: 20260930_pay_currency
"""

from alembic import op
import sqlalchemy as sa


revision = "20260930_supply_links"
down_revision = "20260930_pay_currency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wholesale_supply_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column(
            "voucher_line_id",
            sa.String(36),
            sa.ForeignKey("wholesale_supplier_voucher_lines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "order_line_id",
            sa.String(36),
            sa.ForeignKey("wholesale_customer_order_lines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("quantity_pairs", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("voucher_line_id", "order_line_id", name="uq_wholesale_supply_links_pair"),
    )
    op.create_index("ix_wholesale_supply_links_order_line_id", "wholesale_supply_links", ["order_line_id"])


def downgrade() -> None:
    op.drop_index("ix_wholesale_supply_links_order_line_id", table_name="wholesale_supply_links")
    op.drop_table("wholesale_supply_links")
