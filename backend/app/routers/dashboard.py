from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..deps import require, scoped_club_id
from ..permissions import VIEW
from .payments import _to_payment_read
from .shifts import _to_shift_read, get_open_shift_for_club
from .tournaments import _to_tournament_read

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _sum_payments_between(
    db: Session,
    effective_club_id: int | None,
    dt_from: datetime,
    dt_to: datetime,
) -> Decimal:
    stmt = (
        select(func.coalesce(func.sum(models.Payment.amount), 0))
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
        stmt = stmt.where(models.Workstation.club_id == effective_club_id)
    val = db.scalar(stmt) or Decimal("0.00")
    return Decimal(val).quantize(Decimal("0.01"))


def _sum_expenses_between(
    db: Session,
    effective_club_id: int | None,
    d_from: date,
    d_to: date,
) -> Decimal:
    stmt = select(func.coalesce(func.sum(models.Expense.amount), 0)).where(
        models.Expense.expense_date >= d_from,
        models.Expense.expense_date <= d_to,
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Expense.club_id == effective_club_id)
    val = db.scalar(stmt) or Decimal("0.00")
    return Decimal(val).quantize(Decimal("0.01"))


@router.get("", response_model=schemas.DashboardResponse)
def get_dashboard(
    club_id: int | None = Query(default=None),
    user: models.AppUser = Depends(require("dashboard", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    now = datetime.now()
    today = date.today()
    yesterday = today - timedelta(days=1)

    # Виручка сьогодні та вчора
    rev_today = _sum_payments_between(
        db,
        effective_club_id,
        datetime.combine(today, time.min),
        datetime.combine(today, time.max),
    )
    rev_yesterday = _sum_payments_between(
        db,
        effective_club_id,
        datetime.combine(yesterday, time.min),
        datetime.combine(yesterday, time.max),
    )

    # Місячні показники
    month_start = today.replace(day=1)
    prev_month_end = month_start - timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)

    rev_month = _sum_payments_between(
        db,
        effective_club_id,
        datetime.combine(month_start, time.min),
        datetime.combine(today, time.max),
    )
    exp_month = _sum_expenses_between(db, effective_club_id, month_start, today)
    exp_prev_month = _sum_expenses_between(
        db, effective_club_id, prev_month_start, prev_month_end
    )
    profit_month = (rev_month - exp_month).quantize(Decimal("0.01"))

    # Робочі місця та активні сеанси
    ws_stmt = select(models.Workstation).order_by(
        models.Workstation.club_id, models.Workstation.number
    )
    if effective_club_id is not None:
        ws_stmt = ws_stmt.where(models.Workstation.club_id == effective_club_id)
    workstations = db.scalars(ws_stmt).all()

    active_stmt = (
        select(models.GameSession)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .where(models.GameSession.status == "активний")
    )
    if effective_club_id is not None:
        active_stmt = active_stmt.where(models.Workstation.club_id == effective_club_id)
    active_sessions_list = db.scalars(active_stmt).all()
    active_by_ws = {s.workstation_id: s for s in active_sessions_list}

    ws_total = len(workstations)
    ws_repair = sum(1 for w in workstations if w.status == "на ремонті")
    ws_available = max(0, ws_total - ws_repair)
    ws_busy = sum(1 for w in workstations if w.status == "зайняте")
    ws_free = sum(1 for w in workstations if w.status == "вільне")

    occupancy_pct = (
        (Decimal(ws_busy) * Decimal(100) / Decimal(ws_available)).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP
        )
        if ws_available > 0
        else Decimal("0.0")
    )

    workstations_now = [
        schemas.DashboardWorkstationMini(
            workstation_id=w.workstation_id,
            club_id=w.club_id,
            club_name=w.club.name if w.club else "",
            number=w.number,
            type=w.type,
            status=w.status,
            client_name=active_by_ws[w.workstation_id].client.full_name
            if w.workstation_id in active_by_ws and active_by_ws[w.workstation_id].client
            else None,
        )
        for w in workstations
    ]

    # Виручка за 14 днів
    revenue_14d: list[schemas.RevenueDayPoint] = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        amt = _sum_payments_between(
            db,
            effective_club_id,
            datetime.combine(d, time.min),
            datetime.combine(d, time.max),
        )
        revenue_14d.append(
            schemas.RevenueDayPoint(
                date=d,
                label=d.strftime("%d.%m"),
                amount=amt,
            )
        )

    # Нові клієнти за 7 і 30 днів
    new_7d = (
        db.scalar(
            select(func.count())
            .select_from(models.Client)
            .where(models.Client.reg_date >= today - timedelta(days=7))
        )
        or 0
    )
    new_30d = (
        db.scalar(
            select(func.count())
            .select_from(models.Client)
            .where(models.Client.reg_date >= today - timedelta(days=30))
        )
        or 0
    )

    # Найближчі турніри (до 3)
    trn_stmt = (
        select(models.Tournament)
        .where(models.Tournament.date >= today)
        .order_by(models.Tournament.date.asc(), models.Tournament.tournament_id.asc())
    )
    if effective_club_id is not None:
        trn_stmt = trn_stmt.where(models.Tournament.club_id == effective_club_id)
    upcoming_trn_models = db.scalars(trn_stmt).all()
    upcoming_tournaments = [_to_tournament_read(t, include_participants=False) for t in upcoming_trn_models[:3]]

    # Останні оплати (до 8)
    pay_stmt = (
        select(models.Payment)
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .order_by(models.Payment.payment_date.desc(), models.Payment.payment_id.desc())
        .limit(8)
    )
    if effective_club_id is not None:
        pay_stmt = pay_stmt.where(models.Workstation.club_id == effective_club_id)
    recent_payments = [_to_payment_read(p) for p in db.scalars(pay_stmt).all()]

    # Блок «Увага» (попередження з розділу 7.2)
    alerts: list[schemas.DashboardAlert] = []

    repair_ws = [w for w in workstations if w.status == "на ремонті"]
    if repair_ws:
        nums = ", ".join(f"№ {w.number}" for w in repair_ws[:5])
        alerts.append(
            schemas.DashboardAlert(
                key="ws_repair",
                text=f"Робочі місця на ремонті ({len(repair_ws)} шт.): {nums}",
                link="/workstations",
            )
        )

    long_sessions = [
        s
        for s in active_sessions_list
        if (now - s.start_time).total_seconds() > 8 * 3600
    ]
    for ls in long_sessions:
        hrs = int((now - ls.start_time).total_seconds() // 3600)
        alerts.append(
            schemas.DashboardAlert(
                key=f"long_session_{ls.session_id}",
                text=f"Активний сеанс № {ls.session_id} (місце № {ls.workstation.number}) триває понад {hrs} год — перевірте, чи не забули його завершити",
                link="/sessions",
            )
        )

    for trn in upcoming_trn_models:
        days_left = (trn.date - today).days
        if 0 <= days_left <= 2 and len(trn.participations) == 0:
            alerts.append(
                schemas.DashboardAlert(
                    key=f"empty_trn_{trn.tournament_id}",
                    text=f"Турнір «{trn.name}» відбудеться вже за {days_left} дн., але ще не має зареєстрованих учасників",
                    link=f"/tournaments/{trn.tournament_id}",
                )
            )

    if user.role in ("director", "accountant") and exp_month > rev_month:
        alerts.append(
            schemas.DashboardAlert(
                key="negative_profit",
                text=f"Витрати за поточний місяць ({exp_month} ₴) перевищують виручку ({rev_month} ₴)",
                link="/reports",
            )
        )

    # Поточна зміна, каса за вчора та попередження по змінах/Z-звітах (розділи 7.2 і 8.1 п. 13)
    target_shift_club_id = effective_club_id
    if target_shift_club_id is None:
        first_club = db.scalar(select(models.Club).order_by(models.Club.club_id.asc()))
        target_shift_club_id = first_club.club_id if first_club else None

    current_shift_mini = schemas.DashboardShiftMini(is_open=False)
    if target_shift_club_id is not None:
        c_obj = db.get(models.Club, target_shift_club_id)
        open_sh = get_open_shift_for_club(db, target_shift_club_id)
        if open_sh is not None:
            sh_read = _to_shift_read(db, open_sh, include_details=False)
            current_shift_mini = schemas.DashboardShiftMini(
                shift_id=sh_read.shift_id,
                club_id=sh_read.club_id,
                club_name=sh_read.club_name,
                is_open=True,
                z_label=sh_read.z_label,
                opened_at=sh_read.opened_at,
                opened_by_name=sh_read.opened_by_name,
                revenue_total=sh_read.revenue_total,
                expected_cash=sh_read.expected_cash,
            )
        elif c_obj is not None:
            current_shift_mini = schemas.DashboardShiftMini(
                club_id=c_obj.club_id,
                club_name=c_obj.name,
                is_open=False,
            )

    shifts_stmt = select(models.Shift).order_by(models.Shift.shift_id.desc())
    if effective_club_id is not None:
        shifts_stmt = shifts_stmt.where(models.Shift.club_id == effective_club_id)
    all_shifts = db.scalars(shifts_stmt).all()

    unreviewed_count = sum(
        1 for sh in all_shifts if sh.status == "закрита" and sh.review_status == "очікує"
    )

    yest_shifts = [
        sh for sh in all_shifts if sh.status == "закрита" and sh.business_date == yesterday
    ]
    yest_cash_sales = sum((Decimal(sh.cash_sales) for sh in yest_shifts), Decimal("0.00"))
    yest_card_sales = sum((Decimal(sh.card_sales) for sh in yest_shifts), Decimal("0.00"))
    yest_bonus_sales = sum((Decimal(sh.bonus_sales) for sh in yest_shifts), Decimal("0.00"))
    yest_diff = sum((Decimal(sh.cash_difference) for sh in yest_shifts), Decimal("0.00"))

    cash_yesterday = schemas.DashboardCashYesterday(
        revenue_total=(yest_cash_sales + yest_card_sales + yest_bonus_sales).quantize(
            Decimal("0.01")
        ),
        cash_sales=yest_cash_sales.quantize(Decimal("0.01")),
        cash_difference=yest_diff.quantize(Decimal("0.01")),
        shifts_count=len(yest_shifts),
    )

    for sh in all_shifts:
        if sh.status == "відкрита":
            hrs_open = (now - sh.opened_at).total_seconds() / 3600.0
            if hrs_open > 14:
                alerts.append(
                    schemas.DashboardAlert(
                        key=f"shift_long_{sh.shift_id}",
                        text=f"Зміна у клубі «{sh.club.name if sh.club else ''}» відкрита понад {int(hrs_open)} год — перевірте, чи не забули її закрити",
                        link="/shift",
                    )
                )
        elif sh.status == "закрита":
            z_lbl = f"Z-{sh.z_number:04d}" if sh.z_number is not None else f"№ {sh.shift_id}"
            if (
                sh.review_status == "очікує"
                and sh.closed_at is not None
                and (now - sh.closed_at).total_seconds() > 48 * 3600
            ):
                alerts.append(
                    schemas.DashboardAlert(
                        key=f"z_unreviewed_{sh.shift_id}",
                        text=f"Z-звіт {z_lbl} очікує перевірки бухгалтером понад 2 доби",
                        link=f"/cash/z/{sh.shift_id}",
                    )
                )
            if abs(Decimal(sh.cash_difference)) > Decimal(settings.cash_diff_alert):
                alerts.append(
                    schemas.DashboardAlert(
                        key=f"cash_diff_{sh.shift_id}",
                        text=f"У Z-звіті {z_lbl} зафіксовано розбіжність каси {Decimal(sh.cash_difference):.2f} ₴ (поріг {settings.cash_diff_alert} ₴)",
                        link=f"/cash/z/{sh.shift_id}",
                    )
                )

    return schemas.DashboardResponse(
        server_time=now,
        revenue_today=rev_today,
        revenue_yesterday=rev_yesterday,
        revenue_month=rev_month,
        active_sessions=len(active_sessions_list),
        workstations_total=ws_total,
        workstations_available=ws_available,
        workstations_free=ws_free,
        workstations_repair=ws_repair,
        occupancy_percent=occupancy_pct,
        expenses_month=exp_month,
        expenses_prev_month=exp_prev_month,
        profit_month=profit_month,
        new_clients_7d=int(new_7d),
        new_clients_30d=int(new_30d),
        revenue_14d=revenue_14d,
        workstations_now=workstations_now,
        upcoming_tournaments=upcoming_tournaments,
        recent_payments=recent_payments,
        alerts=alerts,
        current_shift=current_shift_mini,
        cash_yesterday=cash_yesterday,
        unreviewed_z_reports_count=unreviewed_count,
    )

