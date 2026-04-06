"""Tests for stock screener endpoints."""


def test_screener_all(client):
    """GET /api/screener returns all stocks."""
    client.post("/api/stocks/seed")
    response = client.get("/api/screener")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # Each screener result should have basic stock + price info
    entry = data[0]
    assert "symbol" in entry
    assert "name" in entry


def test_screener_by_sector(client):
    """GET /api/screener?sector=Technology filters by sector."""
    client.post("/api/stocks/seed")
    response = client.get("/api/screener", params={"sector": "Technology"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # All results should be Technology sector
    for entry in data:
        assert entry["sector"] == "Technology"
    # Known tech stocks should be present
    symbols = [e["symbol"] for e in data]
    assert "AAPL" in symbols


def test_screener_by_price(client):
    """GET /api/screener?min_price=100&max_price=200 filters by price."""
    client.post("/api/stocks/seed")
    response = client.get(
        "/api/screener",
        params={"min_price": 100, "max_price": 200},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # All returned stocks should have prices in range
    for entry in data:
        price_data = entry.get("price", {})
        price = price_data.get("price", 0) if isinstance(price_data, dict) else price_data
        assert price >= 100
        assert price <= 200


def test_screener_sort(client):
    """GET /api/screener?sort=change_pct&sort_dir=desc sorts correctly."""
    client.post("/api/stocks/seed")
    response = client.get(
        "/api/screener",
        params={"sort": "change_pct", "sort_dir": "desc"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 1
    # Verify descending order of changePct
    change_pcts = [
        entry.get("changePct", entry.get("change_pct", 0))
        for entry in data
    ]
    for i in range(len(change_pcts) - 1):
        assert change_pcts[i] >= change_pcts[i + 1]
