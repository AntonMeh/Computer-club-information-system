from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, require, scoped_club_id
from ..permissions import FULL, VIEW

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _compute_tournament_status(t_date: date) -> str:
    today = date.today()
    if t_date > today:
        return "майбутній"
    if t_date == today:
        return "сьогодні"
    return "завершений"


def _get_or_404(db: Session, tournament_id: int) -> models.Tournament:
    t = db.get(models.Tournament, tournament_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Турнір не знайдено")
    return t


def _to_participant_read(part: models.Participation) -> schemas.ParticipantRead:
    return schemas.ParticipantRead(
        participation_id=part.participation_id,
        tournament_id=part.tournament_id,
        client_id=part.client_id,
        client_name=part.client.full_name if part.client else "",
        client_phone=part.client.phone if part.client else "",
        place=part.place,
    )


def _to_tournament_read(t: models.Tournament, include_participants: bool = True) -> schemas.TournamentRead:
    parts = list(t.participations or [])
    # Сортуємо: спочатку ті, у кого є зайняте місце (1, 2, 3...), потім за participation_id
    parts.sort(key=lambda p: (p.place is None, p.place or 999999, p.participation_id))
    return schemas.TournamentRead(
        tournament_id=t.tournament_id,
        club_id=t.club_id,
        club_name=t.club.name if t.club else "",
        name=t.name,
        game=t.game,
        date=t.date,
        prize_fund=Decimal(t.prize_fund).quantize(Decimal("0.01")),
        status=_compute_tournament_status(t.date),
        participants_count=len(parts),
        participants=[_to_participant_read(p) for p in parts] if include_participants else [],
    )


@router.get("", response_model=list[schemas.TournamentRead])
def list_tournaments(
    club_id: int | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    user: models.AppUser = Depends(require("tournaments", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    stmt = select(models.Tournament).order_by(
        models.Tournament.date.desc(), models.Tournament.tournament_id.desc()
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Tournament.club_id == effective_club_id)

    tournaments = db.scalars(stmt).all()
    items = [_to_tournament_read(t, include_participants=True) for t in tournaments]

    if status_filter and status_filter != "all":
        if status_filter == "upcoming":
            items = [it for it in items if it.status in ("майбутній", "сьогодні")]
        elif status_filter == "completed":
            items = [it for it in items if it.status == "завершений"]
        else:
            items = [it for it in items if it.status == status_filter]

    return items


@router.post("", response_model=schemas.TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(
    data: schemas.TournamentCreate,
    user: models.AppUser = Depends(require("tournaments", FULL)),
    db: Session = Depends(get_db),
):
    ensure_club_access(user, data.club_id)
    if db.get(models.Club, data.club_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    t = models.Tournament(
        club_id=data.club_id,
        name=data.name.strip(),
        game=data.game.strip(),
        date=data.date,
        prize_fund=Decimal(data.prize_fund).quantize(Decimal("0.01")),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _to_tournament_read(t)


@router.get("/{tournament_id}", response_model=schemas.TournamentRead)
def get_tournament(
    tournament_id: int,
    user: models.AppUser = Depends(require("tournaments", VIEW)),
    db: Session = Depends(get_db),
):
    t = _get_or_404(db, tournament_id)
    ensure_club_access(user, t.club_id)
    return _to_tournament_read(t, include_participants=True)


@router.patch("/{tournament_id}", response_model=schemas.TournamentRead)
def update_tournament(
    tournament_id: int,
    data: schemas.TournamentUpdate,
    user: models.AppUser = Depends(require("tournaments", FULL)),
    db: Session = Depends(get_db),
):
    t = _get_or_404(db, tournament_id)
    ensure_club_access(user, t.club_id)

    updates = data.model_dump(exclude_unset=True)
    if "club_id" in updates and updates["club_id"] is not None:
        ensure_club_access(user, updates["club_id"])
        if db.get(models.Club, updates["club_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    for field, value in updates.items():
        if value is not None:
            if field in ("name", "game") and isinstance(value, str):
                value = value.strip()
            setattr(t, field, value)

    db.commit()
    db.refresh(t)
    return _to_tournament_read(t)


@router.delete("/{tournament_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tournament(
    tournament_id: int,
    user: models.AppUser = Depends(require("tournaments", FULL)),
    db: Session = Depends(get_db),
):
    t = _get_or_404(db, tournament_id)
    ensure_club_access(user, t.club_id)

    if len(t.participations) > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Неможливо видалити турнір, у якому вже зареєстровано учасників ({len(t.participations)})",
        )

    db.delete(t)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{tournament_id}/participants",
    response_model=schemas.ParticipantRead,
    status_code=status.HTTP_201_CREATED,
)
def add_participant(
    tournament_id: int,
    data: schemas.ParticipantCreate,
    user: models.AppUser = Depends(require("tournaments", FULL)),
    db: Session = Depends(get_db),
):
    t = _get_or_404(db, tournament_id)
    ensure_club_access(user, t.club_id)

    client = db.get(models.Client, data.client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клієнта не знайдено")

    existing = db.scalar(
        select(models.Participation).where(
            models.Participation.tournament_id == tournament_id,
            models.Participation.client_id == data.client_id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Клієнт уже зареєстрований",
        )

    if data.place is not None:
        taken = db.scalar(
            select(models.Participation).where(
                models.Participation.tournament_id == tournament_id,
                models.Participation.place == data.place,
            )
        )
        if taken is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Місце № {data.place} уже присуджено іншому учаснику цього турніру",
            )

    part = models.Participation(
        tournament_id=tournament_id,
        client_id=data.client_id,
        place=data.place,
    )
    db.add(part)
    db.commit()
    db.refresh(part)
    return _to_participant_read(part)


@router.patch(
    "/{tournament_id}/participants/{participation_id}",
    response_model=schemas.ParticipantRead,
)
def update_participant(
    tournament_id: int,
    participation_id: int,
    data: schemas.ParticipantUpdate,
    user: models.AppUser = Depends(require("tournaments", FULL)),
    db: Session = Depends(get_db),
):
    t = _get_or_404(db, tournament_id)
    ensure_club_access(user, t.club_id)

    part = db.get(models.Participation, participation_id)
    if part is None or part.tournament_id != tournament_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Учасника не знайдено")

    if data.place is not None:
        taken = db.scalar(
            select(models.Participation).where(
                models.Participation.tournament_id == tournament_id,
                models.Participation.place == data.place,
                models.Participation.participation_id != participation_id,
            )
        )
        if taken is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Місце № {data.place} уже присуджено іншому учаснику цього турніру",
            )

    part.place = data.place
    db.commit()
    db.refresh(part)
    return _to_participant_read(part)


@router.delete(
    "/{tournament_id}/participants/{participation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_participant(
    tournament_id: int,
    participation_id: int,
    user: models.AppUser = Depends(require("tournaments", FULL)),
    db: Session = Depends(get_db),
):
    t = _get_or_404(db, tournament_id)
    ensure_club_access(user, t.club_id)

    part = db.get(models.Participation, participation_id)
    if part is None or part.tournament_id != tournament_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Учасника не знайдено")

    db.delete(part)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

