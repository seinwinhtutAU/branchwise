"""keep the colours an issue record is made of

Revision ID: 20261019_issue_colors
Revises: 20261018_assistant_decisions
Create Date: 2026-10-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261019_issue_colors"
down_revision: Union[str, Sequence[str], None] = "20261018_assistant_decisions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_write_offs",
        sa.Column("color_breakdown", sa.String(length=1000), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("wholesale_write_offs", "color_breakdown")
