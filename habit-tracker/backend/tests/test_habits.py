"""Tests for Habit CRUD and reorder endpoints."""


def _make_habit(client, **overrides):
    payload = {
        "name": "Meditate",
        "type": "binary",
        "color": "#22C55E",
        "icon": "Sparkles",
    }
    payload.update(overrides)
    return client.post("/api/habits", json=payload).json()


def test_list_habits_empty(client):
    response = client.get("/api/habits")
    assert response.status_code == 200
    assert response.json() == []


def test_create_binary_habit(client):
    response = client.post("/api/habits", json={
        "name": "Meditate",
        "type": "binary",
        "color": "#22C55E",
        "icon": "Sparkles",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Meditate"
    assert data["type"] == "binary"
    assert data["color"] == "#22C55E"
    assert data["icon"] == "Sparkles"
    assert data["target"] is None
    assert data["unit"] is None
    assert data["archived"] is False
    assert "id" in data
    assert data["order"] == 0


def test_create_count_habit(client):
    response = client.post("/api/habits", json={
        "name": "Drink water",
        "type": "count",
        "target": 8,
        "unit": "glasses",
        "color": "#3B82F6",
        "icon": "GlassWater",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "count"
    assert data["target"] == 8
    assert data["unit"] == "glasses"


def test_create_duration_habit(client):
    response = client.post("/api/habits", json={
        "name": "Read",
        "type": "duration",
        "target": 30,
        "unit": "min",
        "color": "#8B5CF6",
        "icon": "Book",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "duration"
    assert data["target"] == 30


def test_create_negative_habit(client):
    response = client.post("/api/habits", json={
        "name": "No soda",
        "type": "negative",
        "color": "#EF4444",
        "icon": "Ban",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "negative"


def test_create_habit_invalid_type(client):
    response = client.post("/api/habits", json={
        "name": "X",
        "type": "weekly",
        "color": "#000",
        "icon": "Star",
    })
    assert response.status_code in (400, 422)


def test_create_habit_with_category(client):
    cat = client.post("/api/categories", json={"name": "Health", "color": "#22C55E"}).json()
    response = client.post("/api/habits", json={
        "name": "Pushups",
        "type": "count",
        "target": 20,
        "unit": "reps",
        "color": "#22C55E",
        "icon": "Dumbbell",
        "category_id": cat["id"],
    })
    assert response.status_code == 200
    data = response.json()
    assert data["category_id"] == cat["id"]


def test_list_habits_in_order(client):
    a = _make_habit(client, name="A")
    b = _make_habit(client, name="B")
    c = _make_habit(client, name="C")
    response = client.get("/api/habits")
    assert response.status_code == 200
    data = response.json()
    assert [h["name"] for h in data] == ["A", "B", "C"]


def test_get_habit(client):
    h = _make_habit(client)
    response = client.get(f"/api/habits/{h['id']}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Meditate"
    # /habits/{id} should include stats
    assert "currentStreak" in data
    assert "bestStreak" in data
    assert "completionRate" in data


def test_get_habit_not_found(client):
    response = client.get("/api/habits/9999")
    assert response.status_code == 404


def test_update_habit(client):
    h = _make_habit(client)
    response = client.put(f"/api/habits/{h['id']}", json={
        "name": "Meditate (morning)",
        "color": "#FF0000",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Meditate (morning)"
    assert data["color"] == "#FF0000"
    # type unchanged
    assert data["type"] == "binary"


def test_update_habit_not_found(client):
    response = client.put("/api/habits/9999", json={"name": "X"})
    assert response.status_code == 404


def test_archive_habit_excludes_from_list(client):
    h = _make_habit(client)
    client.put(f"/api/habits/{h['id']}", json={"archived": True})
    response = client.get("/api/habits")
    # archived habits hidden by default
    assert response.json() == []
    # but visible with include_archived=true
    response = client.get("/api/habits?include_archived=true")
    assert len(response.json()) == 1


def test_delete_habit(client):
    h = _make_habit(client)
    response = client.delete(f"/api/habits/{h['id']}")
    assert response.status_code == 200
    assert client.get(f"/api/habits/{h['id']}").status_code == 404


def test_delete_habit_not_found(client):
    response = client.delete("/api/habits/9999")
    assert response.status_code == 404


def test_reorder_habits(client):
    a = _make_habit(client, name="A")
    b = _make_habit(client, name="B")
    c = _make_habit(client, name="C")
    response = client.post("/api/habits/reorder", json={
        "habitIds": [c["id"], a["id"], b["id"]],
    })
    assert response.status_code == 200
    data = client.get("/api/habits").json()
    assert [h["name"] for h in data] == ["C", "A", "B"]


def test_reorder_habits_invalid_id(client):
    a = _make_habit(client, name="A")
    response = client.post("/api/habits/reorder", json={
        "habitIds": [a["id"], 9999],
    })
    assert response.status_code == 400
