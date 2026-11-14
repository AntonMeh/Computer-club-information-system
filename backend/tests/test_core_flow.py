"""Тести Етапу 2 (Ядро залу та каси): бізнес-правила 1–10 з розділу 8 специфікації."""
from datetime import datetime, timedelta
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
def core_env(db):
    club = models.Club(name="Cyberion Центр", address="вул. Соборна, 12", phone="+380500000001")
    db.add(club)
    db.flush()

    director = models.AppUser(
        username="director",
        password_hash=hash_password("demo1234"),
        full_name="Директор Мережі",
        role="director",
        club_id=None,
    )
    hall_admin = models.AppUser(
        username="hall_admin",
        password_hash=hash_password("demo1234"),
        full_name="Оператор Залу",
        role="hall_admin",
        club_id=club.club_id,
    )
    ws_std = models.Workstation(club_id=club.club_id, number=1, type="Standard", status="вільне")
    ws_vip = models.Workstation(club_id=club.club_id, number=2, type="VIP", status="вільне")
    ws_repair = models.Workstation(club_id=club.club_id, number=3, type="Standard", status="на ремонті")
    tariff_std = models.Tariff(name="Стандарт", workstation_type="Standard", price_per_hour=Decimal("60.00"))
    tariff_vip = models.Tariff(name="VIP", workstation_type="VIP", price_per_hour=Decimal("120.00"))
    customer = models.Client(
        full_name="Марія Шевченко",
        phone="+380671112233",
        bonus_balance=Decimal("0.00"),
    )
    db.add_all([director, hall_admin, ws_std, ws_vip, ws_repair, tariff_std, tariff_vip, customer])
    db.flush()

    open_shift = models.Shift(
        club_id=club.club_id,
        status="відкрита",
        opened_by_user_id=hall_admin.user_id,
        opening_cash=Decimal("1000.00"),
    )
    db.add(open_shift)
    db.commit()

    return {
        "club": club,
        "director": director,
        "hall_admin": hall_admin,
        "ws_std": ws_std,
        "ws_vip": ws_vip,
        "ws_repair": ws_repair,
        "tariff_std": tariff_std,
        "tariff_vip": tariff_vip,
        "customer": customer,
        "h_admin": {"Authorization": f"Bearer {create_access_token(hall_admin.user_id)}"},
        "h_dir": {"Authorization": f"Bearer {create_access_token(director.user_id)}"},
    }


def test_rules_2_3_4_start_session_validations_and_inline_client(client, core_env):
    h = core_env["h_admin"]
    ws_std = core_env["ws_std"]
    ws_repair = core_env["ws_repair"]
    tariff_std = core_env["tariff_std"]
    tariff_vip = core_env["tariff_vip"]

    # Правило 4: місце на ремонті не можна використати для нового сеансу -> 409
    r = client.post(
        "/sessions",
        headers=h,
        json={
            "workstation_id": ws_repair.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "client_id": core_env["customer"].client_id,
        },
    )
    assert r.status_code == 409
    assert "ремонт" in r.json()["detail"].lower()

    # Правило 3: тариф не відповідає типу місця -> 422
    r = client.post(
        "/sessions",
        headers=h,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_vip.tariff_id,
            "client_id": core_env["customer"].client_id,
        },
    )
    assert r.status_code == 422

    # Початок сеансу зі створенням нового клієнта на льоту (п. 7.3)
    r = client.post(
        "/sessions",
        headers=h,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "new_client_name": "Новий Гравець",
            "new_client_phone": "+380991234567",
        },
    )
    assert r.status_code == 201, r.text
    started = r.json()
    assert started["status"] == "активний"
    assert started["client_name"] == "Новий Гравець"

    # Правило 2: другий активний сеанс на те саме місце -> 409
    r2 = client.post(
        "/sessions",
        headers=h,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "client_id": core_env["customer"].client_id,
        },
    )
    assert r2.status_code == 409
    assert "зайняли" in r2.json()["detail"].lower()

    # Перевірка /hall: місце № 1 має статус «зайняте» і вкладений active_session
    hall = client.get("/hall", headers=h).json()
    assert hall["summary"]["busy"] == 1
    ws1_item = next(it for it in hall["items"] if it["workstation_id"] == ws_std.workstation_id)
    assert ws1_item["status"] == "зайняте"
    assert ws1_item["active_session"]["session_id"] == started["session_id"]


def test_rules_1_5_6_8_9_10_finish_session_price_freeze_and_bonuses(client, db, core_env):
    h = core_env["h_admin"]
    h_dir = core_env["h_dir"]
    ws_std = core_env["ws_std"]
    tariff_std = core_env["tariff_std"]
    customer = core_env["customer"]

    # Старт сеансу за тарифом 60 ₴/год
    r = client.post(
        "/sessions",
        headers=h,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "client_id": customer.client_id,
        },
    )
    assert r.status_code == 201
    session_id = r.json()["session_id"]

    # Правило 5: змінюємо ціну тарифу з 60 на 100 ₴/год ПІСЛЯ старту сеансу
    client.patch(
        f"/tariffs/{tariff_std.tariff_id}",
        headers=h_dir,
        json={"price_per_hour": 100.00},
    )

    # Зсуваємо start_time на 84 хв 10 с назад -> ceil = 85 хв -> 85 * 60 / 60 = 85.00 ₴ (не за 100 ₴!)
    s_obj = db.get(models.GameSession, session_id)
    s_obj.start_time = datetime.now() - timedelta(minutes=84, seconds=10)
    db.commit()

    # Спроба оплатити бонусами при балансі 0 -> 422 (Правило 9)
    r_no_bonus = client.post(
        f"/sessions/{session_id}/finish",
        headers=h,
        json={"method": "бонуси"},
    )
    assert r_no_bonus.status_code == 422

    # Оплата карткою -> 85.00 ₴, нараховано 5 % = 4.25 ₴ бонусів
    r_fin = client.post(
        f"/sessions/{session_id}/finish",
        headers=h,
        json={"method": "картка"},
    )
    assert r_fin.status_code == 200, r_fin.text
    fin_data = r_fin.json()
    assert fin_data["status"] == "завершений"
    assert Decimal(fin_data["payment_amount"]) == Decimal("85.00")
    assert Decimal(fin_data["bonus_earned"]) == Decimal("4.25")
    assert Decimal(fin_data["client_bonus_balance"]) == Decimal("4.25")

    # Правило 1: повторне завершення вже завершеного сеансу -> 409
    assert (
        client.post(f"/sessions/{session_id}/finish", headers=h, json={"method": "готівка"}).status_code
        == 409
    )

    # Тепер поповнимо бонуси клієнта і перевіримо оплату бонусами (Правило 9)
    client.post(
        f"/clients/{customer.client_id}/bonus-adjustment",
        headers=h_dir,
        json={"delta": 200.00, "reason": "Тест оплати бонусами"},
    )

    # Повертаємо ціну тарифу до 60 ₴/год і запускаємо сеанс на 30 хв (= 30.00 ₴)
    client.patch(
        f"/tariffs/{tariff_std.tariff_id}",
        headers=h_dir,
        json={"price_per_hour": 60.00},
    )
    r2 = client.post(
        "/sessions",
        headers=h,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "client_id": customer.client_id,
        },
    )
    s2_id = r2.json()["session_id"]
    s2_obj = db.get(models.GameSession, s2_id)
    s2_obj.start_time = datetime.now() - timedelta(minutes=29, seconds=30)
    db.commit()

    r2_fin = client.post(
        f"/sessions/{s2_id}/finish",
        headers=h,
        json={"method": "бонуси"},
    )
    assert r2_fin.status_code == 200
    s2_data = r2_fin.json()
    assert Decimal(s2_data["payment_amount"]) == Decimal("30.00")
    assert Decimal(s2_data["bonus_spent"]) == Decimal("30.00")
    assert Decimal(s2_data["bonus_earned"]) == Decimal("0.00")
    # 4.25 + 200.00 - 30.00 = 174.25
    assert Decimal(s2_data["client_bonus_balance"]) == Decimal("174.25")

    # Правило 10: оплати незмінні (немає PATCH/DELETE /payments/{id}) і є в реєстрі та CSV
    payments_res = client.get("/payments", headers=h).json()
    assert payments_res["total"] == 2
    assert Decimal(payments_res["summary"]["total"]) == Decimal("115.00")
    assert Decimal(payments_res["summary"]["card"]) == Decimal("85.00")
    assert Decimal(payments_res["summary"]["bonus"]) == Decimal("30.00")

    pay_id = s2_data["payment_id"]
    assert client.delete(f"/payments/{pay_id}", headers=h_dir).status_code == 405
    assert client.patch(f"/payments/{pay_id}", headers=h_dir, json={}).status_code == 405

    csv_resp = client.get("/payments/export.csv", headers=h)
    assert csv_resp.status_code == 200
    assert "Марія Шевченко" in csv_resp.text


def test_cancel_session_5_minute_rule(client, db, core_env):
    h_admin = core_env["h_admin"]
    h_dir = core_env["h_dir"]
    ws_std = core_env["ws_std"]
    tariff_std = core_env["tariff_std"]
    customer = core_env["customer"]

    # 1. Сеанс до 5 хвилин — Адмін залу може скасувати
    r1 = client.post(
        "/sessions",
        headers=h_admin,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "client_id": customer.client_id,
        },
    )
    s1_id = r1.json()["session_id"]
    c1 = client.post(f"/sessions/{s1_id}/cancel", headers=h_admin)
    assert c1.status_code == 200
    assert c1.json()["status"] == "скасований"
    assert c1.json()["payment_id"] is None

    # 2. Сеанс довший за 5 хвилин — Адмін залу отримує 403, а Директор успішно скасовує
    r2 = client.post(
        "/sessions",
        headers=h_admin,
        json={
            "workstation_id": ws_std.workstation_id,
            "tariff_id": tariff_std.tariff_id,
            "client_id": customer.client_id,
        },
    )
    s2_id = r2.json()["session_id"]
    s2_obj = db.get(models.GameSession, s2_id)
    s2_obj.start_time = datetime.now() - timedelta(minutes=10)
    db.commit()

    c2_admin = client.post(f"/sessions/{s2_id}/cancel", headers=h_admin)
    assert c2_admin.status_code == 403

    c2_dir = client.post(f"/sessions/{s2_id}/cancel", headers=h_dir)
    assert c2_dir.status_code == 200
    assert c2_dir.json()["status"] == "скасований"

