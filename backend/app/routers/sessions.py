from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..deps import ensure_club_access, get_active_user, require, scoped_club_id
from ..permissions import DIRECTOR, FULL, VIEW, allowed

router = APIRouter(prefix="/sessions", tags=["sessions"])


def calculate_duration_and_amount(
    start_time: datetime,
    end_time: datetime,
    price_per_hour: Decimal,
) -> tuple[int, Decimal]:
    """Бізнес-правило 6: хвилини = ceil((кінець - початок)/60), мінімум 1 хв; сума з округленням HALF_UP."""
    seconds = max(0.0, (end_time - start_time).total_seconds())
    minutes = max(1, math.ceil(seconds / 60.0))
    amount = (Decimal(minutes) * Decimal(price_per_hour) / Decimal(60)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return minutes, amount


def calculate_bonus_earned(amount: Decimal) -> Decimal:
    """Бізнес-правило 9: 5 % від суми оплати готівкою/карткою, округлення вниз до 0,01."""
    return (Decimal(amount) * Decimal(settings.bonus_rate)).quantize(
        Decimal("0.01"), rounding=ROUND_DOWN
    )


def _require_session_action(user: models.AppUser = Depends(get_active_user)) -> models.AppUser:
    if not (
        allowed(user.role, "sessions", FULL)
        or allowed(user.role, "hall", FULL)
        or user.role == DIRECTOR
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостатньо прав для цієї дії")
    return user


def _get_or_404(db: Session, session_id: int) -> models.GameSession:
    s = db.get(models.GameSession, session_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сеанс не знайдено")
    return s


def _to_session_read(
    s: models.GameSession,
    now: datetime | None = None,
    bonus_earned: Decimal | None = None,
    bonus_spent: Decimal | None = None,
) -> schemas.SessionRead:
    ref_now = now or datetime.now()
    ref_end = s.end_time or ref_now
    mins, calc_amount = calculate_duration_and_amount(s.start_time, ref_end, s.price_per_hour)
    if s.is_prepaid and s.planned_minutes is not None and s.end_time is None:
        mins = s.planned_minutes
    if s.status == "скасований":
        calc_amount = Decimal("0.00")

    remaining_seconds: int | None = None
    if s.status == "активний" and s.planned_end_time is not None:
        remaining_seconds = max(0, int((s.planned_end_time - ref_now).total_seconds()))

    pay = s.payment
    final_amount = Decimal(pay.amount).quantize(Decimal("0.01")) if pay else calc_amount

    if bonus_earned is None:
        if pay and pay.method in ("готівка", "картка"):
            bonus_earned = calculate_bonus_earned(pay.amount)
        else:
            bonus_earned = Decimal("0.00")
    if bonus_spent is None:
        if pay and pay.method == "бонуси":
            bonus_spent = Decimal(pay.amount).quantize(Decimal("0.01"))
        else:
            bonus_spent = Decimal("0.00")

    ws = s.workstation
    club = ws.club if ws else None
    client = s.client
    tariff = s.tariff

    return schemas.SessionRead(
        session_id=s.session_id,
        client_id=s.client_id,
        client_name=client.full_name if client else "",
        client_phone=client.phone if client else "",
        client_bonus_balance=Decimal(client.bonus_balance).quantize(Decimal("0.01"))
        if client
        else Decimal("0.00"),
        workstation_id=s.workstation_id,
        workstation_number=ws.number if ws else 0,
        workstation_type=ws.type if ws else "",
        club_id=ws.club_id if ws else 0,
        club_name=club.name if club else "",
        tariff_id=s.tariff_id,
        tariff_name=tariff.name if tariff else "",
        price_per_hour=Decimal(s.price_per_hour).quantize(Decimal("0.01")),
        start_time=s.start_time,
        end_time=s.end_time,
        planned_minutes=s.planned_minutes,
        planned_end_time=s.planned_end_time,
        is_prepaid=bool(s.is_prepaid),
        remaining_seconds=remaining_seconds,
        status=s.status,
        duration_minutes=mins,
        calculated_amount=final_amount,
        payment_id=pay.payment_id if pay else None,
        payment_amount=Decimal(pay.amount).quantize(Decimal("0.01")) if pay else None,
        payment_method=pay.method if pay else None,
        payment_date=pay.payment_date if pay else None,
        bonus_earned=bonus_earned,
        bonus_spent=bonus_spent,
    )


@router.get("", response_model=schemas.SessionListResponse)
def list_sessions(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    workstation_id: int | None = Query(default=None),
    tariff_id: int | None = Query(default=None),
    client_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    user: models.AppUser = Depends(require("sessions", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    stmt = (
        select(models.GameSession)
        .join(models.Workstation, models.GameSession.workstation_id == models.Workstation.workstation_id)
        .join(models.Client, models.GameSession.client_id == models.Client.client_id)
        .order_by(models.GameSession.start_time.desc(), models.GameSession.session_id.desc())
    )

    if effective_club_id is not None:
        stmt = stmt.where(models.Workstation.club_id == effective_club_id)
    if date_from is not None:
        stmt = stmt.where(models.GameSession.start_time >= datetime.combine(date_from, time.min))
    if date_to is not None:
        stmt = stmt.where(models.GameSession.start_time <= datetime.combine(date_to, time.max))
    if status_filter:
        stmt = stmt.where(models.GameSession.status == status_filter)
    if workstation_id is not None:
        stmt = stmt.where(models.GameSession.workstation_id == workstation_id)
    if tariff_id is not None:
        stmt = stmt.where(models.GameSession.tariff_id == tariff_id)
    if client_id is not None:
        stmt = stmt.where(models.GameSession.client_id == client_id)

    sessions = db.scalars(stmt).all()
    if q and q.strip():
        needle = q.strip().casefold()
        sessions = [
            s
            for s in sessions
            if needle in s.client.full_name.casefold()
            or needle in s.client.phone.casefold()
            or needle == str(s.session_id)
        ]

    now = datetime.now()
    all_reads = [_to_session_read(s, now=now) for s in sessions]

    total_count = len(all_reads)
    total_minutes = sum(
        r.duration_minutes for r in all_reads if r.status in ("активний", "завершений")
    )
    total_amount = sum(
        (r.payment_amount or Decimal("0.00"))
        for r in all_reads
        if r.status in ("активний", "завершений") and r.payment_amount is not None
    )

    sliced = all_reads[offset : offset + limit]
    return schemas.SessionListResponse(
        items=sliced,
        total=total_count,
        summary=schemas.SessionSummary(
            count=total_count,
            minutes=total_minutes,
            amount=Decimal(total_amount).quantize(Decimal("0.01")),
        ),
    )


@router.get("/{session_id}", response_model=schemas.SessionRead)
def get_session(
    session_id: int,
    user: models.AppUser = Depends(require("sessions", VIEW)),
    db: Session = Depends(get_db),
):
    s = _get_or_404(db, session_id)
    ensure_club_access(user, s.workstation.club_id)
    return _to_session_read(s)


@router.post("", response_model=schemas.SessionRead, status_code=status.HTTP_201_CREATED)
def start_session(
    data: schemas.SessionCreate,
    user: models.AppUser = Depends(_require_session_action),
    db: Session = Depends(get_db),
):
    ws = db.get(models.Workstation, data.workstation_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Робоче місце не знайдено")
    ensure_club_access(user, ws.club_id)

    # Правило 8.1 п. 2: без відкритої зміни не можна починати сеанси
    open_shift = db.scalar(
        select(models.Shift).where(
            models.Shift.club_id == ws.club_id,
            models.Shift.status == "відкрита",
        )
    )
    if open_shift is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Зміну не відкрито. Відкрийте зміну, щоб почати сеанс",
        )

    # Правило 4: місце на ремонті не можна використати для нового сеансу
    if ws.status == "на ремонті":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Місце перебуває на ремонті й недоступне для сеансу",
        )

    # Правило 2: не більше одного активного сеансу на місце
    existing_active = db.scalar(
        select(models.GameSession).where(
            models.GameSession.workstation_id == ws.workstation_id,
            models.GameSession.status == "активний",
        )
    )
    if ws.status == "зайняте" or existing_active is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Це місце щойно зайняли. Оновіть залу",
        )

    tariff = db.get(models.Tariff, data.tariff_id)
    if tariff is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тариф не знайдено")

    # Правило 3: тариф відповідає типу місця
    if tariff.workstation_type != ws.type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Тариф «{tariff.name}» ({tariff.workstation_type}) не відповідає типу місця ({ws.type})",
        )

    # Визначаємо або створюємо клієнта в тій самій транзакції
    if data.client_id is not None:
        client = db.get(models.Client, data.client_id)
        if client is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Клієнта не знайдено")
    elif data.new_client_name and data.new_client_phone:
        clean_name = data.new_client_name.strip()
        clean_phone = data.new_client_phone.strip()
        if not clean_name or not clean_phone:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Вкажіть ПІБ і номер телефону нового клієнта",
            )
        client = models.Client(
            full_name=clean_name,
            phone=clean_phone,
            reg_date=date.today(),
            bonus_balance=Decimal("0.00"),
        )
        db.add(client)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Клієнт з таким номером телефону вже існує",
            )
    else:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Оберіть клієнта або вкажіть ПІБ і телефон нового клієнта",
        )

    now = datetime.now()
    price_per_hour = Decimal(tariff.price_per_hour).quantize(Decimal("0.01"))
    planned_minutes: int | None = None
    planned_end_time: datetime | None = None
    is_prepaid = False
    fixed_amount: Decimal | None = None
    bonus_earned = Decimal("0.00")
    bonus_spent = Decimal("0.00")

    if data.planned_hours is not None:
        if not data.payment_method:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Оберіть спосіб оплати для фіксованого часу гри",
            )
        planned_minutes = max(15, int(round(float(data.planned_hours) * 60)))
        planned_end_time = now + timedelta(minutes=planned_minutes)
        fixed_amount = (
            Decimal(planned_minutes) * price_per_hour / Decimal(60)
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if data.payment_method == "бонуси":
            current_bonus = Decimal(client.bonus_balance).quantize(Decimal("0.01"))
            if current_bonus < fixed_amount:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Недостатньо бонусів для передоплати (доступно {current_bonus} ₴, потрібно {fixed_amount} ₴)",
                )
            client.bonus_balance = (current_bonus - fixed_amount).quantize(Decimal("0.01"))
            bonus_spent = fixed_amount
        else:
            bonus_earned = calculate_bonus_earned(fixed_amount)
            client.bonus_balance = (Decimal(client.bonus_balance) + bonus_earned).quantize(
                Decimal("0.01")
            )
        is_prepaid = True

    new_session = models.GameSession(
        client_id=client.client_id,
        workstation_id=ws.workstation_id,
        tariff_id=tariff.tariff_id,
        price_per_hour=price_per_hour,
        start_time=now,
        planned_minutes=planned_minutes,
        planned_end_time=planned_end_time,
        is_prepaid=is_prepaid,
        status="активний",
    )
    ws.status = "зайняте"
    db.add(new_session)
    try:
        db.flush()
        if is_prepaid and fixed_amount is not None and data.payment_method is not None:
            payment = models.Payment(
                session_id=new_session.session_id,
                shift_id=open_shift.shift_id,
                amount=fixed_amount,
                payment_date=now,
                method=data.payment_method,
            )
            db.add(payment)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Це місце щойно зайняли. Оновіть залу",
        )

    db.refresh(new_session)
    return _to_session_read(
        new_session,
        now=now,
        bonus_earned=bonus_earned,
        bonus_spent=bonus_spent,
    )


@router.post("/{session_id}/finish", response_model=schemas.SessionRead)
def finish_session(
    session_id: int,
    data: schemas.SessionFinishRequest,
    user: models.AppUser = Depends(_require_session_action),
    db: Session = Depends(get_db),
):
    s = _get_or_404(db, session_id)
    ensure_club_access(user, s.workstation.club_id)

    # Правило 1: зворотних переходів немає
    if s.status != "активний":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Сеанс уже завершено або скасовано",
        )

    now = datetime.now()
    # На випадок, якщо в тесті start_time випадково опиниться після now на мілісекунди
    if now < s.start_time:
        now = s.start_time

    # Якщо сеанс вже оплачений наперед — просто завершуємо його та звільняємо місце без повторної оплати
    if s.is_prepaid and s.payment is not None:
        s.end_time = now
        s.status = "завершений"
        s.workstation.status = "вільне"
        db.commit()
        db.refresh(s)
        return _to_session_read(s, now=now)

    if not data.method:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Оберіть спосіб оплати",
        )

    # Правило 8.1 п. 2 та п. 3: оплата прив'язується до відкритої зміни клубу в момент завершення
    open_shift = db.scalar(
        select(models.Shift).where(
            models.Shift.club_id == s.workstation.club_id,
            models.Shift.status == "відкрита",
        )
    )
    if open_shift is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Зміну не відкрито. Відкрийте зміну, щоб завершити сеанс і прийняти оплату",
        )

    _, amount = calculate_duration_and_amount(s.start_time, now, s.price_per_hour)
    client = s.client

    bonus_earned = Decimal("0.00")
    bonus_spent = Decimal("0.00")

    # Правило 9: бонуси (1 бонус = 1 ₴)
    if data.method == "бонуси":
        current_bonus = Decimal(client.bonus_balance).quantize(Decimal("0.01"))
        if current_bonus < amount:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Недостатньо бонусів для оплати сеансу (доступно {current_bonus} ₴, потрібно {amount} ₴)",
            )
        client.bonus_balance = (current_bonus - amount).quantize(Decimal("0.01"))
        bonus_spent = amount
    else:
        bonus_earned = calculate_bonus_earned(amount)
        client.bonus_balance = (Decimal(client.bonus_balance) + bonus_earned).quantize(
            Decimal("0.01")
        )

    # Правило 8: завершення сеансу, оплата, звільнення місця й рух бонусів — одна транзакція
    s.end_time = now
    s.status = "завершений"
    s.workstation.status = "вільне"

    payment = models.Payment(
        session_id=s.session_id,
        shift_id=open_shift.shift_id,
        amount=amount,
        payment_date=now,
        method=data.method,
    )
    db.add(payment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Оплата для цього сеансу вже зареєстрована",
        )

    db.refresh(s)
    return _to_session_read(s, now=now, bonus_earned=bonus_earned, bonus_spent=bonus_spent)


@router.post("/{session_id}/cancel", response_model=schemas.SessionRead)
def cancel_session(
    session_id: int,
    user: models.AppUser = Depends(_require_session_action),
    db: Session = Depends(get_db),
):
    s = _get_or_404(db, session_id)
    ensure_club_access(user, s.workstation.club_id)

    if s.status != "активний":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Сеанс уже завершено або скасовано",
        )

    if s.is_prepaid and s.payment is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Оплачений наперед сеанс не можна скасувати — завершіть його, щоб звільнити місце",
        )

    now = datetime.now()
    elapsed_seconds = max(0.0, (now - s.start_time).total_seconds())

    # Пункт 7.3: Адмін залу скасовує лише сеанси до 5 хвилин; довші скасовує лише Директор
    if user.role != DIRECTOR and elapsed_seconds > settings.cancel_window_minutes * 60:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Адміністратор залу може скасувати лише сеанс, що триває до {settings.cancel_window_minutes} хвилин. Зверніться до Директора",
        )

    s.end_time = now
    s.status = "скасований"
    s.workstation.status = "вільне"
    db.commit()
    db.refresh(s)
    return _to_session_read(s, now=now)

