"""Tests for stock CRUD and seed endpoints.

These tests use a manually-seeded universe (no network). The real
/api/stocks/seed endpoint is exercised in the external smoke-test suite
because it hits NASDAQ Trader and Yahoo Finance.
"""


def test_list_stocks(client, seeded_universe):
    """GET /api/stocks returns seeded stocks."""
    response = client.get("/api/stocks")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    symbols = [s["symbol"] for s in data]
    assert "AAPL" in symbols
    assert "MSFT" in symbols


def test_search_stocks(client, seeded_universe):
    """GET /api/stocks/search?q=apple finds AAPL."""
    response = client.get("/api/stocks/search", params={"q": "apple"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    symbols = [s["symbol"] for s in data]
    assert "AAPL" in symbols


def test_search_stocks_by_symbol(client, seeded_universe):
    """GET /api/stocks/search?q=AAPL finds Apple."""
    response = client.get("/api/stocks/search", params={"q": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    names = [s["name"] for s in data]
    assert any("Apple" in name for name in names)


def test_search_no_results(client, seeded_universe):
    """GET /api/stocks/search?q=ZZZZZ returns empty list."""
    response = client.get("/api/stocks/search", params={"q": "ZZZZZ"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 0


def test_search_respects_limit(client, seeded_universe):
    """GET /api/stocks/search?limit=2 returns at most 2 entries."""
    response = client.get("/api/stocks/search", params={"q": "Inc", "limit": 2})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) <= 2
