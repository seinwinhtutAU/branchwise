"""add other wholesale product group

Revision ID: 20260927othergroup
Revises: 20260924merge
"""

from alembic import op


revision = "20260927othergroup"
down_revision = "20260924merge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL enum values are shared by all wholesale line tables. ADD VALUE
    # is additive and avoids a table rewrite; SQLite development databases do
    # not enforce this enum and therefore need no schema change.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE wholesale_product_group ADD VALUE IF NOT EXISTS 'other'")


def downgrade() -> None:
    # PostgreSQL cannot safely remove an enum value while it may be stored in
    # existing rows. Downgrades leave the additive value in place.
    pass
