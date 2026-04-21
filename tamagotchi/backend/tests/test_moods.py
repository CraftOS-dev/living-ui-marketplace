"""
Tests for Feature 4: Moods & SVG Pet Display
Tests mood computation based on pet stats
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from models import Pet


def create_test_pet(client: TestClient, name: str = "Bitsy") -> dict:
    response = client.post("/api/pet", json={"name": name})
    assert response.status_code == 200
    return response.json()


def test_new_pet_has_happy_mood(client: TestClient):
    """A new pet with good stats should be happy."""
    pet = create_test_pet(client)
    # New pet: hunger=80, happiness=80, health=100 — all above 70
    assert pet["mood"] == "happy"


def test_sleeping_pet_has_sleeping_mood(client: TestClient):
    """A sleeping pet should have sleeping mood."""
    create_test_pet(client)
    client.post("/api/pet/sleep")
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "sleeping"
    assert data["is_sleeping"] == True


def test_hungry_pet_mood(client: TestClient, db: Session):
    """A pet with low hunger should have hungry mood."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.hunger = 20.0  # Below 30 threshold
    pet.happiness = 80.0
    pet.health = 80.0
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "hungry"


def test_sad_pet_mood(client: TestClient, db: Session):
    """A pet with low happiness should have sad mood."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.hunger = 80.0
    pet.happiness = 20.0  # Below 30 threshold
    pet.health = 80.0
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "sad"


def test_sick_pet_mood(client: TestClient, db: Session):
    """A sick pet should have sick mood."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.is_sick = True
    pet.hunger = 80.0
    pet.happiness = 80.0
    pet.health = 80.0
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "sick"


def test_critical_mood_when_stat_very_low(client: TestClient, db: Session):
    """A pet with any stat below 10 should have critical mood."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.hunger = 5.0  # Below 10 threshold
    pet.happiness = 80.0
    pet.health = 80.0
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "critical"


def test_excited_mood_when_happiness_very_high(client: TestClient, db: Session):
    """A pet with happiness above 90 should be excited."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.hunger = 80.0
    pet.happiness = 95.0  # Above 90 threshold
    pet.health = 80.0
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "excited"


def test_neutral_mood_when_stats_moderate(client: TestClient, db: Session):
    """A pet with moderate stats should be neutral."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.hunger = 50.0  # Between 30 and 70
    pet.happiness = 50.0
    pet.health = 50.0
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "neutral"


def test_mood_priority_sleeping_over_sick(client: TestClient, db: Session):
    """Sleeping mood takes priority over sick mood."""
    create_test_pet(client)
    pet = db.query(Pet).filter(Pet.is_retired == False).first()
    pet.is_sick = True
    pet.is_sleeping = True
    db.commit()
    response = client.get("/api/pet")
    data = response.json()
    assert data["mood"] == "sleeping"  # Sleeping takes priority


def test_mood_field_always_present(client: TestClient):
    """Mood field is always present in pet response."""
    create_test_pet(client)
    response = client.get("/api/pet")
    data = response.json()
    assert "mood" in data
    valid_moods = ["happy", "excited", "neutral", "hungry", "sad", "sick", "sleeping", "critical"]
    assert data["mood"] in valid_moods
