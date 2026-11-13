from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, get_active_user, require, scoped_club_id
from ..permissions import FULL, REPAIR, VIEW, allowed
from .clubs import sync_club_pc_count

router = APIRouter(prefix="/workstations", tags=["workstations"])


def _get_or_404(db: Session, workstation_id: int) -> models.Workstation:
    ws = db.get(models.Workstation, workstation_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Робоче місце не знайдено")
    return ws


def _ensure_club_exists(db: Session, club_id: int) -> models.Club:
    club = db.get(models.Club, club_id)
    if club is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")
    return club


def _enrich_workstation(db: Session, ws: models.Workstation) -> schemas.WorkstationRead:
    sessions_count = db.scalar(
        select(func.count())
        .select_from(models.GameSession)
        .where(models.GameSession.workstation_id == ws.workstation_id)
    ) or 0
    active = db.scalar(
        select(models.GameSession).where(
            models.GameSession.workstation_id == ws.workstation_id,
            models.GameSession.status == "активний",
        )
    )
    return schemas.WorkstationRead(
        workstation_id=ws.workstation_id,
        club_id=ws.club_id,
        club_name=ws.club.name if ws.club else None,
        number=ws.number,
        type=ws.type,
        status=ws.status,
        active_session_id=active.session_id if active else None,
        active_client_id=active.client_id if active else None,
        active_client_name=active.client.full_name if active and active.client else None,
        sessions_count=int(sessions_count),
    )


@router.get("", response_model=list[schemas.WorkstationRead])
def list_workstations(
    club_id: int | None = Query(default=None),
    type: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    user: models.AppUser = Depends(require("workstations", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    stmt = select(models.Workstation).order_by(models.Workstation.club_id, models.Workstation.number)
    if effective_club_id is not None:
        stmt = stmt.where(models.Workstation.club_id == effective_club_id)
    if type:
        stmt = stmt.where(models.Workstation.type == type)
    if status_filter:
        stmt = stmt.where(models.Workstation.status == status_filter)
    items = db.scalars(stmt).all()
    return [_enrich_workstation(db, ws) for ws in items]


@router.post("", response_model=schemas.WorkstationRead, status_code=status.HTTP_201_CREATED)
def create_workstation(
    data: schemas.WorkstationCreate,
    user: models.AppUser = Depends(require("workstations", FULL)),
    db: Session = Depends(get_db),
):
    ensure_club_access(user, data.club_id)
    _ensure_club_exists(db, data.club_id)

    ws = models.Workstation(
        club_id=data.club_id,
        number=data.number,
        type=data.type,
        status="вільне",
    )
    db.add(ws)
    try:
        db.flush()
        sync_club_pc_count(db, data.club_id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Місце № {data.number} уже існує в цьому клубі",
        )
    db.refresh(ws)
    return _enrich_workstation(db, ws)


@router.post("/bulk", response_model=list[schemas.WorkstationRead], status_code=status.HTTP_201_CREATED)
def create_workstations_bulk(
    data: schemas.WorkstationBulkCreate,
    user: models.AppUser = Depends(require("workstations", FULL)),
    db: Session = Depends(get_db),
):
    ensure_club_access(user, data.club_id)
    _ensure_club_exists(db, data.club_id)

    if data.number_to < data.number_from:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Кінцевий номер діапазону має бути не меншим за початковий",
        )
    count = data.number_to - data.number_from + 1
    if count > 100:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "За один раз можна додати не більше 100 місць",
        )

    existing_numbers = sorted(
        db.scalars(
            select(models.Workstation.number).where(
                models.Workstation.club_id == data.club_id,
                models.Workstation.number >= data.number_from,
                models.Workstation.number <= data.number_to,
            )
        ).all()
    )
    if existing_numbers:
        nums_str = ", ".join(str(n) for n in existing_numbers)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Місця з номерами {nums_str} уже існують у цьому клубі",
        )

    created = [
        models.Workstation(club_id=data.club_id, number=num, type=data.type, status="вільне")
        for num in range(data.number_from, data.number_to + 1)
    ]
    db.add_all(created)
    db.flush()
    sync_club_pc_count(db, data.club_id)
    db.commit()
    for ws in created:
        db.refresh(ws)
    return [_enrich_workstation(db, ws) for ws in created]


@router.patch("/{workstation_id}", response_model=schemas.WorkstationRead)
def update_workstation(
    workstation_id: int,
    data: schemas.WorkstationUpdate,
    user: models.AppUser = Depends(require("workstations", FULL)),
    db: Session = Depends(get_db),
):
    ws = _get_or_404(db, workstation_id)
    ensure_club_access(user, ws.club_id)
    old_club_id = ws.club_id

    updates = data.model_dump(exclude_unset=True)
    if "club_id" in updates and updates["club_id"] is not None:
        ensure_club_access(user, updates["club_id"])
        _ensure_club_exists(db, updates["club_id"])

    for field, value in updates.items():
        if value is not None:
            setattr(ws, field, value)

    try:
        db.flush()
        sync_club_pc_count(db, ws.club_id)
        if old_club_id != ws.club_id:
            sync_club_pc_count(db, old_club_id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Місце № {ws.number} уже існує в обраному клубі",
        )
    db.refresh(ws)
    return _enrich_workstation(db, ws)


@router.patch("/{workstation_id}/status", response_model=schemas.WorkstationRead)
def update_workstation_status(
    workstation_id: int,
    data: schemas.WorkstationStatusUpdate,
    user: models.AppUser = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    # Змінювати статус «на ремонті» / «вільне» можуть Директор, Сисадмін і Адмін залу
    if not (allowed(user.role, "workstations", FULL) or allowed(user.role, "hall", REPAIR)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостатньо прав для цієї дії")

    ws = _get_or_404(db, workstation_id)
    ensure_club_access(user, ws.club_id)

    if data.status not in ("вільне", "на ремонті"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Вручну можна встановити лише статус «вільне» або «на ремонті»",
        )
    if ws.status == "зайняте":
        raise HTTPException(status.HTTP_409_CONFLICT, "Спочатку завершіть сеанс")

    ws.status = data.status
    db.commit()
    db.refresh(ws)
    return _enrich_workstation(db, ws)


@router.delete("/{workstation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workstation(
    workstation_id: int,
    user: models.AppUser = Depends(require("workstations", FULL)),
    db: Session = Depends(get_db),
):
    ws = _get_or_404(db, workstation_id)
    ensure_club_access(user, ws.club_id)

    has_sessions = db.scalar(
        select(func.count())
        .select_from(models.GameSession)
        .where(models.GameSession.workstation_id == workstation_id)
    )
    if has_sessions:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "У місця є історія сеансів. Позначте його як «на ремонті»",
        )

    club_id = ws.club_id
    db.delete(ws)
    db.flush()
    sync_club_pc_count(db, club_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

