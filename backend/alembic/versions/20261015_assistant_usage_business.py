"""assistant_usage: count calls by business (retail/wholesale) instead of by page

Revision ID: 20261015_usage_business
Revises: 20261014_assistant_usage
"""

from alembic import op
import sqlalchemy as sa

revision = "20261015_usage_business"
down_revision = "20261014_assistant_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assistant_usage", sa.Column("business", sa.String(12)))
    op.drop_column("assistant_usage", "page")


def downgrade() -> None:
    op.add_column("assistant_usage", sa.Column("page", sa.String(120)))
    op.drop_column("assistant_usage", "business")
