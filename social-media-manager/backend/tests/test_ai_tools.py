"""Tests for AI Writing Suite routes — no bridge calls, no real API actions."""


def test_generate_hooks_no_bridge(client):
    """Returns unavailable with 200 when bridge not running."""
    r = client.post("/api/ai/generate-hooks", json={"topic": "startup growth", "platform": "twitter"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] in ("unavailable", "ok", "error")
    assert "hooks" in data


def test_humanize_no_bridge(client):
    """Returns unavailable with 200 when bridge not running."""
    r = client.post("/api/ai/humanize", json={"text": "leverage synergies", "platform": "linkedin"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] in ("unavailable", "ok", "error")
    assert "result" in data


def test_comment_insights_no_bridge(client):
    """Returns unavailable with 200 when bridge not running."""
    r = client.post("/api/ai/comment-insights", json={"platform": "google_youtube", "post_id": "abc123"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] in ("unavailable", "ok", "error")
    assert "commentsFetched" in data


def test_hook_request_missing_topic(client):
    """Missing required topic → 422."""
    r = client.post("/api/ai/generate-hooks", json={"platform": "twitter"})
    assert r.status_code == 422


def test_humanize_missing_text(client):
    """Missing required text → 422."""
    r = client.post("/api/ai/humanize", json={"platform": "twitter"})
    assert r.status_code == 422


def test_comment_insights_invalid_platform(client):
    """Invalid platform → 422."""
    r = client.post("/api/ai/comment-insights", json={"platform": "instagram", "post_id": "123"})
    assert r.status_code == 422


def test_hook_count_bounds(client):
    """count must be 3–7."""
    r = client.post("/api/ai/generate-hooks", json={"topic": "test", "platform": "twitter", "count": 10})
    assert r.status_code == 422


def test_humanize_default_tone(client):
    """Tone defaults to casual — request succeeds."""
    r = client.post("/api/ai/humanize", json={"text": "test text", "platform": "twitter"})
    assert r.status_code == 200
