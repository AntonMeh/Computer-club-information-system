from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require
from ..permissions import FULL, VIEW

router = APIRouter(prefix="/tariffs", tags=["tariffs"])

TARIFF_IN_USE = "Тариф використовується в сеансах. Змініть ціну або створіть новий"


def _get_or_404(db: Session, tariff_id: int) -> models.Tariff:
    tariff = db.get(models.Tariff, tariff_id)
    if tariff is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тариф не знайдено")
    return tariff


def _enrich_tariff(db: Session, tariff: models.Tariff) -> schemas.TariffRead:
    sessions_count = db.scalar(
        select(func.count())
        .select_from(models.GameSession)
        .where(models.GameSession.tariff_id == tariff.tariff_id)
    ) or 0
    return schemas.TariffRead(
        tariff_id=tariff.tariff_id,
        name=tariff.name,
        workstation_type=tariff.workstation_type,
        price_per_hour=tariff.price_per_hour,
        sessions_count=int(sessions_count),
    )


@router.get("", response_model=list[schemas.TariffRead], dependencies=[Depends(require("tariffs", VIEW))])
def list_tariffs(db: Session = Depends(get_db)):
    items = db.scalars(select(models.Tariff).order_by(models.Tariff.tariff_id)).all()
    return [_enrich_tariff(db, t) for t in items]


@router.post(
    "",
    response_model=schemas.TariffRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require("tariffs", FULL))],
)
def create_tariff(data: schemas.TariffCreate, db: Session = Depends(get_db)):
    tariff = models.Tariff(**data.model_dump())
    db.add(tariff)
    db.commit()
    db.refresh(tariff)
    return _enrich_tariff(db, tariff)


@router.get("/{tariff_id}", response_model=schemas.TariffRead, dependencies=[Depends(require("tariffs", VIEW))])
def get_tariff(tariff_id: int, db: Session = Depends(get_db)):
    return _enrich_tariff(db, _get_or_404(db, tariff_id))


@router.patch("/{tariff_id}", response_model=schemas.TariffRead, dependencies=[Depends(require("tariffs", FULL))])
def update_tariff(tariff_id: int, data: schemas.TariffUpdate, db: Session = Depends(get_db)):
    tariff = _get_or_404(db, tariff_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(tariff, field, value)
    db.commit()
    db.refresh(tariff)
    return _enrich_tariff(db, tariff)


@router.delete("/{tariff_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require("tariffs", FULL))])
def delete_tariff(tariff_id: int, db: Session = Depends(get_db)):
    tariff = _get_or_404(db, tariff_id)
    used = db.scalar(
        select(func.count())
        .select_from(models.GameSession)
        .where(models.GameSession.tariff_id == tariff_id)
    )
    if used:
        raise HTTPException(status.HTTP_409_CONFLICT, TARIFF_IN_USE)
    try:
        db.delete(tariff)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, TARIFF_IN_USE)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

