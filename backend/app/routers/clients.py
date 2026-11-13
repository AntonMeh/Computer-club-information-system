from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require
from ..permissions import FULL, VIEW

router = APIRouter(prefix="/clients", tags=["clients"])

PHONE_TAKEN = "Клієнт з таким номером телефону вже існує"
CLIENT_HAS_HISTORY = "Є історія сеансів: видалити не можна"


def _get_or_404(db: Session, client_id: int) -> models.Client:
    client = db.get(models.Client, client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клієнта не знайдено")
    return client


def _enrich_client(db: Session, client: models.Client) -> schemas.ClientRead:
    sessions_count = db.scalar(
        select(func.count())
        .select_from(models.GameSession)
        .where(models.GameSession.client_id == client.client_id)
    ) or 0
    total_spent = db.scalar(
        select(func.coalesce(func.sum(models.Payment.amount), 0))
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .where(models.GameSession.client_id == client.client_id)
    ) or Decimal("0.00")
    paid_count = db.scalar(
        select(func.count())
        .select_from(models.Payment)
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .where(models.GameSession.client_id == client.client_id)
    ) or 0
    last_visit = db.scalar(
        select(func.max(models.GameSession.start_time)).where(
            models.GameSession.client_id == client.client_id
        )
    )
    total_spent_dec = Decimal(total_spent).quantize(Decimal("0.01"))
    avg_check = (
        (total_spent_dec / Decimal(paid_count)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if paid_count > 0
        else Decimal("0.00")
    )
    return schemas.ClientRead(
        client_id=client.client_id,
        full_name=client.full_name,
        phone=client.phone,
        email=client.email,
        reg_date=client.reg_date,
        bonus_balance=Decimal(client.bonus_balance).quantize(Decimal("0.01")),
        sessions_count=int(sessions_count),
        total_spent=total_spent_dec,
        avg_check=avg_check,
        last_visit=last_visit,
    )


@router.get("", response_model=list[schemas.ClientRead], dependencies=[Depends(require("clients", VIEW))])
def list_clients(
    q: str | None = Query(default=None),
    filter: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = select(models.Client).order_by(models.Client.client_id)
    if filter == "with_bonus":
        stmt = stmt.where(models.Client.bonus_balance > 0)
    elif filter == "new_30d":
        cutoff_date = date.today() - timedelta(days=30)
        stmt = stmt.where(models.Client.reg_date >= cutoff_date)

    clients = db.scalars(stmt).all()
    if q and q.strip():
        needle = q.strip().casefold()
        clients = [
            c
            for c in clients
            if needle in c.full_name.casefold()
            or needle in c.phone.casefold()
            or (c.email and needle in c.email.casefold())
        ]

    enriched = [_enrich_client(db, c) for c in clients]

    if filter == "inactive_30d":
        cutoff_dt = datetime.now() - timedelta(days=30)
        enriched = [
            c for c in enriched if c.last_visit is None or c.last_visit < cutoff_dt
        ]

    return enriched


@router.post(
    "",
    response_model=schemas.ClientRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require("clients", FULL))],
)
def create_client(data: schemas.ClientCreate, db: Session = Depends(get_db)):
    values = data.model_dump()
    values["reg_date"] = values["reg_date"] or date.today()
    client = models.Client(**values)
    db.add(client)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_TAKEN)
    db.refresh(client)
    return _enrich_client(db, client)


@router.get("/{client_id}", response_model=schemas.ClientRead, dependencies=[Depends(require("clients", VIEW))])
def get_client(client_id: int, db: Session = Depends(get_db)):
    return _enrich_client(db, _get_or_404(db, client_id))


@router.patch("/{client_id}", response_model=schemas.ClientRead, dependencies=[Depends(require("clients", FULL))])
def update_client(client_id: int, data: schemas.ClientUpdate, db: Session = Depends(get_db)):
    client = _get_or_404(db, client_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_TAKEN)
    db.refresh(client)
    return _enrich_client(db, client)


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require("clients", FULL))])
def delete_client(client_id: int, db: Session = Depends(get_db)):
    client = _get_or_404(db, client_id)
    has_sessions = db.scalar(
        select(func.count())
        .select_from(models.GameSession)
        .where(models.GameSession.client_id == client_id)
    )
    has_participations = db.scalar(
        select(func.count())
        .select_from(models.Participation)
        .where(models.Participation.client_id == client_id)
    )
    if has_sessions or has_participations:
        raise HTTPException(status.HTTP_409_CONFLICT, CLIENT_HAS_HISTORY)
    try:
        db.delete(client)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, CLIENT_HAS_HISTORY)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{client_id}/sessions",
    response_model=list[schemas.ClientSessionItem],
    dependencies=[Depends(require("clients", VIEW))],
)
def list_client_sessions(client_id: int, db: Session = Depends(get_db)):
    _get_or_404(db, client_id)
    sessions = db.scalars(
        select(models.GameSession)
        .where(models.GameSession.client_id == client_id)
        .order_by(models.GameSession.start_time.desc())
    ).all()
    return [
        schemas.ClientSessionItem(
            session_id=s.session_id,
            workstation_id=s.workstation_id,
            workstation_number=s.workstation.number,
            workstation_type=s.workstation.type,
            club_id=s.workstation.club_id,
            club_name=s.workstation.club.name if s.workstation.club else "",
            tariff_name=s.tariff.name if s.tariff else "",
            price_per_hour=s.price_per_hour,
            start_time=s.start_time,
            end_time=s.end_time,
            status=s.status,
            amount=s.payment.amount if s.payment else None,
            payment_method=s.payment.method if s.payment else None,
        )
        for s in sessions
    ]


@router.get(
    "/{client_id}/payments",
    response_model=list[schemas.ClientPaymentItem],
    dependencies=[Depends(require("clients", VIEW))],
)
def list_client_payments(client_id: int, db: Session = Depends(get_db)):
    _get_or_404(db, client_id)
    payments = db.scalars(
        select(models.Payment)
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .where(models.GameSession.client_id == client_id)
        .order_by(models.Payment.payment_date.desc())
    ).all()
    return [
        schemas.ClientPaymentItem(
            payment_id=p.payment_id,
            session_id=p.session_id,
            workstation_number=p.session.workstation.number,
            club_name=p.session.workstation.club.name if p.session.workstation.club else "",
            amount=p.amount,
            payment_date=p.payment_date,
            method=p.method,
        )
        for p in payments
    ]


@router.get(
    "/{client_id}/tournaments",
    response_model=list[schemas.ClientTournamentItem],
    dependencies=[Depends(require("clients", VIEW))],
)
def list_client_tournaments(client_id: int, db: Session = Depends(get_db)):
    _get_or_404(db, client_id)
    participations = db.scalars(
        select(models.Participation)
        .join(models.Tournament, models.Participation.tournament_id == models.Tournament.tournament_id)
        .where(models.Participation.client_id == client_id)
        .order_by(models.Tournament.date.desc())
    ).all()
    return [
        schemas.ClientTournamentItem(
            participation_id=part.participation_id,
            tournament_id=part.tournament_id,
            tournament_name=part.tournament.name,
            game=part.tournament.game,
            date=part.tournament.date,
            club_name=part.tournament.club.name if part.tournament.club else "",
            prize_fund=part.tournament.prize_fund,
            place=part.place,
        )
        for part in participations
    ]


@router.post(
    "/{client_id}/bonus-adjustment",
    response_model=schemas.ClientRead,
)
def adjust_client_bonus(
    client_id: int,
    data: schemas.BonusAdjustmentRequest,
    user: models.AppUser = Depends(require("clients", FULL)),
    db: Session = Depends(get_db),
):
    # Коригування бонусів вручну доступне лише Директору (п. 7.5 специфікації)
    if user.role != "director":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Коригування бонусів доступне лише Директору",
        )
    if data.delta == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Вкажіть ненульову суму зміни бонусів")

    client = _get_or_404(db, client_id)
    new_balance = Decimal(client.bonus_balance) + Decimal(data.delta)
    if new_balance < 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Баланс бонусів не може стати від'ємним",
        )
    client.bonus_balance = new_balance.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    db.commit()
    db.refresh(client)
    return _enrich_client(db, client)
