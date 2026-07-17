"""Auth: registration, login, roles, protected routes."""


def test_register_first_user_is_admin(client):
    response = client.post("/api/auth/register", json={
        "email": "a@test.com", "username": "alpha", "password": "secret123",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["role"] == "admin"
    assert data["token"]

    response = client.post("/api/auth/register", json={
        "email": "b@test.com", "username": "beta", "password": "secret123",
    })
    assert response.json()["user"]["role"] == "member"


def test_login_and_me(client):
    client.post("/api/auth/register", json={
        "email": "a@test.com", "username": "alpha", "password": "secret123",
    })
    response = client.post("/api/auth/login", json={"email": "a@test.com", "password": "secret123"})
    assert response.status_code == 200
    token = response.json()["token"]

    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "alpha"


def test_login_wrong_password(client):
    client.post("/api/auth/register", json={
        "email": "a@test.com", "username": "alpha", "password": "secret123",
    })
    response = client.post("/api/auth/login", json={"email": "a@test.com", "password": "wrong"})
    assert response.status_code == 401


def test_protected_route_requires_token(client):
    response = client.get("/api/records/person")
    assert response.status_code == 401


def test_duplicate_email_rejected(client):
    client.post("/api/auth/register", json={
        "email": "a@test.com", "username": "alpha", "password": "secret123",
    })
    response = client.post("/api/auth/register", json={
        "email": "a@test.com", "username": "other", "password": "secret123",
    })
    assert response.status_code == 400
