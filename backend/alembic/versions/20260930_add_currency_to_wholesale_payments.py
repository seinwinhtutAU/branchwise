"""add currency fields to wholesale payments

Revision ID: 20260930_pay_currency
Revises: fbc85cdc3211
"""

from alembic import op
import sqlalchemy as sa


revision = "20260930_pay_currency"
down_revision = "fbc85cdc3211"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("wholesale_payments", sa.Column("currency_code", sa.String(3), nullable=False, server_default="MMK"))
    op.add_column("wholesale_payments", sa.Column("original_amount", sa.Numeric(18, 4), nullable=True))
    op.add_column("wholesale_payments", sa.Column("exchange_rate", sa.Numeric(24, 12), nullable=True))
    op.alter_column("wholesale_payments", "currency_code", server_default=None)
    op.create_check_constraint(
        "ck_wholesale_payments_currency_fields",
        "wholesale_payments",
        """
        (currency_code = 'MMK' AND original_amount IS NULL AND exchange_rate IS NULL)
        OR
        (currency_code <> 'MMK' AND original_amount IS NOT NULL AND exchange_rate IS NOT NULL AND exchange_rate > 0)
        """,
    )


def downgrade() -> None:
    op.drop_constraint("ck_wholesale_payments_currency_fields", "wholesale_payments", type_="check")
    op.drop_column("wholesale_payments", "exchange_rate")
    op.drop_column("wholesale_payments", "original_amount")
    op.drop_column("wholesale_payments", "currency_code")
