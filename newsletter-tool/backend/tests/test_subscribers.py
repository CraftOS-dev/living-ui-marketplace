"""Tests for the subscribers CRUD + tags + CSV import/export."""


def test_create_subscriber(client):
    r = client.post("/api/subscribers", json={"email": "alice@example.com", "first_name": "Alice"})
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "alice@example.com"
    assert body["firstName"] == "Alice"
    assert body["status"] == "subscribed"
    assert "id" in body
    assert "unsubscribeToken" in body


def test_create_subscriber_normalizes_email(client):
    r = client.post("/api/subscribers", json={"email": "Bob@Example.com"})
    assert r.status_code == 200
    assert r.json()["email"] == "bob@example.com"


def test_duplicate_email_is_idempotent(client):
    client.post("/api/subscribers", json={"email": "carol@example.com", "first_name": "Carol"})
    r = client.post("/api/subscribers", json={
        "email": "carol@example.com",
        "first_name": "Carol Updated",
        "tags": ["vip"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["firstName"] == "Carol Updated"
    assert "vip" in body["tags"]


def test_list_subscribers(client):
    client.post("/api/subscribers", json={"email": "a@example.com"})
    client.post("/api/subscribers", json={"email": "b@example.com"})
    r = client.get("/api/subscribers")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_filter_subscribers_by_tag(client):
    client.post("/api/subscribers", json={"email": "a@example.com", "tags": ["vip"]})
    client.post("/api/subscribers", json={"email": "b@example.com", "tags": ["lead"]})
    r = client.get("/api/subscribers?tag=vip")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["email"] == "a@example.com"


def test_filter_subscribers_by_status(client):
    s1 = client.post("/api/subscribers", json={"email": "a@example.com"}).json()
    client.post("/api/subscribers", json={"email": "b@example.com"})
    client.put(f"/api/subscribers/{s1['id']}", json={"status": "unsubscribed"})
    r = client.get("/api/subscribers?status=subscribed")
    assert r.status_code == 200
    emails = [s["email"] for s in r.json()]
    assert "b@example.com" in emails
    assert "a@example.com" not in emails


def test_search_subscribers(client):
    client.post("/api/subscribers", json={"email": "anna@example.com", "first_name": "Anna"})
    client.post("/api/subscribers", json={"email": "bob@example.com", "first_name": "Bob"})
    r = client.get("/api/subscribers?search=anna")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_update_subscriber(client):
    sub = client.post("/api/subscribers", json={"email": "dave@example.com"}).json()
    r = client.put(f"/api/subscribers/{sub['id']}", json={
        "first_name": "Dave",
        "tags": ["customer", "vip"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["firstName"] == "Dave"
    assert set(body["tags"]) == {"customer", "vip"}


def test_update_missing_subscriber_is_idempotent(client):
    r = client.put("/api/subscribers/9999", json={"first_name": "ghost"})
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_delete_subscriber(client):
    sub = client.post("/api/subscribers", json={"email": "eve@example.com"}).json()
    r = client.delete(f"/api/subscribers/{sub['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"
    assert client.get(f"/api/subscribers/{sub['id']}").status_code == 404


def test_delete_missing_subscriber_is_idempotent(client):
    r = client.delete("/api/subscribers/9999")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_import_csv(client):
    payload = {
        "csv_content": "alice@example.com,Alice,Smith\nbob@example.com\n# comment\nbroken-row\n",
        "tags": ["imported"],
    }
    r = client.post("/api/subscribers/import", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["inserted"] == 2
    assert body["skipped"] == 1
    listed = client.get("/api/subscribers").json()
    assert len(listed) == 2
    assert all("imported" in s["tags"] for s in listed)


def test_export_csv(client):
    client.post("/api/subscribers", json={"email": "ann@example.com", "first_name": "Ann"})
    r = client.get("/api/subscribers-export")
    assert r.status_code == 200
    assert "ann@example.com" in r.text
    assert r.headers["content-type"].startswith("text/csv")


def test_tags_aggregates(client):
    client.post("/api/subscribers", json={"email": "a@example.com", "tags": ["vip", "lead"]})
    client.post("/api/subscribers", json={"email": "b@example.com", "tags": ["vip"]})
    r = client.get("/api/tags")
    assert r.status_code == 200
    rows = r.json()
    by_name = {row["name"]: row["count"] for row in rows}
    assert by_name["vip"] == 2
    assert by_name["lead"] == 1


def test_unsubscribe_via_token(client):
    sub = client.post("/api/subscribers", json={"email": "f@example.com"}).json()
    token = sub["unsubscribeToken"]
    r = client.get(f"/api/unsubscribe/{token}")
    assert r.status_code == 200
    # After hitting the public page, status should flip
    refetched = client.get(f"/api/subscribers/{sub['id']}").json()
    assert refetched["status"] == "unsubscribed"


def test_one_click_unsubscribe_post(client):
    sub = client.post("/api/subscribers", json={"email": "g@example.com"}).json()
    r = client.post(f"/api/unsubscribe/{sub['unsubscribeToken']}")
    assert r.status_code == 200
    assert r.json()["status"] == "unsubscribed"


def test_invalid_email_rejected(client):
    r = client.post("/api/subscribers", json={"email": "not-an-email"})
    assert r.status_code == 422
