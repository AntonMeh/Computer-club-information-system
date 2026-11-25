from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, get_active_user, require, scoped_club_id
from ..permissions import ACCOUNTANT, DIRECTOR, FULL, VIEW, allowed

router = APIRouter(prefix="/staff", tags=["staff"])

# Ієрархія посад для оргструктури (розділ 7.11 специфікації)
ORG_NODES = [
    ("director", "Директор клубу", None),
    ("deputy", "Заступник директора (адміністратор клубу)", "director"),
    ("hall_admin", "Оператор-адміністратор залу", "deputy"),
    ("tech", "Технічний персонал", "deputy"),
    ("accountant", "Бухгалтер", "director"),
    ("sysadmin", "Системний адміністратор", "director"),
    ("marketing", "Менеджер з реклами та маркетингу", "director"),
    ("tournaments", "Менеджер з організації турнірів та заходів", "director"),
]


def _get_or_404(db: Session, staff_id: int) -> models.Staff:
    member = db.get(models.Staff, staff_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Співробітника не знайдено")
    return member


def _enrich_staff(member: models.Staff) -> schemas.StaffRead:
    default_rate = schemas.DEFAULT_POSITION_RATES.get(member.position, Decimal("160.00"))
    return schemas.StaffRead(
        staff_id=member.staff_id,
        club_id=member.club_id,
        club_name=member.club.name if member.club else None,
        full_name=member.full_name,
        position=member.position,
        hire_date=member.hire_date,
        hourly_rate=Decimal(member.hourly_rate if member.hourly_rate is not None else default_rate),
    )


@router.get("", response_model=list[schemas.StaffRead])
def list_staff(
    club_id: int | None = Query(default=None),
    position: str | None = Query(default=None),
    user: models.AppUser = Depends(require("staff", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    stmt = select(models.Staff).order_by(models.Staff.club_id, models.Staff.staff_id)
    if effective_club_id is not None:
        stmt = stmt.where(models.Staff.club_id == effective_club_id)
    if position:
        stmt = stmt.where(models.Staff.position == position)
    members = db.scalars(stmt).all()
    return [_enrich_staff(m) for m in members]


@router.get("/org-chart", response_model=list[schemas.OrgChartNode])
def get_org_chart(
    club_id: int | None = Query(default=None),
    user: models.AppUser = Depends(require("staff", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    stmt = select(models.Staff).order_by(models.Staff.staff_id)
    if effective_club_id is not None:
        stmt = stmt.where(models.Staff.club_id == effective_club_id)
    members = db.scalars(stmt).all()

    by_position: dict[str, list[schemas.OrgChartMember]] = {pos: [] for _, pos, _ in ORG_NODES}
    for m in members:
        default_rate = schemas.DEFAULT_POSITION_RATES.get(m.position, Decimal("160.00"))
        item = schemas.OrgChartMember(
            staff_id=m.staff_id,
            full_name=m.full_name,
            hire_date=m.hire_date,
            club_id=m.club_id,
            club_name=m.club.name if m.club else "",
            hourly_rate=Decimal(m.hourly_rate if m.hourly_rate is not None else default_rate),
        )
        by_position.setdefault(m.position, []).append(item)

    return [
        schemas.OrgChartNode(
            key=key,
            position=position,
            parent_key=parent_key,
            members=by_position.get(position, []),
            is_vacant=len(by_position.get(position, [])) == 0,
        )
        for key, position, parent_key in ORG_NODES
    ]


@router.post("", response_model=schemas.StaffRead, status_code=status.HTTP_201_CREATED)
def create_staff(
    data: schemas.StaffCreate,
    user: models.AppUser = Depends(require("staff", FULL)),
    db: Session = Depends(get_db),
):
    ensure_club_access(user, data.club_id)
    if db.get(models.Club, data.club_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    values = data.model_dump()
    values["hire_date"] = values["hire_date"] or date.today()
    if values.get("hourly_rate") is None:
        values["hourly_rate"] = schemas.DEFAULT_POSITION_RATES.get(
            values["position"], Decimal("160.00")
        )
    member = models.Staff(**values)
    db.add(member)
    db.commit()
    db.refresh(member)
    return _enrich_staff(member)


@router.get("/{staff_id}", response_model=schemas.StaffRead)
def get_staff(
    staff_id: int,
    user: models.AppUser = Depends(require("staff", VIEW)),
    db: Session = Depends(get_db),
):
    member = _get_or_404(db, staff_id)
    ensure_club_access(user, member.club_id)
    return _enrich_staff(member)


@router.patch("/{staff_id}", response_model=schemas.StaffRead)
def update_staff(
    staff_id: int,
    data: schemas.StaffUpdate,
    user: models.AppUser = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    updates = data.model_dump(exclude_unset=True)
    # Бухгалтер може змінювати погодинну ставку (hourly_rate), а повне редагування кадрових даних — Директор
    if not allowed(user.role, "staff", FULL):
        if user.role == ACCOUNTANT and set(updates.keys()).issubset({"hourly_rate"}):
            pass
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостатньо прав для зміни даних співробітника")

    member = _get_or_404(db, staff_id)
    ensure_club_access(user, member.club_id)
    if "club_id" in updates and updates["club_id"] is not None:
        ensure_club_access(user, updates["club_id"])
        if db.get(models.Club, updates["club_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")
    for field, value in updates.items():
        if value is not None:
            setattr(member, field, value)
    db.commit()
    db.refresh(member)
    return _enrich_staff(member)


@router.delete("/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_staff(
    staff_id: int,
    user: models.AppUser = Depends(require("staff", FULL)),
    db: Session = Depends(get_db),
):
    member = _get_or_404(db, staff_id)
    ensure_club_access(user, member.club_id)
    # Відв'язуємо облікові записи від співробітника перед видаленням
    db.execute(
        update(models.AppUser).where(models.AppUser.staff_id == staff_id).values(staff_id=None)
    )
    db.delete(member)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

