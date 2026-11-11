from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Налаштування застосунку. Значення беруться зі змінних оточення або з файлу backend/.env."""

    database_url: str = "postgresql+psycopg://club:club@localhost:5432/club_db"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Автентифікація (JWT). У .env обов'язково задайте власний SECRET_KEY.
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 12 * 60  # одна робоча зміна
    bcrypt_rounds: int = 12

    # Блокування входу після невдалих спроб (сторінка «Вхід»)
    login_max_attempts: int = 5
    login_lock_minutes: int = 5

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
