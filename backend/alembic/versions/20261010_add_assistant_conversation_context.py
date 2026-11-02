"""add assistant conversation context and archive state

Revision ID: 20261010_assistant_context
Revises: 20261009_assistant_audit
"""

from alembic import op
import sqlalchemy as sa

revision = "20261010_assistant_context"
down_revision = "20261009_assistant_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assistant_conversations", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.add_column(
        "assistant_conversations",
        sa.Column("context_branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=True),
    )
    op.add_column("assistant_conversations", sa.Column("context_date_from", sa.Date(), nullable=True))
    op.add_column("assistant_conversations", sa.Column("context_date_to", sa.Date(), nullable=True))
    op.add_column("assistant_conversations", sa.Column("context_page", sa.String(120), nullable=True))
    op.create_index(
        "ix_assistant_conversations_user_id_archived_at_updated_at",
        "assistant_conversations",
        ["user_id", "archived_at", "updated_at"],
    )
    op.create_index(
        "ix_assistant_conversations_context_branch_id",
        "assistant_conversations",
        ["context_branch_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_assistant_conversations_context_branch_id",
        table_name="assistant_conversations",
    )
    op.drop_index(
        "ix_assistant_conversations_user_id_archived_at_updated_at",
        table_name="assistant_conversations",
    )
    op.drop_column("assistant_conversations", "context_page")
    op.drop_column("assistant_conversations", "context_date_to")
    op.drop_column("assistant_conversations", "context_date_from")
    op.drop_column("assistant_conversations", "context_branch_id")
    op.drop_column("assistant_conversations", "archived_at")
