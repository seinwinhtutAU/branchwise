"""a list of what costs are for, so a new kind of fee is added once and picked afterwards

Revision ID: 20261007_fee_types
Revises: 20261006_place_warehouse
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "20261007_fee_types"
down_revision = "20261006_place_warehouse"
branch_labels = None
depends_on = None

DEFAULTS = ["Carrier fee", "Porters", "Gate handling", "Second trip", "Other"]


def upgrade() -> None:
    table = op.create_table(
        "wholesale_fee_types",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_wholesale_fee_types_name"),
    )
    bind = op.get_bind()
    used = [
        (kind or "").strip()
        for (kind,) in bind.execute(sa.text("SELECT DISTINCT kind FROM wholesale_receiving_costs")).all()
    ]
    seen: dict[str, str] = {}
    for name in [*DEFAULTS, *used]:
        if name and name.lower() not in seen:
            seen[name.lower()] = name
    op.bulk_insert(table, [{"id": str(uuid.uuid4()), "name": name, "active": True} for name in seen.values()])


def downgrade() -> None:
    op.drop_table("wholesale_fee_types")
