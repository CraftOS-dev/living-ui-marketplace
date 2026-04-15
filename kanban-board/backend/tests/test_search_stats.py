"""Tests for Search and Statistics endpoints."""
from datetime import datetime, timedelta


def _setup_board_with_cards(client, auth_headers):
    """Helper to create a board with cards for testing."""
    board = client.post("/api/boards", json={"name": "Test Board"}, headers=auth_headers).json()
    todo_id = board["lists"][0]["id"]
    prog_id = board["lists"][1]["id"]
    done_id = board["lists"][2]["id"]

    c1 = client.post("/api/cards", json={
        "list_id": todo_id, "title": "Fix login bug", "priority": "high"
    }, headers=auth_headers).json()
    c2 = client.post("/api/cards", json={
        "list_id": todo_id, "title": "Add dark mode", "priority": "low"
    }, headers=auth_headers).json()
    c3 = client.post("/api/cards", json={
        "list_id": prog_id, "title": "Update API docs", "priority": "medium"
    }, headers=auth_headers).json()
    c4 = client.post("/api/cards", json={
        "list_id": done_id, "title": "Setup CI pipeline", "priority": "none"
    }, headers=auth_headers).json()

    past = (datetime.utcnow() - timedelta(days=2)).isoformat()
    future = (datetime.utcnow() + timedelta(days=3)).isoformat()
    client.put(f"/api/cards/{c1['id']}", json={"due_date": past}, headers=auth_headers)
    client.put(f"/api/cards/{c2['id']}", json={"due_date": future}, headers=auth_headers)

    return board, [c1, c2, c3, c4]


def test_search_by_title(client, auth_headers):
    board, cards = _setup_board_with_cards(client, auth_headers)
    response = client.post("/api/search", json={"board_id": board['id'], "q": "login"}, headers=auth_headers)
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Fix login bug"


def test_search_by_priority(client, auth_headers):
    board, cards = _setup_board_with_cards(client, auth_headers)
    response = client.post("/api/search", json={"board_id": board['id'], "priority": "high"}, headers=auth_headers)
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["priority"] == "high"


def test_search_by_label(client, auth_headers):
    board, cards = _setup_board_with_cards(client, auth_headers)
    label = client.post("/api/labels", json={
        "board_id": board['id'], "name": "Bug", "color": "#EF4444"
    }, headers=auth_headers).json()
    client.put(f"/api/cards/{cards[0]['id']}/labels/{label['id']}", headers=auth_headers)
    response = client.post("/api/search", json={"board_id": board['id'], "label_id": label['id']}, headers=auth_headers)
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["id"] == cards[0]["id"]


def test_search_by_due_status_overdue(client, auth_headers):
    board, cards = _setup_board_with_cards(client, auth_headers)
    response = client.post("/api/search", json={"board_id": board['id'], "due_status": "overdue"}, headers=auth_headers)
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Fix login bug"


def test_search_by_due_status_upcoming(client, auth_headers):
    board, cards = _setup_board_with_cards(client, auth_headers)
    response = client.post("/api/search", json={"board_id": board['id'], "due_status": "upcoming"}, headers=auth_headers)
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 1
    assert results[0]["title"] == "Add dark mode"


def test_board_stats(client, auth_headers):
    board, cards = _setup_board_with_cards(client, auth_headers)
    response = client.post("/api/stats", json={"board_id": board['id']}, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["totalCards"] == 4
    assert len(data["cardsByList"]) == 3
    assert data["cardsByPriority"]["high"] == 1
    assert data["cardsByPriority"]["low"] == 1
    assert data["cardsByPriority"]["medium"] == 1
    assert data["cardsByPriority"]["none"] == 1
    assert data["overdueCount"] == 1
