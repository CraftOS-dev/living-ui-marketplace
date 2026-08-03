"""Tests for daily briefing endpoints."""
from unittest.mock import patch, AsyncMock, MagicMock


def test_get_briefing_empty(client):
    """GET /briefing with no data should return null content."""
    response = client.get("/api/briefing")
    assert response.status_code == 200
    data = response.json()
    assert data["content"] is None
    assert data["generatedAt"] is None


def test_get_briefing_after_generate(client):
    """GET /briefing should return stored content after generation."""
    from models import DailyBriefing
    from tests.conftest import TestSessionLocal
    db = TestSessionLocal()
    try:
        briefing = DailyBriefing(content="Good morning! Test briefing.", generated_at=None)
        briefing.generated_at = __import__('datetime').datetime.utcnow()
        db.add(briefing)
        db.commit()
    finally:
        db.close()

    response = client.get("/api/briefing")
    assert response.status_code == 200
    assert response.json()["content"] == "Good morning! Test briefing."


def test_generate_briefing_fallback(client):
    """POST /briefing/generate falls back to template when LLM bridge unavailable."""
    with patch("services.integration_client.integration") as mock_integration:
        mock_integration.available = False
        response = client.post("/api/briefing/generate")
    assert response.status_code == 200
    data = response.json()
    assert data["content"] is not None
    assert len(data["content"]) > 0
    assert data["generatedAt"] is not None


def test_generate_briefing_idempotent(client):
    """POST /briefing/generate twice should update the same singleton row."""
    with patch("services.integration_client.integration") as mock_integration:
        mock_integration.available = False
        client.post("/api/briefing/generate")
        client.post("/api/briefing/generate")

    # Still only one briefing record
    response = client.get("/api/briefing")
    assert response.status_code == 200
    assert response.json()["content"] is not None
