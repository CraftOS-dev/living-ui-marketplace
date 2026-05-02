"""Tests for news endpoints.

The real /api/news fetches from Yahoo Finance via yfinance. We pre-seed
some MarketNews rows in the test fixture so we can verify the endpoint
shape without depending on network.
"""


def test_get_news(client, seeded_universe):
    """GET /api/news returns news items from the cache."""
    response = client.get("/api/news")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    item = data[0]
    assert "headline" in item
    assert "source" in item
    assert "publishedAt" in item


def test_get_news_by_symbol(client, seeded_universe):
    """GET /api/news?symbol=AAPL returns AAPL-specific news."""
    response = client.get("/api/news", params={"symbol": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for item in data:
        assert item["stockSymbol"] == "AAPL"
