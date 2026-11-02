"""add right/wrong feedback on assistant answers

Revision ID: 20261011_assistant_feedback
Revises: 20261010_assistant_context
"""

from alembic import op
import sqlalchemy as sa

revision = "20261011_assistant_feedback"
down_revision = "20261010_assistant_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_feedback",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("message_id", sa.String(36), sa.ForeignKey("assistant_messages.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("rating", sa.String(8), nullable=False),
        sa.Column("reason", sa.String(500)),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("message_id", name="uq_assistant_feedback_message_id"),
    )
    op.create_index(
        "ix_assistant_feedback_rating_created_at", "assistant_feedback", ["rating", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_feedback_rating_created_at", table_name="assistant_feedback")
    op.drop_table("assistant_feedback")
