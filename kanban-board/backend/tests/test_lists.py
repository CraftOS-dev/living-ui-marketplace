"""Tests for List CRUD and reordering."""


def test_create_list(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    board_id = board["id"]
    response = client.post("/api/lists", json={"board_id": board_id, "title": "Review"}, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Review"
    assert data["boardId"] == board_id


def test_update_list(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    list_id = board["lists"][0]["id"]
    response = client.put(f"/api/lists/{list_id}", json={"title": "Backlog"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Backlog"


def test_delete_list_cascades(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    list_id = board["lists"][0]["id"]
    # Add a card
    client.post("/api/cards", json={"list_id": list_id, "title": "Task"}, headers=auth_headers)
    # Delete list
    response = client.delete(f"/api/lists/{list_id}", headers=auth_headers)
    assert response.status_code == 200
    # List should be gone from board
    board_data = client.get(f"/api/boards/{board['id']}", headers=auth_headers).json()
    list_ids = [lst["id"] for lst in board_data["lists"]]
    assert list_id not in list_ids


def test_move_list(client, auth_headers):
    board = client.post("/api/boards", json={"name": "Board"}, headers=auth_headers).json()
    # Default: To Do(0), In Progress(1), Done(2)
    done_id = board["lists"][2]["id"]
    # Move Done to position 0
    response = client.put(f"/api/lists/{done_id}", json={"position": 0}, headers=auth_headers)
    assert response.status_code == 200
    # Verify order changed
    board_data = client.get(f"/api/boards/{board['id']}", headers=auth_headers).json()
    assert board_data["lists"][0]["title"] == "Done"


def test_delete_list_idempotent(client, auth_headers):
    response = client.delete("/api/lists/9999", headers=auth_headers)
    assert response.status_code == 200
