"""Tests for the price tick endpoint.

`tick_simulation` only refreshes prices for stocks that already have a
StockPrice row (lazy-loaded on first user interaction). The unit test
fixture pre-creates those rows.
"""


def test_get_prices_returns_active_stocks(client, seeded_universe):
    """GET /api/stocks/prices returns a {symbol: {price,...}} map."""
    response = client.get("/api/stocks/prices")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    # All seeded stocks should appear
    assert "AAPL" in data
    info = data["AAPL"]
    assert "price" in info
    assert info["price"] > 0


def test_get_single_price(client, seeded_universe):
    """GET /api/stocks/AAPL/price returns the seeded price."""
    response = client.get("/api/stocks/AAPL/price")
    assert response.status_code == 200
    data = response.json()
    assert data["symbol"] == "AAPL"
    assert "price" in data
    price_data = data["price"]
    assert isinstance(price_data, dict)
    assert price_data["price"] > 0


def test_get_price_unknown_symbol_404(client, seeded_universe):
    """Unknown symbol returns 404, not a fallback to another stock."""
    response = client.get("/api/stocks/NOPESYM/price")
    assert response.status_code == 404
