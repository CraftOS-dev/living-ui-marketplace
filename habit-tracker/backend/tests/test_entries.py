"""Tests for HabitEntry endpoints (daily check-in, backfill, upsert)."""

from datetime import date, timedelta


def _today_str() -> str:
    return date.today().isoformat()


def _days_ago(n: int) -> str:
    return (date.today() - timedelta(days=n)).isoformat()


def _binary_habit(client, name: str = "Meditate") -> dict:
    return client.post("/api/habits", json={
        "name": name, "type": "binary", "color": "#22C55E", "icon": "Sparkles",
    }).json()


def _count_habit(client, target: int = 8) -> dict:
    return client.post("/api/habits", json={
        "name": "Water", "type": "count", "target": target, "unit": "glasses",
        "color": "#3B82F6", "icon": "GlassWater",
    }).json()


def _negative_habit(client) -> dict:
    return client.post("/api/habits", json={
        "name": "No soda", "type": "negative", "color": "#EF4444", "icon": "Ban",
    }).json()


# ------------------------------------------------------------ list entries

def test_list_entries_empty(client):
    h = _binary_habit(client)
    response = client.get(f"/api/habits/{h['id']}/entries")
    assert response.status_code == 200
    assert response.json() == []


def test_list_entries_after_upsert(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    response = client.get(f"/api/habits/{h['id']}/entries")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["date"] == _today_str()
    assert data[0]["value"] == 1


# ------------------------------------------------------------ upsert binary

def test_upsert_entry_binary_today(client):
    h = _binary_habit(client)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "value": 1,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["habitId"] == h["id"]
    assert data["date"] == _today_str()
    assert data["value"] == 1
    assert data["completed"] is True


def test_upsert_entry_binary_replaces_existing(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    # Marking again with value 0 should overwrite (not duplicate)
    response = client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 0})
    assert response.status_code == 200
    assert response.json()["value"] == 0
    entries = client.get(f"/api/habits/{h['id']}/entries").json()
    assert len(entries) == 1
    assert entries[0]["value"] == 0


# ------------------------------------------------------------ upsert count

def test_upsert_entry_count_below_target(client):
    h = _count_habit(client, target=8)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "value": 5,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["value"] == 5
    assert data["completed"] is False


def test_upsert_entry_count_meets_target(client):
    h = _count_habit(client, target=8)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "value": 8,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["completed"] is True


def test_upsert_entry_count_exceeds_target(client):
    h = _count_habit(client, target=8)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "value": 12,
    })
    assert response.status_code == 200
    assert response.json()["completed"] is True


# ------------------------------------------------------------ upsert negative

def test_upsert_entry_negative(client):
    h = _negative_habit(client)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "value": 1,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["completed"] is True


# ------------------------------------------------------------ notes

def test_upsert_entry_with_note(client):
    h = _binary_habit(client)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "value": 1, "note": "felt strong",
    })
    assert response.status_code == 200
    assert response.json()["note"] == "felt strong"


def test_upsert_note_only_preserves_value(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": _today_str(), "note": "edited note",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["note"] == "edited note"
    assert data["value"] == 1


# ------------------------------------------------------------ backfill

def test_backfill_past_day(client):
    h = _binary_habit(client)
    yesterday = _days_ago(1)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": yesterday, "value": 1,
    })
    assert response.status_code == 200
    assert response.json()["date"] == yesterday


def test_backfill_far_past(client):
    h = _binary_habit(client)
    far = _days_ago(40)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": far, "value": 1,
    })
    assert response.status_code == 200


def test_upsert_entry_invalid_date(client):
    h = _binary_habit(client)
    response = client.put(f"/api/habits/{h['id']}/entry", json={
        "date": "not-a-date", "value": 1,
    })
    assert response.status_code in (400, 422)


def test_upsert_entry_unknown_habit(client):
    response = client.put("/api/habits/9999/entry", json={
        "date": _today_str(), "value": 1,
    })
    assert response.status_code == 404


# ------------------------------------------------------------ delete entry

def test_delete_entry_by_date(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    response = client.delete(f"/api/habits/{h['id']}/entry?date={_today_str()}")
    assert response.status_code == 200
    assert client.get(f"/api/habits/{h['id']}/entries").json() == []


def test_delete_entry_not_found(client):
    """DELETE is idempotent — returns 200 with status=not_found when there's
    nothing to delete."""
    h = _binary_habit(client)
    response = client.delete(f"/api/habits/{h['id']}/entry?date={_today_str()}")
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"


# ------------------------------------------------------------ list habits surfaces today entry

def test_list_habits_includes_today_entry(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    listing = client.get("/api/habits").json()
    row = next(r for r in listing if r["id"] == h["id"])
    assert row["todayEntry"]["value"] == 1
    assert row["todayEntry"]["completed"] is True


def test_list_habits_includes_streak(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    listing = client.get("/api/habits").json()
    row = next(r for r in listing if r["id"] == h["id"])
    assert row["currentStreak"] == 1


# ------------------------------------------------------------ delete habit cascades

def test_delete_habit_cascades_entries(client):
    h = _binary_habit(client)
    client.put(f"/api/habits/{h['id']}/entry", json={"date": _today_str(), "value": 1})
    client.delete(f"/api/habits/{h['id']}")
    # Re-create and confirm fresh
    h2 = _binary_habit(client)
    assert client.get(f"/api/habits/{h2['id']}/entries").json() == []
