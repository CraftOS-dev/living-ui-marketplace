"""Tests for campaigns: CRUD, AI generation, preview, schedule, send pipeline."""

from datetime import datetime, timedelta


def _create_subs(client, n: int = 2, tags=None):
    out = []
    for i in range(n):
        body = {"email": f"u{i}@example.com", "first_name": f"User{i}"}
        if tags:
            body["tags"] = tags
        out.append(client.post("/api/subscribers", json=body).json())
    return out


def test_create_campaign(client):
    r = client.post("/api/campaigns", json={
        "name": "My first send",
        "subject": "Hello world",
        "blocks": [{"type": "heading", "text": "Hi"}],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "My first send"
    assert body["status"] == "draft"
    assert body["targetAll"] is True
    assert body["blocks"] == [{"type": "heading", "text": "Hi"}]


def test_create_campaign_from_template(client):
    tpl = client.post("/api/templates", json={
        "name": "Welcome",
        "subject": "Welcome aboard",
        "blocks": [{"type": "text", "text": "Hi {firstName}"}],
    }).json()
    r = client.post("/api/campaigns", json={
        "name": "Onboarding",
        "template_id": tpl["id"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["subject"] == "Welcome aboard"
    assert body["blocks"][0]["text"] == "Hi {firstName}"


def test_update_campaign(client):
    c = client.post("/api/campaigns", json={"name": "C1"}).json()
    r = client.put(f"/api/campaigns/{c['id']}", json={"subject": "Updated"})
    assert r.status_code == 200
    assert r.json()["subject"] == "Updated"


def test_delete_campaign_is_idempotent(client):
    c = client.post("/api/campaigns", json={"name": "C1"}).json()
    assert client.delete(f"/api/campaigns/{c['id']}").json()["status"] == "deleted"
    assert client.delete(f"/api/campaigns/{c['id']}").json()["status"] == "not_found"


def test_duplicate_campaign(client):
    c = client.post("/api/campaigns", json={
        "name": "Original",
        "subject": "S",
        "blocks": [{"type": "text", "text": "Hi"}],
    }).json()
    r = client.post(f"/api/campaigns/{c['id']}/duplicate")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] != c["id"]
    assert body["name"] == "Original (copy)"
    assert body["status"] == "draft"


def test_preview_campaign(client):
    _create_subs(client, n=1)
    c = client.post("/api/campaigns", json={
        "name": "Preview",
        "subject": "Hi {firstName}",
        "blocks": [{"type": "text", "text": "Hello {firstName}!"}],
    }).json()
    r = client.get(f"/api/campaigns/{c['id']}/preview")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "<html" in body["html"].lower()
    assert "User0" in body["html"]


def test_preview_missing_campaign_returns_status(client):
    r = client.get("/api/campaigns/99999/preview")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_schedule_campaign(client):
    c = client.post("/api/campaigns", json={"name": "Sched"}).json()
    future = (datetime.utcnow() + timedelta(days=1)).isoformat()
    r = client.post(f"/api/campaigns/{c['id']}/schedule", json={"scheduled_at": future})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "scheduled"
    assert body["scheduledAt"] is not None


def test_cancel_scheduled_campaign(client):
    c = client.post("/api/campaigns", json={"name": "Sched"}).json()
    future = (datetime.utcnow() + timedelta(days=1)).isoformat()
    client.post(f"/api/campaigns/{c['id']}/schedule", json={"scheduled_at": future})
    r = client.post(f"/api/campaigns/{c['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_send_without_gmail_marks_failed(client):
    """Without a connected Gmail integration the send should record a failure
    rather than crash."""
    _create_subs(client, n=2)
    c = client.post("/api/campaigns", json={
        "name": "Will fail",
        "subject": "S",
        "from_email": "me@example.com",
        "blocks": [{"type": "text", "text": "Hi"}],
    }).json()
    r = client.post(f"/api/campaigns/{c['id']}/send")
    assert r.status_code == 200
    body = r.json()
    # In tests the integration bridge is unavailable -> campaign marked failed.
    assert body["campaign"]["status"] == "failed"
    assert "Connect Google Workspace" in (body["campaign"]["errorMessage"] or "")


def test_send_without_from_email_fails_fast(client):
    _create_subs(client, n=1)
    c = client.post("/api/campaigns", json={"name": "No sender", "blocks": []}).json()
    r = client.post(f"/api/campaigns/{c['id']}/send")
    assert r.status_code == 200
    assert r.json()["campaign"]["status"] == "failed"
    assert "from-email" in (r.json()["campaign"]["errorMessage"] or "")


def test_list_recipients_for_scheduled_campaign(client):
    _create_subs(client, n=3)
    c = client.post("/api/campaigns", json={"name": "S", "from_email": "x@y.com"}).json()
    future = (datetime.utcnow() + timedelta(days=1)).isoformat()
    client.post(f"/api/campaigns/{c['id']}/schedule", json={"scheduled_at": future})
    r = client.get(f"/api/campaigns/{c['id']}/recipients")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 3
    assert all(row["status"] == "pending" for row in rows)


def test_filter_campaigns_by_status(client):
    client.post("/api/campaigns", json={"name": "A"})
    b = client.post("/api/campaigns", json={"name": "B"}).json()
    future = (datetime.utcnow() + timedelta(days=1)).isoformat()
    client.post(f"/api/campaigns/{b['id']}/schedule", json={"scheduled_at": future})
    drafts = client.get("/api/campaigns?status=draft").json()
    scheduled = client.get("/api/campaigns?status=scheduled").json()
    assert len(drafts) == 1
    assert len(scheduled) == 1


def test_ai_generate_returns_blocks(client):
    """When the LLM isn't available we still get a usable stub email."""
    r = client.post("/api/campaigns/generate", json={
        "prompt": "Announce our new feature",
        "tone": "friendly",
    })
    assert r.status_code == 200
    body = r.json()
    assert "blocks" in body
    assert isinstance(body["blocks"], list)
    assert len(body["blocks"]) >= 3
    assert "subject" in body


def test_open_tracking_records_click(client):
    """Manually create a recipient row, hit the tracking pixel route, ensure
    the open is recorded on the campaign."""
    from models import Campaign, CampaignRecipient
    from database import SessionLocal
    from tests.conftest import TestSessionLocal
    db = TestSessionLocal()
    try:
        camp = Campaign(name="T", subject="X", status="sent")
        db.add(camp)
        db.commit()
        db.refresh(camp)
        rec = CampaignRecipient(
            campaign_id=camp.id,
            email_snapshot="x@example.com",
            status="sent",
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        token = rec.open_token
    finally:
        db.close()

    r = client.get(f"/api/track/open/{token}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")
    # Refetch via session
    db = TestSessionLocal()
    try:
        camp = db.query(Campaign).first()
        assert camp.opens_unique == 1
        rec = db.query(CampaignRecipient).first()
        assert rec.opened_at is not None
    finally:
        db.close()


def test_click_tracking_redirects(client):
    from models import Campaign, CampaignRecipient
    from tests.conftest import TestSessionLocal
    db = TestSessionLocal()
    try:
        camp = Campaign(name="T", subject="X", status="sent")
        db.add(camp)
        db.commit()
        db.refresh(camp)
        rec = CampaignRecipient(
            campaign_id=camp.id,
            email_snapshot="x@example.com",
            status="sent",
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        token = rec.click_token
    finally:
        db.close()

    r = client.get(
        f"/api/track/click/{token}?url=https://example.com/landing",
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert r.headers["location"] == "https://example.com/landing"
