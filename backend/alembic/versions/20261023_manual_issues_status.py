"""add status and reference fields to wholesale write-offs

Revision ID: 20261023_manual_issues_status
Revises: 20261022_issue_quantity_changes
Create Date: 2026-10-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261023_manual_issues_status"
down_revision: Union[str, Sequence[str], None] = "20261022_issue_quantity_changes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_write_offs",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("resolved_by_user_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("reference_type", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("reference_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("issue_type", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("wholesale_write_offs", "issue_type")
    op.drop_column("wholesale_write_offs", "reference_id")
    op.drop_column("wholesale_write_offs", "reference_type")
    op.drop_column("wholesale_write_offs", "resolved_by_user_id")
    op.drop_column("wholesale_write_offs", "resolved_at")
    op.drop_column("wholesale_write_offs", "status")
