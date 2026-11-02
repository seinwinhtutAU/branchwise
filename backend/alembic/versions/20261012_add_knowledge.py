"""add the assistant's knowledge: articles, their versions and searchable chunks

Revision ID: 20261012_knowledge
Revises: 20261011_assistant_feedback
"""

from alembic import op
import sqlalchemy as sa

revision = "20261012_knowledge"
down_revision = "20261011_assistant_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_articles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("aliases", sa.Text(), nullable=False),
        sa.Column("pinned", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("source_path", sa.String(300)),
        sa.Column("content_hash", sa.String(64)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("reviewed_at", sa.Date()),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("source_path", name="uq_knowledge_articles_source_path"),
    )
    op.create_index(
        "ix_knowledge_articles_status_pinned", "knowledge_articles", ["status", "pinned"]
    )
    op.create_table(
        "knowledge_article_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("article_id", sa.String(36), sa.ForeignKey("knowledge_articles.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("aliases", sa.Text(), nullable=False),
        sa.Column("changed_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("article_id", "version", name="uq_knowledge_versions_article_version"),
    )
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("article_id", sa.String(36), sa.ForeignKey("knowledge_articles.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("heading", sa.String(300), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("embedding", sa.LargeBinary()),
        sa.Column("embedding_model", sa.String(100)),
        sa.UniqueConstraint("article_id", "position", name="uq_knowledge_chunks_article_position"),
    )


def downgrade() -> None:
    op.drop_table("knowledge_chunks")
    op.drop_table("knowledge_article_versions")
    op.drop_index("ix_knowledge_articles_status_pinned", table_name="knowledge_articles")
    op.drop_table("knowledge_articles")
