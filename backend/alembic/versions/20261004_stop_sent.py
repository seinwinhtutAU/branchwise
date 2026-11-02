"""each place on a route records how many the carrier took from the place before

Revision ID: 20261004_stop_sent
Revises: 20261003_carriers

Until now only the cargo company's own figure was kept (`wholesale_shipments.packages_sent_by_cargo`);
a later road only had what arrived at its end, so a package lost on the road could not be seen on
the road. Every place now also has `packages_sent`. Existing places start with sent = arrived (no
difference appears out of nowhere), except the first place after the supplier, which keeps what the
cargo company sent — all of it when there is one such road, and what is left over once the other
roads' arrivals are taken off when the shipment had several.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261004_stop_sent"
down_revision = "20261003_carriers"
branch_labels = None
depends_on = None


def backfill_stop_sent(conn) -> None:
    conn.execute(sa.text("UPDATE wholesale_shipment_stops SET packages_sent = packages_received"))
    shipments = conn.execute(sa.text("SELECT id, packages_sent_by_cargo FROM wholesale_shipments")).all()
    for shipment_id, cargo_sent in shipments:
        roots = conn.execute(
            sa.text(
                "SELECT id, packages_received FROM wholesale_shipment_stops "
                "WHERE shipment_id = :id AND parent_stop_id IS NULL ORDER BY leg_order"
            ),
            {"id": shipment_id},
        ).all()
        if not roots:
            continue
        others = sum(row[1] for row in roots[1:])
        conn.execute(
            sa.text("UPDATE wholesale_shipment_stops SET packages_sent = :sent WHERE id = :id"),
            {"sent": max(0, cargo_sent - others), "id": roots[0][0]},
        )


def upgrade() -> None:
    op.add_column(
        "wholesale_shipment_stops",
        sa.Column("packages_sent", sa.Integer(), nullable=False, server_default="0"),
    )
    backfill_stop_sent(op.get_bind())


def downgrade() -> None:
    op.drop_column("wholesale_shipment_stops", "packages_sent")
