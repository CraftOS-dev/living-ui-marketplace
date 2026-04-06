"""Tests for price simulation."""


def test_get_prices(client):
    """GET /api/stocks/prices returns prices after seeding."""
    client.post("/api/stocks/seed")
    response = client.get("/api/stocks/prices")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict) or isinstance(data, list)
    # Should have price entries
    if isinstance(data, dict):
        assert len(data) > 0
        # Each entry should have price info
        for symbol, info in data.items():
            assert "price" in info
            assert info["price"] > 0
    else:
        assert len(data) > 0


def test_get_single_price(client):
    """GET /api/stocks/AAPL/price returns a single price."""
    client.post("/api/stocks/seed")
    response = client.get("/api/stocks/AAPL/price")
    assert response.status_code == 200
    data = response.json()
    assert "price" in data
    # price is a nested dict with price field
    price_data = data["price"]
    assert isinstance(price_data, dict)
    assert price_data["price"] > 0


def test_prices_update(client):
    """Prices should change between consecutive calls."""
    client.post("/api/stocks/seed")
    # First price fetch (triggers a tick)
    response1 = client.get("/api/stocks/prices")
    assert response1.status_code == 200
    data1 = response1.json()

    # Second price fetch (triggers another tick)
    response2 = client.get("/api/stocks/prices")
    assert response2.status_code == 200
    data2 = response2.json()

    # At least some prices should have changed between ticks
    # (with GBM simulation, it's extremely unlikely all stay the same)
    if isinstance(data1, dict) and isinstance(data2, dict):
        changed = any(
            data1.get(sym, {}).get("price") != data2.get(sym, {}).get("price")
            for sym in data1
        )
        assert changed, "Expected at least some prices to change between ticks"
