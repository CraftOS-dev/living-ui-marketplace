"""Tests for sender identity, integrations status, and analytics dashboard."""


def test_sender_identity_starts_empty(client):
    r = client.get("/api/sender-identity")
    assert r.status_code == 200
    body = r.json()
    assert body["fromEmail"] == ""
    assert body["fromName"] == ""


def test_update_sender_identity(client):
    r = client.put("/api/sender-identity", json={
        "from_name": "Acme",
        "from_email": "hi@acme.com",
        "reply_to": "support@acme.com",
        "organization_name": "Acme Inc.",
        "organization_address": "1 Test St, Earth",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["fromName"] == "Acme"
    assert body["fromEmail"] == "hi@acme.com"
    assert body["replyTo"] == "support@acme.com"


def test_integrations_status_shape(client):
    r = client.get("/api/integrations")
    assert r.status_code == 200
    body = r.json()
    assert "llm" in body
    assert "gmail" in body
    assert "connected" in body["llm"]
    assert "bridge" in body["gmail"]


def test_analytics_overview_empty(client):
    r = client.get("/api/analytics/overview")
    assert r.status_code == 200
    body = r.json()
    assert body["subscribers"]["total"] == 0
    assert body["campaigns"]["totalSent"] == 0


def test_analytics_overview_with_data(client):
    for i in range(3):
        client.post("/api/subscribers", json={"email": f"u{i}@example.com"})
    r = client.get("/api/analytics/overview")
    body = r.json()
    assert body["subscribers"]["total"] == 3
    assert body["subscribers"]["active"] == 3


def test_dashboard_returns_overview_recent_upcoming(client):
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert "overview" in body
    assert "recentCampaigns" in body
    assert "upcomingCampaigns" in body


def test_sender_identity_returns_subscribe_key(client):
    r = client.get("/api/sender-identity")
    body = r.json()
    assert "subscribeKey" in body
    assert len(body["subscribeKey"]) > 10  # auto-generated, not empty


def test_rotate_subscribe_key(client):
    before = client.get("/api/sender-identity").json()["subscribeKey"]
    r = client.post("/api/sender-identity/rotate-subscribe-key")
    assert r.status_code == 200
    after = r.json()["subscribeKey"]
    assert after and after != before


def test_public_subscribe_without_key_blocked_when_one_is_set(client):
    # First read auto-generates a key.
    client.get("/api/sender-identity")
    r = client.post("/api/subscribe", json={"email": "alice@example.com"})
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "error"


def test_public_subscribe_with_matching_key(client):
    key = client.get("/api/sender-identity").json()["subscribeKey"]
    r = client.post(
        "/api/subscribe",
        json={"email": "alice@example.com", "first_name": "Alice", "key": key},
    )
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "subscribed"
    assert body["email"] == "alice@example.com"
    # The subscriber is now in the list
    listed = client.get("/api/subscribers").json()
    assert any(s["email"] == "alice@example.com" for s in listed)


def test_public_subscribe_resubscribes_unsubscribed(client):
    key = client.get("/api/sender-identity").json()["subscribeKey"]
    # Initial subscribe
    client.post("/api/subscribe", json={"email": "b@example.com", "key": key})
    sub = client.get("/api/subscribers").json()[0]
    # Unsubscribe via PUT
    client.put(f"/api/subscribers/{sub['id']}", json={"status": "unsubscribed"})
    # Submit the form again
    r = client.post("/api/subscribe", json={"email": "b@example.com", "key": key})
    body = r.json()
    assert body["status"] == "resubscribed"
    refetch = client.get(f"/api/subscribers/{sub['id']}").json()
    assert refetch["status"] == "subscribed"


def test_public_subscribe_already_subscribed(client):
    key = client.get("/api/sender-identity").json()["subscribeKey"]
    client.post("/api/subscribe", json={"email": "c@example.com", "key": key})
    r = client.post("/api/subscribe", json={"email": "c@example.com", "key": key})
    assert r.json()["status"] == "already_subscribed"


def test_public_subscribe_invalid_email(client):
    key = client.get("/api/sender-identity").json()["subscribeKey"]
    r = client.post("/api/subscribe", json={"email": "not-an-email", "key": key})
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "error"


def test_state_endpoints(client):
    r = client.get("/api/state")
    assert r.status_code == 200
    r2 = client.put("/api/state", json={"data": {"activeSection": "subscribers"}})
    assert r2.status_code == 200
    assert r2.json()["activeSection"] == "subscribers"
    r3 = client.delete("/api/state")
    assert r3.status_code == 200
