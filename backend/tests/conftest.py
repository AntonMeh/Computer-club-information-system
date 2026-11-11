import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base, get_db
from app.main import app
from app.security import create_access_token, hash_password


@pytest.fixture()
def client():
    """Тестовий клієнт із чистою SQLite-базою в пам'яті (PostgreSQL для тестів не потрібен)."""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_client(client):
    """Клієнт із правами директора (авторизований через Bearer токен)."""
    db_gen = client.app.dependency_overrides[get_db]()
    db = next(db_gen)
    user = models.AppUser(
        username="director_fixture",
        password_hash=hash_password("admin1234"),
        full_name="Директор Фікстура",
        role="director",
        club_id=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.user_id)
    client.headers["Authorization"] = f"Bearer {token}"
    return client
