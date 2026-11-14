import csv
from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, get_active_user, scoped_club_id
from ..permissions import ACCOUNTANT, DIRECTOR, FULL, HALL_ADMIN, VIEW, allowed
from .payments import _to_payment_read
from .sessions import _to_session_read

router = APIRouter(tags=["shifts & cash"])

CENT = Decimal("0.01")


def _q2(val: Decimal | int | float | None) -> Decimal:
    if val is None:
        return Decimal("0.00")
    return Decimal(val).quantize(CENT, rounding=ROUND_HALF_UP)


def format_z_label(z_number: int | None, status_str: str = "закрита") -> str:
    if z_number is not None:
        return f"Z-{z_number:04d}"
    return "Триває" if status_str == "відкрита" else "Без номера"


def get_open_shift_for_club(db: Session, club_id: int) -> models.Shift | None:
    return db.scalar(
        select(models.Shift).where(
            models.Shift.club_id == club_id,
            models.Shift.status == "відкрита",
        )
    )


def require_open_shift_for_club(db: Session, club_id: int) -> models.Shift:
    shift = get_open_shift_for_club(db, club_id)
    if shift is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Зміну не відкрито. Відкрийте зміну, щоб виконувати операції в залі та касі",
        )
    return shift


def _next_z_number_for_club(db: Session, club_id: int) -> int:
    max_z = db.scalar(
        select(func.max(models.Shift.z_number)).where(models.Shift.club_id == club_id)
    )
    return int(max_z or 0) + 1


def _compute_live_shift_metrics(db: Session, shift: models.Shift, now: datetime | None = None) -> dict:
    """Обчислює показники зміни на льоту для відкритої зміни або повертає збережений знімок для закритої."""
    now = now or datetime.now()
    ref_end = shift.closed_at or now
    duration_mins = max(1, int((ref_end - shift.opened_at).total_seconds() // 60))

    payments = db.scalars(
        select(models.Payment)
        .where(models.Payment.shift_id == shift.shift_id)
        .order_by(models.Payment.payment_date.desc(), models.Payment.payment_id.desc())
    ).all()

    operations = db.scalars(
        select(models.CashOperation)
        .where(models.CashOperation.shift_id == shift.shift_id)
        .order_by(models.CashOperation.created_at.desc(), models.CashOperation.operation_id.desc())
    ).all()

    active_sessions = db.scalars(
        select(models.GameSession)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .where(
            models.Workstation.club_id == shift.club_id,
            models.GameSession.status == "активний",
        )
        .order_by(models.GameSession.start_time.asc())
    ).all()

    if shift.status == "закрита":
        cash_sales = _q2(shift.cash_sales)
        card_sales = _q2(shift.card_sales)
        bonus_sales = _q2(shift.bonus_sales)
        rev_total = _q2(cash_sales + card_sales + bonus_sales)
        payments_count = len(payments) or shift.sessions_completed
        avg_check = (
            _q2(rev_total / Decimal(payments_count))
            if payments_count > 0
            else Decimal("0.00")
        )
        return {
            "duration_minutes": duration_mins,
            "revenue_total": rev_total,
            "cash_sales": cash_sales,
            "card_sales": card_sales,
            "bonus_sales": bonus_sales,
            "avg_check": avg_check,
            "payments_count": len(payments),
            "sessions_completed": shift.sessions_completed,
            "sessions_cancelled": shift.sessions_cancelled,
            "sessions_carried_over": shift.sessions_carried_over,
            "active_sessions_now": len(active_sessions),
            "cash_in": _q2(shift.cash_in),
            "cash_out": _q2(shift.cash_out),
            "collection": _q2(shift.collection),
            "expected_cash": _q2(shift.expected_cash),
            "actual_cash": _q2(shift.actual_cash),
            "cash_difference": _q2(shift.cash_difference),
            "cash_left": _q2(shift.cash_left),
            "payments": payments,
            "operations": operations,
            "active_sessions": active_sessions,
        }

    # Для відкритої зміни рахуємо наживо
    cash_sales = sum(
        (_q2(p.amount) for p in payments if p.method == "готівка"), Decimal("0.00")
    )
    card_sales = sum(
        (_q2(p.amount) for p in payments if p.method == "картка"), Decimal("0.00")
    )
    bonus_sales = sum(
        (_q2(p.amount) for p in payments if p.method == "бонуси"), Decimal("0.00")
    )
    rev_total = _q2(cash_sales + card_sales + bonus_sales)
    payments_count = len(payments)
    avg_check = (
        _q2(rev_total / Decimal(payments_count)) if payments_count > 0 else Decimal("0.00")
    )

    cancelled_count = (
        db.scalar(
            select(func.count())
            .select_from(models.GameSession)
            .join(
                models.Workstation,
                models.GameSession.workstation_id == models.Workstation.workstation_id,
            )
            .where(
                models.Workstation.club_id == shift.club_id,
                models.GameSession.status == "скасований",
                models.GameSession.end_time >= shift.opened_at,
                models.GameSession.end_time <= ref_end,
            )
        )
        or 0
    )

    cash_in = sum(
        (_q2(op.amount) for op in operations if op.type == "внесення"), Decimal("0.00")
    )
    cash_out = sum(
        (_q2(op.amount) for op in operations if op.type == "вилучення"), Decimal("0.00")
    )
    collection = sum(
        (_q2(op.amount) for op in operations if op.type == "інкасація"), Decimal("0.00")
    )

    opening_cash = _q2(shift.opening_cash)
    expected_cash = _q2(opening_cash + cash_sales + cash_in - cash_out - collection)

    return {
        "duration_minutes": duration_mins,
        "revenue_total": rev_total,
        "cash_sales": _q2(cash_sales),
        "card_sales": _q2(card_sales),
        "bonus_sales": _q2(bonus_sales),
        "avg_check": avg_check,
        "payments_count": payments_count,
        "sessions_completed": payments_count,
        "sessions_cancelled": int(cancelled_count),
        "sessions_carried_over": len(active_sessions),
        "active_sessions_now": len(active_sessions),
        "cash_in": _q2(cash_in),
        "cash_out": _q2(cash_out),
        "collection": _q2(collection),
        "expected_cash": expected_cash,
        "actual_cash": expected_cash,
        "cash_difference": Decimal("0.00"),
        "cash_left": expected_cash,
        "payments": payments,
        "operations": operations,
        "active_sessions": active_sessions,
    }


def _to_operation_read(op: models.CashOperation) -> schemas.CashOperationRead:
    sh = op.shift
    club = op.club
    creator = op.created_by
    return schemas.CashOperationRead(
        operation_id=op.operation_id,
        shift_id=op.shift_id,
        shift_z_number=sh.z_number if sh else None,
        shift_label=format_z_label(sh.z_number if sh else None, sh.status if sh else "закрита"),
        club_id=op.club_id,
        club_name=club.name if club else "",
        type=op.type,
        amount=_q2(op.amount),
        category=op.category,
        comment=op.comment,
        created_at=op.created_at,
        created_by_user_id=op.created_by_user_id,
        created_by_name=creator.full_name if creator else "",
    )


def _to_shift_read(
    db: Session,
    shift: models.Shift,
    include_details: bool = False,
) -> schemas.ShiftRead | schemas.ShiftDetailResponse:
    m = _compute_live_shift_metrics(db, shift)
    club = shift.club
    next_z = (
        _next_z_number_for_club(db, shift.club_id) if shift.status == "відкрита" else shift.z_number
    )
    z_lbl = (
        f"Z-{shift.z_number:04d}"
        if shift.z_number is not None
        else f"Z-{next_z:04d} (проєкт)"
    )

    base_kwargs = dict(
        shift_id=shift.shift_id,
        club_id=shift.club_id,
        club_name=club.name if club else "",
        club_address=club.address if club else "",
        z_number=shift.z_number,
        z_label=z_lbl,
        next_z_number=next_z,
        business_date=shift.business_date,
        status=shift.status,
        opened_at=shift.opened_at,
        opened_by_user_id=shift.opened_by_user_id,
        opened_by_name=shift.opened_by.full_name if shift.opened_by else "",
        opening_cash=_q2(shift.opening_cash),
        opening_difference=_q2(shift.opening_difference),
        open_note=shift.open_note,
        closed_at=shift.closed_at,
        closed_by_user_id=shift.closed_by_user_id,
        closed_by_name=shift.closed_by.full_name if shift.closed_by else None,
        force_closed=bool(shift.force_closed),
        duration_minutes=m["duration_minutes"],
        revenue_total=m["revenue_total"],
        cash_sales=m["cash_sales"],
        card_sales=m["card_sales"],
        bonus_sales=m["bonus_sales"],
        avg_check=m["avg_check"],
        payments_count=m["payments_count"],
        sessions_completed=m["sessions_completed"],
        sessions_cancelled=m["sessions_cancelled"],
        sessions_carried_over=m["sessions_carried_over"],
        active_sessions_now=m["active_sessions_now"],
        cash_in=m["cash_in"],
        cash_out=m["cash_out"],
        collection=m["collection"],
        expected_cash=m["expected_cash"],
        actual_cash=m["actual_cash"],
        cash_difference=m["cash_difference"],
        cash_left=m["cash_left"],
        card_terminal_total=_q2(shift.card_terminal_total)
        if shift.card_terminal_total is not None
        else None,
        card_difference=_q2(shift.card_difference)
        if shift.card_difference is not None
        else None,
        close_note=shift.close_note,
        review_status=shift.review_status,
        reviewed_by_user_id=shift.reviewed_by_user_id,
        reviewed_by_name=shift.reviewed_by.full_name if shift.reviewed_by else None,
        reviewed_at=shift.reviewed_at,
        review_note=shift.review_note,
    )

    if not include_details:
        return schemas.ShiftRead(**base_kwargs)

    now = datetime.now()
    return schemas.ShiftDetailResponse(
        **base_kwargs,
        payments=[_to_payment_read(p) for p in m["payments"]],
        operations=[_to_operation_read(op) for op in m["operations"]],
        active_sessions=[_to_session_read(s, now=now) for s in m["active_sessions"]],
    )


def _require_shift_or_cash_view(user: models.AppUser = Depends(get_active_user)) -> models.AppUser:
    if not (allowed(user.role, "shift", VIEW) or allowed(user.role, "cash", VIEW)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостатньо прав для перегляду змін і каси")
    return user


def _require_shift_manage(user: models.AppUser = Depends(get_active_user)) -> models.AppUser:
    if user.role not in (DIRECTOR, HALL_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Відкривати, закривати зміну та проводити касові операції можуть лише Адміністратор залу або Директор",
        )
    return user


# ==============================================================================
# ЕНДПОІНТИ ЗМІН (/shifts)
# ==============================================================================
@router.get("/shifts/current", response_model=schemas.CurrentShiftStateResponse)
def get_current_shift(
    club_id: int | None = Query(default=None),
    user: models.AppUser = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    if effective_club_id is None:
        first_club = db.scalar(select(models.Club).order_by(models.Club.club_id.asc()))
        effective_club_id = first_club.club_id if first_club else None

    if effective_club_id is None:
        return schemas.CurrentShiftStateResponse(is_open=False)

    club = db.get(models.Club, effective_club_id)
    if club is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    open_shift = get_open_shift_for_club(db, club.club_id)
    last_closed = db.scalar(
        select(models.Shift)
        .where(
            models.Shift.club_id == club.club_id,
            models.Shift.status == "закрита",
        )
        .order_by(models.Shift.z_number.desc(), models.Shift.shift_id.desc())
    )

    suggested = _q2(last_closed.cash_left) if last_closed else Decimal("0.00")

    return schemas.CurrentShiftStateResponse(
        club_id=club.club_id,
        club_name=club.name,
        is_open=open_shift is not None,
        current_shift=_to_shift_read(db, open_shift, include_details=True)
        if open_shift
        else None,
        last_closed_shift=_to_shift_read(db, last_closed, include_details=False)
        if last_closed
        else None,
        suggested_opening_cash=suggested,
    )


@router.get("/shifts/current/x-report", response_model=schemas.ShiftDetailResponse)
def get_current_x_report(
    club_id: int | None = Query(default=None),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    if effective_club_id is None:
        first_club = db.scalar(select(models.Club).order_by(models.Club.club_id.asc()))
        effective_club_id = first_club.club_id if first_club else None
    if effective_club_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    open_shift = require_open_shift_for_club(db, effective_club_id)
    return _to_shift_read(db, open_shift, include_details=True)


@router.post("/shifts", response_model=schemas.ShiftDetailResponse, status_code=status.HTTP_201_CREATED)
def open_shift(
    data: schemas.ShiftOpenRequest,
    user: models.AppUser = Depends(_require_shift_manage),
    db: Session = Depends(get_db),
):
    target_club_id = user.club_id if user.club_id is not None else data.club_id
    if target_club_id is None:
        first_club = db.scalar(select(models.Club).order_by(models.Club.club_id.asc()))
        target_club_id = first_club.club_id if first_club else None

    if target_club_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Оберіть клуб для відкриття зміни")

    ensure_club_access(user, target_club_id)
    club = db.get(models.Club, target_club_id)
    if club is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    # Правило 8.1 п. 1: не більше однієї відкритої зміни на клуб
    existing = get_open_shift_for_club(db, club.club_id)
    if existing is not None:
        opener = existing.opened_by.full_name if existing.opened_by else "Адміністратор"
        t_str = existing.opened_at.strftime("%H:%M")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Зміну вже відкрито: {opener}, {t_str}",
        )

    last_closed = db.scalar(
        select(models.Shift)
        .where(
            models.Shift.club_id == club.club_id,
            models.Shift.status == "закрита",
        )
        .order_by(models.Shift.z_number.desc(), models.Shift.shift_id.desc())
    )
    prev_cash_left = _q2(last_closed.cash_left) if last_closed else Decimal("0.00")
    opening_cash = _q2(data.opening_cash)
    diff = _q2(opening_cash - prev_cash_left)

    clean_comment = (data.comment or "").strip() or None
    # Правило 8.1 п. 4: якщо сума відрізняється від залишку попередньої зміни — коментар обов'язковий
    if last_closed is not None and diff != Decimal("0.00") and not clean_comment:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Сума на початок ({opening_cash} ₴) відрізняється від залишку попередньої зміни ({prev_cash_left} ₴). Вкажіть причину в коментарі",
        )

    now = datetime.now()
    new_shift = models.Shift(
        club_id=club.club_id,
        z_number=None,
        business_date=now.date(),
        status="відкрита",
        opened_at=now,
        opened_by_user_id=user.user_id,
        opening_cash=opening_cash,
        opening_difference=diff if last_closed is not None else Decimal("0.00"),
        open_note=clean_comment,
        expected_cash=opening_cash,
        actual_cash=opening_cash,
        cash_left=opening_cash,
        review_status="очікує",
    )
    db.add(new_shift)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Зміну в цьому клубі вже відкрито")

    db.refresh(new_shift)
    return _to_shift_read(db, new_shift, include_details=True)


@router.post("/shifts/{shift_id}/close", response_model=schemas.ShiftDetailResponse)
def close_shift(
    shift_id: int,
    data: schemas.ShiftCloseRequest,
    user: models.AppUser = Depends(_require_shift_manage),
    db: Session = Depends(get_db),
):
    shift = db.get(models.Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зміну не знайдено")
    ensure_club_access(user, shift.club_id)

    if shift.status != "відкрита":
        raise HTTPException(status.HTTP_409_CONFLICT, "Цю зміну вже закрито")

    now = datetime.now()
    m = _compute_live_shift_metrics(db, shift, now=now)

    expected_cash = _q2(m["expected_cash"])
    actual_cash = _q2(data.actual_cash)
    cash_diff = _q2(actual_cash - expected_cash)
    collection_amt = _q2(data.collection)

    clean_comment = (data.comment or "").strip() or None
    # Правило 8.1 п. 6: за будь-якої різниці коментар обов'язковий
    if cash_diff != Decimal("0.00") and not clean_comment:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Фактична готівка ({actual_cash} ₴) не збігається з очікуваною ({expected_cash} ₴). Вкажіть пояснення розбіжності в коментарі",
        )

    if collection_amt > actual_cash:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Сума інкасації ({collection_amt} ₴) не може перевищувати фактичну готівку в касі ({actual_cash} ₴)",
        )

    # Якщо при закритті здають виручку (collection > 0), автоматично створюємо операцію інкасації
    total_collection = _q2(m["collection"] + collection_amt)
    if collection_amt > Decimal("0.00"):
        db.add(
            models.CashOperation(
                shift_id=shift.shift_id,
                club_id=shift.club_id,
                type="інкасація",
                amount=collection_amt,
                category=None,
                comment=clean_comment or "Інкасація при закритті зміни",
                created_at=now,
                created_by_user_id=user.user_id,
            )
        )

    cash_left = _q2(actual_cash - collection_amt)

    card_term = _q2(data.card_terminal_total) if data.card_terminal_total is not None else None
    card_diff = _q2(card_term - m["card_sales"]) if card_term is not None else None

    # Правило 8.1 п. 8: присвоєння z_number та збереження знімка показників в одній транзакції
    shift.z_number = _next_z_number_for_club(db, shift.club_id)
    shift.status = "закрита"
    shift.closed_at = now
    shift.closed_by_user_id = user.user_id
    shift.force_closed = False

    shift.cash_sales = m["cash_sales"]
    shift.card_sales = m["card_sales"]
    shift.bonus_sales = m["bonus_sales"]
    shift.sessions_completed = m["sessions_completed"]
    shift.sessions_cancelled = m["sessions_cancelled"]
    shift.sessions_carried_over = m["sessions_carried_over"]
    shift.cash_in = m["cash_in"]
    shift.cash_out = m["cash_out"]
    shift.collection = total_collection

    shift.expected_cash = expected_cash
    shift.actual_cash = actual_cash
    shift.cash_difference = cash_diff
    shift.cash_left = cash_left
    shift.card_terminal_total = card_term
    shift.card_difference = card_diff
    shift.close_note = clean_comment
    shift.review_status = "очікує"

    db.commit()
    db.refresh(shift)
    return _to_shift_read(db, shift, include_details=True)


@router.post("/shifts/{shift_id}/force-close", response_model=schemas.ShiftDetailResponse)
def force_close_shift(
    shift_id: int,
    data: schemas.ShiftForceCloseRequest,
    user: models.AppUser = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    # Правило 8.1 п. 9: примусово закрити зміну може лише Директор
    if user.role != DIRECTOR:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Примусове закриття зміни дозволено лише Директору",
        )

    shift = db.get(models.Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зміну не знайдено")
    ensure_club_access(user, shift.club_id)

    if shift.status != "відкрита":
        raise HTTPException(status.HTTP_409_CONFLICT, "Цю зміну вже закрито")

    now = datetime.now()
    m = _compute_live_shift_metrics(db, shift, now=now)
    expected_cash = _q2(m["expected_cash"])

    shift.z_number = _next_z_number_for_club(db, shift.club_id)
    shift.status = "закрита"
    shift.closed_at = now
    shift.closed_by_user_id = user.user_id
    shift.force_closed = True

    shift.cash_sales = m["cash_sales"]
    shift.card_sales = m["card_sales"]
    shift.bonus_sales = m["bonus_sales"]
    shift.sessions_completed = m["sessions_completed"]
    shift.sessions_cancelled = m["sessions_cancelled"]
    shift.sessions_carried_over = m["sessions_carried_over"]
    shift.cash_in = m["cash_in"]
    shift.cash_out = m["cash_out"]
    shift.collection = m["collection"]

    shift.expected_cash = expected_cash
    shift.actual_cash = expected_cash
    shift.cash_difference = Decimal("0.00")
    shift.cash_left = expected_cash
    shift.close_note = data.comment.strip()
    shift.review_status = "очікує"

    db.commit()
    db.refresh(shift)
    return _to_shift_read(db, shift, include_details=True)


@router.post("/shifts/{shift_id}/review", response_model=schemas.ShiftDetailResponse)
def review_shift(
    shift_id: int,
    data: schemas.ShiftReviewRequest,
    user: models.AppUser = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    # Правило 8.1 п. 10: підтверджує Бухгалтер або Директор
    if user.role not in (ACCOUNTANT, DIRECTOR):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Підтверджувати Z-звіти можуть лише Бухгалтер або Директор",
        )

    shift = db.get(models.Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зміну не знайдено")
    ensure_club_access(user, shift.club_id)

    if shift.status != "закрита":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Підтвердити можна лише закриту зміну зі сформованим Z-звітом",
        )

    shift.review_status = "підтверджена"
    shift.reviewed_by_user_id = user.user_id
    shift.reviewed_at = datetime.now()
    shift.review_note = (data.note or "").strip() or None
    db.commit()
    db.refresh(shift)
    return _to_shift_read(db, shift, include_details=True)


@router.delete("/shifts/{shift_id}/review", response_model=schemas.ShiftDetailResponse)
def unreview_shift(
    shift_id: int,
    user: models.AppUser = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    # Правило 8.1 п. 10: зняти підтвердження може лише Директор
    if user.role != DIRECTOR:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Зняти підтвердження Z-звіту може лише Директор",
        )

    shift = db.get(models.Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зміну не знайдено")
    ensure_club_access(user, shift.club_id)

    shift.review_status = "очікує"
    shift.reviewed_by_user_id = None
    shift.reviewed_at = None
    shift.review_note = None
    db.commit()
    db.refresh(shift)
    return _to_shift_read(db, shift, include_details=True)


def _filter_shifts(
    db: Session,
    effective_club_id: int | None,
    date_from: date | None,
    date_to: date | None,
    review_status: str | None,
    with_difference: bool | None,
    force_closed: bool | None,
) -> list[schemas.ShiftRead]:
    stmt = select(models.Shift).order_by(
        models.Shift.opened_at.desc(), models.Shift.shift_id.desc()
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Shift.club_id == effective_club_id)
    if date_from is not None:
        stmt = stmt.where(models.Shift.business_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(models.Shift.business_date <= date_to)
    if review_status:
        stmt = stmt.where(models.Shift.review_status == review_status)
    if force_closed is True:
        stmt = stmt.where(models.Shift.force_closed.is_(True))

    rows = db.scalars(stmt).all()
    items = [_to_shift_read(db, s, include_details=False) for s in rows]
    if with_difference is True:
        items = [
            it
            for it in items
            if it.cash_difference != Decimal("0.00")
            or it.opening_difference != Decimal("0.00")
        ]
    return items


@router.get("/shifts", response_model=schemas.ShiftListResponse)
def list_shifts(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    review_status: str | None = Query(default=None),
    with_difference: bool | None = Query(default=None),
    force_closed: bool | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_shifts(
        db,
        effective_club_id,
        date_from,
        date_to,
        review_status,
        with_difference,
        force_closed,
    )

    unrev_stmt = select(func.count()).select_from(models.Shift).where(
        models.Shift.status == "закрита",
        models.Shift.review_status == "очікує",
    )
    if effective_club_id is not None:
        unrev_stmt = unrev_stmt.where(models.Shift.club_id == effective_club_id)
    unreviewed_count = int(db.scalar(unrev_stmt) or 0)

    return schemas.ShiftListResponse(
        items=items[offset : offset + limit],
        total=len(items),
        unreviewed_count=unreviewed_count,
    )


@router.get("/shifts/export.csv")
def export_shifts_csv(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    review_status: str | None = Query(default=None),
    with_difference: bool | None = Query(default=None),
    force_closed: bool | None = Query(default=None),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_shifts(
        db,
        effective_club_id,
        date_from,
        date_to,
        review_status,
        with_difference,
        force_closed,
    )

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "Z-номер",
            "Клуб",
            "Дата зміни",
            "Статус",
            "Відкрито",
            "Закрито",
            "Відкрив",
            "Закрив",
            "Виручка (₴)",
            "Готівка (₴)",
            "Картка (₴)",
            "Бонуси (₴)",
            "Очікувана готівка (₴)",
            "Фактична готівка (₴)",
            "Розбіжність (₴)",
            "Залишок у касі (₴)",
            "Перевірка",
        ]
    )
    for it in items:
        writer.writerow(
            [
                it.z_label,
                it.club_name,
                it.business_date.strftime("%d.%m.%Y"),
                it.status,
                it.opened_at.strftime("%d.%m.%Y %H:%M"),
                it.closed_at.strftime("%d.%m.%Y %H:%M") if it.closed_at else "Триває",
                it.opened_by_name,
                it.closed_by_name or "—",
                f"{it.revenue_total:.2f}".replace(".", ","),
                f"{it.cash_sales:.2f}".replace(".", ","),
                f"{it.card_sales:.2f}".replace(".", ","),
                f"{it.bonus_sales:.2f}".replace(".", ","),
                f"{it.expected_cash:.2f}".replace(".", ","),
                f"{it.actual_cash:.2f}".replace(".", ","),
                f"{it.cash_difference:.2f}".replace(".", ","),
                f"{it.cash_left:.2f}".replace(".", ","),
                it.review_status,
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="shifts_z_reports.csv"'},
    )


@router.get("/shifts/{shift_id}", response_model=schemas.ShiftDetailResponse)
def get_shift_detail(
    shift_id: int,
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    shift = db.get(models.Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Зміну не знайдено")
    ensure_club_access(user, shift.club_id)
    return _to_shift_read(db, shift, include_details=True)


# ==============================================================================
# ЕНДПОІНТИ СЛУЖБОВИХ ОПЕРАЦІЙ (/cash-operations) ТА ДЕННОЇ КАСИ (/cash/daily)
# ==============================================================================
@router.post(
    "/cash-operations",
    response_model=schemas.CashOperationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_cash_operation(
    data: schemas.CashOperationCreate,
    user: models.AppUser = Depends(_require_shift_manage),
    db: Session = Depends(get_db),
):
    target_club_id = user.club_id if user.club_id is not None else data.club_id
    if target_club_id is None:
        first_club = db.scalar(select(models.Club).order_by(models.Club.club_id.asc()))
        target_club_id = first_club.club_id if first_club else None
    if target_club_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Оберіть клуб")

    ensure_club_access(user, target_club_id)

    # Правило 8.1 п. 2: без відкритої зміни службові операції заборонені (409)
    open_shift = require_open_shift_for_club(db, target_club_id)

    clean_comment = (data.comment or "").strip() or None
    clean_category = (data.category or "").strip() or None

    if data.type == "вилучення":
        if clean_category not in schemas.CASH_WITHDRAWAL_CATEGORIES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Для вилучення вкажіть категорію: {', '.join(schemas.CASH_WITHDRAWAL_CATEGORIES)}",
            )
        if not clean_comment:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Коментар обов'язковий для службового вилучення готівки",
            )
    elif data.type == "інкасація":
        clean_category = None
        if not clean_comment:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Коментар обов'язковий для операції інкасації",
            )
    else:
        clean_category = None

    # Правило 8.1 п. 5: вилучення чи інкасація не можуть перевищувати поточну очікувану готівку в касі
    metrics = _compute_live_shift_metrics(db, open_shift)
    expected_cash = _q2(metrics["expected_cash"])
    amt = _q2(data.amount)

    if data.type in ("вилучення", "інкасація") and amt > expected_cash:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"У касі лише {expected_cash} ₴ — недостатньо готівки для цієї операції",
        )

    op = models.CashOperation(
        shift_id=open_shift.shift_id,
        club_id=open_shift.club_id,
        type=data.type,
        amount=amt,
        category=clean_category,
        comment=clean_comment,
        created_at=datetime.now(),
        created_by_user_id=user.user_id,
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    return _to_operation_read(op)


def _filter_cash_operations(
    db: Session,
    effective_club_id: int | None,
    shift_id: int | None,
    date_from: date | None,
    date_to: date | None,
    op_type: str | None,
    category: str | None,
) -> list[schemas.CashOperationRead]:
    stmt = select(models.CashOperation).order_by(
        models.CashOperation.created_at.desc(), models.CashOperation.operation_id.desc()
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.CashOperation.club_id == effective_club_id)
    if shift_id is not None:
        stmt = stmt.where(models.CashOperation.shift_id == shift_id)
    if date_from is not None:
        stmt = stmt.where(models.CashOperation.created_at >= datetime.combine(date_from, time.min))
    if date_to is not None:
        stmt = stmt.where(models.CashOperation.created_at <= datetime.combine(date_to, time.max))
    if op_type:
        stmt = stmt.where(models.CashOperation.type == op_type)
    if category:
        stmt = stmt.where(models.CashOperation.category == category)

    rows = db.scalars(stmt).all()
    return [_to_operation_read(r) for r in rows]


@router.get("/cash-operations", response_model=schemas.CashOperationListResponse)
def list_cash_operations(
    club_id: int | None = Query(default=None),
    shift_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type_filter: str | None = Query(default=None, alias="type"),
    category: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_cash_operations(
        db, effective_club_id, shift_id, date_from, date_to, type_filter, category
    )

    cash_in = sum(
        (it.amount for it in items if it.type == "внесення"), Decimal("0.00")
    )
    cash_out = sum(
        (it.amount for it in items if it.type == "вилучення"), Decimal("0.00")
    )
    coll = sum(
        (it.amount for it in items if it.type == "інкасація"), Decimal("0.00")
    )

    return schemas.CashOperationListResponse(
        items=items[offset : offset + limit],
        total=len(items),
        summary=schemas.CashOperationSummary(
            count=len(items),
            cash_in=_q2(cash_in),
            cash_out=_q2(cash_out),
            collection=_q2(coll),
        ),
    )


@router.get("/cash-operations/export.csv")
def export_cash_operations_csv(
    club_id: int | None = Query(default=None),
    shift_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type_filter: str | None = Query(default=None, alias="type"),
    category: str | None = Query(default=None),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_cash_operations(
        db, effective_club_id, shift_id, date_from, date_to, type_filter, category
    )

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        ["№", "Дата і час", "Клуб", "Зміна", "Тип", "Сума (₴)", "Категорія", "Коментар", "Хто створив"]
    )
    for it in items:
        writer.writerow(
            [
                it.operation_id,
                it.created_at.strftime("%d.%m.%Y %H:%M"),
                it.club_name,
                it.shift_label,
                it.type,
                f"{it.amount:.2f}".replace(".", ","),
                it.category or "—",
                it.comment or "—",
                it.created_by_name,
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="cash_operations.csv"'},
    )


def _build_daily_cash(
    db: Session,
    effective_club_id: int | None,
    date_from: date | None,
    date_to: date | None,
) -> schemas.DailyCashResponse:
    stmt = select(models.Shift).order_by(
        models.Shift.business_date.desc(),
        models.Shift.club_id.asc(),
        models.Shift.opened_at.asc(),
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Shift.club_id == effective_club_id)
    if date_from is not None:
        stmt = stmt.where(models.Shift.business_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(models.Shift.business_date <= date_to)

    all_shifts = db.scalars(stmt).all()
    grouped: dict[tuple[date, int], list[schemas.ShiftRead]] = {}
    for s in all_shifts:
        sr = _to_shift_read(db, s, include_details=False)
        grouped.setdefault((sr.business_date, sr.club_id), []).append(sr)

    rows: list[schemas.DailyCashRow] = []
    for (b_date, c_id), sh_list in grouped.items():
        rev = sum((x.revenue_total for x in sh_list), Decimal("0.00"))
        c_sales = sum((x.cash_sales for x in sh_list), Decimal("0.00"))
        card_s = sum((x.card_sales for x in sh_list), Decimal("0.00"))
        bon_s = sum((x.bonus_sales for x in sh_list), Decimal("0.00"))
        c_in = sum((x.cash_in for x in sh_list), Decimal("0.00"))
        c_out = sum((x.cash_out for x in sh_list), Decimal("0.00"))
        coll = sum((x.collection for x in sh_list), Decimal("0.00"))
        diff = sum((x.cash_difference for x in sh_list), Decimal("0.00"))
        has_open = any(x.status == "відкрита" for x in sh_list)
        end_cash_left = sh_list[-1].cash_left

        rows.append(
            schemas.DailyCashRow(
                business_date=b_date,
                club_id=c_id,
                club_name=sh_list[0].club_name,
                shifts_count=len(sh_list),
                has_open_shift=has_open,
                revenue_total=_q2(rev),
                cash_sales=_q2(c_sales),
                card_sales=_q2(card_s),
                bonus_sales=_q2(bon_s),
                cash_in=_q2(c_in),
                cash_out=_q2(c_out),
                collection=_q2(coll),
                cash_difference=_q2(diff),
                cash_left_end_of_day=_q2(end_cash_left),
                shifts=sh_list,
            )
        )

    rows.sort(key=lambda r: (r.business_date, r.club_id), reverse=True)

    summary = schemas.DailyCashSummary(
        days_count=len(rows),
        shifts_count=sum(r.shifts_count for r in rows),
        revenue_total=_q2(sum((r.revenue_total for r in rows), Decimal("0.00"))),
        cash_sales=_q2(sum((r.cash_sales for r in rows), Decimal("0.00"))),
        card_sales=_q2(sum((r.card_sales for r in rows), Decimal("0.00"))),
        bonus_sales=_q2(sum((r.bonus_sales for r in rows), Decimal("0.00"))),
        cash_in=_q2(sum((r.cash_in for r in rows), Decimal("0.00"))),
        cash_out=_q2(sum((r.cash_out for r in rows), Decimal("0.00"))),
        collection=_q2(sum((r.collection for r in rows), Decimal("0.00"))),
        cash_difference=_q2(sum((r.cash_difference for r in rows), Decimal("0.00"))),
    )
    return schemas.DailyCashResponse(items=rows, summary=summary)


@router.get("/cash/daily", response_model=schemas.DailyCashResponse)
def get_daily_cash(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    return _build_daily_cash(db, effective_club_id, date_from, date_to)


@router.get("/cash/daily/export.csv")
def export_daily_cash_csv(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    user: models.AppUser = Depends(_require_shift_or_cash_view),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    res = _build_daily_cash(db, effective_club_id, date_from, date_to)

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "Дата",
            "Клуб",
            "Кількість змін",
            "Статус дня",
            "Виручка (₴)",
            "Готівка (₴)",
            "Картка (₴)",
            "Бонуси (₴)",
            "Внесення (₴)",
            "Вилучення (₴)",
            "Інкасація (₴)",
            "Розбіжність (₴)",
            "Залишок на кінець дня (₴)",
        ]
    )
    for r in res.items:
        writer.writerow(
            [
                r.business_date.strftime("%d.%m.%Y"),
                r.club_name,
                r.shifts_count,
                "День не закрито" if r.has_open_shift else "Закрито",
                f"{r.revenue_total:.2f}".replace(".", ","),
                f"{r.cash_sales:.2f}".replace(".", ","),
                f"{r.card_sales:.2f}".replace(".", ","),
                f"{r.bonus_sales:.2f}".replace(".", ","),
                f"{r.cash_in:.2f}".replace(".", ","),
                f"{r.cash_out:.2f}".replace(".", ","),
                f"{r.collection:.2f}".replace(".", ","),
                f"{r.cash_difference:.2f}".replace(".", ","),
                f"{r.cash_left_end_of_day:.2f}".replace(".", ","),
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="daily_cash.csv"'},
    )
