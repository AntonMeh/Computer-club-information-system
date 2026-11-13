from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require
from ..permissions import FULL, VIEW

router = APIRouter(prefix="/clubs", tags=["clubs"])


def _get_or_404(db: Session, club_id: int) -> models.Club:
    club = db.get(models.Club, club_id)
    if club is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")
    return club


def sync_club_pc_count(db: Session, club_id: int) -> None:
    """Автоматично оновлює club.pc_count за фактичною кількістю робочих місць клубу."""
    club = db.get(models.Club, club_id)
    if club is not None:
        count = db.scalar(
            select(func.count()).select_from(models.Workstation).where(models.Workstation.club_id == club_id)
        )
        club.pc_count = int(count or 0)


def _enrich_club(db: Session, club: models.Club, month_start: datetime) -> schemas.ClubRead:
    ws_count = db.scalar(
        select(func.count()).select_from(models.Workstation).where(models.Workstation.club_id == club.club_id)
    ) or 0
    staff_count = db.scalar(
        select(func.count()).select_from(models.Staff).where(models.Staff.club_id == club.club_id)
    ) or 0
    rev_month = db.scalar(
        select(func.coalesce(func.sum(models.Payment.amount), 0))
        .join(models.GameSession, models.Payment.session_id == models.GameSession.session_id)
        .join(models.Workstation, models.GameSession.workstation_id == models.Workstation.workstation_id)
        .where(
            models.Workstation.club_id == club.club_id,
            models.Payment.payment_date >= month_start,
        )
    ) or Decimal("0.00")

    return schemas.ClubRead(
        club_id=club.club_id,
        name=club.name,
        address=club.address,
        phone=club.phone,
        pc_count=club.pc_count,
        workstations_count=int(ws_count),
        staff_count=int(staff_count),
        revenue_month=Decimal(rev_month).quantize(Decimal("0.01")),
    )


def _plural_uk(n: int, one: str, few: str, many: str) -> str:
    mod10 = n % 10
    mod100 = n % 100
    if mod10 == 1 and mod100 != 11:
        return f"{n} {one}"
    if 2 <= mod10 <= 4 and not (12 <= mod100 <= 14):
        return f"{n} {few}"
    return f"{n} {many}"


@router.get("", response_model=list[schemas.ClubRead], dependencies=[Depends(require("clubs", VIEW))])
def list_clubs(db: Session = Depends(get_db)):
    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)
    clubs = db.scalars(select(models.Club).order_by(models.Club.club_id)).all()
    return [_enrich_club(db, c, month_start) for c in clubs]


@router.post(
    "",
    response_model=schemas.ClubRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require("clubs", FULL))],
)
def create_club(data: schemas.ClubCreate, db: Session = Depends(get_db)):
    club = models.Club(**data.model_dump())
    db.add(club)
    db.commit()
    db.refresh(club)
    now = datetime.now()
    return _enrich_club(db, club, datetime(now.year, now.month, 1))


@router.get("/{club_id}", response_model=schemas.ClubRead, dependencies=[Depends(require("clubs", VIEW))])
def get_club(club_id: int, db: Session = Depends(get_db)):
    club = _get_or_404(db, club_id)
    now = datetime.now()
    return _enrich_club(db, club, datetime(now.year, now.month, 1))


@router.patch("/{club_id}", response_model=schemas.ClubRead, dependencies=[Depends(require("clubs", FULL))])
def update_club(club_id: int, data: schemas.ClubUpdate, db: Session = Depends(get_db)):
    club = _get_or_404(db, club_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(club, field, value)
    db.commit()
    db.refresh(club)
    now = datetime.now()
    return _enrich_club(db, club, datetime(now.year, now.month, 1))


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require("clubs", FULL))])
def delete_club(club_id: int, db: Session = Depends(get_db)):
    club = _get_or_404(db, club_id)

    ws_count = db.scalar(
        select(func.count()).select_from(models.Workstation).where(models.Workstation.club_id == club_id)
    ) or 0
    staff_count = db.scalar(
        select(func.count()).select_from(models.Staff).where(models.Staff.club_id == club_id)
    ) or 0
    tourn_count = db.scalar(
        select(func.count()).select_from(models.Tournament).where(models.Tournament.club_id == club_id)
    ) or 0
    exp_count = db.scalar(
        select(func.count()).select_from(models.Expense).where(models.Expense.club_id == club_id)
    ) or 0
    user_count = db.scalar(
        select(func.count()).select_from(models.AppUser).where(models.AppUser.club_id == club_id)
    ) or 0

    parts = []
    if ws_count:
        parts.append(_plural_uk(ws_count, "місце", "місця", "місць"))
    if staff_count:
        parts.append(_plural_uk(staff_count, "співробітник", "співробітники", "співробітників"))
    if tourn_count:
        parts.append(_plural_uk(tourn_count, "турнір", "турніри", "турнірів"))
    if exp_count:
        parts.append(_plural_uk(exp_count, "витрата", "витрати", "витрат"))
    if user_count:
        parts.append(_plural_uk(user_count, "користувач", "користувачі", "користувачів"))

    if parts:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Клуб неможливо видалити: {', '.join(parts)}",
        )

    try:
        db.delete(club)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Клуб неможливо видалити: є пов'язані записи",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
