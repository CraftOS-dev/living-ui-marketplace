"""Tests for price alerts endpoints."""


def test_create_alert(client):
    """POST /api/alerts creates an alert."""
    client.post("/api/stocks/seed")
    response = client.post(
        "/api/alerts",
        json={
            "symbol": "AAPL",
            "targetPrice": 200.0,
            "condition": "above",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["targetPrice"] == 200.0
    assert data["condition"] == "above"
    assert data["active"] is True
    assert data["triggered"] is False


def test_get_alerts(client):
    """GET /api/alerts returns active alerts."""
    client.post("/api/stocks/seed")
    client.post(
        "/api/alerts",
        json={"symbol": "AAPL", "targetPrice": 200.0, "condition": "above"},
    )
    client.post(
        "/api/alerts",
        json={"symbol": "MSFT", "targetPrice": 400.0, "condition": "below"},
    )

    response = client.get("/api/alerts")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2


def test_delete_alert(client):
    """DELETE /api/alerts/{id} removes alert."""
    client.post("/api/stocks/seed")
    create_resp = client.post(
        "/api/alerts",
        json={"symbol": "AAPL", "targetPrice": 200.0, "condition": "above"},
    )
    alert_id = create_resp.json()["id"]

    del_resp = client.delete(f"/api/alerts/{alert_id}")
    assert del_resp.status_code == 200

    # Verify it's gone
    list_resp = client.get("/api/alerts")
    assert list_resp.status_code == 200
    ids = [a["id"] for a in list_resp.json()]
    assert alert_id not in ids


def test_filter_alerts_by_symbol(client):
    """GET /api/alerts?symbol=AAPL filters by stock."""
    client.post("/api/stocks/seed")
    client.post(
        "/api/alerts",
        json={"symbol": "AAPL", "targetPrice": 200.0, "condition": "above"},
    )
    client.post(
        "/api/alerts",
        json={"symbol": "MSFT", "targetPrice": 400.0, "condition": "below"},
    )

    response = client.get("/api/alerts", params={"symbol": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["targetPrice"] == 200.0
