"""Tests for flashcard endpoints."""
from datetime import date


def _setup(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })
    resp = client.post("/api/vocabulary", json={
        "word": "猫",
        "translation": "cat",
    })
    return resp.json()["id"]


def test_flashcard_stats_empty(client):
    response = client.get("/api/flashcards/stats")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["due"] == 0


def test_add_to_flashcards(client):
    word_id = _setup(client)
    response = client.post(f"/api/flashcards/add/{word_id}")
    assert response.status_code == 200
    assert response.json()["status"] == "added"


def test_add_duplicate_flashcard(client):
    word_id = _setup(client)
    client.post(f"/api/flashcards/add/{word_id}")
    response = client.post(f"/api/flashcards/add/{word_id}")
    assert response.json()["status"] == "already_exists"


def test_get_due_flashcards(client):
    word_id = _setup(client)
    client.post(f"/api/flashcards/add/{word_id}")

    response = client.get("/api/flashcards/due")
    assert response.status_code == 200
    data = response.json()
    assert data["totalDue"] == 1
    assert data["cards"][0]["word"]["word"] == "猫"


def test_review_flashcard(client):
    word_id = _setup(client)
    client.post(f"/api/flashcards/add/{word_id}")

    response = client.post("/api/flashcards/review", json={
        "wordId": word_id,
        "quality": 4,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["xpEarned"] > 0
    progress = data["progress"]
    assert progress["repetitions"] == 1
    assert progress["interval"] == 1


def test_review_flashcard_incorrect(client):
    word_id = _setup(client)
    client.post(f"/api/flashcards/add/{word_id}")

    response = client.post("/api/flashcards/review", json={
        "wordId": word_id,
        "quality": 1,
    })
    data = response.json()
    progress = data["progress"]
    assert progress["repetitions"] == 0
    assert progress["interval"] == 1


def test_add_list_to_flashcards(client):
    word1_id = _setup(client)
    word2 = client.post("/api/vocabulary", json={"word": "犬", "translation": "dog"}).json()["id"]

    list_resp = client.post("/api/lists", json={"name": "Animals"})
    list_id = list_resp.json()["id"]

    client.post(f"/api/lists/{list_id}/words", json={"wordId": word1_id})
    client.post(f"/api/lists/{list_id}/words", json={"wordId": word2})

    response = client.post(f"/api/flashcards/add-list/{list_id}")
    assert response.status_code == 200
    assert response.json()["count"] == 2

    stats = client.get("/api/flashcards/stats").json()
    assert stats["total"] == 2
