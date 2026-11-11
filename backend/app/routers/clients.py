from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require
from ..permissions import FULL, VIEW

router = APIRouter(prefix="/clients", tags=["clients"])

PHONE_TAKEN = "Клієнт з таким номером телефону вже існує"


def _get_or_404(db: Session, client_id: int) -> models.Client:
    client = db.get(models.Client, client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клієнта не знайдено")
    return client


@router.get("", response_model=list[schemas.ClientRead], dependencies=[Depends(require("clients", VIEW))])
def list_clients(db: Session = Depends(get_db)):
    return db.scalars(select(models.Client).order_by(models.Client.client_id)).all()


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
    return client


@router.get("/{client_id}", response_model=schemas.ClientRead, dependencies=[Depends(require("clients", VIEW))])
def get_client(client_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, client_id)


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
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require("clients", FULL))])
def delete_client(client_id: int, db: Session = Depends(get_db)):
    client = _get_or_404(db, client_id)
    try:
        db.delete(client)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Клієнта неможливо видалити: є пов'язані сеанси або участь у турнірах",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
