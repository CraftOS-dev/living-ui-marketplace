"""Tests for note endpoints."""


def test_create_note(client):
    response = client.post("/api/notes", json={"title": "Shopping list", "content": "Milk, Eggs"})
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Shopping list"
    assert data["content"] == "Milk, Eggs"
    assert data["pinned"] is False
    assert "id" in data


def test_list_notes(client):
    client.post("/api/notes", json={"title": "A"})
    client.post("/api/notes", json={"title": "B"})
    response = client.get("/api/notes")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_pinned_notes_come_first(client):
    client.post("/api/notes", json={"title": "Regular"})
    client.post("/api/notes", json={"title": "Pinned", "pinned": True})
    notes = client.get("/api/notes").json()
    assert notes[0]["pinned"] is True


def test_get_note(client):
    created = client.post("/api/notes", json={"title": "My Note", "content": "Hello"}).json()
    response = client.get(f"/api/notes/{created['id']}")
    assert response.status_code == 200
    assert response.json()["content"] == "Hello"


def test_get_note_not_found(client):
    assert client.get("/api/notes/9999").status_code == 404


def test_update_note(client):
    note = client.post("/api/notes", json={"title": "Draft"}).json()
    response = client.put(f"/api/notes/{note['id']}", json={"content": "Updated content"})
    assert response.status_code == 200
    assert response.json()["content"] == "Updated content"


def test_pin_note(client):
    note = client.post("/api/notes", json={"title": "Pin me"}).json()
    response = client.put(f"/api/notes/{note['id']}", json={"pinned": True})
    assert response.status_code == 200
    assert response.json()["pinned"] is True


def test_delete_note(client):
    note = client.post("/api/notes", json={"title": "Delete me"}).json()
    response = client.delete(f"/api/notes/{note['id']}")
    assert response.status_code == 200
    assert client.get(f"/api/notes/{note['id']}").status_code == 404


def test_delete_note_idempotent(client):
    response = client.delete("/api/notes/9999")
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"
