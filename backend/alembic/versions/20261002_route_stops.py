"""shipment stops form a tree: legs table renamed, each stop knows the stop before it; a receiving knows where it was counted

Revision ID: 20261002_route_stops
Revises: 20261001_voucher_gate
"""

from alembic import op
import sqlalchemy as sa


revision = "20261002_route_stops"
down_revision = "20261001_voucher_gate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("wholesale_shipment_legs", "wholesale_shipment_stops")
    op.drop_constraint("uq_wholesale_shipment_legs_shipment_id_leg_order", "wholesale_shipment_stops", type_="unique")
    op.create_unique_constraint(
        "uq_wholesale_shipment_stops_shipment_id_leg_order", "wholesale_shipment_stops", ["shipment_id", "leg_order"]
    )
    op.drop_index("ix_wholesale_shipment_legs_shipment_id", table_name="wholesale_shipment_stops")
    op.create_index("ix_wholesale_shipment_stops_shipment_id", "wholesale_shipment_stops", ["shipment_id"])

    with op.batch_alter_table("wholesale_shipment_stops") as batch:
        batch.add_column(sa.Column("parent_stop_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_wholesale_shipment_stops_parent_stop_id",
            "wholesale_shipment_stops",
            ["parent_stop_id"],
            ["id"],
            ondelete="SET NULL",
        )
    # Every existing route is one chain: a stop's parent is the stop before it.
    op.execute(
        """
        UPDATE wholesale_shipment_stops
        SET parent_stop_id = (
            SELECT previous.id FROM (SELECT id, shipment_id, leg_order FROM wholesale_shipment_stops) AS previous
            WHERE previous.shipment_id = wholesale_shipment_stops.shipment_id
              AND previous.leg_order = wholesale_shipment_stops.leg_order - 1
        )
        """
    )

    with op.batch_alter_table("wholesale_receivings") as batch:
        batch.add_column(sa.Column("stop_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_wholesale_receivings_stop_id",
            "wholesale_shipment_stops",
            ["stop_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("wholesale_receivings") as batch:
        batch.drop_constraint("fk_wholesale_receivings_stop_id", type_="foreignkey")
        batch.drop_column("stop_id")
    with op.batch_alter_table("wholesale_shipment_stops") as batch:
        batch.drop_constraint("fk_wholesale_shipment_stops_parent_stop_id", type_="foreignkey")
        batch.drop_column("parent_stop_id")
    op.drop_index("ix_wholesale_shipment_stops_shipment_id", table_name="wholesale_shipment_stops")
    op.create_index("ix_wholesale_shipment_legs_shipment_id", "wholesale_shipment_stops", ["shipment_id"])
    op.drop_constraint("uq_wholesale_shipment_stops_shipment_id_leg_order", "wholesale_shipment_stops", type_="unique")
    op.create_unique_constraint(
        "uq_wholesale_shipment_legs_shipment_id_leg_order", "wholesale_shipment_stops", ["shipment_id", "leg_order"]
    )
    op.rename_table("wholesale_shipment_stops", "wholesale_shipment_legs")
