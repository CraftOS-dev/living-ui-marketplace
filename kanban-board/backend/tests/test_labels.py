"""Tests for Label CRUD and card-label assignment."""


def test_create_label(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    response = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Bug", "color": "#EF4444"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bug"
    assert data["color"] == "#EF4444"


def test_assign_label_to_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Feature", "color": "#22C55E"
    }).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    # Assign label
    response = client.put(f"/api/cards/{card['id']}/labels/{label['id']}")
    assert response.status_code == 200
    # Verify on card
    card_data = client.get(f"/api/cards/{card['id']}").json()
    assert len(card_data["labels"]) == 1
    assert card_data["labels"][0]["id"] == label["id"]


def test_remove_label_from_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Bug", "color": "#EF4444"
    }).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    client.put(f"/api/cards/{card['id']}/labels/{label['id']}")
    # Remove label
    response = client.delete(f"/api/cards/{card['id']}/labels/{label['id']}")
    assert response.status_code == 200
    # Verify removed
    card_data = client.get(f"/api/cards/{card['id']}").json()
    assert len(card_data["labels"]) == 0


def test_delete_label_removes_from_cards(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Temp", "color": "#3B82F6"
    }).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}).json()
    client.put(f"/api/cards/{card['id']}/labels/{label['id']}")
    # Delete label
    response = client.delete(f"/api/labels/{label['id']}")
    assert response.status_code == 200
    # Card should have no labels
    card_data = client.get(f"/api/cards/{card['id']}").json()
    assert len(card_data["labels"]) == 0


def test_multiple_labels_on_card(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    labels = []
    for name, color in [("Bug", "#EF4444"), ("Feature", "#22C55E"), ("Urgent", "#EAB308")]:
        lbl = client.post("/api/labels", json={"board_id": board['id'], "name": name, "color": color}).json()
        labels.append(lbl)
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Multi Label"}).json()
    for lbl in labels:
        client.put(f"/api/cards/{card['id']}/labels/{lbl['id']}")
    card_data = client.get(f"/api/cards/{card['id']}").json()
    assert len(card_data["labels"]) == 3


def test_update_label(client):
    board = client.post("/api/boards", json={"name": "Board"}).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Old", "color": "#000000"
    }).json()
    response = client.put(f"/api/labels/{label['id']}", json={"name": "New", "color": "#FFFFFF"})
    assert response.status_code == 200
    assert response.json()["name"] == "New"
    assert response.json()["color"] == "#FFFFFF"
