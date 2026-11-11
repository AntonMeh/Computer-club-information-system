"""Обмеження цілісності БД (розділ 3 специфікації, бізнес-правило 2)."""
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session


@pytest.fixture()
def base(db):
    """Клуб, місце, тариф і клієнт - мінімум для створення сеансу."""
    club = models.Club(name="Клуб", address="вул. 1", phone="+380500000000")
    db.add(club)
    db.flush()
    ws = models.Workstation(club_id=club.club_id, number=1, type="Standard")
    tariff = models.Tariff(name="Стандарт", price_per_hour=Decimal("60"), workstation_type="Standard")
    client = models.Client(full_name="Іван", phone="+380670000001")
    db.add_all([ws, tariff, client])
    db.commit()
    return club, ws, tariff, client


def _session(ws, tariff, client, status="активний"):
    return models.GameSession(
        client_id=client.client_id, workstation_id=ws.workstation_id, tariff_id=tariff.tariff_id,
        price_per_hour=tariff.price_per_hour, status=status,
    )


def test_only_one_active_session_per_workstation(db, base):
    _, ws, tariff, client = base
    db.add(_session(ws, tariff, client))
    db.commit()
    db.add(_session(ws, tariff, client))
    with pytest.raises(IntegrityError):
        db.commit()


def test_finished_sessions_do_not_block_workstation(db, base):
    _, ws, tariff, client = base
    db.add_all([_session(ws, tariff, client, "завершений"), _session(ws, tariff, client, "скасований")])
    db.add(_session(ws, tariff, client))
    db.commit()  # без помилки: індекс стосується лише активних


def test_tariff_price_must_be_positive(db):
    db.add(models.Tariff(name="Безкоштовний", price_per_hour=Decimal("0"), workstation_type="Standard"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_client_bonus_cannot_be_negative(db):
    db.add(models.Client(full_name="Мінус", phone="+380670000099", bonus_balance=Decimal("-1")))
    with pytest.raises(IntegrityError):
        db.commit()


def test_workstation_number_unique_within_club(db, base):
    club, *_ = base
    db.add(models.Workstation(club_id=club.club_id, number=1, type="VIP"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_same_workstation_number_allowed_in_other_club(db, base):
    other = models.Club(name="Інший", address="вул. 2", phone="+380500000001")
    db.add(other)
    db.flush()
    db.add(models.Workstation(club_id=other.club_id, number=1, type="Standard"))
    db.commit()


def test_app_user_role_is_checked(db):
    db.add(models.AppUser(username="x", password_hash="h", full_name="X", role="superuser"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_app_user_defaults(db):
    user = models.AppUser(username="director", password_hash="h", full_name="Директор", role="director")
    db.add(user)
    db.commit()
    assert user.is_active is True
    assert user.must_change_password is False
    assert user.club_id is None  # уся мережа
    assert user.created_at is not None

