import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require
from ..permissions import FULL, ROLE_LABELS
from ..security import PASSWORD_RULE, hash_password, password_is_strong

router = APIRouter(prefix="/users", tags=["users"])


def _get_or_404(db: Session, user_id: int) -> models.AppUser:
    u = db.get(models.AppUser, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Користувача не знайдено")
    return u


def _to_read(u: models.AppUser) -> schemas.UserRead:
    return schemas.UserRead(
        user_id=u.user_id,
        username=u.username,
        full_name=u.full_name,
        role=u.role,
        role_label=ROLE_LABELS.get(u.role, u.role),
        club_id=u.club_id,
        club_name=u.club.name if u.club else None,
        staff_id=u.staff_id,
        staff_name=u.staff.full_name if u.staff else None,
        is_active=u.is_active,
        must_change_password=u.must_change_password,
        created_at=u.created_at,
        last_login_at=u.last_login_at,
    )


def _validate_role_and_club(db: Session, role: str, club_id: int | None) -> None:
    if role not in ROLE_LABELS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Невідома роль користувача")
    if role != "director" and club_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Для цієї ролі обов'язково потрібно вказати клуб",
        )
    if club_id is not None and db.get(models.Club, club_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Обраний клуб не знайдено")


def _generate_temp_password(length: int = 10) -> str:
    letters = string.ascii_letters
    digits = string.digits
    alphabet = letters + digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.isalpha() for c in pw) and any(c.isdigit() for c in pw):
            return pw


@router.get("", response_model=list[schemas.UserRead], dependencies=[Depends(require("users", FULL))])
def list_users(db: Session = Depends(get_db)):
    users = db.scalars(select(models.AppUser).order_by(models.AppUser.user_id)).all()
    return [_to_read(u) for u in users]


@router.post("", response_model=schemas.UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    data: schemas.UserCreate,
    current_user: models.AppUser = Depends(require("users", FULL)),
    db: Session = Depends(get_db),
):
    _validate_role_and_club(db, data.role, data.club_id)
    if not password_is_strong(data.password):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, PASSWORD_RULE)
    if data.staff_id is not None and db.get(models.Staff, data.staff_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Обраного співробітника не знайдено")

    existing = db.scalar(
        select(models.AppUser).where(func.lower(models.AppUser.username) == data.username.lower())
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Користувач із таким логіном уже існує")

    user = models.AppUser(
        username=data.username.lower(),
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role=data.role,
        club_id=data.club_id,
        staff_id=data.staff_id,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Користувач із таким логіном уже існує")
    db.refresh(user)
    return _to_read(user)


@router.patch("/{user_id}", response_model=schemas.UserRead)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    current_user: models.AppUser = Depends(require("users", FULL)),
    db: Session = Depends(get_db),
):
    target = _get_or_404(db, user_id)
    updates = data.model_dump(exclude_unset=True)

    # Правила безпеки розділу 7.13: не можна вимкнути себе або забрати у себе роль Директора
    if target.user_id == current_user.user_id:
        if updates.get("is_active") is False:
            raise HTTPException(status.HTTP_409_CONFLICT, "Не можна вимкнути власний обліковий запис")
        if "role" in updates and updates["role"] is not None and updates["role"] != current_user.role:
            raise HTTPException(status.HTTP_409_CONFLICT, "Не можна змінити роль власного облікового запису")

    next_role = updates.get("role") or target.role
    next_club_id = updates["club_id"] if "club_id" in updates else target.club_id
    next_active = updates["is_active"] if "is_active" in updates and updates["is_active"] is not None else target.is_active

    _validate_role_and_club(db, next_role, next_club_id)

    # Перевірка, що в системі залишається щонайменше один активний Директор
    if target.role == "director" and target.is_active and (next_role != "director" or not next_active):
        other_directors = db.scalar(
            select(func.count())
            .select_from(models.AppUser)
            .where(
                models.AppUser.role == "director",
                models.AppUser.is_active.is_(True),
                models.AppUser.user_id != target.user_id,
            )
        ) or 0
        if other_directors == 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "У системі має залишатися щонайменше один активний Директор",
            )

    if "staff_id" in updates and updates["staff_id"] is not None:
        if db.get(models.Staff, updates["staff_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Обраного співробітника не знайдено")

    for field, value in updates.items():
        if field in ("club_id", "staff_id") or value is not None:
            setattr(target, field, value)

    db.commit()
    db.refresh(target)
    return _to_read(target)


@router.post("/{user_id}/reset-password", response_model=schemas.ResetPasswordResponse)
def reset_user_password(
    user_id: int,
    current_user: models.AppUser = Depends(require("users", FULL)),
    db: Session = Depends(get_db),
):
    target = _get_or_404(db, user_id)
    temp_password = _generate_temp_password(10)
    target.password_hash = hash_password(temp_password)
    target.must_change_password = True
    db.commit()
    return schemas.ResetPasswordResponse(
        user_id=target.user_id,
        username=target.username,
        temporary_password=temp_password,
    )

