"""Tests for widget config endpoints."""


def test_get_widget_configs_creates_defaults(client):
    """GET /widget-configs should create 7 default configs if none exist."""
    response = client.get("/api/widget-configs")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 7
    widget_ids = {w["widgetId"] for w in data}
    assert "clock" in widget_ids
    assert "weather" in widget_ids
    assert "briefing" in widget_ids


def test_get_widget_configs_idempotent(client):
    """Calling GET twice should not duplicate configs."""
    client.get("/api/widget-configs")
    response = client.get("/api/widget-configs")
    assert response.status_code == 200
    assert len(response.json()) == 7


def test_update_widget_config_enabled(client):
    """PUT /widget-configs/{id} should toggle enabled state."""
    client.get("/api/widget-configs")
    response = client.put("/api/widget-configs/clock", json={"enabled": False})
    assert response.status_code == 200
    data = response.json()
    assert data["widgetId"] == "clock"
    assert data["enabled"] is False


def test_update_widget_config_position(client):
    """PUT /widget-configs/{id} should update position."""
    client.get("/api/widget-configs")
    response = client.put("/api/widget-configs/weather", json={"position": 5})
    assert response.status_code == 200
    assert response.json()["position"] == 5


def test_update_widget_config_settings(client):
    """PUT /widget-configs/{id} should merge widget_settings."""
    client.get("/api/widget-configs")
    response = client.put("/api/widget-configs/clock", json={"widget_settings": {"format": "24h"}})
    assert response.status_code == 200
    assert response.json()["widgetSettings"]["format"] == "24h"


def test_update_widget_config_unknown_widget(client):
    """PUT with unknown widget_id should return 404."""
    client.get("/api/widget-configs")
    response = client.put("/api/widget-configs/nonexistent", json={"enabled": False})
    assert response.status_code == 404
