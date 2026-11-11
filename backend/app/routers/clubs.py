from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
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


@router.get("", response_model=list[schemas.ClubRead], dependencies=[Depends(require("clubs", VIEW))])
def list_clubs(db: Session = Depends(get_db)):
    return db.scalars(select(models.Club).order_by(models.Club.club_id)).all()


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
    return club


@router.get("/{club_id}", response_model=schemas.ClubRead, dependencies=[Depends(require("clubs", VIEW))])
def get_club(club_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, club_id)


@router.patch("/{club_id}", response_model=schemas.ClubRead, dependencies=[Depends(require("clubs", FULL))])
def update_club(club_id: int, data: schemas.ClubUpdate, db: Session = Depends(get_db)):
    club = _get_or_404(db, club_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(club, field, value)
    db.commit()
    return club


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require("clubs", FULL))])
def delete_club(club_id: int, db: Session = Depends(get_db)):
    club = _get_or_404(db, club_id)
    try:
        db.delete(club)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Клуб неможливо видалити: до нього прив'язані робочі місця, співробітники, турніри або витрати",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
