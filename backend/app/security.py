"""Паролі (bcrypt) і токени доступу (JWT)."""
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

ALGORITHM = "HS256"
MAX_PASSWORD_BYTES = 72
# Пароль: мінімум 8 символів (не більше 72 байтів UTF-8), хоча б одна літера й одна цифра
PASSWORD_RULE = "Пароль має містити від 8 до 36 символів, щонайменше одну літеру й одну цифру"
_LETTER = re.compile(r"[^\W\d_]")
_DIGIT = re.compile(r"\d")


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError(PASSWORD_RULE)
    salt = bcrypt.gensalt(rounds=settings.bcrypt_rounds)
    return bcrypt.hashpw(encoded, salt).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:  # пошкоджений хеш або пароль довший за 72 байти
        return False


def password_is_strong(password: str) -> bool:
    return (
        len(password) >= 8
        and len(password.encode("utf-8")) <= MAX_PASSWORD_BYTES
        and bool(_LETTER.search(password))
        and bool(_DIGIT.search(password))
    )


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> int | None:
    """Повертає user_id з токена або None, якщо токен недійсний чи прострочений."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
