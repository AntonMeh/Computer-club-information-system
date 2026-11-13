"""Тести Етапу 3: Витрати (/expenses) та Турніри з учасниками і призерами (/tournaments)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app import models
from app.database import get_db
from app.security import create_access_token, hash_password


@pytest.fixture()
def db(client):
    gen = client.app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


@pytest.fixture()
def stage3_env(db):
    club = models.Club(name="Cyberion Центр", address="вул. Соборна, 12", phone="+380500000001")
    db.add(club)
    db.flush()

    director = models.AppUser(
        username="director",
        password_hash=hash_password("demo1234"),
        full_name="Директор",
        role="director",
        club_id=None,
    )
    accountant = models.AppUser(
        username="accountant",
        password_hash=hash_password("demo1234"),
        full_name="Бухгалтер",
        role="accountant",
        club_id=club.club_id,
    )
    tournaments_mgr = models.AppUser(
        username="tournaments",
        password_hash=hash_password("demo1234"),
        full_name="Менеджер Турнірів",
        role="tournament_manager",
        club_id=club.club_id,
    )
    c1 = models.Client(full_name="Гравець Перший", phone="+380670001111")
    c2 = models.Client(full_name="Гравець Другий", phone="+380670002222")
    db.add_all([director, accountant, tournaments_mgr, c1, c2])
    db.commit()

    return {
        "club": club,
        "c1": c1,
        "c2": c2,
        "h_dir": {"Authorization": f"Bearer {create_access_token(director.user_id)}"},
        "h_acc": {"Authorization": f"Bearer {create_access_token(accountant.user_id)}"},
        "h_trn": {"Authorization": f"Bearer {create_access_token(tournaments_mgr.user_id)}"},
    }


def test_expenses_crud_summary_and_future_date_validation(client, stage3_env):
    h_acc = stage3_env["h_acc"]
    club = stage3_env["club"]

    # Спроба створити витрату з датою в майбутньому -> 422
    future = (date.today() + timedelta(days=2)).isoformat()
    r_fut = client.post(
        "/expenses",
        headers=h_acc,
        json={
            "club_id": club.club_id,
            "category": "оренда",
            "amount": 15000,
            "expense_date": future,
        },
    )
    assert r_fut.status_code == 422

    # Створення двох витрат у різних категоріях
    r1 = client.post(
        "/expenses",
        headers=h_acc,
        json={
            "club_id": club.club_id,
            "category": "оренда",
            "amount": 30000,
            "description": "Оренда приміщення за місяць",
        },
    )
    assert r1.status_code == 201
    exp1_id = r1.json()["expense_id"]

    r2 = client.post(
        "/expenses",
        headers=h_acc,
        json={
            "club_id": club.club_id,
            "category": "комунальні",
            "amount": 10000,
            "description": "Електроенергія",
        },
    )
    assert r2.status_code == 201

    # Перевірка списку та підсумків
    res = client.get("/expenses", headers=h_acc).json()
    assert res["total"] == 2
    assert Decimal(res["summary"]["total"]) == Decimal("40000.00")
    assert res["summary"]["top_category"] == "оренда"
    assert Decimal(res["summary"]["top_category_amount"]) == Decimal("30000.00")

    # CSV-експорт
    csv_res = client.get("/expenses/export.csv", headers=h_acc)
    assert csv_res.status_code == 200
    assert "Оренда приміщення" in csv_res.text

    # Редагування та видалення
    r_upd = client.patch(
        f"/expenses/{exp1_id}",
        headers=h_acc,
        json={"amount": 32000, "description": "Оренда оновлена"},
    )
    assert r_upd.status_code == 200
    assert Decimal(r_upd.json()["amount"]) == Decimal("32000.00")

    assert client.delete(f"/expenses/{exp1_id}", headers=h_acc).status_code == 204
    assert client.get("/expenses", headers=h_acc).json()["total"] == 1


def test_tournaments_participants_places_and_delete_protection(client, stage3_env):
    h_trn = stage3_env["h_trn"]
    club = stage3_env["club"]
    c1 = stage3_env["c1"]
    c2 = stage3_env["c2"]

    # Створення турніру
    r_create = client.post(
        "/tournaments",
        headers=h_trn,
        json={
            "club_id": club.club_id,
            "name": "Cyberion CS2 Cup",
            "game": "Counter-Strike 2",
            "date": date.today().isoformat(),
            "prize_fund": 10000,
        },
    )
    assert r_create.status_code == 201
    t_id = r_create.json()["tournament_id"]
    assert r_create.json()["status"] == "сьогодні"

    # Реєстрація двох учасників
    p1 = client.post(
        f"/tournaments/{t_id}/participants",
        headers=h_trn,
        json={"client_id": c1.client_id},
    )
    assert p1.status_code == 201
    p1_id = p1.json()["participation_id"]

    # Повторне додавання того самого клієнта -> 409
    p_dup = client.post(
        f"/tournaments/{t_id}/participants",
        headers=h_trn,
        json={"client_id": c1.client_id},
    )
    assert p_dup.status_code == 409

    p2 = client.post(
        f"/tournaments/{t_id}/participants",
        headers=h_trn,
        json={"client_id": c2.client_id},
    )
    assert p2.status_code == 201
    p2_id = p2.json()["participation_id"]

    # Видалення турніру з учасниками заблоковано -> 409
    assert client.delete(f"/tournaments/{t_id}", headers=h_trn).status_code == 409

    # Присвоєння 1 місця першому учаснику
    u1 = client.patch(
        f"/tournaments/{t_id}/participants/{p1_id}",
        headers=h_trn,
        json={"place": 1},
    )
    assert u1.status_code == 200
    assert u1.json()["place"] == 1

    # Спроба присвоїти те саме 1 місце другому учаснику -> 409
    u2_conflict = client.patch(
        f"/tournaments/{t_id}/participants/{p2_id}",
        headers=h_trn,
        json={"place": 1},
    )
    assert u2_conflict.status_code == 409

    # Присвоєння 2 місця другому учаснику
    u2 = client.patch(
        f"/tournaments/{t_id}/participants/{p2_id}",
        headers=h_trn,
        json={"place": 2},
    )
    assert u2.status_code == 200

    # Видалення учасників дозволяє видалити турнір
    assert client.delete(f"/tournaments/{t_id}/participants/{p1_id}", headers=h_trn).status_code == 204
    assert client.delete(f"/tournaments/{t_id}/participants/{p2_id}", headers=h_trn).status_code == 204
    assert client.delete(f"/tournaments/{t_id}", headers=h_trn).status_code == 204

