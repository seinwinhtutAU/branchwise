"""keep a read-only Issue history for corrected quantities

Revision ID: 20261022_issue_quantity_changes
Revises: 20261021_package_changes
Create Date: 2026-10-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261022_issue_quantity_changes"
down_revision: Union[str, Sequence[str], None] = "20261021_package_changes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_write_offs",
        sa.Column("record_type", sa.String(length=30), nullable=False, server_default="shortfall"),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("quantity_before", sa.Integer(), nullable=True),
    )
    op.add_column(
        "wholesale_write_offs",
        sa.Column("quantity_after", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_wholesale_write_offs_record_type",
        "wholesale_write_offs",
        "record_type IN ('shortfall', 'quantity_change')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_wholesale_write_offs_record_type",
        "wholesale_write_offs",
        type_="check",
    )
    op.drop_column("wholesale_write_offs", "quantity_after")
    op.drop_column("wholesale_write_offs", "quantity_before")
    op.drop_column("wholesale_write_offs", "record_type")
