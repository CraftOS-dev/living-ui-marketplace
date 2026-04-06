"""Tests for drawing tools endpoints."""


def test_create_drawing(client):
    """POST /api/stocks/AAPL/drawings creates a drawing."""
    client.post("/api/stocks/seed")
    response = client.post(
        "/api/stocks/AAPL/drawings",
        json={
            "timeframe": "1D",
            "toolType": "trendline",
            "drawingData": {"x1": 0, "y1": 100, "x2": 10, "y2": 150},
            "color": "#FF0000",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["toolType"] == "trendline"
    assert data["color"] == "#FF0000"


def test_get_drawings(client):
    """GET /api/stocks/AAPL/drawings returns drawings."""
    client.post("/api/stocks/seed")
    # Create a drawing first
    client.post(
        "/api/stocks/AAPL/drawings",
        json={
            "timeframe": "1D",
            "toolType": "horizontal",
            "drawingData": {"price": 175.0},
        },
    )

    response = client.get("/api/stocks/AAPL/drawings")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert data[0]["toolType"] == "horizontal"


def test_update_drawing(client):
    """PUT /api/drawings/{id} updates a drawing."""
    client.post("/api/stocks/seed")
    create_resp = client.post(
        "/api/stocks/AAPL/drawings",
        json={
            "timeframe": "1D",
            "toolType": "trendline",
            "drawingData": {"x1": 0, "y1": 100, "x2": 10, "y2": 150},
            "color": "#FF0000",
        },
    )
    drawing_id = create_resp.json()["id"]

    update_resp = client.put(
        f"/api/drawings/{drawing_id}",
        json={
            "color": "#00FF00",
            "drawingData": {"x1": 0, "y1": 100, "x2": 20, "y2": 200},
        },
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["color"] == "#00FF00"


def test_delete_drawing(client):
    """DELETE /api/drawings/{id} removes drawing."""
    client.post("/api/stocks/seed")
    create_resp = client.post(
        "/api/stocks/AAPL/drawings",
        json={
            "timeframe": "1D",
            "toolType": "text",
            "drawingData": {"text": "Support level"},
        },
    )
    drawing_id = create_resp.json()["id"]

    del_resp = client.delete(f"/api/drawings/{drawing_id}")
    assert del_resp.status_code == 200

    # Verify it's gone
    list_resp = client.get("/api/stocks/AAPL/drawings")
    assert list_resp.status_code == 200
    ids = [d["id"] for d in list_resp.json()]
    assert drawing_id not in ids
