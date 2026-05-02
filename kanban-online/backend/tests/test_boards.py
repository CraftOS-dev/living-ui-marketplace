"""Tests for Board and List CRUD operations."""


def test_create_board(client, auth_headers):
    response = client.post("/api/boards", json={"name": "Sprint 23"}, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Sprint 23"
    assert "id" in data
    # Should auto-create 3 default lists
    assert len(data["lists"]) == 3
    assert data["lists"][0]["title"] == "To Do"
    assert data["lists"][1]["title"] == "In Progress"
    assert data["lists"][2]["title"] == "Done"


def test_list_boards(client, auth_headers):
    client.post("/api/boards", json={"name": "Board A"}, headers=auth_headers)
    client.post("/api/boards", json={"name": "Board B"}, headers=auth_headers)
    response = client.get("/api/boards", headers=auth_headers)
    assert response.status_code == 200
    boards = response.json()
    assert len(boards) == 2


def test_get_board_full(client, auth_headers):
    create_resp = client.post("/api/boards", json={"name": "Full Board"}, headers=auth_headers)
    board_id = create_resp.json()["id"]
    response = client.get(f"/api/boards/{board_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Full Board"
    assert "lists" in data
    assert "labels" in data


def test_update_board(client, auth_headers):
    create_resp = client.post("/api/boards", json={"name": "Old Name"}, headers=auth_headers)
    board_id = create_resp.json()["id"]
    response = client.put(f"/api/boards/{board_id}", json={"name": "New Name"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_delete_board_cascades(client, auth_headers):
    create_resp = client.post("/api/boards", json={"name": "Delete Me"}, headers=auth_headers)
    board_id = create_resp.json()["id"]
    list_id = create_resp.json()["lists"][0]["id"]
    # Add a card to the first list
    client.post("/api/cards", json={"list_id": list_id, "title": "Task 1"}, headers=auth_headers)
    # Delete board
    response = client.delete(f"/api/boards/{board_id}", headers=auth_headers)
    assert response.status_code == 200
    # Board should be gone
    get_resp = client.get(f"/api/boards/{board_id}", headers=auth_headers)
    assert get_resp.status_code == 404


def test_get_board_not_found(client, auth_headers):
    response = client.get("/api/boards/9999", headers=auth_headers)
    # Not a member, so 403
    assert response.status_code in (403, 404)
