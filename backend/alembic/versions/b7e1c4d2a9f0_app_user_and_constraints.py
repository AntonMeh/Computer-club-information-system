"""app_user, session.price_per_hour та обмеження цілісності

Зміни БД із розділів 3 і 8 специфікації:
- нова таблиця app_user (ролі, прив'язка до клубу, must_change_password);
- session.price_per_hour - ціна, зафіксована на початку сеансу;
- частковий унікальний індекс: не більше одного активного сеансу на місце;
- CHECK tariff.price_per_hour > 0, CHECK client.bonus_balance >= 0;
- UNIQUE workstation (club_id, number).

Revision ID: b7e1c4d2a9f0
Revises: a62b3afc5b21
Create Date: 2026-11-12 01:15:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e1c4d2a9f0"
down_revision: Union[str, None] = "a62b3afc5b21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLES = ("director", "hall_admin", "accountant", "tournament_manager", "marketing_manager", "sysadmin")
ACTIVE = sa.text("status = 'активний'")


def upgrade() -> None:
    op.create_table(
        "app_user",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=100), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column("club_id", sa.Integer(), nullable=True),
        sa.Column("staff_id", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "role IN (" + ", ".join(f"'{r}'" for r in ROLES) + ")", name="ck_app_user_role"
        ),
        sa.ForeignKeyConstraint(["club_id"], ["club.club_id"]),
        sa.ForeignKeyConstraint(["staff_id"], ["staff.staff_id"]),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("username"),
    )

    # Ціна сеансу: додаємо nullable, заповнюємо з тарифу для наявних рядків, потім NOT NULL
    op.add_column("session", sa.Column("price_per_hour", sa.Numeric(precision=8, scale=2), nullable=True))
    op.execute(
        "UPDATE session SET price_per_hour = "
        "(SELECT tariff.price_per_hour FROM tariff WHERE tariff.tariff_id = session.tariff_id)"
    )
    with op.batch_alter_table("session") as batch:
        batch.alter_column("price_per_hour", existing_type=sa.Numeric(precision=8, scale=2), nullable=False)

    op.create_index(
        "uq_session_active_workstation",
        "session",
        ["workstation_id"],
        unique=True,
        postgresql_where=ACTIVE,
        sqlite_where=ACTIVE,
    )

    with op.batch_alter_table("tariff") as batch:
        batch.create_check_constraint("ck_tariff_price_positive", "price_per_hour > 0")
    with op.batch_alter_table("client") as batch:
        batch.create_check_constraint("ck_client_bonus_nonnegative", "bonus_balance >= 0")
    with op.batch_alter_table("workstation") as batch:
        batch.create_unique_constraint("uq_workstation_club_number", ["club_id", "number"])


def downgrade() -> None:
    with op.batch_alter_table("workstation") as batch:
        batch.drop_constraint("uq_workstation_club_number", type_="unique")
    with op.batch_alter_table("client") as batch:
        batch.drop_constraint("ck_client_bonus_nonnegative", type_="check")
    with op.batch_alter_table("tariff") as batch:
        batch.drop_constraint("ck_tariff_price_positive", type_="check")
    op.drop_index("uq_session_active_workstation", table_name="session")
    with op.batch_alter_table("session") as batch:
        batch.drop_column("price_per_hour")
    op.drop_table("app_user")

