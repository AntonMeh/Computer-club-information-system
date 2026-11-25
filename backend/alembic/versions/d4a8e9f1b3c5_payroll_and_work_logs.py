"""Погодинна зарплата (staff.hourly_rate), табель годин (staff_work_log) та виплати зарплати (payroll_payout)

Revision ID: d4a8e9f1b3c5
Revises: c3f9a1b8e2d4
Create Date: 2026-11-18 15:05:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4a8e9f1b3c5"
down_revision: Union[str, None] = "c3f9a1b8e2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "staff",
        sa.Column(
            "hourly_rate",
            sa.Numeric(precision=8, scale=2),
            nullable=False,
            server_default="160.00",
        ),
    )

    op.create_table(
        "staff_work_log",
        sa.Column("log_id", sa.Integer(), nullable=False),
        sa.Column("staff_id", sa.Integer(), nullable=False),
        sa.Column("club_id", sa.Integer(), nullable=False),
        sa.Column("shift_id", sa.Integer(), nullable=True),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("hours_worked", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("hourly_rate_snapshot", sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column(
            "bonus_amount",
            sa.Numeric(precision=10, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column("comment", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "hours_worked > 0 AND hours_worked <= 24",
            name="ck_staff_work_log_hours_range",
        ),
        sa.CheckConstraint(
            "bonus_amount >= 0",
            name="ck_staff_work_log_bonus_nonnegative",
        ),
        sa.ForeignKeyConstraint(["club_id"], ["club.club_id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["app_user.user_id"]),
        sa.ForeignKeyConstraint(["shift_id"], ["shift.shift_id"]),
        sa.ForeignKeyConstraint(["staff_id"], ["staff.staff_id"]),
        sa.PrimaryKeyConstraint("log_id"),
        sa.UniqueConstraint("shift_id", name="uq_staff_work_log_shift_id"),
    )

    op.create_table(
        "payroll_payout",
        sa.Column("payout_id", sa.Integer(), nullable=False),
        sa.Column("staff_id", sa.Integer(), nullable=False),
        sa.Column("club_id", sa.Integer(), nullable=False),
        sa.Column("expense_id", sa.Integer(), nullable=True),
        sa.Column("period_from", sa.Date(), nullable=False),
        sa.Column("period_to", sa.Date(), nullable=False),
        sa.Column(
            "hours_paid",
            sa.Numeric(precision=6, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column(
            "base_amount",
            sa.Numeric(precision=10, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column(
            "bonus_amount",
            sa.Numeric(precision=10, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column("amount_paid", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column(
            "payment_method",
            sa.String(length=30),
            nullable=False,
            server_default="картка",
        ),
        sa.Column("paid_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("paid_by_user_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.CheckConstraint(
            "amount_paid > 0",
            name="ck_payroll_payout_amount_positive",
        ),
        sa.ForeignKeyConstraint(["club_id"], ["club.club_id"]),
        sa.ForeignKeyConstraint(["expense_id"], ["expense.expense_id"]),
        sa.ForeignKeyConstraint(["paid_by_user_id"], ["app_user.user_id"]),
        sa.ForeignKeyConstraint(["staff_id"], ["staff.staff_id"]),
        sa.PrimaryKeyConstraint("payout_id"),
    )


def downgrade() -> None:
    op.drop_table("payroll_payout")
    op.drop_table("staff_work_log")
    op.drop_column("staff", "hourly_rate")
