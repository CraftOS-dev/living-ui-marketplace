"""Tests for streaks, stats, heatmap, and dashboard endpoints."""

from datetime import date, timedelta


def _today() -> date:
    return date.today()


def _ds(d: date) -> str:
    return d.isoformat()


def _binary_habit(client, name="Meditate"):
    return client.post("/api/habits", json={
        "name": name, "type": "binary", "color": "#22C55E", "icon": "Sparkles",
    }).json()


def _count_habit(client, target=8):
    return client.post("/api/habits", json={
        "name": "Water", "type": "count", "target": target, "unit": "glasses",
        "color": "#3B82F6", "icon": "GlassWater",
    }).json()


def _check(client, habit_id: int, day: date, value: float = 1):
    client.put(f"/api/habits/{habit_id}/entry", json={"date": _ds(day), "value": value})


# ============================================================ streak math

def test_streak_zero_when_empty(client):
    h = _binary_habit(client)
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 0
    assert stats["bestStreak"] == 0


def test_streak_today_only(client):
    h = _binary_habit(client)
    _check(client, h["id"], _today())
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 1
    assert stats["bestStreak"] == 1


def test_streak_consecutive_days(client):
    h = _binary_habit(client)
    for n in range(0, 5):
        _check(client, h["id"], _today() - timedelta(days=n))
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 5
    assert stats["bestStreak"] == 5


def test_streak_breaks_with_gap(client):
    h = _binary_habit(client)
    # Today, yesterday, then a gap of 2 days, then 3 prior days
    _check(client, h["id"], _today())
    _check(client, h["id"], _today() - timedelta(days=1))
    # gap on -2, -3
    _check(client, h["id"], _today() - timedelta(days=4))
    _check(client, h["id"], _today() - timedelta(days=5))
    _check(client, h["id"], _today() - timedelta(days=6))
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 2
    assert stats["bestStreak"] == 3


def test_current_streak_when_today_missing_but_yesterday_complete(client):
    """If today has no entry yet but yesterday does, current streak still counts yesterday's run."""
    h = _binary_habit(client)
    _check(client, h["id"], _today() - timedelta(days=1))
    _check(client, h["id"], _today() - timedelta(days=2))
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 2


def test_current_streak_zero_if_two_days_missed(client):
    """If today and yesterday both missing, current streak is 0 (broken)."""
    h = _binary_habit(client)
    _check(client, h["id"], _today() - timedelta(days=2))
    _check(client, h["id"], _today() - timedelta(days=3))
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 0
    assert stats["bestStreak"] == 2


def test_streak_count_habit_only_counts_completed_days(client):
    h = _count_habit(client, target=8)
    # Day completed (8/8)
    _check(client, h["id"], _today(), value=8)
    # Day not completed (3/8) — breaks streak
    _check(client, h["id"], _today() - timedelta(days=1), value=3)
    _check(client, h["id"], _today() - timedelta(days=2), value=8)
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["currentStreak"] == 1


# ============================================================ completion rate

def test_completion_rate_zero(client):
    h = _binary_habit(client)
    stats = client.get(f"/api/habits/{h['id']}/stats").json()
    assert stats["completionRate"] == 0


def test_completion_rate_partial(client):
    h = _binary_habit(client)
    # 3 completed in last 30 days
    for n in [0, 1, 2]:
        _check(client, h["id"], _today() - timedelta(days=n))
    stats = client.get(f"/api/habits/{h['id']}/stats?window=30").json()
    # 3 / 30
    assert stats["completionRate"] == round(3 / 30, 4)


# ============================================================ trend

def test_trend_returns_30_days(client):
    h = _binary_habit(client)
    _check(client, h["id"], _today())
    stats = client.get(f"/api/habits/{h['id']}/stats?window=30").json()
    assert "trend" in stats
    assert len(stats["trend"]) == 30
    # Last entry corresponds to today
    last = stats["trend"][-1]
    assert last["date"] == _ds(_today())
    assert last["completed"] is True


# ============================================================ heatmap

def test_heatmap_returns_365_days(client):
    h = _binary_habit(client)
    response = client.get(f"/api/habits/{h['id']}/heatmap")
    assert response.status_code == 200
    data = response.json()
    assert "cells" in data
    assert len(data["cells"]) == 365
    # Cells should be in ascending date order
    dates = [c["date"] for c in data["cells"]]
    assert dates == sorted(dates)
    # Last date is today
    assert data["cells"][-1]["date"] == _ds(_today())


def test_heatmap_marks_completed_days(client):
    h = _binary_habit(client)
    _check(client, h["id"], _today())
    _check(client, h["id"], _today() - timedelta(days=10))
    data = client.get(f"/api/habits/{h['id']}/heatmap").json()
    by_date = {c["date"]: c for c in data["cells"]}
    assert by_date[_ds(_today())]["completed"] is True
    assert by_date[_ds(_today() - timedelta(days=10))]["completed"] is True
    assert by_date[_ds(_today() - timedelta(days=5))]["completed"] is False


def test_heatmap_carries_value_for_count(client):
    h = _count_habit(client, target=8)
    _check(client, h["id"], _today(), value=4)
    data = client.get(f"/api/habits/{h['id']}/heatmap").json()
    today_cell = next(c for c in data["cells"] if c["date"] == _ds(_today()))
    assert today_cell["value"] == 4
    assert today_cell["completed"] is False
    assert today_cell["intensity"] == 0.5  # 4/8


# ============================================================ dashboard

def test_dashboard_empty(client):
    response = client.get("/api/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert data["todayCompleted"] == 0
    assert data["todayTotal"] == 0
    assert data["weeklyRate"] == 0
    assert data["activeStreaks"] == 0


def test_dashboard_today_summary(client):
    h1 = _binary_habit(client, "A")
    h2 = _binary_habit(client, "B")
    _binary_habit(client, "C")
    _check(client, h1["id"], _today())
    _check(client, h2["id"], _today())
    data = client.get("/api/dashboard").json()
    assert data["todayCompleted"] == 2
    assert data["todayTotal"] == 3


def test_dashboard_active_streaks(client):
    h = _binary_habit(client)
    # 7-day streak
    for n in range(0, 7):
        _check(client, h["id"], _today() - timedelta(days=n))
    data = client.get("/api/dashboard").json()
    assert data["activeStreaks"] == 1


def test_dashboard_weekly_rate(client):
    h = _binary_habit(client)
    # Complete 4 of last 7 days
    for n in [0, 1, 3, 5]:
        _check(client, h["id"], _today() - timedelta(days=n))
    data = client.get("/api/dashboard").json()
    # 4 completed / 7 day-slots (single habit)
    assert data["weeklyRate"] == round(4 / 7, 4)


def test_dashboard_excludes_archived(client):
    h_active = _binary_habit(client, "Active")
    h_archived = _binary_habit(client, "Archived")
    client.put(f"/api/habits/{h_archived['id']}", json={"archived": True})
    _check(client, h_active["id"], _today())
    data = client.get("/api/dashboard").json()
    assert data["todayTotal"] == 1
    assert data["todayCompleted"] == 1
