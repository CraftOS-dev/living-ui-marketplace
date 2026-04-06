"""Tests for vocabulary endpoints."""


def _create_profile(client):
    client.post("/api/profile", json={
        "nativeLanguage": "English",
        "targetLanguage": "Japanese",
    })


def test_list_vocabulary_empty(client):
    response = client.get("/api/vocabulary")
    assert response.status_code == 200
    data = response.json()
    assert data["words"] == []
    assert data["total"] == 0


def test_create_word(client):
    _create_profile(client)
    response = client.post("/api/vocabulary", json={
        "word": "猫",
        "translation": "cat",
        "pronunciation": "neko",
        "partOfSpeech": "noun",
        "exampleSentence": "猫が好きです。",
        "exampleTranslation": "I like cats.",
        "difficulty": "beginner",
        "category": "Animals",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["word"] == "猫"
    assert data["translation"] == "cat"
    assert data["languagePair"] == "English-Japanese"


def test_get_word(client):
    _create_profile(client)
    create_resp = client.post("/api/vocabulary", json={
        "word": "犬",
        "translation": "dog",
    })
    word_id = create_resp.json()["id"]
    response = client.get(f"/api/vocabulary/{word_id}")
    assert response.status_code == 200
    assert response.json()["word"] == "犬"


def test_delete_word(client):
    _create_profile(client)
    create_resp = client.post("/api/vocabulary", json={
        "word": "鳥",
        "translation": "bird",
    })
    word_id = create_resp.json()["id"]
    response = client.delete(f"/api/vocabulary/{word_id}")
    assert response.status_code == 200

    response = client.get(f"/api/vocabulary/{word_id}")
    assert response.status_code == 404


def test_list_vocabulary_with_search(client):
    _create_profile(client)
    client.post("/api/vocabulary", json={"word": "猫", "translation": "cat"})
    client.post("/api/vocabulary", json={"word": "犬", "translation": "dog"})

    response = client.get("/api/vocabulary?search=cat")
    data = response.json()
    assert data["total"] == 1
    assert data["words"][0]["translation"] == "cat"


def test_create_list(client):
    _create_profile(client)
    response = client.post("/api/lists", json={
        "name": "Animals",
        "description": "Common animals",
        "category": "Animals",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Animals"
    assert data["wordCount"] == 0


def test_add_word_to_list(client):
    _create_profile(client)
    word_resp = client.post("/api/vocabulary", json={"word": "猫", "translation": "cat"})
    word_id = word_resp.json()["id"]

    list_resp = client.post("/api/lists", json={"name": "Animals"})
    list_id = list_resp.json()["id"]

    response = client.post(f"/api/lists/{list_id}/words", json={"wordId": word_id})
    assert response.status_code == 200

    list_detail = client.get(f"/api/lists/{list_id}")
    assert list_detail.json()["wordCount"] == 1


def test_delete_list(client):
    _create_profile(client)
    list_resp = client.post("/api/lists", json={"name": "Test List"})
    list_id = list_resp.json()["id"]

    response = client.delete(f"/api/lists/{list_id}")
    assert response.status_code == 200

    response = client.get(f"/api/lists/{list_id}")
    assert response.status_code == 404
