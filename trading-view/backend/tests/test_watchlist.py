"""Tests for watchlist endpoints."""


def test_add_to_watchlist(client, seeded_universe):
    """POST /api/watchlist adds a stock that exists in the universe."""
    response = client.post("/api/watchlist", json={"symbol": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["stock"]["symbol"] == "AAPL"


def test_add_unknown_symbol_returns_404(client, seeded_universe):
    """Adding a symbol not in the universe must return 404, never silently substitute."""
    response = client.post("/api/watchlist", json={"symbol": "NOPESYM"})
    assert response.status_code == 404


def test_get_watchlist(client, seeded_universe):
    """GET /api/watchlist returns added stocks with prices."""
    client.post("/api/watchlist", json={"symbol": "AAPL"})
    client.post("/api/watchlist", json={"symbol": "MSFT"})

    response = client.get("/api/watchlist")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2


def test_delete_from_watchlist(client, seeded_universe):
    """DELETE /api/watchlist/{id} removes entry."""
    add_resp = client.post("/api/watchlist", json={"symbol": "AAPL"})
    entry_id = add_resp.json()["id"]

    del_resp = client.delete(f"/api/watchlist/{entry_id}")
    assert del_resp.status_code == 200

    list_resp = client.get("/api/watchlist")
    assert list_resp.status_code == 200
    data = list_resp.json()
    ids = [item["id"] for item in data]
    assert entry_id not in ids


def test_duplicate_watchlist(client, seeded_universe):
    """Adding same stock twice returns 409 Conflict."""
    client.post("/api/watchlist", json={"symbol": "AAPL"})
    response = client.post("/api/watchlist", json={"symbol": "AAPL"})
    assert response.status_code == 409


def test_reorder_watchlist(client, seeded_universe):
    """PUT /api/watchlist/reorder updates sort order."""
    resp1 = client.post("/api/watchlist", json={"symbol": "AAPL"})
    resp2 = client.post("/api/watchlist", json={"symbol": "MSFT"})
    id1 = resp1.json()["id"]
    id2 = resp2.json()["id"]

    reorder_resp = client.put(
        "/api/watchlist/reorder",
        json={"items": [{"id": id2, "sortOrder": 0}, {"id": id1, "sortOrder": 1}]},
    )
    assert reorder_resp.status_code == 200
