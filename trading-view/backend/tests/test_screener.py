"""Tests for stock screener endpoints.

Uses a manually-seeded fixture to avoid hitting the real network during
unit tests. The real /api/stocks/seed endpoint pulls from NASDAQ Trader
and Yahoo Finance, which is exercised in the external smoke-test suite.
"""
import pytest


@pytest.fixture
def priced_stocks(db):
    """Insert a small handful of stocks WITH StockPrice rows.

    The screener INNER-JOINs Stock and StockPrice, so unpriced rows
    (which is the default for newly-seeded universe rows) wouldn't show up.
    """
    from models import Stock, StockPrice

    fixtures = [
        ("AAPL", "Apple Inc.", "Technology", 175.0, 1.0),
        ("MSFT", "Microsoft Corporation", "Technology", 415.0, 2.5),
        ("JPM", "JPMorgan Chase", "Financial", 195.0, -0.5),
        ("XOM", "Exxon Mobil", "Energy", 105.0, 0.2),
    ]
    for sym, name, sector, price, change_pct in fixtures:
        s = Stock(symbol=sym, name=name, sector=sector, exchange="NASDAQ")
        db.add(s)
        db.flush()
        db.add(StockPrice(
            stock_id=s.id, price=price, open_price=price, high=price + 1,
            low=price - 1, prev_close=price - (price * change_pct / 100),
            volume=1_000_000, change=price * change_pct / 100, change_pct=change_pct,
        ))
    db.commit()


def test_screener_all(client, priced_stocks):
    """GET /api/screener returns priced stocks."""
    response = client.get("/api/screener")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 4
    entry = data[0]
    assert "symbol" in entry
    assert "name" in entry


def test_screener_by_sector(client, priced_stocks):
    """GET /api/screener?sector=Technology filters by sector."""
    response = client.get("/api/screener", params={"sector": "Technology"})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    for entry in data:
        assert entry["sector"] == "Technology"
    symbols = [e["symbol"] for e in data]
    assert "AAPL" in symbols


def test_screener_by_price(client, priced_stocks):
    """GET /api/screener?min_price=100&max_price=200 filters by price."""
    response = client.get(
        "/api/screener",
        params={"min_price": 100, "max_price": 200},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for entry in data:
        price_data = entry.get("price", {})
        price = price_data.get("price", 0) if isinstance(price_data, dict) else price_data
        assert 100 <= price <= 200


def test_screener_sort(client, priced_stocks):
    """GET /api/screener?sort=change_pct&sort_dir=desc sorts correctly."""
    response = client.get(
        "/api/screener",
        params={"sort": "change_pct", "sort_dir": "desc"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 1
    change_pcts = [
        entry.get("changePct", entry.get("change_pct", 0))
        for entry in data
    ]
    for i in range(len(change_pcts) - 1):
        assert change_pcts[i] >= change_pcts[i + 1]
