"""Наповнення бази демонстраційними даними.

Запуск (з папки backend, після `alembic upgrade head`):

    python -m app.seed            # наповнити порожню базу
    python -m app.seed --reset    # ВИДАЛИТИ ВСІ дані з усіх таблиць і наповнити заново

Усі імена, телефони та адреси вигадані.
"""
import argparse
from datetime import datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import models
from .database import Base, SessionLocal
from .security import hash_password

CENT = Decimal("0.01")

# Робочі місця: тип кожного місця по порядку номерів
LAYOUT = {
    0: ["Standard"] * 5 + ["VIP"] * 2 + ["PlayStation"],
    1: ["Standard"] * 4 + ["VIP"] * 2,
}

# (ПІБ, телефон, email, днів тому зареєстрований, бонуси)
CLIENTS = [
    ("Олександр Коваленко", "+380670000001", "o.kovalenko@example.com", 90, "120.00"),
    ("Марія Шевченко", "+380670000002", None, 75, "0.00"),
    ("Дмитро Бондаренко", "+380670000003", "d.bondarenko@example.com", 60, "35.50"),
    ("Анна Ткаченко", "+380670000004", None, 45, "0.00"),
    ("Іван Мельник", "+380670000005", "i.melnyk@example.com", 40, "210.00"),
    ("Софія Кравченко", "+380670000006", None, 30, "15.00"),
    ("Андрій Олійник", "+380670000007", "a.oliynyk@example.com", 21, "0.00"),
    ("Юлія Лисенко", "+380670000008", None, 10, "60.00"),
    ("Владислав Поліщук", "+380670000009", "v.polishchuk@example.com", 85, "45.00"),
    ("Дарина Мороз", "+380670000010", None, 70, "0.00"),
    ("Артем Марченко", "+380670000011", "a.marchenko@example.com", 65, "90.00"),
    ("Вікторія Савченко", "+380670000012", None, 58, "10.00"),
    ("Назар Руденко", "+380670000013", "n.rudenko@example.com", 52, "0.00"),
    ("Аліна Петренко", "+380670000014", "a.petrenko@example.com", 48, "150.00"),
    ("Роман Клименко", "+380670000015", None, 42, "25.00"),
    ("Христина Павленко", "+380670000016", "k.pavlenko@example.com", 36, "0.00"),
    ("Богдан Гончарук", "+380670000017", None, 29, "80.00"),
    ("Тетяна Кузьменко", "+380670000018", "t.kuzmenko@example.com", 25, "0.00"),
    ("Ярослав Василенко", "+380670000019", None, 19, "55.00"),
    ("Ольга Сидоренко", "+380670000020", "o.sydorenko@example.com", 15, "0.00"),
    ("Микола Литвин", "+380670000021", None, 12, "30.00"),
    ("Ілона Дяченко", "+380670000022", "i.diachenko@example.com", 8, "0.00"),
    ("Сергій Гавриш", "+380670000023", None, 5, "110.00"),
    ("Поліна Козак", "+380670000024", "p.kozak@example.com", 2, "0.00"),
]

# (клуб, ПІБ, посада, днів тому прийнятий) - посади з оргструктури клубу
STAFF = [
    (0, "Віктор Романенко", "Директор клубу", 700),
    (0, "Наталія Гнатюк", "Заступник директора (адміністратор клубу)", 600),
    (0, "Богдан Савчук", "Оператор-адміністратор залу", 400),
    (0, "Олена Вовк", "Оператор-адміністратор залу", 250),
    (0, "Тарас Пономаренко", "Системний адміністратор", 500),
    (0, "Ірина Остапенко", "Бухгалтер", 450),
    (0, "Катерина Руденко", "Менеджер з реклами та маркетингу", 300),
    (0, "Максим Гаврилюк", "Менеджер з організації турнірів та заходів", 280),
    (1, "Оксана Левченко", "Заступник директора (адміністратор клубу)", 320),
    (1, "Денис Мороз", "Оператор-адміністратор залу", 150),
    (1, "Павло Яковенко", "Системний адміністратор", 200),
]

# Завершені сеанси:
# (клієнт, клуб, № місця, тариф, днів тому, година початку, хвилин, спосіб оплати)
COMPLETED_SESSIONS = [
    (0, 0, 1, "std", 6, 15, 120, "картка"),
    (1, 0, 6, "vip", 6, 18, 180, "готівка"),
    (2, 0, 8, "ps", 5, 16, 90, "картка"),
    (3, 0, 2, "std", 4, 19, 60, "готівка"),
    (4, 1, 1, "std", 4, 14, 150, "картка"),
    (5, 1, 5, "vip", 3, 20, 120, "бонуси"),
    (6, 0, 3, "night", 3, 23, 240, "готівка"),
    (7, 1, 2, "std", 2, 17, 90, "готівка"),
    (0, 0, 7, "vip", 1, 19, 120, "картка"),
    (2, 1, 3, "std", 1, 15, 60, "бонуси"),
]

# (клуб, категорія, сума, днів тому, опис)
EXPENSES = [
    (0, "оренда", "15000.00", 20, "Оренда приміщення за місяць"),
    (0, "комунальні", "3200.00", 12, "Електроенергія та інтернет"),
    (0, "зарплата", "48000.00", 10, "Зарплата персоналу за місяць"),
    (0, "закупівлі", "4500.00", 7, "Напої та снеки для бару"),
    (0, "інше", "1200.00", 5, "Реклама в соцмережах"),
    (1, "оренда", "9000.00", 20, "Оренда приміщення за місяць"),
    (1, "комунальні", "2100.00", 12, "Електроенергія та інтернет"),
    (1, "закупівлі", "2600.00", 6, "Нові миші та килимки"),
]


def _money(value: str | Decimal) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


# Демо-користувачі: по одному на кожну роль.
# (логін, ПІБ співробітника, роль, назва клубу або None = уся мережа)
DEMO_PASSWORD = "demo1234"
DEMO_USERS = [
    ("director", "Віктор Романенко", "director", None),
    ("hall_admin", "Богдан Савчук", "hall_admin", "Cyberion Центр"),
    ("accountant", "Ірина Остапенко", "accountant", "Cyberion Центр"),
    ("tournaments", "Максим Гаврилюк", "tournament_manager", "Cyberion Центр"),
    ("marketing", "Катерина Руденко", "marketing_manager", "Cyberion Центр"),
    ("sysadmin", "Тарас Пономаренко", "sysadmin", "Cyberion Центр"),
]


def seed_users(db: Session) -> int:
    """Створює демо-користувачів, яких ще немає. Клуб і співробітника шукає за назвою/ПІБ.

    Працює й на вже заповненій базі (python -m app.seed --users). Повертає кількість створених.
    """
    password_hash = hash_password(DEMO_PASSWORD)
    created = 0
    for username, full_name, role, club_name in DEMO_USERS:
        if db.scalar(select(models.AppUser).where(models.AppUser.username == username)):
            continue
        club_id = None
        if club_name is not None:
            club_id = db.scalar(select(models.Club.club_id).where(models.Club.name == club_name))
            if club_id is None:
                raise RuntimeError(f"Клуб «{club_name}» не знайдено: спершу створіть демо-дані")
        staff_id = db.scalar(select(models.Staff.staff_id).where(models.Staff.full_name == full_name))
        db.add(models.AppUser(
            username=username, password_hash=password_hash, full_name=full_name,
            role=role, club_id=club_id, staff_id=staff_id,
        ))
        created += 1
    db.flush()
    return created


def seed(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Створює демо-дані в переданій сесії (commit робить викликач). Повертає кількість записів."""
    now = (now or datetime.now()).replace(second=0, microsecond=0)
    today = now.date()

    # Клуби
    clubs = [
        models.Club(name="Cyberion Центр", address="вул. Соборна, 12", phone="+380500000001", pc_count=len(LAYOUT[0])),
        models.Club(name="Cyberion Дніпровський", address="бул. Шевченка, 45", phone="+380500000002", pc_count=len(LAYOUT[1])),
    ]
    db.add_all(clubs)
    db.flush()

    # Робочі місця
    workstations: dict[tuple[int, int], models.Workstation] = {}
    for club_idx, types in LAYOUT.items():
        for number, ws_type in enumerate(types, start=1):
            ws = models.Workstation(club_id=clubs[club_idx].club_id, number=number, type=ws_type, status="вільне")
            workstations[(club_idx, number)] = ws
            db.add(ws)
    workstations[(1, 4)].status = "на ремонті"
    db.flush()

    # Тарифи
    tariffs = {
        "std": models.Tariff(name="Стандарт", price_per_hour=_money("60"), workstation_type="Standard"),
        "vip": models.Tariff(name="VIP", price_per_hour=_money("90"), workstation_type="VIP"),
        "ps": models.Tariff(name="PlayStation", price_per_hour=_money("80"), workstation_type="PlayStation"),
        "night": models.Tariff(name="Нічний Стандарт", price_per_hour=_money("40"), workstation_type="Standard"),
    }
    db.add_all(tariffs.values())
    db.flush()

    # Клієнти
    clients = [
        models.Client(
            full_name=name, phone=phone, email=email,
            reg_date=today - timedelta(days=days_ago), bonus_balance=_money(bonus),
        )
        for name, phone, email, days_ago, bonus in CLIENTS
    ]
    db.add_all(clients)
    db.flush()

    # Співробітники
    staff_members = [
        models.Staff(
            club_id=clubs[club_idx].club_id, full_name=name, position=position,
            hire_date=today - timedelta(days=days_ago),
        )
        for club_idx, name, position, days_ago in STAFF
    ]
    db.add_all(staff_members)
    db.flush()

    seed_users(db)

    hall_admin_user = db.scalar(select(models.AppUser).where(models.AppUser.username == "hall_admin"))
    director_user = db.scalar(select(models.AppUser).where(models.AppUser.username == "director"))
    accountant_user = db.scalar(select(models.AppUser).where(models.AppUser.username == "accountant"))
    admin_uid = hall_admin_user.user_id if hall_admin_user else 1
    dir_uid = director_user.user_id if director_user else 1
    acc_uid = accountant_user.user_id if accountant_user else 1

    # Створюємо закриту зміну Z-0001 за вчора та поточну відкриту зміну на сьогодні у клубі № 0
    closed_shift_0 = models.Shift(
        club_id=clubs[0].club_id,
        z_number=1,
        business_date=today - timedelta(days=1),
        status="закрита",
        opened_at=datetime.combine(today - timedelta(days=1), time(8, 0)),
        opened_by_user_id=admin_uid,
        opening_cash=_money("1000.00"),
        opening_difference=_money("0.00"),
        closed_at=datetime.combine(today - timedelta(days=1), time(22, 0)),
        closed_by_user_id=admin_uid,
        force_closed=False,
        cash_sales=_money("590.00"),
        card_sales=_money("420.00"),
        bonus_sales=_money("0.00"),
        sessions_completed=5,
        sessions_cancelled=0,
        sessions_carried_over=0,
        cash_in=_money("200.00"),
        cash_out=_money("150.00"),
        collection=_money("440.00"),
        expected_cash=_money("1640.00"),
        actual_cash=_money("1640.00"),
        cash_difference=_money("0.00"),
        cash_left=_money("1200.00"),
        card_terminal_total=_money("420.00"),
        card_difference=_money("0.00"),
        review_status="підтверджена",
        reviewed_by_user_id=acc_uid,
        reviewed_at=datetime.combine(today, time(9, 0)),
        review_note="Перевірено за Z-звітом та випискою термінала",
    )
    closed_shift_1 = models.Shift(
        club_id=clubs[1].club_id,
        z_number=1,
        business_date=today - timedelta(days=1),
        status="закрита",
        opened_at=datetime.combine(today - timedelta(days=1), time(9, 0)),
        opened_by_user_id=dir_uid,
        opening_cash=_money("500.00"),
        opening_difference=_money("0.00"),
        closed_at=datetime.combine(today - timedelta(days=1), time(21, 0)),
        closed_by_user_id=dir_uid,
        force_closed=False,
        cash_sales=_money("90.00"),
        card_sales=_money("150.00"),
        bonus_sales=_money("240.00"),
        sessions_completed=4,
        sessions_cancelled=0,
        sessions_carried_over=0,
        cash_in=_money("0.00"),
        cash_out=_money("0.00"),
        collection=_money("0.00"),
        expected_cash=_money("590.00"),
        actual_cash=_money("590.00"),
        cash_difference=_money("0.00"),
        cash_left=_money("590.00"),
        review_status="очікує",
    )
    open_shift_0 = models.Shift(
        club_id=clubs[0].club_id,
        z_number=None,
        business_date=today,
        status="відкрита",
        opened_at=now - timedelta(hours=3),
        opened_by_user_id=admin_uid,
        opening_cash=_money("1200.00"),
        opening_difference=_money("0.00"),
        expected_cash=_money("1200.00"),
        actual_cash=_money("1200.00"),
        cash_left=_money("1200.00"),
        review_status="очікує",
    )
    db.add_all([closed_shift_0, closed_shift_1, open_shift_0])
    db.flush()

    db.add_all([
        models.CashOperation(
            shift_id=closed_shift_0.shift_id,
            club_id=clubs[0].club_id,
            type="внесення",
            amount=_money("200.00"),
            category=None,
            comment="Розмінна монета на початок дня",
            created_at=datetime.combine(today - timedelta(days=1), time(8, 15)),
            created_by_user_id=admin_uid,
        ),
        models.CashOperation(
            shift_id=closed_shift_0.shift_id,
            club_id=clubs[0].club_id,
            type="вилучення",
            amount=_money("150.00"),
            category="господарські витрати",
            comment="Вода для кулера та серветки",
            created_at=datetime.combine(today - timedelta(days=1), time(14, 30)),
            created_by_user_id=admin_uid,
        ),
        models.CashOperation(
            shift_id=closed_shift_0.shift_id,
            club_id=clubs[0].club_id,
            type="інкасація",
            amount=_money("440.00"),
            category=None,
            comment="Інкасація при закритті зміни",
            created_at=datetime.combine(today - timedelta(days=1), time(22, 0)),
            created_by_user_id=admin_uid,
        ),
    ])
    db.flush()

    # Завершені сеанси та оплати
    for client_idx, club_idx, number, tariff_key, days_ago, hour, minutes, method in COMPLETED_SESSIONS:
        tariff = tariffs[tariff_key]
        start = datetime.combine(today - timedelta(days=days_ago), time(hour))
        end = start + timedelta(minutes=minutes)
        session = models.GameSession(
            client_id=clients[client_idx].client_id,
            workstation_id=workstations[(club_idx, number)].workstation_id,
            tariff_id=tariff.tariff_id,
            price_per_hour=tariff.price_per_hour,
            start_time=start, end_time=end, status="завершений",
        )
        db.add(session)
        db.flush()
        amount = _money(Decimal(minutes) / Decimal(60) * tariff.price_per_hour)
        linked_shift_id = closed_shift_0.shift_id if club_idx == 0 else closed_shift_1.shift_id
        db.add(models.Payment(
            session_id=session.session_id,
            shift_id=linked_shift_id,
            amount=amount,
            payment_date=end,
            method=method,
        ))

    # Один активний сеанс: місце зайняте, оплати ще немає
    active_ws = workstations[(0, 3)]
    active_ws.status = "зайняте"
    db.add(models.GameSession(
        client_id=clients[1].client_id,
        workstation_id=active_ws.workstation_id,
        tariff_id=tariffs["std"].tariff_id,
        price_per_hour=tariffs["std"].price_per_hour,
        start_time=now - timedelta(minutes=45), end_time=None, status="активний",
    ))

    # Витрати
    db.add_all(
        models.Expense(
            club_id=clubs[club_idx].club_id, category=category, amount=_money(amount),
            expense_date=today - timedelta(days=days_ago), description=description,
        )
        for club_idx, category, amount, days_ago, description in EXPENSES
    )

    # Турніри та участь
    upcoming = models.Tournament(
        club_id=clubs[0].club_id, name="CS2 Weekend Cup", game="Counter-Strike 2",
        date=today + timedelta(days=9), prize_fund=_money("5000"),
    )
    finished = models.Tournament(
        club_id=clubs[1].club_id, name="FC 25 League Night", game="EA FC 25",
        date=today - timedelta(days=8), prize_fund=_money("2000"),
    )
    db.add_all([upcoming, finished])
    db.flush()

    for client_idx in (0, 2, 4, 6):  # майбутній турнір: місць ще немає
        db.add(models.Participation(tournament_id=upcoming.tournament_id, client_id=clients[client_idx].client_id, place=None))
    for place, client_idx in enumerate((5, 1, 7, 3), start=1):  # завершений турнір: підсумки
        db.add(models.Participation(tournament_id=finished.tournament_id, client_id=clients[client_idx].client_id, place=place))
    db.flush()

    return {
        table.name: db.scalar(select(func.count()).select_from(table))
        for table in Base.metadata.sorted_tables
    }


def wipe(db: Session) -> None:
    """Видаляє всі рядки з усіх таблиць (у порядку, що поважає зовнішні ключі)."""
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(delete(table))


def main() -> None:
    parser = argparse.ArgumentParser(description="Наповнити базу демонстраційними даними.")
    parser.add_argument(
        "--reset", action="store_true",
        help="спочатку ВИДАЛИТИ всі дані з усіх таблиць, потім створити демо-дані",
    )
    parser.add_argument(
        "--users", action="store_true",
        help="лише додати демо-користувачів, яких ще немає (наявні дані не змінюються)",
    )
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.users:
            created = seed_users(db)
            db.commit()
            print(f"Створено користувачів: {created}. Пароль усіх демо-користувачів: {DEMO_PASSWORD}")
            return

        has_data = db.scalar(select(func.count()).select_from(models.Club)) or db.scalar(
            select(func.count()).select_from(models.Client)
        )
        if has_data and not args.reset:
            print("У базі вже є дані, нічого не змінено.")
            print("Щоб видалити їх і створити демо-дані заново, запустіть з --reset.")
            return
        if args.reset:
            wipe(db)
        counts = seed(db)
        db.commit()

    print("Демо-дані створено:")
    for name, count in counts.items():
        if name != "alembic_version":
            print(f"  {name}: {count}")
    print(f"Пароль усіх демо-користувачів: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
