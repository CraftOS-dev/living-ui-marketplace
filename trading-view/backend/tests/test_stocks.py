"""Tests for stock CRUD and seed endpoints."""


def test_seed_stocks(client):
    """POST /api/stocks/seed creates stocks and returns them."""
    response = client.post("/api/stocks/seed")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # Check that AAPL is in the seeded stocks
    symbols = [s["symbol"] for s in data]
    assert "AAPL" in symbols
    # Each stock should have required fields
    stock = data[0]
    assert "id" in stock
    assert "symbol" in stock
    assert "name" in stock
    assert "sector" in stock


def test_list_stocks(client):
    """GET /api/stocks returns all stocks after seeding."""
    client.post("/api/stocks/seed")
    response = client.get("/api/stocks")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    symbols = [s["symbol"] for s in data]
    assert "AAPL" in symbols
    assert "MSFT" in symbols


def test_search_stocks(client):
    """GET /api/stocks/search?q=apple finds AAPL."""
    client.post("/api/stocks/seed")
    response = client.get("/api/stocks/search", params={"q": "apple"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    symbols = [s["symbol"] for s in data]
    assert "AAPL" in symbols


def test_search_stocks_by_symbol(client):
    """GET /api/stocks/search?q=AAPL finds Apple."""
    client.post("/api/stocks/seed")
    response = client.get("/api/stocks/search", params={"q": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    names = [s["name"] for s in data]
    assert any("Apple" in name for name in names)


def test_search_no_results(client):
    """GET /api/stocks/search?q=ZZZZZ returns empty list."""
    client.post("/api/stocks/seed")
    response = client.get("/api/stocks/search", params={"q": "ZZZZZ"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 0
