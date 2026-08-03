"""Tests for calendar event endpoints."""


def test_create_event(client):
    response = client.post("/api/calendar-events", json={
        "title": "Team Meeting",
        "event_date": "2026-07-01",
        "start_time": "14:00",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Team Meeting"
    assert data["eventDate"] == "2026-07-01"
    assert data["startTime"] == "14:00"
    assert "id" in data


def test_list_events(client):
    client.post("/api/calendar-events", json={"title": "A", "event_date": "2026-07-01"})
    client.post("/api/calendar-events", json={"title": "B", "event_date": "2026-07-02"})
    response = client.get("/api/calendar-events")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_events_filter_by_month(client):
    client.post("/api/calendar-events", json={"title": "July", "event_date": "2026-07-15"})
    client.post("/api/calendar-events", json={"title": "August", "event_date": "2026-08-01"})
    response = client.get("/api/calendar-events?month=2026-07")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "July"


def test_get_event(client):
    created = client.post("/api/calendar-events", json={"title": "X", "event_date": "2026-07-01"}).json()
    response = client.get(f"/api/calendar-events/{created['id']}")
    assert response.status_code == 200
    assert response.json()["title"] == "X"


def test_get_event_not_found(client):
    assert client.get("/api/calendar-events/9999").status_code == 404


def test_update_event(client):
    created = client.post("/api/calendar-events", json={"title": "Old", "event_date": "2026-07-01"}).json()
    response = client.put(f"/api/calendar-events/{created['id']}", json={"title": "New"})
    assert response.status_code == 200
    assert response.json()["title"] == "New"


def test_delete_event(client):
    created = client.post("/api/calendar-events", json={"title": "Del", "event_date": "2026-07-01"}).json()
    response = client.delete(f"/api/calendar-events/{created['id']}")
    assert response.status_code == 200
    assert client.get(f"/api/calendar-events/{created['id']}").status_code == 404


def test_delete_event_idempotent(client):
    """DELETE on missing event should return 200 not_found."""
    response = client.delete("/api/calendar-events/9999")
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"
