"""a place can be marked as a warehouse

Revision ID: 20261006_place_warehouse
Revises: 20261005_stop_links

Goods counted at a warehouse are in stock straight away; goods counted anywhere else have to be
moved to a warehouse before they can be set aside for a customer or delivered.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261006_place_warehouse"
down_revision = "20261005_stop_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_places",
        sa.Column("is_warehouse", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Every place goods have already been moved to is a warehouse, and so is every place
    # something has been delivered from: that is what they have been used as until now.
    op.execute(
        """
        UPDATE wholesale_places SET is_warehouse = true
        WHERE lower(name) IN (
            SELECT lower(to_location) FROM wholesale_stock_transfers
            UNION SELECT lower(location) FROM wholesale_stock_movements
        )
        """
    )


def downgrade() -> None:
    op.drop_column("wholesale_places", "is_warehouse")
