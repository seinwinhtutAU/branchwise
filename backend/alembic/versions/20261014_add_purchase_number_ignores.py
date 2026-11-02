"""add ignored purchase-number gaps

Revision ID: 20261014purchaseignores
Revises: 20261024_manual_issue_type
Create Date: 2026-10-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261014purchaseignores"
down_revision: Union[str, Sequence[str], None] = "20261024_manual_issue_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "purchase_number_ignores",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=False),
        sa.Column("prefix", sa.String(length=100), nullable=False),
        sa.Column("start_number", sa.Integer(), nullable=False),
        sa.Column("end_number", sa.Integer(), nullable=False),
        sa.Column("number_width", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("ignored_at", sa.DateTime(), nullable=True),
        sa.Column("ignored_by", sa.String(length=36), nullable=True),
        sa.CheckConstraint("start_number <= end_number", name="ck_purchase_number_ignores_range"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["ignored_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "branch_id", "prefix", "start_number", "end_number",
            name="uq_purchase_number_ignores_branch_prefix_range",
        ),
    )


def downgrade() -> None:
    op.drop_table("purchase_number_ignores")
