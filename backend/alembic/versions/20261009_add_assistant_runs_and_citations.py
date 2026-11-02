"""add assistant run audit records and data citations

Revision ID: 20261009_assistant_audit
Revises: 20261008_assistant_conversations
"""

from alembic import op
import sqlalchemy as sa

revision = "20261009_assistant_audit"
down_revision = "20261008_assistant_conversations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), sa.ForeignKey("assistant_conversations.id"), nullable=False),
        sa.Column("assistant_message_id", sa.String(36), sa.ForeignKey("assistant_messages.id")),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("error_message", sa.String(500)),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assistant_runs_conversation_id_created_at", "assistant_runs", ["conversation_id", "created_at"])
    op.create_table(
        "assistant_citations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("assistant_runs.id"), nullable=False),
        sa.Column("source_name", sa.String(120), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assistant_citations_run_id", "assistant_citations", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_citations_run_id", table_name="assistant_citations")
    op.drop_table("assistant_citations")
    op.drop_index("ix_assistant_runs_conversation_id_created_at", table_name="assistant_runs")
    op.drop_table("assistant_runs")
