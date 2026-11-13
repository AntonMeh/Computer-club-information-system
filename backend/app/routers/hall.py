from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require, scoped_club_id
from ..permissions import VIEW
from .sessions import calculate_duration_and_amount

router = APIRouter(prefix="/hall", tags=["hall"])


@router.get("", response_model=schemas.HallResponse)
def get_hall(
    club_id: int | None = Query(default=None),
    type_filter: str | None = Query(default=None, alias="type"),
    status_filter: str | None = Query(default=None, alias="status"),
    user: models.AppUser = Depends(require("hall", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    if effective_club_id is None:
        first_club = db.scalar(select(models.Club).order_by(models.Club.club_id))
        if first_club is not None:
            effective_club_id = first_club.club_id

    ws_stmt = select(models.Workstation).order_by(
        models.Workstation.club_id, models.Workstation.number
    )
    if effective_club_id is not None:
        ws_stmt = ws_stmt.where(models.Workstation.club_id == effective_club_id)
    all_ws = db.scalars(ws_stmt).all()

    active_sessions = db.scalars(
        select(models.GameSession).where(models.GameSession.status == "активний")
    ).all()
    active_by_ws = {s.workstation_id: s for s in active_sessions}

    now = datetime.now()
    summary = schemas.HallSummary(
        total=len(all_ws),
        free=sum(1 for w in all_ws if w.status == "вільне"),
        busy=sum(1 for w in all_ws if w.status == "зайняте"),
        repair=sum(1 for w in all_ws if w.status == "на ремонті"),
    )

    items: list[schemas.HallWorkstationItem] = []
    for w in all_ws:
        if type_filter and w.type != type_filter:
            continue
        if status_filter and w.status != status_filter:
            continue

        act = active_by_ws.get(w.workstation_id)
        active_payload = None
        if act is not None:
            elapsed_seconds = max(0, int((now - act.start_time).total_seconds()))
            mins, est_amount = calculate_duration_and_amount(
                act.start_time, now, act.price_per_hour
            )
            client = act.client
            tariff = act.tariff
            active_payload = schemas.HallActiveSession(
                session_id=act.session_id,
                client_id=act.client_id,
                client_name=client.full_name if client else "",
                client_phone=client.phone if client else "",
                client_bonus_balance=Decimal(client.bonus_balance).quantize(Decimal("0.01"))
                if client
                else Decimal("0.00"),
                tariff_id=act.tariff_id,
                tariff_name=tariff.name if tariff else "",
                price_per_hour=Decimal(act.price_per_hour).quantize(Decimal("0.01")),
                start_time=act.start_time,
                elapsed_seconds=elapsed_seconds,
                elapsed_minutes=mins,
                estimated_amount=est_amount,
            )

        items.append(
            schemas.HallWorkstationItem(
                workstation_id=w.workstation_id,
                club_id=w.club_id,
                club_name=w.club.name if w.club else "",
                number=w.number,
                type=w.type,
                status=w.status,
                active_session=active_payload,
            )
        )

    return schemas.HallResponse(
        server_time=now,
        club_id=effective_club_id,
        summary=summary,
        items=items,
    )

