"""Вхід, поточний користувач і зміна пароля (сторінки «Вхід» і «Профіль»)."""
from datetime import datetime, timedelta
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..permissions import ROLE_LABELS, permissions_for
from ..security import (
    PASSWORD_RULE,
    create_access_token,
    hash_password,
    password_is_strong,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

BAD_CREDENTIALS = "Невірний логін або пароль"


# ---------- Схеми ----------
class UserInfo(BaseModel):
    user_id: int
    username: str
    full_name: str
    role: str
    role_label: str
    club_id: int | None
    club_name: str | None
    must_change_password: bool
    permissions: dict[str, str]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=1, max_length=72)


def user_info(user: models.AppUser) -> UserInfo:
    return UserInfo(
        user_id=user.user_id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        role_label=ROLE_LABELS[user.role],
        club_id=user.club_id,
        club_name=user.club.name if user.club else None,
        must_change_password=user.must_change_password,
        permissions=permissions_for(user.role),
    )


# ---------- Блокування після невдалих спроб ----------
# Зберігається в пам'яті процесу: після перезапуску сервера лічильники обнуляються.
class LoginLimiter:
    def __init__(self) -> None:
        self._failures: dict[str, tuple[int, datetime | None]] = {}
        self._lock = Lock()

    def minutes_left(self, username: str, now: datetime) -> int:
        """Скільки хвилин ще діє блокування (0 - не заблоковано)."""
        with self._lock:
            _, locked_until = self._failures.get(username, (0, None))
        if locked_until is None or locked_until <= now:
            return 0
        return max(1, -(-int((locked_until - now).total_seconds()) // 60))  # округлення вгору

    def fail(self, username: str, now: datetime) -> None:
        with self._lock:
            count, locked_until = self._failures.get(username, (0, None))
            if locked_until is not None and locked_until <= now:
                count = 0  # блокування минуло - рахуємо заново
            count += 1
            if count >= settings.login_max_attempts:
                self._failures[username] = (0, now + timedelta(minutes=settings.login_lock_minutes))
            else:
                self._failures[username] = (count, None)

    def success(self, username: str) -> None:
        with self._lock:
            self._failures.pop(username, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()


limiter = LoginLimiter()


# ---------- Ендпоінти ----------
@router.post("/login", response_model=LoginResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = form.username.strip().lower()
    now = datetime.now()

    if minutes := limiter.minutes_left(username, now):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Забагато спроб. Спробуйте за {minutes} хв")

    user = db.scalar(select(models.AppUser).where(func.lower(models.AppUser.username) == username))
    if user is None or not user.is_active or not verify_password(form.password, user.password_hash):
        limiter.fail(username, now)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    limiter.success(username)
    user.last_login_at = now
    db.commit()
    return LoginResponse(access_token=create_access_token(user.user_id), user=user_info(user))


@router.get("/me", response_model=UserInfo)
def me(user: models.AppUser = Depends(get_current_user)):
    return user_info(user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: ChangePasswordRequest,
    user: models.AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Поточний пароль введено неправильно")
    if not password_is_strong(data.new_password):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, PASSWORD_RULE)
    if data.new_password == data.current_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Новий пароль має відрізнятися від поточного")
    user.password_hash = hash_password(data.new_password)
    user.must_change_password = False
    db.commit()

