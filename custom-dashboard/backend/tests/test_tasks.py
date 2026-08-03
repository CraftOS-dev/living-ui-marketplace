"""Tests for task endpoints."""


def test_create_task(client):
    response = client.post("/api/tasks", json={"title": "Buy milk", "priority": "low"})
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Buy milk"
    assert data["priority"] == "low"
    assert data["completed"] is False
    assert "id" in data


def test_list_tasks(client):
    client.post("/api/tasks", json={"title": "Task 1"})
    client.post("/api/tasks", json={"title": "Task 2"})
    response = client.get("/api/tasks")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_task_default_priority(client):
    response = client.post("/api/tasks", json={"title": "Default"})
    assert response.json()["priority"] == "none"


def test_complete_task(client):
    task = client.post("/api/tasks", json={"title": "Finish report"}).json()
    response = client.put(f"/api/tasks/{task['id']}", json={"completed": True})
    assert response.status_code == 200
    assert response.json()["completed"] is True


def test_update_task_priority(client):
    task = client.post("/api/tasks", json={"title": "Urgent"}).json()
    response = client.put(f"/api/tasks/{task['id']}", json={"priority": "high"})
    assert response.status_code == 200
    assert response.json()["priority"] == "high"


def test_update_task_position(client):
    task = client.post("/api/tasks", json={"title": "Reorder"}).json()
    response = client.put(f"/api/tasks/{task['id']}", json={"position": 5})
    assert response.status_code == 200
    assert response.json()["position"] == 5


def test_update_task_not_found(client):
    assert client.put("/api/tasks/9999", json={"title": "x"}).status_code == 404


def test_delete_task(client):
    task = client.post("/api/tasks", json={"title": "Delete me"}).json()
    response = client.delete(f"/api/tasks/{task['id']}")
    assert response.status_code == 200
    # Verify gone
    tasks = client.get("/api/tasks").json()
    assert all(t["id"] != task["id"] for t in tasks)


def test_delete_task_idempotent(client):
    response = client.delete("/api/tasks/9999")
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"
