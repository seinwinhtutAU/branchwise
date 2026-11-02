"""add default prices to wholesale products

Revision ID: fbc85cdc3211
Revises: 20260927othergroup
Create Date: 2026-09-29 16:00:51.631346

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fbc85cdc3211'
down_revision: Union[str, Sequence[str], None] = '20260927othergroup'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('wholesale_products', sa.Column('default_selling_price', sa.Numeric(precision=14, scale=2), server_default='0', nullable=False))
    op.add_column('wholesale_products', sa.Column('default_buying_price', sa.Numeric(precision=14, scale=2), server_default='0', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('wholesale_products', 'default_buying_price')
    op.drop_column('wholesale_products', 'default_selling_price')
