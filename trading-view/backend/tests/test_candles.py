"""Tests for candle data endpoints."""


def test_get_candles_daily(client):
    """GET /api/stocks/AAPL/candles?timeframe=1D returns daily candles."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get("/api/stocks/AAPL/candles", params={"timeframe": "1D"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_candles_with_limit(client):
    """Candles endpoint respects limit parameter."""
    client.post("/api/stocks/seed?sync=true")
    limit = 10
    response = client.get(
        "/api/stocks/AAPL/candles",
        params={"timeframe": "1D", "limit": limit},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) <= limit


def test_candle_structure(client):
    """Each candle has required fields: timestamp, open, high, low, close, volume."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get("/api/stocks/AAPL/candles", params={"timeframe": "1D"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0

    candle = data[0]
    # Check for required OHLCV fields (camelCase as returned by to_dict)
    assert "timestamp" in candle
    assert "openPrice" in candle
    assert "high" in candle
    assert "low" in candle
    assert "closePrice" in candle
    assert "volume" in candle

    # Verify OHLC relationships
    assert candle["high"] >= candle["low"]
    assert candle["volume"] >= 0


def test_get_candles_invalid_symbol(client):
    """Returns 404 for unknown symbol."""
    client.post("/api/stocks/seed?sync=true")
    response = client.get(
        "/api/stocks/INVALID/candles",
        params={"timeframe": "1D"},
    )
    assert response.status_code == 404
