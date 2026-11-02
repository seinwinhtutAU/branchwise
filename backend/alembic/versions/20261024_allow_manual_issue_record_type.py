"""allow manually recorded issues in wholesale write-offs

Revision ID: 20261024_manual_issue_type
Revises: 20261023_manual_issues_status
Create Date: 2026-10-24
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20261024_manual_issue_type"
down_revision: Union[str, Sequence[str], None] = "20261023_manual_issues_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _replace_record_type_constraint(values: str) -> None:
    """Update the allowed record types without touching any existing issue rows."""
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("wholesale_write_offs") as batch_op:
            batch_op.drop_constraint(
                "ck_wholesale_write_offs_record_type",
                type_="check",
            )
            batch_op.create_check_constraint(
                "ck_wholesale_write_offs_record_type",
                f"record_type IN ({values})",
            )
        return

    op.drop_constraint(
        "ck_wholesale_write_offs_record_type",
        "wholesale_write_offs",
        type_="check",
    )
    op.create_check_constraint(
        "ck_wholesale_write_offs_record_type",
        "wholesale_write_offs",
        f"record_type IN ({values})",
    )


def upgrade() -> None:
    _replace_record_type_constraint(
        "'shortfall', 'quantity_change', 'manual_issue'",
    )


def downgrade() -> None:
    _replace_record_type_constraint("'shortfall', 'quantity_change'")
