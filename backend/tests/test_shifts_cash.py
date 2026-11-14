"""Тести модуля «Зміна й каса» (розділи 7.16, 7.17 та бізнес-правила 8.1 п. 1–14)."""
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
def shift_env(db):
    club1 = models.Club(name="Cyberion Центр", address="вул. Соборна, 12", phone="+380500000001")
    club2 = models.Club(name="Cyberion Північ", address="пр. Миру, 5", phone="+380500000002")
    db.add_all([club1, club2])
    db.flush()

    director = models.AppUser(
        username="director",
        password_hash=hash_password("demo1234"),
        full_name="Віктор Романенко",
        role="director",
        club_id=None,
    )
    hall_admin = models.AppUser(
        username="hall_admin",
        password_hash=hash_password("demo1234"),
        full_name="Богдан Савчук",
        role="hall_admin",
        club_id=club1.club_id,
    )
    accountant = models.AppUser(
        username="accountant",
        password_hash=hash_password("demo1234"),
        full_name="Ірина Остапенко",
        role="accountant",
        club_id=club1.club_id,
    )
    db.add_all([director, hall_admin, accountant])
    db.flush()

    ws1 = models.Workstation(club_id=club1.club_id, number=1, type="Standard", status="вільне")
    ws2 = models.Workstation(club_id=club1.club_id, number=2, type="VIP", status="вільне")
    tariff_std = models.Tariff(name="Стандарт", workstation_type="Standard", price_per_hour=Decimal("60.00"))
    tariff_vip = models.Tariff(name="VIP", workstation_type="VIP", price_per_hour=Decimal("120.00"))
    customer = models.Client(
        full_name="Марія Шевченко",
        phone="+380671112233",
        bonus_balance=Decimal("200.00"),
    )
    db.add_all([ws1, ws2, tariff_std, tariff_vip, customer])
    db.commit()

    return {
        "club1": club1,
        "club2": club2,
        "director": director,
        "hall_admin": hall_admin,
        "accountant": accountant,
        "ws1": ws1,
        "ws2": ws2,
        "tariff_std": tariff_std,
        "tariff_vip": tariff_vip,
        "customer": customer,
        "h_dir": {"Authorization": f"Bearer {create_access_token(director.user_id)}"},
        "h_adm": {"Authorization": f"Bearer {create_access_token(hall_admin.user_id)}"},
        "h_acc": {"Authorization": f"Bearer {create_access_token(accountant.user_id)}"},
    }


def test_rules_1_2_3_4_5_6_7_8_14_full_shift_and_cash_lifecycle(client, db, shift_env):
    h_adm = shift_env["h_adm"]
    h_acc = shift_env["h_acc"]
    club1 = shift_env["club1"]
    ws1 = shift_env["ws1"]
    ws2 = shift_env["ws2"]
    t_std = shift_env["tariff_std"]
    t_vip = shift_env["tariff_vip"]
    customer = shift_env["customer"]

    # Правило 2: без відкритої зміни не можна почати сеанс чи створити касову операцію -> 409
    r_no_shift = client.post(
        "/sessions",
        headers=h_adm,
        json={
            "workstation_id": ws1.workstation_id,
            "tariff_id": t_std.tariff_id,
            "client_id": customer.client_id,
        },
    )
    assert r_no_shift.status_code == 409
    assert "зміну не відкрито" in r_no_shift.json()["detail"].lower()

    r_op_no_shift = client.post(
        "/cash-operations",
        headers=h_adm,
        json={"type": "внесення", "amount": 500},
    )
    assert r_op_no_shift.status_code == 409

    # Перегляд залу працює і без відкритої зміни (shift_open = False)
    hall_before = client.get("/hall", headers=h_adm).json()
    assert hall_before["shift_open"] is False

    # Бухгалтер не може відкривати зміну -> 403
    assert (
        client.post("/shifts", headers=h_acc, json={"opening_cash": 1000}).status_code
        == 403
    )

    # Правило 1 і 4: відкриття першої зміни з готівкою 1000 ₴
    r_open1 = client.post(
        "/shifts",
        headers=h_adm,
        json={"club_id": club1.club_id, "opening_cash": 1000.00},
    )
    assert r_open1.status_code == 201, r_open1.text
    sh1 = r_open1.json()
    sh1_id = sh1["shift_id"]
    assert sh1["status"] == "відкрита"
    assert Decimal(sh1["opening_cash"]) == Decimal("1000.00")

    # Повторне відкриття зміни в тому самому клубі -> 409 (Правило 1)
    r_open_dup = client.post(
        "/shifts",
        headers=h_adm,
        json={"club_id": club1.club_id, "opening_cash": 500.00},
    )
    assert r_open_dup.status_code == 409

    # Починаємо сеанс № 1 (буде завершений у зміні 1 за готівку 60 ₴)
    s1 = client.post(
        "/sessions",
        headers=h_adm,
        json={
            "workstation_id": ws1.workstation_id,
            "tariff_id": t_std.tariff_id,
            "client_id": customer.client_id,
        },
    ).json()
    s1_obj = db.get(models.GameSession, s1["session_id"])
    s1_obj.start_time = datetime.now() - timedelta(minutes=59, seconds=30)
    db.commit()

    fin1 = client.post(
        f"/sessions/{s1['session_id']}/finish",
        headers=h_adm,
        json={"method": "готівка"},
    ).json()
    assert Decimal(fin1["payment_amount"]) == Decimal("60.00")

    # Починаємо сеанс № 2 на ws2 (залишиться активним під час закриття зміни 1 — Правило 3 і 7!)
    s2 = client.post(
        "/sessions",
        headers=h_adm,
        json={
            "workstation_id": ws2.workstation_id,
            "tariff_id": t_vip.tariff_id,
            "client_id": customer.client_id,
        },
    ).json()

    # Службові операції (Правило 5):
    # Внесення 200 ₴ -> очікувана готівка = 1000 + 60 + 200 = 1260 ₴
    r_in = client.post(
        "/cash-operations",
        headers=h_adm,
        json={"type": "внесення", "amount": 200.00, "comment": "Розмінна монета"},
    )
    assert r_in.status_code == 201

    # Вилучення без категорії або без коментаря -> 422
    assert (
        client.post(
            "/cash-operations",
            headers=h_adm,
            json={"type": "вилучення", "amount": 100.00, "comment": "Вода"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/cash-operations",
            headers=h_adm,
            json={"type": "вилучення", "amount": 100.00, "category": "господарські витрати"},
        ).status_code
        == 422
    )

    # Вилучення понад очікувану готівку (5000 > 1260) -> 422 (Правило 5)
    r_over = client.post(
        "/cash-operations",
        headers=h_adm,
        json={
            "type": "вилучення",
            "amount": 5000.00,
            "category": "інше",
            "comment": "Забагато",
        },
    )
    assert r_over.status_code == 422
    assert "1260" in r_over.json()["detail"]

    # Коректне вилучення 100 ₴ -> очікувана готівка = 1160.00 ₴
    r_out = client.post(
        "/cash-operations",
        headers=h_adm,
        json={
            "type": "вилучення",
            "amount": 100.00,
            "category": "господарські витрати",
            "comment": "Питна вода в кулер",
        },
    )
    assert r_out.status_code == 201

    # Перевіряємо X-звіт (GET /shifts/current/x-report)
    x_rep = client.get("/shifts/current/x-report", headers=h_adm).json()
    assert Decimal(x_rep["expected_cash"]) == Decimal("1160.00")
    assert x_rep["active_sessions_now"] == 1

    # Правило 6: закриття з розбіжністю (actual_cash = 1150 != 1160) без коментаря -> 422
    r_close_no_note = client.post(
        f"/shifts/{sh1_id}/close",
        headers=h_adm,
        json={"actual_cash": 1150.00, "collection": 150.00},
    )
    assert r_close_no_note.status_code == 422

    # Закриття з коментарем і здачею виручки (collection = 150 ₴ -> cash_left = 1000 ₴)
    r_close1 = client.post(
        f"/shifts/{sh1_id}/close",
        headers=h_adm,
        json={
            "actual_cash": 1150.00,
            "collection": 150.00,
            "card_terminal_total": 0.00,
            "comment": "Недостача 10 грн при перерахунку дрібних купюр",
        },
    )
    assert r_close1.status_code == 200, r_close1.text
    closed1 = r_close1.json()
    assert closed1["status"] == "закрита"
    assert closed1["z_number"] == 1
    assert closed1["z_label"] == "Z-0001"
    assert closed1["sessions_carried_over"] == 1  # Правило 7: активний сеанс s2 перейшов далі
    assert Decimal(closed1["cash_difference"]) == Decimal("-10.00")
    assert Decimal(closed1["collection"]) == Decimal("150.00")
    assert Decimal(closed1["cash_left"]) == Decimal("1000.00")

    # Правило 2: поки зміна 2 ще не відкрита, завершити сеанс s2 не можна -> 409
    assert (
        client.post(
            f"/sessions/{s2['session_id']}/finish",
            headers=h_adm,
            json={"method": "картка"},
        ).status_code
        == 409
    )

    # Правило 4: відкриття зміни 2 з іншою сумою (950 замість залишку 1000) без коментаря -> 422
    assert (
        client.post(
            "/shifts",
            headers=h_adm,
            json={"club_id": club1.club_id, "opening_cash": 950.00},
        ).status_code
        == 422
    )

    # Відкриття зміни 2 з коментарем -> opening_difference = -50.00 ₴
    r_open2 = client.post(
        "/shifts",
        headers=h_adm,
        json={
            "club_id": club1.club_id,
            "opening_cash": 950.00,
            "comment": "Вилучено 50 грн у сейф між змінами",
        },
    )
    assert r_open2.status_code == 201
    sh2 = r_open2.json()
    sh2_id = sh2["shift_id"]
    assert Decimal(sh2["opening_difference"]) == Decimal("-50.00")

    # Правило 3: завершуємо сеанс s2 (початий у зміні 1) у зміні 2 -> оплата належить зміні 2!
    s2_obj = db.get(models.GameSession, s2["session_id"])
    s2_obj.start_time = datetime.now() - timedelta(minutes=30)
    db.commit()

    fin2 = client.post(
        f"/sessions/{s2['session_id']}/finish",
        headers=h_adm,
        json={"method": "картка"},
    ).json()
    pay2 = client.get(f"/payments/{fin2['payment_id']}", headers=h_adm).json()
    assert pay2["shift_id"] == sh2_id


def test_rules_9_10_11_12_13_force_close_review_daily_and_alerts(client, db, shift_env):
    h_dir = shift_env["h_dir"]
    h_adm = shift_env["h_adm"]
    h_acc = shift_env["h_acc"]
    club1 = shift_env["club1"]
    club2 = shift_env["club2"]

    # Відкриваємо зміну в клубі 1
    sh = client.post(
        "/shifts",
        headers=h_adm,
        json={"club_id": club1.club_id, "opening_cash": 800.00},
    ).json()
    sh_id = sh["shift_id"]

    # Зсуваємо opened_at на 15 годин назад, щоб спрацювало попередження > 14 год (Правило 13)
    sh_obj = db.get(models.Shift, sh_id)
    sh_obj.opened_at = datetime.now() - timedelta(hours=15)
    db.commit()

    dash = client.get("/dashboard", headers=h_dir).json()
    assert any(a["key"].startswith("shift_long_") for a in dash["alerts"])

    # Правило 9: Адмін залу не може примусово закрити зміну -> 403; Директор може
    assert (
        client.post(
            f"/shifts/{sh_id}/force-close",
            headers=h_adm,
            json={"comment": "Спроба"},
        ).status_code
        == 403
    )

    r_force = client.post(
        f"/shifts/{sh_id}/force-close",
        headers=h_dir,
        json={"comment": "Адміністратор забув закрити зміну після нічного чергування"},
    )
    assert r_force.status_code == 200
    forced = r_force.json()
    assert forced["force_closed"] is True
    assert forced["status"] == "закрита"
    assert forced["z_number"] == 1
    assert Decimal(forced["actual_cash"]) == Decimal("800.00")

    # Правило 10: Бухгалтер підтверджує Z-звіт; зняти підтвердження може лише Директор
    assert (
        client.post(
            f"/shifts/{sh_id}/review",
            headers=h_adm,
            json={"note": "Адмін не має прав"},
        ).status_code
        == 403
    )
    r_rev = client.post(
        f"/shifts/{sh_id}/review",
        headers=h_acc,
        json={"note": "Z-звіт перевірено бухгалтерією"},
    )
    assert r_rev.status_code == 200
    assert r_rev.json()["review_status"] == "підтверджена"
    assert r_rev.json()["reviewed_by_name"] == "Ірина Остапенко"

    # Бухгалтер не може зняти підтвердження (403), а Директор може (200)
    assert client.delete(f"/shifts/{sh_id}/review", headers=h_acc).status_code == 403
    r_unrev = client.delete(f"/shifts/{sh_id}/review", headers=h_dir)
    assert r_unrev.status_code == 200
    assert r_unrev.json()["review_status"] == "очікує"

    # Правило 11 і 12: Денна каса та доступ за клубом
    # Відкриємо зміну в клубі 2 від імені Директора
    client.post(
        "/shifts",
        headers=h_dir,
        json={"club_id": club2.club_id, "opening_cash": 500.00},
    )
    # Адмін клубу 1 бачить лише зміну клубу 1
    adm_shifts = client.get("/shifts", headers=h_adm).json()
    assert adm_shifts["total"] == 1
    assert adm_shifts["items"][0]["club_id"] == club1.club_id

    daily = client.get("/cash/daily", headers=h_dir).json()
    assert len(daily["items"]) == 2
    assert client.get("/cash/daily/export.csv", headers=h_dir).status_code == 200
    assert client.get("/shifts/export.csv", headers=h_dir).status_code == 200
    assert client.get("/cash-operations/export.csv", headers=h_dir).status_code == 200
