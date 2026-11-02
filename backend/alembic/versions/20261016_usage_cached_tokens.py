"""record how many input tokens the provider served from its cache, for a more exact cost

Revision ID: 20261016_cached_tokens
Revises: 20261015_usage_business
"""

from alembic import op
import sqlalchemy as sa

revision = "20261016_cached_tokens"
down_revision = "20261015_usage_business"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assistant_runs", sa.Column("cached_input_tokens", sa.Integer()))
    op.add_column("assistant_usage", sa.Column("cached_input_tokens", sa.Integer()))


def downgrade() -> None:
    op.drop_column("assistant_usage", "cached_input_tokens")
    op.drop_column("assistant_runs", "cached_input_tokens")
