"""Фіксована тривалість та передоплата сеансу (planned_minutes, planned_end_time, is_prepaid)

Revision ID: e5b2c7d9f1a6
Revises: d4a8e9f1b3c5
Create Date: 2026-11-25 14:35:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5b2c7d9f1a6"
down_revision: Union[str, None] = "d4a8e9f1b3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("session", sa.Column("planned_minutes", sa.Integer(), nullable=True))
    op.add_column("session", sa.Column("planned_end_time", sa.DateTime(), nullable=True))
    op.add_column(
        "session",
        sa.Column("is_prepaid", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("session", "is_prepaid")
    op.drop_column("session", "planned_end_time")
    op.drop_column("session", "planned_minutes")
