"""Тести Етапу 1 «Довідники»: Клуби, Робочі місця, Тарифи, Співробітники, Клієнти, Користувачі."""
from decimal import Decimal

import pytest

from app import models
from app.database import get_db
from app.security import create_access_token, hash_password


@pytest.fixture()
def db(auth_client):
    gen = auth_client.app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


def test_club_aggregates_and_409_details(auth_client):
    club = auth_client.post(
        "/clubs", json={"name": "Cyberion Південь", "address": "вул. Миру, 5", "phone": "+380501111111"}
    ).json()
    club_id = club["club_id"]
    assert club["workstations_count"] == 0
    assert club["staff_count"] == 0

    auth_client.post("/workstations", json={"club_id": club_id, "number": 1, "type": "Standard"})
    auth_client.post(
        "/staff",
        json={"club_id": club_id, "full_name": "Петро Іваненко", "position": "Системний адміністратор"},
    )

    enriched = auth_client.get(f"/clubs/{club_id}").json()
    assert enriched["pc_count"] == 1
    assert enriched["workstations_count"] == 1
    assert enriched["staff_count"] == 1

    # Видалення клубу з пов'язаними записами повертає 409 з переліком кількостей
    res = auth_client.delete(f"/clubs/{club_id}")
    assert res.status_code == 409
    assert "1 місце" in res.json()["detail"]
    assert "1 співробітник" in res.json()["detail"]


def test_workstations_crud_bulk_status_and_delete_protection(auth_client, db):
    club_id = auth_client.post(
        "/clubs", json={"name": "Клуб ПК", "address": "вул. 1", "phone": "+380502222222"}
    ).json()["club_id"]

    # Одиночне створення
    r1 = auth_client.post("/workstations", json={"club_id": club_id, "number": 1, "type": "Standard"})
    assert r1.status_code == 201
    ws1_id = r1.json()["workstation_id"]
    assert r1.json()["status"] == "вільне"

    # Дубль номера в тому ж клубі -> 409
    dup = auth_client.post("/workstations", json={"club_id": club_id, "number": 1, "type": "VIP"})
    assert dup.status_code == 409

    # Масове додавання діапазоном 2..5
    bulk = auth_client.post(
        "/workstations/bulk",
        json={"club_id": club_id, "number_from": 2, "number_to": 5, "type": "VIP"},
    )
    assert bulk.status_code == 201
    assert len(bulk.json()) == 4
    assert auth_client.get(f"/clubs/{club_id}").json()["pc_count"] == 5

    # Повторне масове додавання з перетином номерів -> 409
    overlap = auth_client.post(
        "/workstations/bulk",
        json={"club_id": club_id, "number_from": 4, "number_to": 7, "type": "Standard"},
    )
    assert overlap.status_code == 409
    assert "4, 5" in overlap.json()["detail"]

    # Переведення на ремонт і назад
    rep = auth_client.patch(f"/workstations/{ws1_id}/status", json={"status": "на ремонті"})
    assert rep.status_code == 200
    assert rep.json()["status"] == "на ремонті"

    back = auth_client.patch(f"/workstations/{ws1_id}/status", json={"status": "вільне"})
    assert back.status_code == 200
    assert back.json()["status"] == "вільне"

    # Вручну поставити «зайняте» не можна -> 422
    bad_status = auth_client.patch(f"/workstations/{ws1_id}/status", json={"status": "зайняте"})
    assert bad_status.status_code == 422

    # Якщо місце зайняте активним сеансом — перевести на ремонт або видалити не можна (409)
    tariff = models.Tariff(name="Стандарт", price_per_hour=Decimal("60"), workstation_type="Standard")
    cl = models.Client(full_name="Тест Клієнт", phone="+380679999991")
    db.add_all([tariff, cl])
    db.flush()
    ws_obj = db.get(models.Workstation, ws1_id)
    ws_obj.status = "зайняте"
    db.add(
        models.GameSession(
            client_id=cl.client_id,
            workstation_id=ws1_id,
            tariff_id=tariff.tariff_id,
            price_per_hour=tariff.price_per_hour,
            status="активний",
        )
    )
    db.commit()

    busy_patch = auth_client.patch(f"/workstations/{ws1_id}/status", json={"status": "на ремонті"})
    assert busy_patch.status_code == 409
    assert "Спочатку завершіть сеанс" in busy_patch.json()["detail"]

    del_with_history = auth_client.delete(f"/workstations/{ws1_id}")
    assert del_with_history.status_code == 409
    assert "історія сеансів" in del_with_history.json()["detail"]


def test_tariffs_crud_and_delete_protection(auth_client, db):
    created = auth_client.post(
        "/tariffs",
        json={"name": "VIP Вечір", "workstation_type": "VIP", "price_per_hour": "100.00"},
    )
    assert created.status_code == 201
    tid = created.json()["tariff_id"]

    # Невідомий тип місця -> 422
    bad = auth_client.post(
        "/tariffs",
        json={"name": "Xbox", "workstation_type": "Xbox", "price_per_hour": "80.00"},
    )
    assert bad.status_code == 422

    # Оновлення ціни
    patched = auth_client.patch(f"/tariffs/{tid}", json={"price_per_hour": "110.00"})
    assert patched.status_code == 200
    assert Decimal(str(patched.json()["price_per_hour"])) == Decimal("110.00")

    # Використання в сеансі блокує видалення тарифу
    club = models.Club(name="Клуб Т", address="вул. Т", phone="+380503333333")
    db.add(club)
    db.flush()
    ws = models.Workstation(club_id=club.club_id, number=1, type="VIP")
    cl = models.Client(full_name="Клієнт Т", phone="+380679999992")
    db.add_all([ws, cl])
    db.flush()
    db.add(
        models.GameSession(
            client_id=cl.client_id,
            workstation_id=ws.workstation_id,
            tariff_id=tid,
            price_per_hour=Decimal("110.00"),
            status="завершений",
        )
    )
    db.commit()

    assert auth_client.get(f"/tariffs/{tid}").json()["sessions_count"] == 1
    del_used = auth_client.delete(f"/tariffs/{tid}")
    assert del_used.status_code == 409
    assert "використовується в сеансах" in del_used.json()["detail"]


def test_staff_and_org_chart(auth_client):
    club_id = auth_client.post(
        "/clubs", json={"name": "Клуб Персоналу", "address": "вул. П", "phone": "+380504444444"}
    ).json()["club_id"]

    s1 = auth_client.post(
        "/staff",
        json={"club_id": club_id, "full_name": "Олег Директор", "position": "Директор клубу"},
    )
    assert s1.status_code == 201

    chart = auth_client.get(f"/staff/org-chart?club_id={club_id}").json()
    assert len(chart) == 8
    by_key = {node["key"]: node for node in chart}
    assert by_key["director"]["is_vacant"] is False
    assert by_key["director"]["members"][0]["full_name"] == "Олег Директор"
    assert by_key["accountant"]["is_vacant"] is True


def test_client_filters_history_and_bonus_adjustment(auth_client, db):
    c1 = auth_client.post(
        "/clients",
        json={"full_name": "Богдан Бонусний", "phone": "+380678888881", "bonus_balance": "50.00"},
    ).json()
    c2 = auth_client.post(
        "/clients",
        json={"full_name": "Марина Безбонусна", "phone": "+380678888882"},
    ).json()

    # Пошук q
    found = auth_client.get("/clients?q=Богдан").json()
    assert len(found) == 1 and found[0]["client_id"] == c1["client_id"]

    # Фільтр with_bonus
    with_bonus = auth_client.get("/clients?filter=with_bonus").json()
    assert {c["client_id"] for c in with_bonus} == {c1["client_id"]}

    # Коригування бонусів Директором
    adj = auth_client.post(f"/clients/{c1['client_id']}/bonus-adjustment", json={"delta": "-20.00"})
    assert adj.status_code == 200
    assert Decimal(str(adj.json()["bonus_balance"])) == Decimal("30.00")

    # Від'ємний баланс заборонено -> 422
    neg = auth_client.post(f"/clients/{c1['client_id']}/bonus-adjustment", json={"delta": "-100.00"})
    assert neg.status_code == 422

    # Адмін залу не може коригувати бонуси вручну -> 403
    club = models.Club(name="Клуб А", address="вул. А", phone="+380505555555")
    db.add(club)
    db.flush()
    hall_user = models.AppUser(
        username="hall_bonus_test",
        password_hash=hash_password("demo1234"),
        full_name="Адмін",
        role="hall_admin",
        club_id=club.club_id,
    )
    db.add(hall_user)
    db.commit()
    hall_headers = {"Authorization": f"Bearer {create_access_token(hall_user.user_id)}"}
    forbidden = auth_client.post(
        f"/clients/{c2['client_id']}/bonus-adjustment",
        json={"delta": "10.00"},
        headers=hall_headers,
    )
    assert forbidden.status_code == 403


def test_users_management_and_safety_rules(auth_client):
    club_id = auth_client.post(
        "/clubs", json={"name": "Клуб Юзерів", "address": "вул. Ю", "phone": "+380506666666"}
    ).json()["club_id"]

    # Для ролі не-директора без club_id -> 422
    no_club = auth_client.post(
        "/users",
        json={
            "username": "admin_no_club",
            "full_name": "Без Клубу",
            "role": "hall_admin",
            "password": "Password123",
        },
    )
    assert no_club.status_code == 422

    # Валідне створення
    created = auth_client.post(
        "/users",
        json={
            "username": "operator_1",
            "full_name": "Оператор Один",
            "role": "hall_admin",
            "club_id": club_id,
            "password": "Password123",
        },
    )
    assert created.status_code == 201
    uid = created.json()["user_id"]

    # Скидання пароля повертає тимчасовий пароль і ставить must_change_password=True
    reset = auth_client.post(f"/users/{uid}/reset-password")
    assert reset.status_code == 200
    temp_pw = reset.json()["temporary_password"]
    assert len(temp_pw) >= 8

    users_list = auth_client.get("/users").json()
    target = next(u for u in users_list if u["user_id"] == uid)
    assert target["must_change_password"] is True

    # Поточний директор не може вимкнути самого себе -> 409
    me = auth_client.get("/auth/me").json()
    self_disable = auth_client.patch(f"/users/{me['user_id']}", json={"is_active": False})
    assert self_disable.status_code == 409

