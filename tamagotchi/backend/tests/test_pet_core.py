"""
Tests for Feature 1: Pet Core & Stats
Tests GET /api/pet, POST /api/pet, PUT /api/pet/tick
"""
import pytest
from fastapi.testclient import TestClient


def test_get_pet_no_pet_exists(client: TestClient):
    """GET /api/pet returns 404 when no pet exists."""
    response = client.get("/api/pet")
    assert response.status_code == 404
    data = response.json()
    assert data["detail"] == "no_pet"


def test_create_pet(client: TestClient):
    """POST /api/pet creates a new pet."""
    response = client.post("/api/pet", json={"name": "Bitsy"})
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bitsy"
    assert data["stage"] == "egg"
    assert data["hunger"] == 80.0
    assert data["happiness"] == 80.0
    assert data["health"] == 100.0
    assert data["is_sleeping"] == False
    assert data["is_sick"] == False
    assert data["is_retired"] == False
    assert data["evolution_points"] == 0
    assert "id" in data
    assert "created_at" in data


def test_create_pet_requires_name(client: TestClient):
    """POST /api/pet requires a name."""
    response = client.post("/api/pet", json={})
    assert response.status_code == 422


def test_get_pet_after_creation(client: TestClient):
    """GET /api/pet returns the pet after creation."""
    client.post("/api/pet", json={"name": "Bitsy"})
    response = client.get("/api/pet")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bitsy"
    assert data["stage"] == "egg"


def test_create_pet_when_active_pet_exists_returns_existing(client: TestClient):
    """POST /api/pet returns existing pet (200) if an active pet already exists."""
    client.post("/api/pet", json={"name": "Bitsy"})
    response = client.post("/api/pet", json={"name": "Sparky"})
    assert response.status_code == 200
    data = response.json()
    # Returns the existing pet, not a new one
    assert data["name"] == "Bitsy"


def test_pet_tick_updates_stats(client: TestClient):
    """PUT /api/pet/tick updates stats based on elapsed time."""
    client.post("/api/pet", json={"name": "Bitsy"})
    response = client.put("/api/pet/tick")
    assert response.status_code == 200
    data = response.json()
    assert "hunger" in data
    assert "happiness" in data
    assert "health" in data


def test_pet_tick_no_pet_returns_404(client: TestClient):
    """PUT /api/pet/tick returns 404 when no pet exists."""
    response = client.put("/api/pet/tick")
    assert response.status_code == 404


def test_pet_stats_have_correct_range(client: TestClient):
    """Pet stats should always be between 0 and 100."""
    client.post("/api/pet", json={"name": "Bitsy"})
    response = client.get("/api/pet")
    data = response.json()
    assert 0 <= data["hunger"] <= 100
    assert 0 <= data["happiness"] <= 100
    assert 0 <= data["health"] <= 100


def test_pet_mood_is_computed(client: TestClient):
    """GET /api/pet returns a mood field."""
    client.post("/api/pet", json={"name": "Bitsy"})
    response = client.get("/api/pet")
    data = response.json()
    assert "mood" in data
    assert data["mood"] in ["happy", "excited", "neutral", "hungry", "sad", "sick", "sleeping", "critical"]
