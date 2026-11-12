"""Права за ролями та доступ за клубом (розділ 4 специфікації, бізнес-правило 12)."""
import pytest

from app import models
from app.database import get_db
from app.permissions import PERMISSIONS, ROLE_LABELS
from app.routers.auth import limiter
from app.security import create_access_token, hash_password


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture()
def db(client):
    gen = client.app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


@pytest.fixture()
def club(db):
    c = models.Club(name="Клуб А", address="вул. 1", phone="+380500000001")
    db.add(c)
    db.commit()
    return c


def make_user(db, role, club_id=None, must_change_password=False, username=None):
    user = models.AppUser(
        username=username or role, password_hash=hash_password("demo1234"), full_name=role,
        role=role, club_id=club_id, must_change_password=must_change_password,
    )
    db.add(user)
    db.commit()
    return user


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token(user.user_id)}"}


@pytest.mark.parametrize("role", list(ROLE_LABELS))
def test_me_returns_permissions_matching_matrix(client, db, club, role):
    user = make_user(db, role, club_id=None if role == "director" else club.club_id)
    body = client.get("/auth/me", headers=headers_for(user)).json()
    expected = {section for section, roles in PERMISSIONS.items() if role in roles}
    assert set(body["permissions"]) == expected
    assert body["role_label"] == ROLE_LABELS[role]


@pytest.mark.parametrize(
    "role, method, path, expected",
    [
        ("hall_admin", "get", "/clients", 200),
        ("hall_admin", "post", "/clients", 201),
        ("hall_admin", "get", "/clubs", 403),
        ("tournament_manager", "get", "/clients", 200),
        ("tournament_manager", "post", "/clients", 403),
        ("marketing_manager", "post", "/clients", 403),
        ("accountant", "get", "/clients", 403),
        ("sysadmin", "get", "/clubs", 200),
        ("sysadmin", "post", "/clubs", 403),
        ("sysadmin", "get", "/clients", 403),
    ],
)
def test_role_access(client, db, club, role, method, path, expected):
    user = make_user(db, role, club_id=club.club_id)
    payload = {
        "/clients": {"full_name": "Новий Клієнт", "phone": "+380671234567"},
        "/clubs": {"name": "Новий", "address": "вул. 2", "phone": "+380500000002"},
    }[path]
    kwargs = {"json": payload} if method == "post" else {}
    r = getattr(client, method)(path, headers=headers_for(user), **kwargs)
    assert r.status_code == expected, r.text


def test_must_change_password_blocks_data_but_not_profile(client, db):
    user = make_user(db, "director", must_change_password=True)
    h = headers_for(user)
    assert client.get("/clubs", headers=h).status_code == 403
    assert client.get("/auth/me", headers=h).json()["must_change_password"] is True

    r = client.post(
        "/auth/change-password", headers=h,
        json={"current_password": "demo1234", "new_password": "NewPass2026"},
    )
    assert r.status_code == 204
    assert client.get("/clubs", headers=h).status_code == 200


def test_disabled_user_cannot_login_or_use_token(client, db):
    user = make_user(db, "director")
    token_headers = headers_for(user)
    user.is_active = False
    db.commit()
    assert client.get("/auth/me", headers=token_headers).status_code == 401
    r = client.post("/auth/login", data={"username": "director", "password": "demo1234"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Невірний логін або пароль"  # не уточнюємо причину


def test_forged_token_is_rejected(client, db):
    import jwt

    user = make_user(db, "director")
    forged = jwt.encode({"sub": str(user.user_id)}, "dev-secret-change-me", algorithm="HS256")
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_login_is_case_insensitive_and_updates_last_login(client, db):
    user = make_user(db, "director")
    assert user.last_login_at is None
    r = client.post("/auth/login", data={"username": "DIRECTOR", "password": "demo1234"})
    assert r.status_code == 200
    db.refresh(user)
    assert user.last_login_at is not None

