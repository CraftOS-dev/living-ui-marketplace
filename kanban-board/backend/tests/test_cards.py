"""Tests for Card CRUD, move, and archive operations."""


def test_create_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    response = client.post("/api/cards", json={"list_id": list_id, "title": "My Task"})
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "My Task"
    assert data["listId"] == list_id
    assert data["priority"] == "none"
    assert data["archived"] is False


def test_get_card_detail(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={
        "list_id": list_id, "title": "Detailed", "description": "Some details", "priority": "high"
    }).json()
    response = client.get(f"/api/cards/{card['id']}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Detailed"
    assert data["description"] == "Some details"
    assert data["priority"] == "high"
    assert "labels" in data
    assert "checklistItems" in data


def test_update_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Old"}).json()
    response = client.put(f"/api/cards/{card['id']}", json={
        "title": "Updated",
        "description": "New desc",
        "priority": "urgent",
        "due_date": "2026-12-31T00:00:00",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Updated"
    assert data["description"] == "New desc"
    assert data["priority"] == "urgent"
    assert data["dueDate"] is not None


def test_delete_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Delete Me"}).json()
    response = client.delete(f"/api/cards/{card['id']}")
    assert response.status_code == 200
    # Should be gone
    get_resp = client.get(f"/api/cards/{card['id']}")
    assert get_resp.status_code == 404


def test_move_card_within_list(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card1 = client.post("/api/cards", json={"list_id": list_id, "title": "First"}).json()
    card2 = client.post("/api/cards", json={"list_id": list_id, "title": "Second"}).json()
    # Move first card to position 1 (after second)
    response = client.put(f"/api/cards/{card1['id']}/move", json={
        "list_id": list_id, "position": 1
    })
    assert response.status_code == 200
    assert response.json()["position"] == 1


def test_move_card_between_lists(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    todo_id = board["lists"][0]["id"]
    done_id = board["lists"][2]["id"]
    card = client.post("/api/cards", json={"list_id": todo_id, "title": "Move Me"}).json()
    response = client.put(f"/api/cards/{card['id']}/move", json={
        "list_id": done_id, "position": 0
    })
    assert response.status_code == 200
    assert response.json()["listId"] == done_id


def test_archive_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Archive Me"}).json()
    response = client.put(f"/api/cards/{card['id']}", json={"archived": True})
    assert response.status_code == 200
    assert response.json()["archived"] is True
    # Archived cards should not appear in board view
    board_data = client.get(f"/api/boards/{board['id']}").json()
    todo_cards = board_data["lists"][0]["cards"]
    card_ids = [c["id"] for c in todo_cards]
    assert card["id"] not in card_ids


def test_card_not_found(client):
    response = client.get("/api/cards/9999")
    assert response.status_code == 404
