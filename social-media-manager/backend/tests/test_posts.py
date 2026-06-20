"""
Smoke tests for Social Media Manager backend.

Tests cover database/API behavior only — no real API calls, no real posting.
The conftest.py provides a client fixture with in-memory SQLite.
"""

from datetime import datetime, timedelta


# ============================================================================
# Post CRUD Tests
# ============================================================================

def test_create_post_draft(client):
    resp = client.post("/api/posts", json={
        "globalContent": "Hello world!",
        "platform": "twitter",
        "status": "draft",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["globalContent"] == "Hello world!"
    assert data["platform"] == "twitter"
    assert data["status"] == "draft"
    assert data["id"] is not None


def test_create_post_scheduled(client):
    scheduled_time = (datetime.utcnow() + timedelta(hours=2)).isoformat()
    resp = client.post("/api/posts", json={
        "globalContent": "Scheduled tweet",
        "platform": "twitter",
        "status": "scheduled",
        "scheduledAt": scheduled_time,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "scheduled"
    assert data["scheduledAt"] is not None


def test_get_posts(client):
    # Create two posts
    client.post("/api/posts", json={"globalContent": "Post 1", "platform": "twitter"})
    client.post("/api/posts", json={"globalContent": "Post 2", "platform": "linkedin"})
    resp = client.get("/api/posts")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_get_posts_filter_by_platform(client):
    client.post("/api/posts", json={"globalContent": "Tweet", "platform": "twitter"})
    client.post("/api/posts", json={"globalContent": "LinkedIn post", "platform": "linkedin"})
    resp = client.get("/api/posts?platform=twitter")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["platform"] == "twitter"


def test_get_posts_filter_by_status(client):
    client.post("/api/posts", json={"globalContent": "Draft", "platform": "twitter", "status": "draft"})
    client.post("/api/posts", json={
        "globalContent": "Scheduled",
        "platform": "twitter",
        "status": "scheduled",
        "scheduledAt": (datetime.utcnow() + timedelta(hours=1)).isoformat(),
    })
    resp = client.get("/api/posts?status=draft")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["status"] == "draft"


def test_update_post(client):
    create_resp = client.post("/api/posts", json={"globalContent": "Original", "platform": "twitter"})
    post_id = create_resp.json()["id"]
    resp = client.put(f"/api/posts/{post_id}", json={"globalContent": "Updated content"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["globalContent"] == "Updated content"


def test_delete_post(client):
    create_resp = client.post("/api/posts", json={"globalContent": "To delete", "platform": "twitter"})
    post_id = create_resp.json()["id"]
    resp = client.delete(f"/api/posts/{post_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"
    # Verify it's gone
    list_resp = client.get("/api/posts")
    assert len(list_resp.json()) == 0


def test_delete_nonexistent_post(client):
    """DELETE on a non-existing post must return 200 with status=not_found."""
    resp = client.delete("/api/posts/99999")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


# ============================================================================
# Post Action Tests
# ============================================================================

def test_schedule_post(client):
    create_resp = client.post("/api/posts", json={"globalContent": "Schedule me", "platform": "twitter"})
    post_id = create_resp.json()["id"]
    future = (datetime.utcnow() + timedelta(hours=3)).isoformat()
    resp = client.post(f"/api/posts/{post_id}/schedule", json={"scheduledAt": future})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "scheduled"
    assert data["scheduledAt"] is not None
    assert data["retryCount"] == 0


def test_cancel_post(client):
    future = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    create_resp = client.post("/api/posts", json={
        "globalContent": "To cancel",
        "platform": "linkedin",
        "status": "scheduled",
        "scheduledAt": future,
    })
    post_id = create_resp.json()["id"]
    resp = client.post(f"/api/posts/{post_id}/cancel")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "cancelled"
    assert data["scheduledAt"] is None
    assert data["retryCount"] == 0


# ============================================================================
# Queue & Calendar Tests
# ============================================================================

def test_queue_returns_scheduled(client):
    future = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    client.post("/api/posts", json={
        "globalContent": "Queued post",
        "platform": "twitter",
        "status": "scheduled",
        "scheduledAt": future,
    })
    client.post("/api/posts", json={
        "globalContent": "Draft post",
        "platform": "twitter",
        "status": "draft",
    })
    resp = client.get("/api/queue")
    assert resp.status_code == 200
    data = resp.json()
    # Only scheduled/publishing should appear
    assert len(data) == 1
    assert data[0]["status"] == "scheduled"


def test_calendar_groups_by_date(client):
    dt = datetime(2026, 6, 15, 10, 0, 0)
    future = dt.isoformat()
    client.post("/api/posts", json={
        "globalContent": "Calendar post",
        "platform": "twitter",
        "status": "scheduled",
        "scheduledAt": future,
    })
    resp = client.get("/api/calendar?year=2026&month=6")
    assert resp.status_code == 200
    data = resp.json()
    assert "2026-06-15" in data
    assert len(data["2026-06-15"]) == 1


# ============================================================================
# Bridge/Integration Tests (smoke — no real API calls)
# ============================================================================

def test_integrations_status_no_bridge(client):
    """With no bridge env vars set, bridgeAvailable must be False."""
    resp = client.get("/api/integrations/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "bridgeAvailable" in data
    # In test env, bridge is not configured
    assert data["bridgeAvailable"] is False
    assert "platforms" in data


def test_ai_caption_no_bridge(client):
    """With no bridge, generate-caption must return status=unavailable, not 5xx."""
    resp = client.post("/api/ai/generate-caption", json={
        "platform": "twitter",
        "topic": "product launch",
        "tone": "casual",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "unavailable"
    assert "caption" in data


def test_publish_now_no_bridge(client):
    """With no bridge, publish-now must return status=error with 200, not 5xx."""
    create_resp = client.post("/api/posts", json={
        "globalContent": "Publish me",
        "platform": "twitter",
    })
    post_id = create_resp.json()["id"]
    resp = client.post(f"/api/posts/{post_id}/publish-now")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "error"
    assert "message" in data
