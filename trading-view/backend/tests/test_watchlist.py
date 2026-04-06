"""Tests for watchlist endpoints."""


def test_add_to_watchlist(client):
    """POST /api/watchlist adds a stock."""
    client.post("/api/stocks/seed")
    response = client.post("/api/watchlist", json={"symbol": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["stockId"] is not None or data.get("symbol") == "AAPL"


def test_get_watchlist(client):
    """GET /api/watchlist returns added stocks with prices."""
    client.post("/api/stocks/seed")
    client.post("/api/watchlist", json={"symbol": "AAPL"})
    client.post("/api/watchlist", json={"symbol": "MSFT"})

    response = client.get("/api/watchlist")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2


def test_delete_from_watchlist(client):
    """DELETE /api/watchlist/{id} removes entry."""
    client.post("/api/stocks/seed")
    add_resp = client.post("/api/watchlist", json={"symbol": "AAPL"})
    entry_id = add_resp.json()["id"]

    del_resp = client.delete(f"/api/watchlist/{entry_id}")
    assert del_resp.status_code == 200

    # Verify it's gone
    list_resp = client.get("/api/watchlist")
    assert list_resp.status_code == 200
    data = list_resp.json()
    ids = [item["id"] for item in data]
    assert entry_id not in ids


def test_duplicate_watchlist(client):
    """Adding same stock twice returns 409 Conflict."""
    client.post("/api/stocks/seed")
    client.post("/api/watchlist", json={"symbol": "AAPL"})
    response = client.post("/api/watchlist", json={"symbol": "AAPL"})
    assert response.status_code == 409


def test_reorder_watchlist(client):
    """PUT /api/watchlist/reorder updates sort order."""
    client.post("/api/stocks/seed")
    resp1 = client.post("/api/watchlist", json={"symbol": "AAPL"})
    resp2 = client.post("/api/watchlist", json={"symbol": "MSFT"})
    id1 = resp1.json()["id"]
    id2 = resp2.json()["id"]

    # Reorder: put MSFT first, AAPL second
    reorder_resp = client.put(
        "/api/watchlist/reorder",
        json={"items": [{"id": id2, "sortOrder": 0}, {"id": id1, "sortOrder": 1}]},
    )
    assert reorder_resp.status_code == 200
