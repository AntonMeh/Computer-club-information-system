import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base
from app.seed import seed, wipe


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session


def test_seed_creates_all_tables(db):
    counts = seed(db)
    db.commit()
    for table in ("club", "workstation", "client", "tariff", "session", "payment", "staff", "tournament", "participation", "expense", "app_user"):
        assert counts[table] > 0, f"таблиця {table} порожня"


def test_seed_data_is_consistent(db):
    seed(db)
    db.commit()

    sessions = db.scalars(select(models.GameSession)).all()
    for s in sessions:
        # тариф підходить до типу робочого місця
        assert s.tariff.workstation_type == s.workstation.type
        if s.status == "завершений":
            assert s.payment is not None and s.payment.amount > 0
            assert s.end_time > s.start_time
        else:
            assert s.payment is None and s.end_time is None

    # «зайняті» місця відповідають активним сеансам
    busy = {w.workstation_id for w in db.scalars(select(models.Workstation)) if w.status == "зайняте"}
    active = {s.workstation_id for s in sessions if s.status == "активний"}
    assert busy == active

    # кількість ПК у клубі збігається з кількістю робочих місць
    for club in db.scalars(select(models.Club)):
        assert club.pc_count == len(club.workstations)


def test_wipe_then_seed_again(db):
    first = seed(db)
    db.commit()
    wipe(db)
    db.commit()
    assert db.scalars(select(models.Club)).first() is None
    assert seed(db) == first
