"""Таблиці shift, cash_operation та колонка payment.shift_id (версія 1.1 специфікації)

Revision ID: c3f9a1b8e2d4
Revises: b7e1c4d2a9f0
Create Date: 2026-11-14 17:25:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3f9a1b8e2d4"
down_revision: Union[str, None] = "b7e1c4d2a9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPEN_SHIFT = sa.text("status = 'відкрита'")


def upgrade() -> None:
    op.create_table(
        "shift",
        sa.Column("shift_id", sa.Integer(), nullable=False),
        sa.Column("club_id", sa.Integer(), nullable=False),
        sa.Column("z_number", sa.Integer(), nullable=True),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="відкрита"),
        sa.Column("opened_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("opened_by_user_id", sa.Integer(), nullable=False),
        sa.Column("opening_cash", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("opening_difference", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("open_note", sa.String(length=300), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("force_closed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cash_sales", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("card_sales", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("bonus_sales", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("sessions_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sessions_cancelled", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sessions_carried_over", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cash_in", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("cash_out", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("collection", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("expected_cash", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("actual_cash", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("cash_difference", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("cash_left", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0.00"),
        sa.Column("card_terminal_total", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("card_difference", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("close_note", sa.String(length=300), nullable=True),
        sa.Column("review_status", sa.String(length=20), nullable=False, server_default="очікує"),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("review_note", sa.String(length=300), nullable=True),
        sa.CheckConstraint("opening_cash >= 0", name="ck_shift_opening_cash_nonnegative"),
        sa.ForeignKeyConstraint(["club_id"], ["club.club_id"]),
        sa.ForeignKeyConstraint(["opened_by_user_id"], ["app_user.user_id"]),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["app_user.user_id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["app_user.user_id"]),
        sa.PrimaryKeyConstraint("shift_id"),
        sa.UniqueConstraint("club_id", "z_number", name="uq_shift_club_z_number"),
    )

    op.create_index(
        "uq_shift_open_club",
        "shift",
        ["club_id"],
        unique=True,
        postgresql_where=OPEN_SHIFT,
        sqlite_where=OPEN_SHIFT,
    )

    op.create_table(
        "cash_operation",
        sa.Column("operation_id", sa.Integer(), nullable=False),
        sa.Column("shift_id", sa.Integer(), nullable=False),
        sa.Column("club_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=True),
        sa.Column("comment", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_cash_operation_amount_positive"),
        sa.ForeignKeyConstraint(["shift_id"], ["shift.shift_id"]),
        sa.ForeignKeyConstraint(["club_id"], ["club.club_id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["app_user.user_id"]),
        sa.PrimaryKeyConstraint("operation_id"),
    )

    with op.batch_alter_table("payment") as batch:
        batch.add_column(sa.Column("shift_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_payment_shift_id", "shift", ["shift_id"], ["shift_id"])


def downgrade() -> None:
    with op.batch_alter_table("payment") as batch:
        batch.drop_constraint("fk_payment_shift_id", type_="foreignkey")
        batch.drop_column("shift_id")
    op.drop_table("cash_operation")
    op.drop_index("uq_shift_open_club", table_name="shift")
    op.drop_table("shift")

