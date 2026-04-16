"""Tests for technical indicators endpoints."""
from datetime import datetime, timedelta
import math
import pytest


@pytest.fixture
def seeded_stock(db):
    """Seed a stock with enough candle data for indicator calculations."""
    from models import Stock, StockPrice, Candle

    stock = Stock(symbol="AAPL", name="Apple Inc.", sector="Technology", exchange="NASDAQ")
    db.add(stock)
    db.flush()

    db.add(StockPrice(stock_id=stock.id, price=150.0, open_price=148.0, high=152.0,
                      low=147.0, prev_close=149.0, volume=1000000, change=1.0, change_pct=0.67))

    # Generate 50 daily candles with some price variation (needed for RSI, MACD, BB)
    base = datetime(2026, 1, 1)
    for i in range(50):
        # Sine wave price for realistic indicator values
        price = 150.0 + 10 * math.sin(i * 0.3) + i * 0.1
        db.add(Candle(
            stock_id=stock.id, timeframe="1D",
            timestamp=base + timedelta(days=i),
            open_price=price - 1, high=price + 2, low=price - 2,
            close_price=price, volume=1000000 + i * 10000,
        ))
    db.commit()
    return stock


def test_get_sma(client, seeded_stock):
    """GET /api/stocks/AAPL/indicators?type=SMA returns SMA data."""
    response = client.get("/api/stocks/AAPL/indicators", params={"type": "SMA"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    point = data[0]
    assert "timestamp" in point
    assert "value" in point
    assert isinstance(point["value"], (int, float))


def test_get_rsi(client, seeded_stock):
    """GET /api/stocks/AAPL/indicators?type=RSI returns RSI values between 0-100."""
    response = client.get("/api/stocks/AAPL/indicators", params={"type": "RSI"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    for point in data:
        assert "value" in point
        assert 0 <= point["value"] <= 100


def test_get_macd(client, seeded_stock):
    """GET /api/stocks/AAPL/indicators?type=MACD returns macd, signal, histogram."""
    response = client.get("/api/stocks/AAPL/indicators", params={"type": "MACD"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    point = data[0]
    assert "macd" in point
    assert "signal" in point
    assert "histogram" in point


def test_get_bollinger_bands(client, seeded_stock):
    """GET /api/stocks/AAPL/indicators?type=BB returns upper, middle, lower."""
    response = client.get("/api/stocks/AAPL/indicators", params={"type": "BB"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    point = data[0]
    assert "upper" in point
    assert "middle" in point
    assert "lower" in point
    assert point["upper"] >= point["middle"]
    assert point["middle"] >= point["lower"]


def test_invalid_indicator(client, seeded_stock):
    """Invalid indicator type returns 400."""
    response = client.get("/api/stocks/AAPL/indicators", params={"type": "INVALID_INDICATOR"})
    assert response.status_code == 400
