"""Tests for Checklist CRUD operations."""


def test_create_checklist_item(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    response = client.post("/api/checklist", json={"card_id": card['id'], "text": "Step 1"})
    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "Step 1"
    assert data["completed"] is False
    assert data["cardId"] == card["id"]


def test_toggle_checklist_item(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    item = client.post("/api/checklist", json={"card_id": card['id'], "text": "Step 1"}).json()
    # Mark completed
    response = client.put(f"/api/checklist/{item['id']}", json={"completed": True})
    assert response.status_code == 200
    assert response.json()["completed"] is True
    # Mark uncompleted
    response = client.put(f"/api/checklist/{item['id']}", json={"completed": False})
    assert response.json()["completed"] is False


def test_delete_checklist_item(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    item = client.post("/api/checklist", json={"card_id": card['id'], "text": "Remove Me"}).json()
    response = client.delete(f"/api/checklist/{item['id']}")
    assert response.status_code == 200
    # Check card detail
    card_data = client.get(f"/api/cards/{card['id']}").json()
    assert len(card_data["checklistItems"]) == 0


def test_move_checklist_item(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    item1 = client.post("/api/checklist", json={"card_id": card['id'], "text": "First"}).json()
    item2 = client.post("/api/checklist", json={"card_id": card['id'], "text": "Second"}).json()
    # Move first to position 1
    response = client.put(f"/api/checklist/{item1['id']}", json={"position": 1})
    assert response.status_code == 200
    assert response.json()["position"] == 1


def test_checklist_progress_on_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    item1 = client.post("/api/checklist", json={"card_id": card['id'], "text": "Step 1"}).json()
    client.post("/api/checklist", json={"card_id": card['id'], "text": "Step 2"})
    # Complete one item
    client.put(f"/api/checklist/{item1['id']}", json={"completed": True})
    # Check card
    card_data = client.get(f"/api/cards/{card['id']}").json()
    assert card_data["checklistTotal"] == 2
    assert card_data["checklistCompleted"] == 1
