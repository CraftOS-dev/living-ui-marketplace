"""Shared test helpers: register a user and return auth headers."""


def auth_headers(client, email="tester@test.com", username="tester", password="testpass123"):
    response = client.post("/api/auth/register", json={
        "email": email, "username": username, "password": password,
    })
    if response.status_code != 200:
        response = client.post("/api/auth/login", json={"email": email, "password": password})
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}
