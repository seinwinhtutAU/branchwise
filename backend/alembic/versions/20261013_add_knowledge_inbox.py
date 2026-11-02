"""add the knowledge inbox: unanswered questions the owner has answered or dismissed

Revision ID: 20261013_knowledge_inbox
Revises: 20261012_knowledge
"""

from alembic import op
import sqlalchemy as sa

revision = "20261013_knowledge_inbox"
down_revision = "20261012_knowledge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_inbox_handled",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("question_key", sa.String(40), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("article_id", sa.String(36), sa.ForeignKey("knowledge_articles.id")),
        sa.Column("handled_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("handled_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("question_key", name="uq_knowledge_inbox_question_key"),
    )


def downgrade() -> None:
    op.drop_table("knowledge_inbox_handled")
