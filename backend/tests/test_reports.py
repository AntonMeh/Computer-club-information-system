"""Тести Етапу 4: Огляд (/dashboard) та Аналітичні звіти (/reports/*)."""
from datetime import date, datetime, timedelta
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
def stage4_env(db):
    now = datetime.now()
    today = date.today()

    club = models.Club(
        name="Cyberion Центр",
        address="вул. Соборна, 12",
        phone="+380500000001",
    )
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
    marketing = models.AppUser(
        username="marketing",
        password_hash=hash_password("demo1234"),
        full_name="Маркетолог",
        role="marketing_manager",
        club_id=club.club_id,
    )
    db.add_all([director, accountant, marketing])

    w1 = models.Workstation(club_id=club.club_id, number=1, type="Standard", status="вільне")
    w2 = models.Workstation(club_id=club.club_id, number=2, type="VIP", status="зайняте")
    w3 = models.Workstation(club_id=club.club_id, number=3, type="PlayStation", status="на ремонті")
    db.add_all([w1, w2, w3])
    db.flush()

    t_std = models.Tariff(
        name="Стандарт",
        workstation_type="Standard",
        price_per_hour=Decimal("80.00"),
    )
    t_vip = models.Tariff(
        name="VIP",
        workstation_type="VIP",
        price_per_hour=Decimal("130.00"),
    )
    db.add_all([t_std, t_vip])
    db.flush()

    c1 = models.Client(
        full_name="Марія Шевченко",
        phone="+380501112233",
        bonus_balance=Decimal("25.00"),
        reg_date=today - timedelta(days=2),
    )
    c2 = models.Client(
        full_name="Олег Мельник",
        phone="+380502223344",
        bonus_balance=Decimal("10.00"),
        reg_date=today - timedelta(days=10),
    )
    db.add_all([c1, c2])
    db.flush()

    # Два завершені сеанси для c1 (щоб був клієнтом, що повернувся) + один активний на w2
    s1 = models.GameSession(
        client_id=c1.client_id,
        workstation_id=w1.workstation_id,
        tariff_id=t_std.tariff_id,
        price_per_hour=Decimal("80.00"),
        start_time=now - timedelta(hours=5),
        end_time=now - timedelta(hours=3),
        status="завершений",
    )
    s2 = models.GameSession(
        client_id=c1.client_id,
        workstation_id=w1.workstation_id,
        tariff_id=t_std.tariff_id,
        price_per_hour=Decimal("80.00"),
        start_time=now - timedelta(hours=2, minutes=30),
        end_time=now - timedelta(hours=1, minutes=30),
        status="завершений",
    )
    s_active = models.GameSession(
        client_id=c2.client_id,
        workstation_id=w2.workstation_id,
        tariff_id=t_vip.tariff_id,
        price_per_hour=Decimal("130.00"),
        start_time=now - timedelta(hours=1),
        end_time=None,
        status="активний",
    )
    db.add_all([s1, s2, s_active])
    db.flush()

    p1 = models.Payment(
        session_id=s1.session_id,
        amount=Decimal("160.00"),
        method="готівка",
        payment_date=now - timedelta(hours=3),
    )
    p2 = models.Payment(
        session_id=s2.session_id,
        amount=Decimal("80.00"),
        method="картка",
        payment_date=now - timedelta(hours=1, minutes=30),
    )
    db.add_all([p1, p2])

    exp1 = models.Expense(
        club_id=club.club_id,
        category="оренда",
        amount=Decimal("100.00"),
        expense_date=today,
        description="Часткова оплата оренди",
    )
    db.add(exp1)

    trn = models.Tournament(
        club_id=club.club_id,
        name="Winter Cup",
        game="CS2",
        date=today,
        prize_fund=Decimal("5000.00"),
    )
    db.add(trn)
    db.flush()

    part1 = models.TournamentParticipation(
        tournament_id=trn.tournament_id,
        client_id=c1.client_id,
        reg_date=today,
        place=1,
    )
    db.add(part1)
    db.commit()

    return {
        "club": club,
        "h_dir": {"Authorization": f"Bearer {create_access_token(director.user_id)}"},
        "h_acc": {"Authorization": f"Bearer {create_access_token(accountant.user_id)}"},
        "h_mkt": {"Authorization": f"Bearer {create_access_token(marketing.user_id)}"},
    }


def test_dashboard_metrics_and_alerts(client, stage4_env):
    h_dir = stage4_env["h_dir"]
    res = client.get("/dashboard", headers=h_dir)
    assert res.status_code == 200
    body = res.json()

    # Виручка сьогодні = 160 + 80 = 240.00, витрати за місяць = 100.00, прибуток = 140.00
    assert Decimal(body["revenue_today"]) == Decimal("240.00")
    assert Decimal(body["expenses_month"]) == Decimal("100.00")
    assert Decimal(body["profit_month"]) == Decimal("140.00")

    # Усього місць 3, на ремонті 1 -> доступно 2, зайнято 1 -> завантаженість 50.0%
    assert body["workstations_total"] == 3
    assert body["workstations_repair"] == 1
    assert body["workstations_available"] == 2
    assert body["active_sessions"] == 1
    assert Decimal(body["occupancy_percent"]) == Decimal("50.0")

    # Серія за 14 днів має рівно 14 точок
    assert len(body["revenue_14d"]) == 14
    assert len(body["workstations_now"]) == 3
    assert len(body["recent_payments"]) == 2
    assert any(a["key"] == "ws_repair" for a in body["alerts"])


def test_reports_finance_matches_journals_and_blocks_marketing(client, stage4_env):
    h_dir = stage4_env["h_dir"]
    h_mkt = stage4_env["h_mkt"]

    # Маркетолог не має доступу до вкладки «Фінанси» (403)
    assert client.get("/reports/finance", headers=h_mkt).status_code == 403

    # Директор бачить повний фінансовий звіт
    r_fin = client.get("/reports/finance?granularity=day", headers=h_dir)
    assert r_fin.status_code == 200
    fin = r_fin.json()

    assert Decimal(fin["revenue_total"]) == Decimal("240.00")
    assert Decimal(fin["revenue_cash"]) == Decimal("160.00")
    assert Decimal(fin["revenue_card"]) == Decimal("80.00")
    assert Decimal(fin["expenses_total"]) == Decimal("100.00")
    assert Decimal(fin["profit"]) == Decimal("140.00")
    assert fin["payments_count"] == 2
    assert Decimal(fin["avg_check"]) == Decimal("120.00")

    # CSV-експорт фінансового звіту
    r_csv = client.get("/reports/finance?format=csv", headers=h_dir)
    assert r_csv.status_code == 200
    assert "Виручка" in r_csv.text


def test_reports_occupancy_tariffs_clients_tournaments(client, stage4_env):
    h_mkt = stage4_env["h_mkt"]

    # 1. Завантаженість (доступно маркетологу)
    r_occ = client.get("/reports/occupancy", headers=h_mkt)
    assert r_occ.status_code == 200
    occ = r_occ.json()
    assert occ["available_workstations"] == 2  # місце № 3 на ремонті не у знаменнику
    assert occ["total_sessions"] == 3
    assert len(occ["heatmap"]) == 7
    assert len(occ["heatmap"][0]) == 24
    assert len(occ["by_type"]) == 3

    # 2. Тарифи і місця
    r_tar = client.get("/reports/tariffs", headers=h_mkt)
    assert r_tar.status_code == 200
    tar = r_tar.json()
    assert len(tar["tariffs"]) == 2
    assert len(tar["workstations"]) == 3
    assert any(w["is_most_loaded"] for w in tar["workstations"])
    assert any(w["is_least_loaded"] for w in tar["workstations"])

    # 3. Клієнти
    r_cli = client.get("/reports/clients", headers=h_mkt)
    assert r_cli.status_code == 200
    cli = r_cli.json()
    assert cli["total_clients"] == 2
    assert cli["active_clients_period"] == 2
    assert cli["returning_clients_count"] == 1  # Марія має 2 сеанси
    assert Decimal(cli["returning_share_percent"]) == Decimal("50.0")
    assert cli["top_clients"][0]["full_name"] == "Марія Шевченко"
    assert Decimal(cli["top_clients"][0]["total_spent"]) == Decimal("240.00")

    # 4. Турніри
    r_trn = client.get("/reports/tournaments", headers=h_mkt)
    assert r_trn.status_code == 200
    trn = r_trn.json()
    assert trn["tournaments_count"] == 1
    assert trn["participants_total"] == 1
    assert Decimal(trn["prize_fund_total"]) == Decimal("5000.00")
    assert trn["items"][0]["winner_name"] == "Марія Шевченко"

