"""add assistant_usage: tokens spent by assistant model calls that are not chat answers

Revision ID: 20261014_assistant_usage
Revises: 20261013_knowledge_inbox
"""

from alembic import op
import sqlalchemy as sa

revision = "20261014_assistant_usage"
down_revision = "20261013_knowledge_inbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_usage",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("page", sa.String(120)),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assistant_usage_created_at", "assistant_usage", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_assistant_usage_created_at", table_name="assistant_usage")
    op.drop_table("assistant_usage")
