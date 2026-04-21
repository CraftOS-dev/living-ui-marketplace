"""
Tests for Feature 3: Evolution & Life Cycle
Tests GET /api/pet/evolution-status, POST /api/pet/retire
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from models import Pet, VALID_STAGES, STAGE_THRESHOLDS
from datetime import datetime


def create_test_pet(client: TestClient, name: str = "Bitsy") -> dict:
    response = client.post("/api/pet", json={"name": name})
    assert response.status_code == 200
    return response.json()


def test_evolution_status_returns_stage_info(client: TestClient):
    """GET /api/pet/evolution-status returns stage and evolution info."""
    create_test_pet(client)
    response = client.get("/api/pet/evolution-status")
    assert response.status_code == 200
    data = response.json()
    assert "stage" in data
    assert "evolution_points" in data
    assert "current_threshold" in data
    assert "next_stage" in data
    assert "can_retire" in data
    assert "is_max_stage" in data


def test_evolution_status_egg_stage(client: TestClient):
    """New pet starts at egg stage with 0 evolution points."""
    create_test_pet(client)
    response = client.get("/api/pet/evolution-status")
    data = response.json()
    assert data["stage"] == "egg"
    assert data["evolution_points"] == 0
    assert data["next_stage"] == "baby"
    assert data["can_retire"] == False
    assert data["is_max_stage"] == False


def test_evolution_status_no_pet_returns_404(client: TestClient):
    """Evolution status without a pet returns 404."""
    response = client.get("/api/pet/evolution-status")
    assert response.status_code == 404


def test_retire_non_adult_returns_message(client: TestClient):
    """Retiring a non-adult pet returns 200 with retire_message=not_adult."""
    create_test_pet(client)
    response = client.post("/api/pet/retire")
    assert response.status_code == 200
    data = response.json()
    assert data["can_retire"] == False
    assert data["retire_message"] == "not_adult"


def test_retire_adult_without_enough_points_returns_message(client: TestClient, db: Session):
    """Retiring adult without enough points returns 200 with retire_message=not_ready_to_retire."""
    create_test_pet(client)
    # Manually set pet to adult stage but with insufficient evo points
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.stage = "adult"
    pet.evolution_points = 100  # Below retirement threshold of 700
    db.commit()
    response = client.post("/api/pet/retire")
    assert response.status_code == 200
    data = response.json()
    assert data["can_retire"] == False
    assert data["retire_message"] == "not_ready_to_retire"


def test_retire_adult_with_enough_points(client: TestClient, db: Session):
    """Can retire an adult pet with enough evolution points."""
    create_test_pet(client)
    # Manually set pet to adult stage with enough evo points
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.stage = "adult"
    pet.evolution_points = 700  # At retirement threshold
    db.commit()
    response = client.post("/api/pet/retire")
    assert response.status_code == 200
    data = response.json()
    assert data["is_retired"] == True
    assert data["retired_at"] is not None


def test_retired_pet_no_longer_active(client: TestClient, db: Session):
    """After retirement, GET /api/pet returns 404 (no active pet)."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.stage = "adult"
    pet.evolution_points = 700
    db.commit()
    client.post("/api/pet/retire")
    response = client.get("/api/pet")
    assert response.status_code == 404


def test_get_retired_pet(client: TestClient, db: Session):
    """GET /api/pet/retired returns the most recently retired pet."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.stage = "adult"
    pet.evolution_points = 700
    db.commit()
    client.post("/api/pet/retire")
    response = client.get("/api/pet/retired")
    assert response.status_code == 200
    data = response.json()
    assert data["is_retired"] == True


def test_get_retired_pet_no_retired_pet_returns_null(client: TestClient):
    """GET /api/pet/retired returns 200 with null when no retired pet exists."""
    response = client.get("/api/pet/retired")
    assert response.status_code == 200
    data = response.json()
    assert data["retired"] == False
    assert data["pet"] is None


def test_pet_evolution_via_apply_decay(client: TestClient, db: Session):
    """Pet evolves from egg to baby when evolution points reach threshold."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    # Set evolution points just below threshold
    pet.evolution_points = 49
    pet.hunger = 80.0
    pet.happiness = 80.0
    pet.health = 80.0
    db.commit()
    # Apply decay with enough time to earn 2+ evo points (stats > 70)
    pet.apply_decay(1.0)  # 1 minute with good stats = 2 evo points
    db.commit()
    assert pet.stage == "baby"  # Should have evolved
