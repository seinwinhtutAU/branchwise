"""record package splits and combinations on shipment stops

Revision ID: 20261021_package_changes
Revises: 20261020_discount_baht
Create Date: 2026-10-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261021_package_changes"
down_revision: Union[str, Sequence[str], None] = "20261020_discount_baht"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_shipment_stops",
        sa.Column("package_change_kind", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "wholesale_shipment_stops",
        sa.Column("packages_after_change", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_wholesale_shipment_stops_package_change_kind",
        "wholesale_shipment_stops",
        "package_change_kind IS NULL OR package_change_kind IN ('split', 'combine')",
    )
    op.create_check_constraint(
        "ck_wholesale_shipment_stops_package_change_packages",
        "wholesale_shipment_stops",
        "(package_change_kind IS NULL AND packages_after_change IS NULL) OR "
        "(package_change_kind IS NOT NULL AND packages_after_change >= 0)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_wholesale_shipment_stops_package_change_packages",
        "wholesale_shipment_stops",
        type_="check",
    )
    op.drop_constraint(
        "ck_wholesale_shipment_stops_package_change_kind",
        "wholesale_shipment_stops",
        type_="check",
    )
    op.drop_column("wholesale_shipment_stops", "packages_after_change")
    op.drop_column("wholesale_shipment_stops", "package_change_kind")
