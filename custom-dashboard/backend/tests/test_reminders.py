"""Tests for reminder endpoints."""


def test_create_reminder(client):
    response = client.post("/api/reminders", json={
        "title": "Call dentist",
        "due_date": "2026-07-10",
        "due_time": "09:00",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Call dentist"
    assert data["dueDate"] == "2026-07-10"
    assert data["dueTime"] == "09:00"
    assert data["completed"] is False
    assert "id" in data


def test_list_reminders(client):
    client.post("/api/reminders", json={"title": "A", "due_date": "2026-07-01"})
    client.post("/api/reminders", json={"title": "B", "due_date": "2026-07-02"})
    response = client.get("/api/reminders")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_upcoming_reminders(client):
    client.post("/api/reminders", json={"title": "Future", "due_date": "2099-01-01"})
    client.post("/api/reminders", json={"title": "Past"})  # no date
    response = client.get("/api/reminders?upcoming=true")
    assert response.status_code == 200
    data = response.json()
    assert all(r["completed"] is False for r in data)


def test_update_reminder(client):
    reminder = client.post("/api/reminders", json={"title": "Old title"}).json()
    response = client.put(f"/api/reminders/{reminder['id']}", json={"title": "New title"})
    assert response.status_code == 200
    assert response.json()["title"] == "New title"


def test_complete_reminder(client):
    reminder = client.post("/api/reminders", json={"title": "Done"}).json()
    response = client.put(f"/api/reminders/{reminder['id']}", json={"completed": True})
    assert response.status_code == 200
    assert response.json()["completed"] is True


def test_update_reminder_not_found(client):
    assert client.put("/api/reminders/9999", json={"title": "x"}).status_code == 404


def test_delete_reminder(client):
    reminder = client.post("/api/reminders", json={"title": "Delete me"}).json()
    response = client.delete(f"/api/reminders/{reminder['id']}")
    assert response.status_code == 200
    reminders = client.get("/api/reminders").json()
    assert all(r["id"] != reminder["id"] for r in reminders)


def test_delete_reminder_idempotent(client):
    response = client.delete("/api/reminders/9999")
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"
