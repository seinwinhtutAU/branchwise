"""wholesale places: one list of every place goods can be (stops, receiving gates, warehouses)

Revision ID: 20261001_places
Revises: 20261001_transfer_counts
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "20261001_places"
down_revision = "20261001_transfer_counts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wholesale_places",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_wholesale_places_name"),
    )
    # Fill the list from the names already in use, so nothing written down so far is lost. Written
    # against the tables as they were at this revision (not the current models), the old gate and
    # destination lists first, then the places used by receivings, shipments, stops, moves and
    # deliveries; trimmed and de-duplicated ignoring case, the first spelling met winning.
    conn = op.get_bind()
    sources = [
        ("wholesale_receiving_gates", "name"),
        ("wholesale_destinations", "name"),
        ("wholesale_receivings", "gate"),
        ("wholesale_shipments", "final_location"),
        ("wholesale_shipment_legs", "stop_name"),
        ("wholesale_stock_transfers", "from_location"),
        ("wholesale_stock_transfers", "to_location"),
        ("wholesale_stock_movements", "location"),
    ]
    seen: dict[str, str] = {}
    for table, column in sources:
        for (value,) in conn.execute(sa.text(f"SELECT DISTINCT {column} FROM {table} ORDER BY {column}")):
            name = (value or "").strip()
            if name and name.lower() not in seen:
                seen[name.lower()] = name
    for name in seen.values():
        conn.execute(
            sa.text("INSERT INTO wholesale_places (id, name, active) VALUES (:id, :name, :active)"),
            {"id": str(uuid.uuid4()), "name": name, "active": True},
        )


def downgrade() -> None:
    op.drop_table("wholesale_places")
