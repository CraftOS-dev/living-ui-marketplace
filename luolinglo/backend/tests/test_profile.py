"""Tests for profile endpoints."""


def test_get_profile_empty(client):
    response = client.get("/api/profile")
    assert response.status_code == 200
    assert response.json() is None


def test_create_profile(client):
    response = client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
        "proficiencyLevel": "beginner",
        "displayName": "Test User",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["nativeLanguage"] == "English"
    assert data["targetLanguage"] == "Japanese"
    assert data["proficiencyLevel"] == "beginner"
    assert data["displayName"] == "Test User"
    assert data["totalXp"] == 0
    assert data["level"] == 1
    assert data["currentStreak"] == 0


def test_create_profile_duplicate(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })
    response = client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Korean",
    })
    assert response.status_code == 400


def test_get_profile_after_create(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Spanish",
    })
    response = client.get("/api/profile")
    assert response.status_code == 200
    data = response.json()
    assert data["nativeLanguage"] == "English"
    assert data["targetLanguage"] == "Spanish"


def test_update_profile(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })
    response = client.put("/api/profile", json={
        "displayName": "Updated Name",
        "dailyXpGoal": 100,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["displayName"] == "Updated Name"
    assert data["dailyXpGoal"] == 100


def test_record_practice(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })
    response = client.post("/api/profile/record-practice")
    assert response.status_code == 200
    data = response.json()
    assert data["currentStreak"] == 1
    assert data["lastPracticeDate"] is not None
