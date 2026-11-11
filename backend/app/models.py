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
    status: Mapped[str] = mapped_column(String(20), default="активний")  # активний / завершений / скасований

    client: Mapped["Client"] = relationship(back_populates="sessions")
    workstation: Mapped["Workstation"] = relationship(back_populates="sessions")
    tariff: Mapped["Tariff"] = relationship(back_populates="sessions")
    payment: Mapped["Payment | None"] = relationship(back_populates="session", uselist=False)


class Payment(Base):
    __tablename__ = "payment"

    payment_id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("session.session_id"), unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    payment_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    method: Mapped[str] = mapped_column(String(20))  # готівка / картка / бонуси

    session: Mapped["GameSession"] = relationship(back_populates="payment")


class Staff(Base):
    __tablename__ = "staff"

    staff_id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("club.club_id"))
    full_name: Mapped[str] = mapped_column(String(100))
    position: Mapped[str] = mapped_column(String(50))
    hire_date: Mapped[date] = mapped_column(Date, default=date.today)

    club: Mapped["Club"] = relationship(back_populates="staff")


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
