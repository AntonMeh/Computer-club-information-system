import csv
from datetime import date, datetime, time
from decimal import Decimal
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, require, scoped_club_id
from ..permissions import VIEW
from .sessions import calculate_duration_and_amount

router = APIRouter(prefix="/payments", tags=["payments"])


def _to_payment_read(p: models.Payment) -> schemas.PaymentRead:
    s = p.session
    ws = s.workstation if s else None
    club = ws.club if ws else None
    client = s.client if s else None
    tariff = s.tariff if s else None

    end_ref = s.end_time or p.payment_date
    mins, _ = calculate_duration_and_amount(s.start_time, end_ref, s.price_per_hour)

    return schemas.PaymentRead(
        payment_id=p.payment_id,
        session_id=p.session_id,
        amount=Decimal(p.amount).quantize(Decimal("0.01")),
        payment_date=p.payment_date,
        method=p.method,
        client_id=s.client_id if s else 0,
        client_name=client.full_name if client else "",
        client_phone=client.phone if client else "",
        club_id=ws.club_id if ws else 0,
        club_name=club.name if club else "",
        club_address=club.address if club else "",
        club_phone=club.phone if club else "",
        workstation_id=s.workstation_id if s else 0,
        workstation_number=ws.number if ws else 0,
        workstation_type=ws.type if ws else "",
        tariff_id=s.tariff_id if s else 0,
        tariff_name=tariff.name if tariff else "",
        price_per_hour=Decimal(s.price_per_hour).quantize(Decimal("0.01"))
        if s
        else Decimal("0.00"),
        start_time=s.start_time if s else p.payment_date,
        end_time=s.end_time if s else p.payment_date,
        duration_minutes=mins,
    )


def _filter_payments(
    db: Session,
    effective_club_id: int | None,
    date_from: date | None,
    date_to: date | None,
    method: str | None,
    q: str | None,
) -> list[schemas.PaymentRead]:
    stmt = (
        select(models.Payment)
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .join(
            models.Workstation,
            models.GameSession.workstation_id == models.Workstation.workstation_id,
        )
        .join(models.Client, models.GameSession.client_id == models.Client.client_id)
        .order_by(models.Payment.payment_date.desc(), models.Payment.payment_id.desc())
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Workstation.club_id == effective_club_id)
    if date_from is not None:
        stmt = stmt.where(models.Payment.payment_date >= datetime.combine(date_from, time.min))
    if date_to is not None:
        stmt = stmt.where(models.Payment.payment_date <= datetime.combine(date_to, time.max))
    if method:
        stmt = stmt.where(models.Payment.method == method)

    rows = db.scalars(stmt).all()
    items = [_to_payment_read(p) for p in rows]

    if q and q.strip():
        needle = q.strip().casefold()
        items = [
            it
            for it in items
            if needle in it.client_name.casefold()
            or needle in it.client_phone.casefold()
            or needle == str(it.payment_id)
            or needle == str(it.session_id)
        ]

    return items


@router.get("", response_model=schemas.PaymentListResponse)
def list_payments(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    method: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    user: models.AppUser = Depends(require("payments", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_payments(db, effective_club_id, date_from, date_to, method, q)

    total_sum = sum((it.amount for it in items), Decimal("0.00")).quantize(Decimal("0.01"))
    cash_sum = sum(
        (it.amount for it in items if it.method == "готівка"), Decimal("0.00")
    ).quantize(Decimal("0.01"))
    card_sum = sum(
        (it.amount for it in items if it.method == "картка"), Decimal("0.00")
    ).quantize(Decimal("0.01"))
    bonus_sum = sum(
        (it.amount for it in items if it.method == "бонуси"), Decimal("0.00")
    ).quantize(Decimal("0.01"))

    return schemas.PaymentListResponse(
        items=items[offset : offset + limit],
        total=len(items),
        summary=schemas.PaymentSummary(
            count=len(items),
            total=total_sum,
            cash=cash_sum,
            card=card_sum,
            bonus=bonus_sum,
        ),
    )


@router.get("/export.csv")
def export_payments_csv(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    method: str | None = Query(default=None),
    q: str | None = Query(default=None),
    user: models.AppUser = Depends(require("payments", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_payments(db, effective_club_id, date_from, date_to, method, q)

    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 BOM для коректного відкриття в Excel
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "№ оплати",
            "Дата і час",
            "Клуб",
            "Клієнт",
            "Телефон",
            "№ сеансу",
            "Місце",
            "Тип місця",
            "Тариф",
            "Тривалість (хв)",
            "Спосіб оплати",
            "Сума (₴)",
        ]
    )
    for it in items:
        writer.writerow(
            [
                it.payment_id,
                it.payment_date.strftime("%d.%m.%Y %H:%M"),
                it.club_name,
                it.client_name,
                it.client_phone,
                it.session_id,
                it.workstation_number,
                it.workstation_type,
                it.tariff_name,
                it.duration_minutes,
                it.method,
                f"{it.amount:.2f}".replace(".", ","),
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="payments.csv"'},
    )


@router.get("/{payment_id}", response_model=schemas.PaymentRead)
def get_payment(
    payment_id: int,
    user: models.AppUser = Depends(require("payments", VIEW)),
    db: Session = Depends(get_db),
):
    p = db.get(models.Payment, payment_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Оплату не знайдено")
    ensure_club_access(user, p.session.workstation.club_id)
    return _to_payment_read(p)

