import csv
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, get_active_user, scoped_club_id
from ..permissions import ACCOUNTANT, DIRECTOR, HALL_ADMIN, VIEW, allowed

router = APIRouter(prefix="/payroll", tags=["payroll & accounting"])

CENT = Decimal("0.01")


def _q2(val: Decimal | int | float | None) -> Decimal:
    if val is None:
        return Decimal("0.00")
    return Decimal(val).quantize(CENT, rounding=ROUND_HALF_UP)


def _require_payroll_view(user: models.AppUser = Depends(get_active_user)) -> models.AppUser:
    if not (
        allowed(user.role, "cash", VIEW)
        or allowed(user.role, "staff", VIEW)
        or user.role in (DIRECTOR, ACCOUNTANT, HALL_ADMIN)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Недостатньо прав для перегляду зарплатної відомості",
        )
    return user


def _require_payroll_manage(user: models.AppUser = Depends(get_active_user)) -> models.AppUser:
    if user.role not in (DIRECTOR, ACCOUNTANT):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Керувати табелем годин і виплатами зарплати можуть лише Бухгалтер або Директор",
        )
    return user


def sync_closed_shifts_to_work_logs(db: Session, club_id: int | None = None) -> None:
    """Автоматично переносить відпрацьовані години із закритих касових змін у табель співробітника."""
    stmt = select(models.Shift).where(models.Shift.status == "закрита")
    if club_id is not None:
        stmt = stmt.where(models.Shift.club_id == club_id)
    shifts = db.scalars(stmt).all()

    existing_shift_ids = set(
        db.scalars(
            select(models.StaffWorkLog.shift_id).where(
                models.StaffWorkLog.shift_id.is_not(None)
            )
        ).all()
    )

    added = False
    for sh in shifts:
        if sh.shift_id in existing_shift_ids:
            continue
        opener = sh.opened_by
        if not opener or not opener.staff_id:
            continue
        staff_member = db.get(models.Staff, opener.staff_id)
        if not staff_member:
            continue

        ref_end = sh.closed_at or datetime.now()
        mins = max(15, int((ref_end - sh.opened_at).total_seconds() // 60))
        hours = min(Decimal("24.00"), max(Decimal("0.25"), _q2(Decimal(mins) / Decimal(60))))
        default_rate = schemas.DEFAULT_POSITION_RATES.get(
            staff_member.position, Decimal("160.00")
        )
        rate = _q2(
            staff_member.hourly_rate
            if staff_member.hourly_rate is not None
            else default_rate
        )
        z_lbl = f"Z-{sh.z_number:04d}" if sh.z_number is not None else f"#{sh.shift_id}"

        db.add(
            models.StaffWorkLog(
                staff_id=staff_member.staff_id,
                club_id=sh.club_id,
                shift_id=sh.shift_id,
                work_date=sh.business_date,
                hours_worked=hours,
                hourly_rate_snapshot=rate,
                bonus_amount=Decimal("0.00"),
                comment=f"Касова зміна {z_lbl}",
                created_at=sh.closed_at or sh.opened_at,
                created_by_user_id=sh.opened_by_user_id,
            )
        )
        existing_shift_ids.add(sh.shift_id)
        added = True

    if added:
        db.commit()


def _to_work_log_read(log: models.StaffWorkLog) -> schemas.WorkLogRead:
    staff = log.staff
    club = log.club
    sh = log.shift
    hours = _q2(log.hours_worked)
    rate = _q2(log.hourly_rate_snapshot)
    base_pay = _q2(hours * rate)
    bonus = _q2(log.bonus_amount)
    total_pay = _q2(base_pay + bonus)
    sh_label = None
    if sh:
        sh_label = f"Z-{sh.z_number:04d}" if sh.z_number is not None else f"Зміна #{sh.shift_id}"

    return schemas.WorkLogRead(
        log_id=log.log_id,
        staff_id=log.staff_id,
        staff_name=staff.full_name if staff else "",
        position=staff.position if staff else "",
        club_id=log.club_id,
        club_name=club.name if club else "",
        shift_id=log.shift_id,
        shift_label=sh_label,
        work_date=log.work_date,
        hours_worked=hours,
        hourly_rate_snapshot=rate,
        base_pay=base_pay,
        bonus_amount=bonus,
        total_pay=total_pay,
        comment=log.comment,
        created_at=log.created_at,
    )


def _to_payout_read(p: models.PayrollPayout) -> schemas.PayrollPayoutRead:
    staff = p.staff
    club = p.club
    payer = p.paid_by
    return schemas.PayrollPayoutRead(
        payout_id=p.payout_id,
        staff_id=p.staff_id,
        staff_name=staff.full_name if staff else "",
        position=staff.position if staff else "",
        club_id=p.club_id,
        club_name=club.name if club else "",
        expense_id=p.expense_id,
        period_from=p.period_from,
        period_to=p.period_to,
        hours_paid=_q2(p.hours_paid),
        base_amount=_q2(p.base_amount),
        bonus_amount=_q2(p.bonus_amount),
        amount_paid=_q2(p.amount_paid),
        payment_method=p.payment_method,
        paid_at=p.paid_at,
        paid_by_name=payer.full_name if payer else None,
        note=p.note,
    )


def _build_payroll_report(
    db: Session,
    effective_club_id: int | None,
    date_from: date,
    date_to: date,
    position: str | None = None,
) -> schemas.PayrollReportResponse:
    sync_closed_shifts_to_work_logs(db, effective_club_id)

    staff_stmt = select(models.Staff).order_by(models.Staff.club_id, models.Staff.staff_id)
    if effective_club_id is not None:
        staff_stmt = staff_stmt.where(models.Staff.club_id == effective_club_id)
    if position:
        staff_stmt = staff_stmt.where(models.Staff.position == position)
    staff_members = db.scalars(staff_stmt).all()

    logs_stmt = (
        select(models.StaffWorkLog)
        .where(
            models.StaffWorkLog.work_date >= date_from,
            models.StaffWorkLog.work_date <= date_to,
        )
        .order_by(
            models.StaffWorkLog.work_date.desc(),
            models.StaffWorkLog.log_id.desc(),
        )
    )
    if effective_club_id is not None:
        logs_stmt = logs_stmt.where(models.StaffWorkLog.club_id == effective_club_id)
    all_logs = db.scalars(logs_stmt).all()

    payouts_stmt = (
        select(models.PayrollPayout)
        .where(
            models.PayrollPayout.period_to >= date_from,
            models.PayrollPayout.period_from <= date_to,
        )
        .order_by(
            models.PayrollPayout.paid_at.desc(),
            models.PayrollPayout.payout_id.desc(),
        )
    )
    if effective_club_id is not None:
        payouts_stmt = payouts_stmt.where(models.PayrollPayout.club_id == effective_club_id)
    all_payouts = db.scalars(payouts_stmt).all()

    logs_by_staff: dict[int, list[schemas.WorkLogRead]] = {}
    for lg in all_logs:
        logs_by_staff.setdefault(lg.staff_id, []).append(_to_work_log_read(lg))

    payouts_by_staff: dict[int, list[schemas.PayrollPayoutRead]] = {}
    for po in all_payouts:
        payouts_by_staff.setdefault(po.staff_id, []).append(_to_payout_read(po))

    rows: list[schemas.StaffPayrollRow] = []
    for m in staff_members:
        default_rate = schemas.DEFAULT_POSITION_RATES.get(m.position, Decimal("160.00"))
        rate = _q2(m.hourly_rate if m.hourly_rate is not None else default_rate)
        m_logs = logs_by_staff.get(m.staff_id, [])
        m_payouts = payouts_by_staff.get(m.staff_id, [])

        hours_worked = _q2(sum((x.hours_worked for x in m_logs), Decimal("0.00")))
        base_pay = _q2(sum((x.base_pay for x in m_logs), Decimal("0.00")))
        bonus_pay = _q2(sum((x.bonus_amount for x in m_logs), Decimal("0.00")))
        total_accrued = _q2(base_pay + bonus_pay)
        total_paid = _q2(sum((x.amount_paid for x in m_payouts), Decimal("0.00")))
        balance_due = _q2(max(Decimal("0.00"), total_accrued - total_paid))

        if total_accrued <= Decimal("0.00") and total_paid <= Decimal("0.00"):
            st = "немає нарахувань"
        elif balance_due <= Decimal("0.00"):
            st = "виплачено"
        elif total_paid > Decimal("0.00"):
            st = "частково"
        else:
            st = "очікує виплати"

        rows.append(
            schemas.StaffPayrollRow(
                staff_id=m.staff_id,
                full_name=m.full_name,
                position=m.position,
                club_id=m.club_id,
                club_name=m.club.name if m.club else "",
                hire_date=m.hire_date,
                hourly_rate=rate,
                shifts_count=len(m_logs),
                hours_worked=hours_worked,
                base_pay=base_pay,
                bonus_pay=bonus_pay,
                total_accrued=total_accrued,
                total_paid=total_paid,
                balance_due=balance_due,
                status=st,
                work_logs=m_logs,
                payouts=m_payouts,
            )
        )

    summary = schemas.PayrollSummary(
        staff_count=len(rows),
        total_hours=_q2(sum((r.hours_worked for r in rows), Decimal("0.00"))),
        total_base_pay=_q2(sum((r.base_pay for r in rows), Decimal("0.00"))),
        total_bonus_pay=_q2(sum((r.bonus_pay for r in rows), Decimal("0.00"))),
        total_accrued=_q2(sum((r.total_accrued for r in rows), Decimal("0.00"))),
        total_paid=_q2(sum((r.total_paid for r in rows), Decimal("0.00"))),
        total_balance_due=_q2(sum((r.balance_due for r in rows), Decimal("0.00"))),
    )

    recent_payouts = [_to_payout_read(po) for po in all_payouts[:30]]

    return schemas.PayrollReportResponse(
        date_from=date_from,
        date_to=date_to,
        summary=summary,
        items=rows,
        recent_payouts=recent_payouts,
    )


@router.get("", response_model=schemas.PayrollReportResponse)
def get_payroll_report(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    position: str | None = Query(default=None),
    user: models.AppUser = Depends(_require_payroll_view),
    db: Session = Depends(get_db),
):
    today = date.today()
    d_from = date_from or date(today.year, today.month, 1)
    d_to = date_to or today
    effective_club_id = scoped_club_id(user, club_id)
    return _build_payroll_report(db, effective_club_id, d_from, d_to, position)


@router.post(
    "/work-logs",
    response_model=schemas.WorkLogRead,
    status_code=status.HTTP_201_CREATED,
)
def create_work_log(
    data: schemas.WorkLogCreate,
    user: models.AppUser = Depends(_require_payroll_manage),
    db: Session = Depends(get_db),
):
    staff = db.get(models.Staff, data.staff_id)
    if staff is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Співробітника не знайдено")
    ensure_club_access(user, staff.club_id)

    default_rate = schemas.DEFAULT_POSITION_RATES.get(staff.position, Decimal("160.00"))
    rate = _q2(staff.hourly_rate if staff.hourly_rate is not None else default_rate)

    log = models.StaffWorkLog(
        staff_id=staff.staff_id,
        club_id=staff.club_id,
        shift_id=None,
        work_date=data.work_date or date.today(),
        hours_worked=_q2(data.hours_worked),
        hourly_rate_snapshot=rate,
        bonus_amount=_q2(data.bonus_amount),
        comment=(data.comment or "").strip() or "Робоча зміна за табелем",
        created_at=datetime.now(),
        created_by_user_id=user.user_id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _to_work_log_read(log)


@router.delete("/work-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_log(
    log_id: int,
    user: models.AppUser = Depends(_require_payroll_manage),
    db: Session = Depends(get_db),
):
    log = db.get(models.StaffWorkLog, log_id)
    if log is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис табеля не знайдено")
    ensure_club_access(user, log.club_id)
    if log.shift_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Цей запис сформовано автоматично із закритої касової зміни і не може бути видалений",
        )
    db.delete(log)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/payouts",
    response_model=schemas.PayrollPayoutRead,
    status_code=status.HTTP_201_CREATED,
)
def create_payroll_payout(
    data: schemas.PayrollPayoutCreate,
    user: models.AppUser = Depends(_require_payroll_manage),
    db: Session = Depends(get_db),
):
    staff = db.get(models.Staff, data.staff_id)
    if staff is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Співробітника не знайдено")
    ensure_club_access(user, staff.club_id)

    amount_paid = _q2(data.amount_paid)
    hours_paid = _q2(data.hours_paid)
    base_amount = _q2(data.base_amount)
    bonus_amount = _q2(data.bonus_amount)
    clean_note = (data.note or "").strip() or None

    expense_id = None
    if data.create_expense:
        desc = f"Зарплата: {staff.full_name} ({hours_paid} год)"
        if clean_note:
            desc = f"{desc} — {clean_note}"
        exp = models.Expense(
            club_id=staff.club_id,
            category="зарплата",
            amount=amount_paid,
            expense_date=date.today(),
            description=desc[:200],
        )
        db.add(exp)
        db.flush()
        expense_id = exp.expense_id

    payout = models.PayrollPayout(
        staff_id=staff.staff_id,
        club_id=staff.club_id,
        expense_id=expense_id,
        period_from=data.period_from,
        period_to=data.period_to,
        hours_paid=hours_paid,
        base_amount=base_amount,
        bonus_amount=bonus_amount,
        amount_paid=amount_paid,
        payment_method=data.payment_method,
        paid_at=datetime.now(),
        paid_by_user_id=user.user_id,
        note=clean_note,
    )
    db.add(payout)
    db.commit()
    db.refresh(payout)
    return _to_payout_read(payout)


@router.get("/export.csv")
def export_payroll_csv(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    position: str | None = Query(default=None),
    user: models.AppUser = Depends(_require_payroll_view),
    db: Session = Depends(get_db),
):
    today = date.today()
    d_from = date_from or date(today.year, today.month, 1)
    d_to = date_to or today
    effective_club_id = scoped_club_id(user, club_id)
    report = _build_payroll_report(db, effective_club_id, d_from, d_to, position)

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "ПІБ співробітника",
            "Посада",
            "Клуб",
            "Ставка (₴/год)",
            "К-сть змін",
            "Відпрацьовано годин",
            "Нараховано за години (₴)",
            "Премії (₴)",
            "Разом нараховано (₴)",
            "Виплачено (₴)",
            "До виплати (₴)",
            "Статус",
        ]
    )
    for r in report.items:
        writer.writerow(
            [
                r.full_name,
                r.position,
                r.club_name,
                f"{r.hourly_rate:.2f}".replace(".", ","),
                r.shifts_count,
                f"{r.hours_worked:.2f}".replace(".", ","),
                f"{r.base_pay:.2f}".replace(".", ","),
                f"{r.bonus_pay:.2f}".replace(".", ","),
                f"{r.total_accrued:.2f}".replace(".", ","),
                f"{r.total_paid:.2f}".replace(".", ","),
                f"{r.balance_due:.2f}".replace(".", ","),
                r.status,
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="payroll_statement.csv"'},
    )
