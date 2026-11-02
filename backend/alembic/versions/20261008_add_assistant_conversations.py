"""add durable assistant conversations and messages

Revision ID: 20261008_assistant_conversations
Revises: 20261007_fee_types
"""

from alembic import op
import sqlalchemy as sa


revision = "20261008_assistant_conversations"
down_revision = "20261007_fee_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False, server_default="New conversation"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_assistant_conversations_user_id_updated_at",
        "assistant_conversations",
        ["user_id", "updated_at"],
    )
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(length=36),
            sa.ForeignKey("assistant_conversations.id"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("conversation_id", "sequence", name="uq_assistant_messages_conversation_sequence"),
    )
    op.create_index(
        "ix_assistant_messages_conversation_id_sequence",
        "assistant_messages",
        ["conversation_id", "sequence"],
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_messages_conversation_id_sequence", table_name="assistant_messages")
    op.drop_table("assistant_messages")
    op.drop_index("ix_assistant_conversations_user_id_updated_at", table_name="assistant_conversations")
    op.drop_table("assistant_conversations")
