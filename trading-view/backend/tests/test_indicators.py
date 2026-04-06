"""Tests for technical indicators endpoints."""


def test_get_sma(client):
    """GET /api/stocks/AAPL/indicators?type=SMA returns SMA data."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get(
        "/api/stocks/AAPL/indicators",
        params={"type": "SMA"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # Each SMA point should have timestamp and value
    point = data[0]
    assert "timestamp" in point
    assert "value" in point
    assert isinstance(point["value"], (int, float))


def test_get_rsi(client):
    """GET /api/stocks/AAPL/indicators?type=RSI returns RSI values between 0-100."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get(
        "/api/stocks/AAPL/indicators",
        params={"type": "RSI"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # RSI should be between 0 and 100
    for point in data:
        assert "value" in point
        assert 0 <= point["value"] <= 100


def test_get_macd(client):
    """GET /api/stocks/AAPL/indicators?type=MACD returns macd, signal, histogram."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get(
        "/api/stocks/AAPL/indicators",
        params={"type": "MACD"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    point = data[0]
    assert "macd" in point
    assert "signal" in point
    assert "histogram" in point


def test_get_bollinger_bands(client):
    """GET /api/stocks/AAPL/indicators?type=BB returns upper, middle, lower."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get(
        "/api/stocks/AAPL/indicators",
        params={"type": "BB"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    point = data[0]
    assert "upper" in point
    assert "middle" in point
    assert "lower" in point
    # Upper should be >= middle >= lower
    assert point["upper"] >= point["middle"]
    assert point["middle"] >= point["lower"]


def test_invalid_indicator(client):
    """Invalid indicator type returns 400."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get(
        "/api/stocks/AAPL/indicators",
        params={"type": "INVALID_INDICATOR"},
    )
    assert response.status_code == 400
