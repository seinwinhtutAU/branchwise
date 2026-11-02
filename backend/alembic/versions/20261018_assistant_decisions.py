"""remember what the assistant said needs a decision, so it can follow up

Revision ID: 20261018_assistant_decisions
Revises: 20261017_voucher_discount
"""

import sqlalchemy as sa
from alembic import op

revision = "20261018_assistant_decisions"
down_revision = "20261017_voucher_discount"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_decisions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scope", sa.String(length=80), nullable=False),
        sa.Column("key", sa.String(length=160), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("why", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("where_to_look", sa.String(length=120), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("first_seen", sa.Date(), nullable=False),
        sa.Column("last_seen", sa.Date(), nullable=False),
        sa.Column("resolved_on", sa.Date(), nullable=True),
        sa.Column("snoozed_until", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assistant_decisions_scope_key_status", "assistant_decisions", ["scope", "key", "status"])


def downgrade() -> None:
    op.drop_index("ix_assistant_decisions_scope_key_status", table_name="assistant_decisions")
    op.drop_table("assistant_decisions")
