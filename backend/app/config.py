from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Налаштування застосунку. Значення беруться зі змінних оточення або з файлу backend/.env."""

    database_url: str = "postgresql+psycopg://club:club@localhost:5432/club_db"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Автентифікація (JWT). У .env обов'язково задайте власний SECRET_KEY.
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 12 * 60  # одна робоча зміна
    bcrypt_rounds: int = 12

    # Блокування входу після невдалих спроб (сторінка «Вхід»)
    login_max_attempts: int = 5
    login_lock_minutes: int = 5

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

INSECURE_SECRET_KEYS = {"dev-secret-change-me", "change-me", ""}


def check_secret_key() -> None:
    """Не дає запустити API з ключем за замовчуванням: ним можна підробити токен будь-якого користувача."""
    if settings.secret_key in INSECURE_SECRET_KEYS or len(settings.secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY не задано або він занадто короткий. Додайте в backend/.env рядок SECRET_KEY=..., "
            'згенерувавши значення командою: python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
