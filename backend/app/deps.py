"""Залежності FastAPI: поточний користувач, перевірка прав і доступу до клубу."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .permissions import VIEW, allowed
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

NOT_AUTHENTICATED = "Потрібно увійти в систему"
FORBIDDEN = "Недостатньо прав для цієї дії"
MUST_CHANGE_PASSWORD = "Спочатку змініть тимчасовий пароль"
OTHER_CLUB = "Немає доступу до даних іншого клубу"


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> models.AppUser:
    """Користувач за токеном. Не перевіряє must_change_password (потрібно для /auth/me і зміни пароля)."""
    user_id = decode_access_token(token) if token else None
    user = db.get(models.AppUser, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, NOT_AUTHENTICATED, headers={"WWW-Authenticate": "Bearer"}
        )
    return user


def get_active_user(user: models.AppUser = Depends(get_current_user)) -> models.AppUser:
    """Користувач, який може працювати з даними (тимчасовий пароль уже змінено)."""
    if user.must_change_password:
        raise HTTPException(status.HTTP_403_FORBIDDEN, MUST_CHANGE_PASSWORD)
    return user


def require(section: str, level: str = VIEW):
    """Залежність: користувач має рівень доступу `level` до розділу `section`."""

    def dependency(user: models.AppUser = Depends(get_active_user)) -> models.AppUser:
        if not allowed(user.role, section, level):
            raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)
        return user

    return dependency


def ensure_club_access(user: models.AppUser, club_id: int | None) -> None:
    """Бізнес-правило 12: користувач із club_id працює лише зі своїм клубом."""
    if user.club_id is not None and club_id != user.club_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, OTHER_CLUB)


def scoped_club_id(user: models.AppUser, requested: int | None) -> int | None:
    """Клуб для фільтра списків: прив'язаний користувач завжди бачить лише свій клуб.

    Повертає None, якщо треба показати всю мережу.
    """
    if user.club_id is not None:
        if requested is not None and requested != user.club_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, OTHER_CLUB)
        return user.club_id
    return requested

