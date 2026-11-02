"""one list for everyone who carries goods: cargo companies are folded into the carriers list

Revision ID: 20261003_carriers
Revises: 20261002_route_tree

A cargo company and a driver between two towns are the same kind of thing — someone who carries
the goods — and the same name can be either, so there is one list. Every cargo company name is
added to the carriers (a name already there, ignoring case, is not added twice), and so is every
carrier named on a shipment or one of its stops, so nothing written down is missing from the list.
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "20261003_carriers"
down_revision = "20261002_route_tree"
branch_labels = None
depends_on = None


def fold_cargo_companies(conn) -> None:
    """Adds the cargo companies, and the carriers in use, to wholesale_carriers; written against
    the tables as they are before the cargo list is dropped."""
    seen: dict[str, str] = {}
    sources = [
        ("wholesale_carriers", "name"),
        ("wholesale_cargo_companies", "name"),
        ("wholesale_shipments", "cargo_name"),
        ("wholesale_shipment_stops", "carrier_name"),
    ]
    existing = {
        (row[0] or "").strip().lower() for row in conn.execute(sa.text("SELECT name FROM wholesale_carriers"))
    }
    for table, column in sources:
        for (value,) in conn.execute(sa.text(f"SELECT DISTINCT {column} FROM {table} ORDER BY {column}")):
            name = (value or "").strip()
            if not name or name == "—" or name.lower() in existing or name.lower() in seen:
                continue
            seen[name.lower()] = name
    for name in seen.values():
        conn.execute(
            sa.text("INSERT INTO wholesale_carriers (id, name, active) VALUES (:id, :name, :active)"),
            {"id": str(uuid.uuid4()), "name": name, "active": True},
        )


def upgrade() -> None:
    fold_cargo_companies(op.get_bind())
    op.drop_table("wholesale_cargo_companies")


def downgrade() -> None:
    raise NotImplementedError("The cargo companies list was folded into carriers; restore from a backup.")
