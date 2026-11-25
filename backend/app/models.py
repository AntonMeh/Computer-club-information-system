"""ORM-моделі. Відповідають ER-діаграмі з docs/ (10 таблиць)."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# Псевдонім потрібен, бо поле Tournament.date затіняє ім'я `date` усередині класу
date_type = date


class Club(Base):
    __tablename__ = "club"

    club_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(20))
    pc_count: Mapped[int] = mapped_column(default=0)

    workstations: Mapped[list["Workstation"]] = relationship(back_populates="club")
    staff: Mapped[list["Staff"]] = relationship(back_populates="club")
    tournaments: Mapped[list["Tournament"]] = relationship(back_populates="club")
    expenses: Mapped[list["Expense"]] = relationship(back_populates="club")


class Workstation(Base):
    __tablename__ = "workstation"
    __table_args__ = (UniqueConstraint("club_id", "number", name="uq_workstation_club_number"),)

    workstation_id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    number: Mapped[int]
    type: Mapped[str] = mapped_column(String(20))  # Standard / VIP / PlayStation
    status: Mapped[str] = mapped_column(String(20), default="вільне")  # вільне / зайняте / на ремонті

    club: Mapped["Club"] = relationship(back_populates="workstations")
    sessions: Mapped[list["GameSession"]] = relationship(back_populates="workstation")


class Client(Base):
    __tablename__ = "client"
    __table_args__ = (CheckConstraint("bonus_balance >= 0", name="ck_client_bonus_nonnegative"),)

    client_id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20), unique=True)
    email: Mapped[str | None] = mapped_column(String(100))
    reg_date: Mapped[date] = mapped_column(Date, default=date.today)
    bonus_balance: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))

    sessions: Mapped[list["GameSession"]] = relationship(back_populates="client")
    participations: Mapped[list["Participation"]] = relationship(back_populates="client")


class Tariff(Base):
    __tablename__ = "tariff"
    __table_args__ = (CheckConstraint("price_per_hour > 0", name="ck_tariff_price_positive"),)

    tariff_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    price_per_hour: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    workstation_type: Mapped[str] = mapped_column(String(20))

    sessions: Mapped[list["GameSession"]] = relationship(back_populates="tariff")


class GameSession(Base):
    """Ігровий сеанс. Таблиця `session` з ER-діаграми (клас названо інакше, щоб не плутати з Session SQLAlchemy)."""

    __tablename__ = "session"
    __table_args__ = (
        # Не більше одного активного сеансу на робоче місце (бізнес-правило 2)
        Index(
            "uq_session_active_workstation",
            "workstation_id",
            unique=True,
            postgresql_where=text("status = 'активний'"),
            sqlite_where=text("status = 'активний'"),
        ),
    )

    session_id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("client.client_id"))
    workstation_id: Mapped[int] = mapped_column(ForeignKey("workstation.workstation_id"))
    tariff_id: Mapped[int] = mapped_column(ForeignKey("tariff.tariff_id"))
    # Ціна тарифу, зафіксована на момент початку сеансу (бізнес-правило 5)
    price_per_hour: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    start_time: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    end_time: Mapped[datetime | None] = mapped_column(DateTime)
    planned_minutes: Mapped[int | None] = mapped_column(default=None)
    planned_end_time: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    is_prepaid: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="активний")  # активний / завершений / скасований

    client: Mapped["Client"] = relationship(back_populates="sessions")
    workstation: Mapped["Workstation"] = relationship(back_populates="sessions")
    tariff: Mapped["Tariff"] = relationship(back_populates="sessions")
    payment: Mapped["Payment | None"] = relationship(back_populates="session", uselist=False)


class Payment(Base):
    __tablename__ = "payment"

    payment_id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("session.session_id"), unique=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shift.shift_id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    payment_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    method: Mapped[str] = mapped_column(String(20))  # готівка / картка / бонуси

    session: Mapped["GameSession"] = relationship(back_populates="payment")
    shift: Mapped["Shift | None"] = relationship(back_populates="payments")


class Staff(Base):
    __tablename__ = "staff"

    staff_id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    full_name: Mapped[str] = mapped_column(String(100))
    position: Mapped[str] = mapped_column(String(50))
    hire_date: Mapped[date] = mapped_column(Date, default=date.today)
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("160.00"))

    club: Mapped["Club"] = relationship(back_populates="staff")
    work_logs: Mapped[list["StaffWorkLog"]] = relationship(
        back_populates="staff", cascade="all, delete-orphan"
    )
    payouts: Mapped[list["PayrollPayout"]] = relationship(
        back_populates="staff", cascade="all, delete-orphan"
    )


class Tournament(Base):
    __tablename__ = "tournament"

    tournament_id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    name: Mapped[str] = mapped_column(String(100))
    game: Mapped[str] = mapped_column(String(50))
    date: Mapped[date_type] = mapped_column(Date)
    prize_fund: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))

    club: Mapped["Club"] = relationship(back_populates="tournaments")
    participations: Mapped[list["Participation"]] = relationship(back_populates="tournament")


class Participation(Base):
    __tablename__ = "participation"

    participation_id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournament.tournament_id"))
    client_id: Mapped[int] = mapped_column(ForeignKey("client.client_id"))
    place: Mapped[int | None]

    tournament: Mapped["Tournament"] = relationship(back_populates="participations")
    client: Mapped["Client"] = relationship(back_populates="participations")


class Expense(Base):
    __tablename__ = "expense"

    expense_id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    category: Mapped[str] = mapped_column(String(50))  # оренда / зарплата / закупівлі / комунальні / інше
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    expense_date: Mapped[date] = mapped_column(Date, default=date.today)
    description: Mapped[str | None] = mapped_column(String(200))

    club: Mapped["Club"] = relationship(back_populates="expenses")


# Ролі користувачів (розділ 4 специфікації)
ROLES = (
    "director",
    "hall_admin",
    "accountant",
    "tournament_manager",
    "marketing_manager",
    "sysadmin",
)


class AppUser(Base):
    """Обліковий запис співробітника для входу в систему."""

    __tablename__ = "app_user"
    __table_args__ = (
        CheckConstraint(
            "role IN (" + ", ".join(f"'{r}'" for r in ROLES) + ")",
            name="ck_app_user_role",
        ),
    )

    user_id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(30))
    club_id: Mapped[int | None] = mapped_column(ForeignKey("club.club_id"))  # NULL = уся мережа
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.staff_id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)

    club: Mapped["Club | None"] = relationship()
    staff: Mapped["Staff | None"] = relationship()


class Shift(Base):
    """Робоча зміна клубу та знімок показників Z-звіту (розділ 3 та 7.16 специфікації)."""

    __tablename__ = "shift"
    __table_args__ = (
        # Не більше однієї відкритої зміни на клуб (правило 8.1 п. 1)
        Index(
            "uq_shift_open_club",
            "club_id",
            unique=True,
            postgresql_where=text("status = 'відкрита'"),
            sqlite_where=text("status = 'відкрита'"),
        ),
        UniqueConstraint("club_id", "z_number", name="uq_shift_club_z_number"),
        CheckConstraint("opening_cash >= 0", name="ck_shift_opening_cash_nonnegative"),
    )

    shift_id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    z_number: Mapped[int | None] = mapped_column(default=None)
    business_date: Mapped[date] = mapped_column(Date, default=date.today)
    status: Mapped[str] = mapped_column(String(20), default="відкрита")  # відкрита / закрита

    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    opened_by_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"))
    opening_cash: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    opening_difference: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    open_note: Mapped[str | None] = mapped_column(String(300))

    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    closed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"))
    force_closed: Mapped[bool] = mapped_column(Boolean, default=False)

    cash_sales: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    card_sales: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    bonus_sales: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))

    sessions_completed: Mapped[int] = mapped_column(default=0)
    sessions_cancelled: Mapped[int] = mapped_column(default=0)
    sessions_carried_over: Mapped[int] = mapped_column(default=0)

    cash_in: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    cash_out: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    collection: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))

    expected_cash: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    actual_cash: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    cash_difference: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    cash_left: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))

    card_terminal_total: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    card_difference: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    close_note: Mapped[str | None] = mapped_column(String(300))

    review_status: Mapped[str] = mapped_column(String(20), default="очікує")  # очікує / підтверджена
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_note: Mapped[str | None] = mapped_column(String(300))

    club: Mapped["Club"] = relationship()
    opened_by: Mapped["AppUser"] = relationship(foreign_keys=[opened_by_user_id])
    closed_by: Mapped["AppUser | None"] = relationship(foreign_keys=[closed_by_user_id])
    reviewed_by: Mapped["AppUser | None"] = relationship(foreign_keys=[reviewed_by_user_id])
    payments: Mapped[list["Payment"]] = relationship(back_populates="shift")
    operations: Mapped[list["CashOperation"]] = relationship(back_populates="shift")


class CashOperation(Base):
    """Службова операція з готівкою: внесення, вилучення, інкасація (розділ 3 та 7.16)."""

    __tablename__ = "cash_operation"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_cash_operation_amount_positive"),
    )

    operation_id: Mapped[int] = mapped_column(primary_key=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shift.shift_id"))
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    type: Mapped[str] = mapped_column(String(20))  # внесення / вилучення / інкасація
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    category: Mapped[str | None] = mapped_column(String(30))  # господарські витрати / закупівля / виплата / інше
    comment: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"))

    shift: Mapped["Shift"] = relationship(back_populates="operations")
    club: Mapped["Club"] = relationship()
    created_by: Mapped["AppUser"] = relationship()



class StaffWorkLog(Base):
    """Табель обліку відпрацьованих годин співробітників (для нарахування зарплати)."""

    __tablename__ = "staff_work_log"
    __table_args__ = (
        CheckConstraint(
            "hours_worked > 0 AND hours_worked <= 24",
            name="ck_staff_work_log_hours_range",
        ),
        CheckConstraint("bonus_amount >= 0", name="ck_staff_work_log_bonus_nonnegative"),
    )

    log_id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.staff_id"))
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shift.shift_id"), unique=True)
    work_date: Mapped[date_type] = mapped_column(Date, default=date.today)
    hours_worked: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    hourly_rate_snapshot: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    bonus_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    comment: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"))

    staff: Mapped["Staff"] = relationship(back_populates="work_logs")
    club: Mapped["Club"] = relationship()
    shift: Mapped["Shift | None"] = relationship()
    created_by: Mapped["AppUser | None"] = relationship()


class PayrollPayout(Base):
    """Виплата заробітної плати співробітнику за період (інтегрована зі статтею витрат 'зарплата')."""

    __tablename__ = "payroll_payout"
    __table_args__ = (
        CheckConstraint("amount_paid > 0", name="ck_payroll_payout_amount_positive"),
    )

    payout_id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.staff_id"))
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    expense_id: Mapped[int | None] = mapped_column(ForeignKey("expense.expense_id"))
    period_from: Mapped[date_type] = mapped_column(Date)
    period_to: Mapped[date_type] = mapped_column(Date)
    hours_paid: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0.00"))
    base_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    bonus_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    payment_method: Mapped[str] = mapped_column(String(30), default="картка")  # картка / готівка / переказ
    paid_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    paid_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"))
    note: Mapped[str | None] = mapped_column(String(200))

    staff: Mapped["Staff"] = relationship(back_populates="payouts")
    club: Mapped["Club"] = relationship()
    expense: Mapped["Expense | None"] = relationship()
    paid_by: Mapped["AppUser | None"] = relationship()
