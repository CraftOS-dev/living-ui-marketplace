"""Email config/send/log/templates, tags, attachments."""

import base64

from tests.helpers import auth_headers


# ---- Email ----

def test_smtp_config_roundtrip_masks_password(client):
    headers = auth_headers(client)  # first user = admin
    response = client.put("/api/email/config", json={
        "host": "smtp.example.com", "port": 587,
        "username": "mailer", "password": "supersecret",
        "from_email": "crm@example.com", "from_name": "CRM",
    }, headers=headers)
    assert response.status_code == 200
    config = client.get("/api/email/config", headers=headers).json()
    assert config["configured"] is True
    assert config["password"] == "********"

    # Saving the masked placeholder must not clobber the real secret
    client.put("/api/email/config", json={"password": "********", "from_name": "CRM 2"}, headers=headers)
    config = client.get("/api/email/config", headers=headers).json()
    assert config["fromName"] == "CRM 2"


def test_send_unconfigured_returns_200_with_honest_status(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={
        "first_name": "Mail", "emails": ["mail@x.com"],
    }, headers=headers).json()
    response = client.post("/api/email/send", json={
        "to": "mail@x.com", "subject": "Hi", "body": "Hello",
        "record_type": "person", "record_id": person["id"],
    }, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["notConfigured"] is True


def test_manual_email_log_writes_timeline(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Log"}, headers=headers).json()
    response = client.post("/api/email/log", json={
        "subject": "Thread recap", "body": "Pasted thread...",
        "record_type": "person", "record_id": person["id"],
    }, headers=headers)
    assert response.status_code == 200
    timeline = client.get(f"/api/timeline/person/{person['id']}", headers=headers).json()
    assert any(item["type"] == "email" for item in timeline["items"])

    logs = client.get(f"/api/email/logs?record_type=person&record_id={person['id']}", headers=headers).json()
    assert logs["total"] == 1


def test_template_crud_and_rendering(client):
    headers = auth_headers(client)
    template = client.post("/api/email/templates", json={
        "name": "Follow-up", "subject": "Hi {{first_name}}", "body": "Hello {{first_name}} at {{company}}",
    }, headers=headers).json()

    company = client.post("/api/records/company", json={"name": "Acme"}, headers=headers).json()
    person = client.post("/api/records/person", json={
        "first_name": "Rita", "emails": ["rita@acme.com"], "company_id": company["id"],
    }, headers=headers).json()

    response = client.post("/api/email/send", json={
        "person_id": person["id"], "template_id": template["id"],
        "record_type": "person", "record_id": person["id"],
    }, headers=headers).json()
    # Unconfigured SMTP, but the rendered log is still recorded
    assert response["log"]["subject"] == "Hi Rita"
    assert "Rita" in response["log"]["body"]
    assert "Acme" in response["log"]["body"]

    assert client.delete(f"/api/email/templates/{template['id']}", headers=headers).json()["status"] == "deleted"


# ---- Tags ----

def test_tag_assign_and_filter(client):
    headers = auth_headers(client)
    tag = client.post("/api/tags", json={"name": "Hot"}, headers=headers).json()
    person = client.post("/api/records/person", json={"first_name": "Tag"}, headers=headers).json()
    client.post(f"/api/tags/{tag['id']}/records", json={
        "record_type": "person", "record_id": person["id"],
    }, headers=headers)

    result = client.post("/api/records/person/query", json={}, headers=headers).json()
    row = next(r for r in result["items"] if r["id"] == person["id"])
    assert row["tags"][0]["name"] == "Hot"

    response = client.delete(f"/api/tags/{tag['id']}/records/person/{person['id']}", headers=headers)
    assert response.status_code == 200
    assert client.delete(f"/api/tags/{tag['id']}/records/person/{person['id']}", headers=headers).status_code == 200


def test_tag_dedupe_by_name(client):
    headers = auth_headers(client)
    first = client.post("/api/tags", json={"name": "VIP"}, headers=headers).json()
    second = client.post("/api/tags", json={"name": "vip"}, headers=headers).json()
    assert first["id"] == second["id"]


# ---- Files ----

def test_file_upload_download_delete(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "File"}, headers=headers).json()
    content = base64.b64encode(b"hello attachment").decode()
    uploaded = client.post("/api/files", json={
        "record_type": "person", "record_id": person["id"],
        "file_name": "notes.txt", "data_base64": content,
    }, headers=headers).json()
    assert uploaded["fileName"] == "notes.txt"
    assert uploaded["size"] == len(b"hello attachment")

    files = client.get(f"/api/files/person/{person['id']}", headers=headers).json()
    assert len(files) == 1

    response = client.get(f"/api/files/download/{uploaded['id']}")
    assert response.status_code == 200
    assert response.content == b"hello attachment"

    assert client.delete(f"/api/files/{uploaded['id']}", headers=headers).json()["status"] == "deleted"
    assert client.delete(f"/api/files/{uploaded['id']}", headers=headers).json()["status"] == "not_found"
