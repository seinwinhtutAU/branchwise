"""a place can have more than one road into it — routes that forked can meet again

Revision ID: 20261005_stop_links
Revises: 20261004_stop_sent

The first road into a place is still `parent_stop_id`; every further one is a row here, with its
own carrier and packages sent.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261005_stop_links"
down_revision = "20261004_stop_sent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wholesale_shipment_stop_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "to_stop_id", sa.String(36), sa.ForeignKey("wholesale_shipment_stops.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "from_stop_id", sa.String(36), sa.ForeignKey("wholesale_shipment_stops.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("carrier_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("packages_sent", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("to_stop_id", "from_stop_id", name="uq_wholesale_shipment_stop_links_to_from"),
    )
    op.create_index(
        "ix_wholesale_shipment_stop_links_from_stop_id", "wholesale_shipment_stop_links", ["from_stop_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_wholesale_shipment_stop_links_from_stop_id", table_name="wholesale_shipment_stop_links")
    op.drop_table("wholesale_shipment_stop_links")
