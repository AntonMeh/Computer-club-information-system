def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_club_crud(auth_client):
    payload = {"name": "Cyberion Cherkasy", "address": "вул. Шевченка, 1", "phone": "+380000000000", "pc_count": 20}
    created = auth_client.post("/clubs", json=payload)
    assert created.status_code == 201
    club_id = created.json()["club_id"]

    assert auth_client.get(f"/clubs/{club_id}").json()["name"] == "Cyberion Cherkasy"
    assert len(auth_client.get("/clubs").json()) == 1

    patched = auth_client.patch(f"/clubs/{club_id}", json={"pc_count": 30})
    assert patched.status_code == 200
    assert patched.json()["pc_count"] == 30
    assert patched.json()["name"] == "Cyberion Cherkasy"  # інші поля не змінились

    assert auth_client.delete(f"/clubs/{club_id}").status_code == 204
    assert auth_client.get(f"/clubs/{club_id}").status_code == 404


def test_club_validation(auth_client):
    r = auth_client.post("/clubs", json={"name": "", "address": "x", "phone": "1"})
    assert r.status_code == 422


def test_client_defaults_and_unique_phone(auth_client):
    first = auth_client.post("/clients", json={"full_name": "Іван Петренко", "phone": "+380501112233"})
    assert first.status_code == 201
    body = first.json()
    assert body["reg_date"]  # дата реєстрації підставилась автоматично
    assert body["bonus_balance"] in ("0", "0.00", 0)

    duplicate = auth_client.post("/clients", json={"full_name": "Інший Клієнт", "phone": "+380501112233"})
    assert duplicate.status_code == 409


def test_client_not_found(auth_client):
    assert auth_client.get("/clients/999").status_code == 404
