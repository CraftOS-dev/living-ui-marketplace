"""Tests for news endpoints."""


def test_get_news(client):
    """GET /api/news returns news items after seeding."""
    client.post("/api/stocks/seed")
    response = client.get("/api/news")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # Each news item should have required fields
    item = data[0]
    assert "headline" in item
    assert "source" in item
    assert "publishedAt" in item


def test_get_news_by_symbol(client):
    """GET /api/news?symbol=AAPL returns stock-specific news or empty list."""
    client.post("/api/stocks/seed")
    response = client.get("/api/news", params={"symbol": "AAPL"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # If results exist, all should be for AAPL
    for item in data:
        assert item["stockSymbol"] == "AAPL"
