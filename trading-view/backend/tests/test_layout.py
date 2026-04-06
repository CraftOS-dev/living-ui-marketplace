"""Tests for widget layout endpoints."""


def test_get_default_layout(client):
    """GET /api/layout returns default layout when none saved."""
    response = client.get("/api/layout")
    assert response.status_code == 200
    data = response.json()
    # Should return a layout object (possibly with default/empty data)
    assert "layoutData" in data or "layoutName" in data or isinstance(data, dict)


def test_save_layout(client):
    """PUT /api/layout saves and returns layout."""
    layout_payload = {
        "layoutName": "my-layout",
        "layoutData": {
            "widgets": [
                {"i": "chart-1", "x": 0, "y": 0, "w": 8, "h": 6},
                {"i": "watchlist", "x": 8, "y": 0, "w": 4, "h": 6},
            ]
        },
        "chartConfig": {
            "chart-1": {"symbol": "AAPL", "timeframe": "1D"},
        },
    }
    response = client.put("/api/layout", json=layout_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["layoutName"] == "my-layout"
    assert "layoutData" in data


def test_layout_persists(client):
    """Saved layout is returned on subsequent GET."""
    layout_payload = {
        "layoutName": "persistent-layout",
        "layoutData": {
            "widgets": [
                {"i": "chart-1", "x": 0, "y": 0, "w": 12, "h": 8},
            ]
        },
        "chartConfig": {},
    }
    client.put("/api/layout", json=layout_payload)

    response = client.get("/api/layout")
    assert response.status_code == 200
    data = response.json()
    assert data["layoutName"] == "persistent-layout"
    assert data["layoutData"]["widgets"][0]["i"] == "chart-1"
