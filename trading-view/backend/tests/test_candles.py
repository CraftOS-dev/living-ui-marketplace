"""Tests for candle data endpoints."""
from datetime import datetime, timedelta
import pytest


@pytest.fixture
def seeded_stock(db):
    """Seed a stock with candle data directly — no yfinance dependency."""
    from models import Stock, StockPrice, Candle

    stock = Stock(symbol="AAPL", name="Apple Inc.", sector="Technology", exchange="NASDAQ")
    db.add(stock)
    db.flush()

    db.add(StockPrice(stock_id=stock.id, price=150.0, open_price=148.0, high=152.0,
                      low=147.0, prev_close=149.0, volume=1000000, change=1.0, change_pct=0.67))

    # Generate 30 daily candles
    base = datetime(2026, 1, 1)
    for i in range(30):
        price = 150.0 + i * 0.5
        db.add(Candle(
            stock_id=stock.id, timeframe="1D",
            timestamp=base + timedelta(days=i),
            open_price=price - 1, high=price + 2, low=price - 2,
            close_price=price, volume=1000000 + i * 10000,
        ))
    db.commit()
    return stock


def test_get_candles_daily(client, seeded_stock):
    """GET /api/stocks/AAPL/candles?timeframe=1D returns daily candles."""
    response = client.get("/api/stocks/AAPL/candles", params={"timeframe": "1D"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_candles_with_limit(client, seeded_stock):
    """Candles endpoint respects limit parameter."""
    limit = 10
    response = client.get("/api/stocks/AAPL/candles", params={"timeframe": "1D", "limit": limit})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) <= limit


def test_candle_structure(client, seeded_stock):
    """Each candle has required fields: timestamp, open, high, low, close, volume."""
    response = client.get("/api/stocks/AAPL/candles", params={"timeframe": "1D"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0

    candle = data[0]
    assert "timestamp" in candle
    assert "openPrice" in candle
    assert "high" in candle
    assert "low" in candle
    assert "closePrice" in candle
    assert "volume" in candle
    assert candle["high"] >= candle["low"]
    assert candle["volume"] >= 0


def test_get_candles_invalid_symbol(client, seeded_stock):
    """Returns 404 for unknown symbol."""
    response = client.get("/api/stocks/INVALID/candles", params={"timeframe": "1D"})
    assert response.status_code == 404
