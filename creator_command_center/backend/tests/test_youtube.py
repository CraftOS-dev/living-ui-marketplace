"""Tests for YouTube cache CRUD and integration status."""


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_list_channels_empty(client):
    response = client.get("/api/youtube/channels")
    assert response.status_code == 200
    assert response.json() == []


def test_list_videos_empty(client):
    response = client.get("/api/youtube/videos")
    assert response.status_code == 200
    assert response.json() == []


def test_integration_status(client):
    """Integration status should work even without bridge."""
    response = client.get("/api/integrations/status")
    assert response.status_code == 200
    data = response.json()
    assert "bridgeAvailable" in data
    assert "integrations" in data


def test_state_crud(client):
    """App state should persist."""
    # Get initial state
    response = client.get("/api/state")
    assert response.status_code == 200

    # Update state
    response = client.put("/api/state", json={"data": {"theme": "dark"}})
    assert response.status_code == 200
    assert response.json()["data"]["theme"] == "dark"

    # Clear state
    response = client.delete("/api/state")
    assert response.status_code == 200
