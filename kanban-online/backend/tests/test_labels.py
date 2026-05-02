"""Tests for Label CRUD and card-label assignment."""


def test_create_label(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    response = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Bug", "color": "#EF4444"
    }, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bug"
    assert data["color"] == "#EF4444"


def test_assign_label_to_card(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Feature", "color": "#22C55E"
    }, headers=auth_headers).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}, headers=auth_headers).json()
    # Assign label
    response = client.put(f"/api/cards/{card['id']}/labels/{label['id']}", headers=auth_headers)
    assert response.status_code == 200
    # Verify on card
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["labels"]) == 1
    assert card_data["labels"][0]["id"] == label["id"]


def test_remove_label_from_card(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Bug", "color": "#EF4444"
    }, headers=auth_headers).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}, headers=auth_headers).json()
    client.put(f"/api/cards/{card['id']}/labels/{label['id']}", headers=auth_headers)
    # Remove label
    response = client.delete(f"/api/cards/{card['id']}/labels/{label['id']}", headers=auth_headers)
    assert response.status_code == 200
    # Verify removed
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["labels"]) == 0


def test_delete_label_removes_from_cards(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Temp", "color": "#3B82F6"
    }, headers=auth_headers).json()
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Task"}, headers=auth_headers).json()
    client.put(f"/api/cards/{card['id']}/labels/{label['id']}", headers=auth_headers)
    # Delete label
    response = client.delete(f"/api/labels/{label['id']}", headers=auth_headers)
    assert response.status_code == 200
    # Card should have no labels
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["labels"]) == 0


def test_multiple_labels_on_card(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    labels = []
    for name, color in [("Bug", "#EF4444"), ("Feature", "#22C55E"), ("Urgent", "#EAB308")]:
        lbl = client.post("/api/labels", json={"board_id": board['id'], "name": name, "color": color}, headers=auth_headers).json()
        labels.append(lbl)
    list_id = board["lists"][0]["id"]
    card = client.post("/api/cards", json={"list_id": list_id, "title": "Multi Label"}, headers=auth_headers).json()
    for lbl in labels:
        client.put(f"/api/cards/{card['id']}/labels/{lbl['id']}", headers=auth_headers)
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["labels"]) == 3


def test_update_label(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Old", "color": "#000000"
    }, headers=auth_headers).json()
    response = client.put(f"/api/labels/{label['id']}", json={"name": "New", "color": "#FFFFFF"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "New"
    assert response.json()["color"] == "#FFFFFF"
