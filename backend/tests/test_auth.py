"""Тести автентифікації та перевірки прав (розділи 4, 7.1, 7.15 специфікації)."""
import pytest
from app import models
from app.routers.auth import limiter
from app.security import hash_password


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture()
def director_user(client):
    """Створює користувача-директора в тестовій базі."""
    from app.database import Base, get_db
    # Отримуємо сесію через override_get_db
    db_gen = client.app.dependency_overrides[get_db]()
    db = next(db_gen)
    user = models.AppUser(
        username="test_director",
        password_hash=hash_password("admin1234"),
        full_name="Тестовий Директор",
        role="director",
        club_id=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_header(client, username="test_director", password="admin1234"):
    r = client.post("/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, f"Login failed: {r.text}"
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_login_success(client, director_user):
    r = client.post("/auth/login", data={"username": "test_director", "password": "admin1234"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["role"] == "director"
    assert data["user"]["full_name"] == "Тестовий Директор"
    assert "permissions" in data["user"]


def test_login_bad_credentials(client, director_user):
    r = client.post("/auth/login", data={"username": "test_director", "password": "wrongpassword"})
    assert r.status_code == 401
    assert "Невірний логін або пароль" in r.json()["detail"]


def test_login_rate_limiting(client, director_user):
    # 5 невдалих спроб
    for _ in range(5):
        r = client.post("/auth/login", data={"username": "test_director", "password": "wrongpassword"})
        assert r.status_code == 401

    # 6-та спроба блокується з 429
    r = client.post("/auth/login", data={"username": "test_director", "password": "wrongpassword"})
    assert r.status_code == 429
    assert "Забагато спроб" in r.json()["detail"]


def test_me_endpoint(client, director_user):
    headers = _auth_header(client)
    r = client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["username"] == "test_director"
    assert r.json()["role_label"] == "Директор"


def test_unauthorized_access(client):
    r = client.get("/clubs")
    assert r.status_code == 401


def test_authorized_access(client, director_user):
    headers = _auth_header(client)
    r = client.get("/clubs", headers=headers)
    assert r.status_code == 200


def test_change_password(client, director_user):
    headers = _auth_header(client)
    # Зміна на слабкий пароль -> 422
    r = client.post(
        "/auth/change-password",
        headers=headers,
        json={"current_password": "admin1234", "new_password": "short"},
    )
    assert r.status_code == 422

    # Зміна на валідний новий пароль
    r = client.post(
        "/auth/change-password",
        headers=headers,
        json={"current_password": "admin1234", "new_password": "NewPassword2026"},
    )
    assert r.status_code == 204

    # Вхід зі старим паролем більше не працює
    r = client.post("/auth/login", data={"username": "test_director", "password": "admin1234"})
    assert r.status_code == 401

    # Вхід з новим паролем успішний
    r = client.post("/auth/login", data={"username": "test_director", "password": "NewPassword2026"})
    assert r.status_code == 200
