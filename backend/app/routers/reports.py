import csv
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require, scoped_club_id
from ..permissions import FULL, VIEW, allowed
from .sessions import calculate_duration_and_amount
from .tournaments import _compute_tournament_status

router = APIRouter(prefix="/reports", tags=["reports"])

WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"]


def _resolve_dates(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = date.today()
    d_to = date_to or today
    d_from = date_from or (d_to - timedelta(days=29))
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    return d_from, d_to


def _period_key_and_label(d: date, granularity: str) -> tuple[str, str]:
    if granularity == "month":
        return d.strftime("%Y-%m"), d.strftime("%m.%Y")
    if granularity == "week":
        monday = d - timedelta(days=d.weekday())
        sunday = monday + timedelta(days=6)
        return monday.strftime("%Y-%m-%d"), f"{monday.strftime('%d.%m')}–{sunday.strftime('%d.%m')}"
    return d.strftime("%Y-%m-%d"), d.strftime("%d.%m.%Y")


def _generate_period_buckets(
    d_from: date, d_to: date, granularity: str
) -> list[tuple[str, str]]:
    seen: dict[str, str] = {}
    cur = d_from
    while cur <= d_to:
        k, lbl = _period_key_and_label(cur, granularity)
        if k not in seen:
            seen[k] = lbl
        cur += timedelta(days=1)
    return list(seen.items())


def _csv_response(filename: str, headers: list[str], rows: list[list[object]]) -> Response:
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(headers)
    for r in rows:
        writer.writerow(r)
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/finance")
def report_finance(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    granularity: str = Query(default="day"),
    format_type: str | None = Query(default=None, alias="format"),
    user: models.AppUser = Depends(require("reports", VIEW)),
    db: Session = Depends(get_db),
):
    # Вкладка «Фінанси» доступна лише ролям із FULL на reports (Директор і Бухгалтер, п. 7.14)
    if not allowed(user.role, "reports", FULL):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Фінансовий звіт доступний лише Директору та Бухгалтеру",
        )

    effective_club_id = scoped_club_id(user, club_id)
    d_from, d_to = _resolve_dates(date_from, date_to)
    dt_from = datetime.combine(d_from, time.min)
    dt_to = datetime.combine(d_to, time.max)

    pay_stmt = (
        select(models.Payment)
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .where(
            models.Payment.payment_date >= dt_from,
            models.Payment.payment_date <= dt_to,
        )
    )
    if effective_club_id is not None:
        pay_stmt = pay_stmt.where(models.Workstation.club_id == effective_club_id)
    payments = db.scalars(pay_stmt).all()

    exp_stmt = select(models.Expense).where(
        models.Expense.expense_date >= d_from,
        models.Expense.expense_date <= d_to,
    )
    if effective_club_id is not None:
        exp_stmt = exp_stmt.where(models.Expense.club_id == effective_club_id)
    expenses = db.scalars(exp_stmt).all()

    buckets = _generate_period_buckets(d_from, d_to, granularity)
    bucket_map: dict[str, schemas.FinancePeriodBucket] = {
        k: schemas.FinancePeriodBucket(
            period_key=k,
            period_label=lbl,
            revenue=Decimal("0.00"),
            revenue_cash=Decimal("0.00"),
            revenue_card=Decimal("0.00"),
            revenue_bonus=Decimal("0.00"),
            expenses=Decimal("0.00"),
            profit=Decimal("0.00"),
            expenses_by_category={c: Decimal("0.00") for c in schemas.EXPENSE_CATEGORIES},
        )
        for k, lbl in buckets
    }

    rev_total = Decimal("0.00")
    rev_cash = Decimal("0.00")
    rev_card = Decimal("0.00")
    rev_bonus = Decimal("0.00")

    for p in payments:
        amt = Decimal(p.amount).quantize(Decimal("0.01"))
        rev_total += amt
        if p.method == "готівка":
            rev_cash += amt
        elif p.method == "картка":
            rev_card += amt
        elif p.method == "бонуси":
            rev_bonus += amt

        pk, _ = _period_key_and_label(p.payment_date.date(), granularity)
        b = bucket_map.get(pk)
        if b is not None:
            b.revenue = (b.revenue + amt).quantize(Decimal("0.01"))
            if p.method == "готівка":
                b.revenue_cash = (b.revenue_cash + amt).quantize(Decimal("0.01"))
            elif p.method == "картка":
                b.revenue_card = (b.revenue_card + amt).quantize(Decimal("0.01"))
            elif p.method == "бонуси":
                b.revenue_bonus = (b.revenue_bonus + amt).quantize(Decimal("0.01"))

    exp_total = Decimal("0.00")
    exp_by_cat: dict[str, Decimal] = {c: Decimal("0.00") for c in schemas.EXPENSE_CATEGORIES}

    for e in expenses:
        amt = Decimal(e.amount).quantize(Decimal("0.01"))
        exp_total += amt
        exp_by_cat[e.category] = (exp_by_cat.get(e.category, Decimal("0.00")) + amt).quantize(
            Decimal("0.01")
        )
        pk, _ = _period_key_and_label(e.expense_date, granularity)
        b = bucket_map.get(pk)
        if b is not None:
            b.expenses = (b.expenses + amt).quantize(Decimal("0.01"))
            b.expenses_by_category[e.category] = (
                b.expenses_by_category.get(e.category, Decimal("0.00")) + amt
            ).quantize(Decimal("0.01"))

    for b in bucket_map.values():
        b.profit = (b.revenue - b.expenses).quantize(Decimal("0.01"))

    profit_total = (rev_total - exp_total).quantize(Decimal("0.01"))
    avg_check = (
        (rev_total / Decimal(len(payments))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if len(payments) > 0
        else Decimal("0.00")
    )

    series_list = list(bucket_map.values())

    if format_type == "csv":
        rows = [
            [
                b.period_label,
                f"{b.revenue:.2f}".replace(".", ","),
                f"{b.revenue_cash:.2f}".replace(".", ","),
                f"{b.revenue_card:.2f}".replace(".", ","),
                f"{b.revenue_bonus:.2f}".replace(".", ","),
                f"{b.expenses:.2f}".replace(".", ","),
                f"{b.profit:.2f}".replace(".", ","),
            ]
            for b in series_list
        ]
        return _csv_response(
            "report_finance.csv",
            ["Період", "Виручка", "Готівка", "Картка", "Бонуси", "Витрати", "Прибуток"],
            rows,
        )

    return schemas.FinanceReportResponse(
        date_from=d_from,
        date_to=d_to,
        granularity=granularity,
        revenue_total=rev_total.quantize(Decimal("0.01")),
        revenue_cash=rev_cash.quantize(Decimal("0.01")),
        revenue_card=rev_card.quantize(Decimal("0.01")),
        revenue_bonus=rev_bonus.quantize(Decimal("0.01")),
        expenses_total=exp_total.quantize(Decimal("0.01")),
        profit=profit_total,
        payments_count=len(payments),
        avg_check=avg_check,
        expenses_by_category=exp_by_cat,
        series=series_list,
    )


@router.get("/occupancy")
def report_occupancy(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    format_type: str | None = Query(default=None, alias="format"),
    user: models.AppUser = Depends(require("reports", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    d_from, d_to = _resolve_dates(date_from, date_to)
    dt_from = datetime.combine(d_from, time.min)
    dt_to = min(datetime.combine(d_to, time.max), datetime.now())
    if dt_to < dt_from:
        dt_to = datetime.combine(d_to, time.max)

    ws_stmt = select(models.Workstation)
    if effective_club_id is not None:
        ws_stmt = ws_stmt.where(models.Workstation.club_id == effective_club_id)
    all_ws = db.scalars(ws_stmt).all()

    # Правило 13: місця «на ремонті» у знаменнику не враховуються
    available_ws = [w for w in all_ws if w.status != "на ремонті"]
    avail_count = len(available_ws)

    sess_stmt = (
        select(models.GameSession)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .where(
            models.GameSession.status.in_(("активний", "завершений")),
            models.GameSession.start_time <= dt_to,
        )
    )
    if effective_club_id is not None:
        sess_stmt = sess_stmt.where(models.Workstation.club_id == effective_club_id)
    sessions = db.scalars(sess_stmt).all()

    now = datetime.now()
    period_minutes = max(1.0, (dt_to - dt_from).total_seconds() / 60.0)
    total_busy_minutes = 0.0
    total_sessions_in_period = 0

    by_type_minutes: dict[str, float] = {t: 0.0 for t in schemas.WORKSTATION_TYPES}
    by_type_sessions: dict[str, int] = {t: 0 for t in schemas.WORKSTATION_TYPES}

    # Для теплової карти: сума зайнятих хвилин у слоті (weekday, hour) та кількість таких годин у періоді
    slot_busy_minutes = [[0.0 for _ in range(24)] for _ in range(7)]
    slot_occurrences = [0 for _ in range(7)]
    cur_d = d_from
    while cur_d <= d_to:
        slot_occurrences[cur_d.weekday()] += 1
        cur_d += timedelta(days=1)

    for s in sessions:
        s_end = s.end_time or now
        if s_end < dt_from:
            continue
        clip_start = max(s.start_time, dt_from)
        clip_end = min(s_end, dt_to)
        if clip_end <= clip_start:
            continue

        mins = (clip_end - clip_start).total_seconds() / 60.0
        total_busy_minutes += mins
        total_sessions_in_period += 1

        ws_type = s.workstation.type if s.workstation else "Standard"
        by_type_minutes[ws_type] = by_type_minutes.get(ws_type, 0.0) + mins
        by_type_sessions[ws_type] = by_type_sessions.get(ws_type, 0) + 1

        # Розподіляємо зайняті хвилини по годинах доби для теплової карти
        cursor = clip_start.replace(minute=0, second=0, microsecond=0)
        while cursor < clip_end:
            next_hour = cursor + timedelta(hours=1)
            ov_start = max(clip_start, cursor)
            ov_end = min(clip_end, next_hour)
            if ov_end > ov_start:
                slot_busy_minutes[cursor.weekday()][cursor.hour] += (
                    ov_end - ov_start
                ).total_seconds() / 60.0
            cursor = next_hour

    denom_total = avail_count * period_minutes
    overall_occ = (
        Decimal(min(100.0, (total_busy_minutes * 100.0) / denom_total)).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP
        )
        if denom_total > 0
        else Decimal("0.0")
    )

    heatmap: list[list[Decimal]] = []
    flat_slots: list[schemas.PeakHourItem] = []
    for wd in range(7):
        row: list[Decimal] = []
        occ_days = max(1, slot_occurrences[wd])
        slot_denom = avail_count * occ_days * 60.0
        for hr in range(24):
            pct = (
                Decimal(min(100.0, (slot_busy_minutes[wd][hr] * 100.0) / slot_denom)).quantize(
                    Decimal("0.1"), rounding=ROUND_HALF_UP
                )
                if slot_denom > 0
                else Decimal("0.0")
            )
            row.append(pct)
            flat_slots.append(
                schemas.PeakHourItem(
                    weekday=wd,
                    weekday_label=WEEKDAY_LABELS[wd],
                    hour=hr,
                    hour_label=f"{hr:02d}:00–{(hr + 1) % 24:02d}:00",
                    occupancy_percent=pct,
                )
            )
        heatmap.append(row)

    flat_slots.sort(key=lambda x: x.occupancy_percent, reverse=True)
    peak_hours = [p for p in flat_slots[:3] if p.occupancy_percent > 0]

    by_type_items: list[schemas.OccupancyByTypeItem] = []
    for t in schemas.WORKSTATION_TYPES:
        type_avail = sum(1 for w in available_ws if w.type == t)
        type_denom = type_avail * period_minutes
        t_mins = by_type_minutes.get(t, 0.0)
        t_occ = (
            Decimal(min(100.0, (t_mins * 100.0) / type_denom)).quantize(
                Decimal("0.1"), rounding=ROUND_HALF_UP
            )
            if type_denom > 0
            else Decimal("0.0")
        )
        by_type_items.append(
            schemas.OccupancyByTypeItem(
                type=t,
                workstations_count=type_avail,
                sessions_count=by_type_sessions.get(t, 0),
                hours=Decimal(t_mins / 60.0).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP),
                occupancy_percent=t_occ,
            )
        )

    if format_type == "csv":
        rows = [
            [
                it.type,
                it.workstations_count,
                it.sessions_count,
                f"{it.hours:.1f}".replace(".", ","),
                f"{it.occupancy_percent:.1f}".replace(".", ","),
            ]
            for it in by_type_items
        ]
        return _csv_response(
            "report_occupancy.csv",
            ["Тип місця", "Доступних місць", "Сеансів", "Годин", "Завантаженість (%)"],
            rows,
        )

    return schemas.OccupancyReportResponse(
        date_from=d_from,
        date_to=d_to,
        available_workstations=avail_count,
        total_sessions=total_sessions_in_period,
        total_hours=Decimal(total_busy_minutes / 60.0).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP
        ),
        overall_occupancy_percent=overall_occ,
        heatmap=heatmap,
        by_type=by_type_items,
        peak_hours=peak_hours,
    )


@router.get("/tariffs")
def report_tariffs(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    format_type: str | None = Query(default=None, alias="format"),
    user: models.AppUser = Depends(require("reports", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    d_from, d_to = _resolve_dates(date_from, date_to)
    dt_from = datetime.combine(d_from, time.min)
    dt_to = datetime.combine(d_to, time.max)
    period_minutes = max(1.0, (min(dt_to, datetime.now()) - dt_from).total_seconds() / 60.0)

    all_tariffs = db.scalars(select(models.Tariff).order_by(models.Tariff.tariff_id)).all()
    ws_stmt = select(models.Workstation).order_by(
        models.Workstation.club_id, models.Workstation.number
    )
    if effective_club_id is not None:
        ws_stmt = ws_stmt.where(models.Workstation.club_id == effective_club_id)
    workstations = db.scalars(ws_stmt).all()

    sess_stmt = (
        select(models.GameSession)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .where(
            models.GameSession.start_time >= dt_from,
            models.GameSession.start_time <= dt_to,
            models.GameSession.status.in_(("активний", "завершений")),
        )
    )
    if effective_club_id is not None:
        sess_stmt = sess_stmt.where(models.Workstation.club_id == effective_club_id)
    sessions = db.scalars(sess_stmt).all()

    now = datetime.now()
    t_stats = {
        t.tariff_id: {"sessions": 0, "minutes": 0, "revenue": Decimal("0.00")}
        for t in all_tariffs
    }
    w_stats = {
        w.workstation_id: {"sessions": 0, "minutes": 0, "revenue": Decimal("0.00")}
        for w in workstations
    }

    for s in sessions:
        end_ref = s.end_time or now
        mins, _ = calculate_duration_and_amount(s.start_time, end_ref, s.price_per_hour)
        rev = Decimal(s.payment.amount).quantize(Decimal("0.01")) if s.payment else Decimal("0.00")

        if s.tariff_id in t_stats:
            t_stats[s.tariff_id]["sessions"] += 1
            t_stats[s.tariff_id]["minutes"] += mins
            t_stats[s.tariff_id]["revenue"] += rev

        if s.workstation_id in w_stats:
            w_stats[s.workstation_id]["sessions"] += 1
            w_stats[s.workstation_id]["minutes"] += mins
            w_stats[s.workstation_id]["revenue"] += rev

    tariff_items = [
        schemas.TariffReportItem(
            tariff_id=t.tariff_id,
            name=t.name,
            workstation_type=t.workstation_type,
            price_per_hour=Decimal(t.price_per_hour).quantize(Decimal("0.01")),
            sessions_count=t_stats[t.tariff_id]["sessions"],
            hours=Decimal(t_stats[t.tariff_id]["minutes"] / 60.0).quantize(
                Decimal("0.1"), rounding=ROUND_HALF_UP
            ),
            revenue=t_stats[t.tariff_id]["revenue"].quantize(Decimal("0.01")),
        )
        for t in all_tariffs
    ]

    ws_items: list[schemas.WorkstationReportItem] = []
    for w in workstations:
        st = w_stats[w.workstation_id]
        occ = (
            Decimal(min(100.0, (st["minutes"] * 100.0) / period_minutes)).quantize(
                Decimal("0.1"), rounding=ROUND_HALF_UP
            )
            if w.status != "на ремонті" and period_minutes > 0
            else Decimal("0.0")
        )
        ws_items.append(
            schemas.WorkstationReportItem(
                workstation_id=w.workstation_id,
                club_id=w.club_id,
                club_name=w.club.name if w.club else "",
                number=w.number,
                type=w.type,
                status=w.status,
                sessions_count=st["sessions"],
                hours=Decimal(st["minutes"] / 60.0).quantize(
                    Decimal("0.1"), rounding=ROUND_HALF_UP
                ),
                revenue=st["revenue"].quantize(Decimal("0.01")),
                occupancy_percent=occ,
            )
        )

    if len(ws_items) >= 2:
        max_h = max(it.hours for it in ws_items)
        min_h = min(it.hours for it in ws_items)
        if max_h > min_h:
            for it in ws_items:
                if it.hours == max_h and max_h > 0:
                    it.is_most_loaded = True
                elif it.hours == min_h:
                    it.is_least_loaded = True

    if format_type == "csv":
        rows = [
            [
                it.club_name,
                it.number,
                it.type,
                it.sessions_count,
                f"{it.hours:.1f}".replace(".", ","),
                f"{it.revenue:.2f}".replace(".", ","),
                f"{it.occupancy_percent:.1f}".replace(".", ","),
            ]
            for it in ws_items
        ]
        return _csv_response(
            "report_workstations.csv",
            ["Клуб", "№ місця", "Тип", "Сеансів", "Годин", "Виручка (₴)", "Завантаженість (%)"],
            rows,
        )

    return schemas.TariffsReportResponse(
        date_from=d_from,
        date_to=d_to,
        tariffs=tariff_items,
        workstations=ws_items,
    )


@router.get("/clients")
def report_clients(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    granularity: str = Query(default="week"),
    format_type: str | None = Query(default=None, alias="format"),
    user: models.AppUser = Depends(require("reports", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    d_from, d_to = _resolve_dates(date_from, date_to)
    dt_from = datetime.combine(d_from, time.min)
    dt_to = datetime.combine(d_to, time.max)

    all_clients = db.scalars(select(models.Client)).all()
    client_map = {c.client_id: c for c in all_clients}

    sess_stmt = (
        select(models.GameSession)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .where(
            models.GameSession.start_time >= dt_from,
            models.GameSession.start_time <= dt_to,
            models.GameSession.status.in_(("активний", "завершений")),
        )
    )
    if effective_club_id is not None:
        sess_stmt = sess_stmt.where(models.Workstation.club_id == effective_club_id)
    sessions = db.scalars(sess_stmt).all()

    per_client: dict[int, dict[str, object]] = {}
    for s in sessions:
        entry = per_client.setdefault(
            s.client_id, {"sessions": 0, "spent": Decimal("0.00")}
        )
        entry["sessions"] = int(entry["sessions"]) + 1
        if s.payment:
            entry["spent"] = (Decimal(entry["spent"]) + Decimal(s.payment.amount)).quantize(
                Decimal("0.01")
            )

    active_count = len(per_client)
    returning_count = sum(1 for st in per_client.values() if int(st["sessions"]) >= 2)
    returning_pct = (
        (Decimal(returning_count) * Decimal(100) / Decimal(active_count)).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP
        )
        if active_count > 0
        else Decimal("0.0")
    )

    top_rows: list[schemas.TopClientItem] = []
    for cid, st in per_client.items():
        c = client_map.get(cid)
        if not c:
            continue
        top_rows.append(
            schemas.TopClientItem(
                client_id=cid,
                full_name=c.full_name,
                phone=c.phone,
                sessions_count=int(st["sessions"]),
                total_spent=Decimal(st["spent"]).quantize(Decimal("0.01")),
                bonus_balance=Decimal(c.bonus_balance).quantize(Decimal("0.01")),
            )
        )
    top_rows.sort(key=lambda x: (x.total_spent, x.sessions_count), reverse=True)
    top_10 = top_rows[:10]

    buckets = _generate_period_buckets(d_from, d_to, granularity)
    new_bucket_map = {
        k: schemas.NewClientsBucket(period_key=k, period_label=lbl, count=0)
        for k, lbl in buckets
    }
    new_in_period = 0
    for c in all_clients:
        if d_from <= c.reg_date <= d_to:
            new_in_period += 1
            pk, _ = _period_key_and_label(c.reg_date, granularity)
            if pk in new_bucket_map:
                new_bucket_map[pk].count += 1

    if format_type == "csv":
        rows = [
            [
                r.full_name,
                r.phone,
                r.sessions_count,
                f"{r.total_spent:.2f}".replace(".", ","),
                f"{r.bonus_balance:.2f}".replace(".", ","),
            ]
            for r in top_10
        ]
        return _csv_response(
            "report_clients.csv",
            ["ПІБ клієнта", "Телефон", "Сеансів за період", "Витрачено (₴)", "Бонусний баланс (₴)"],
            rows,
        )

    return schemas.ClientsReportResponse(
        date_from=d_from,
        date_to=d_to,
        total_clients=len(all_clients),
        new_clients_period=new_in_period,
        active_clients_period=active_count,
        returning_clients_count=returning_count,
        returning_share_percent=returning_pct,
        top_clients=top_10,
        new_clients_series=list(new_bucket_map.values()),
    )


@router.get("/tournaments")
def report_tournaments(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    format_type: str | None = Query(default=None, alias="format"),
    user: models.AppUser = Depends(require("reports", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    d_from, d_to = _resolve_dates(date_from, date_to)

    stmt = (
        select(models.Tournament)
        .where(
            models.Tournament.date >= d_from,
            models.Tournament.date <= d_to,
        )
        .order_by(models.Tournament.date.desc(), models.Tournament.tournament_id.desc())
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Tournament.club_id == effective_club_id)
    tournaments = db.scalars(stmt).all()

    items: list[schemas.TournamentReportRow] = []
    total_parts = 0
    total_prizes = Decimal("0.00")

    for t in tournaments:
        parts = list(t.participations or [])
        total_parts += len(parts)
        prize = Decimal(t.prize_fund).quantize(Decimal("0.01"))
        total_prizes += prize

        winner = next((p for p in parts if p.place == 1), None)
        winner_name = winner.client.full_name if winner and winner.client else None

        items.append(
            schemas.TournamentReportRow(
                tournament_id=t.tournament_id,
                name=t.name,
                game=t.game,
                club_name=t.club.name if t.club else "",
                date=t.date,
                status=_compute_tournament_status(t.date),
                participants_count=len(parts),
                prize_fund=prize,
                winner_name=winner_name,
            )
        )

    if format_type == "csv":
        rows = [
            [
                it.name,
                it.game,
                it.club_name,
                it.date.strftime("%d.%m.%Y"),
                it.participants_count,
                f"{it.prize_fund:.2f}".replace(".", ","),
                it.winner_name or "",
            ]
            for it in items
        ]
        return _csv_response(
            "report_tournaments.csv",
            ["Турнір", "Гра", "Клуб", "Дата", "Учасників", "Призовий фонд (₴)", "Переможець"],
            rows,
        )

    return schemas.TournamentsReportResponse(
        date_from=d_from,
        date_to=d_to,
        tournaments_count=len(items),
        participants_total=total_parts,
        prize_fund_total=total_prizes.quantize(Decimal("0.01")),
        items=items,
    )

