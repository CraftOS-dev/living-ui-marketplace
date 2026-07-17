"""Saved views, timeline/notes, tasks + My Work buckets."""

from datetime import date, timedelta

from tests.helpers import auth_headers


def iso(days_offset: int) -> str:
    return (date.today() + timedelta(days=days_offset)).isoformat()


# ---- Views ----

def test_default_object_views_bootstrapped(client):
    headers = auth_headers(client)
    views = client.get("/api/views?object_type=person", headers=headers).json()
    assert any(v["name"] == "All people" and v["isDefault"] for v in views)


def test_view_crud(client):
    headers = auth_headers(client)
    view = client.post("/api/views", json={
        "name": "Hot leads", "object_type": "person", "layout": "table",
        "filters": [{"field": "jobTitle", "operator": "contains", "value": "CEO"}],
        "visible_columns": ["name", "jobTitle"],
    }, headers=headers).json()
    assert view["filters"][0]["value"] == "CEO"

    updated = client.put(f"/api/views/{view['id']}", json={
        "name": "Hot CEOs", "is_default": True,
    }, headers=headers).json()
    assert updated["name"] == "Hot CEOs"
    assert updated["isDefault"] is True

    # Old default demoted
    views = client.get("/api/views?object_type=person", headers=headers).json()
    defaults = [v for v in views if v["isDefault"]]
    assert len(defaults) == 1 and defaults[0]["id"] == view["id"]

    assert client.delete(f"/api/views/{view['id']}", headers=headers).json()["status"] == "deleted"
    assert client.delete(f"/api/views/{view['id']}", headers=headers).json()["status"] == "not_found"


# ---- Timeline & notes ----

def test_manual_activity_log(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Tim"}, headers=headers).json()
    activity = client.post("/api/activities", json={
        "record_type": "person", "record_id": person["id"],
        "type": "call", "title": "Intro call", "body": "Great chat",
    }, headers=headers).json()
    assert activity["type"] == "call"

    timeline = client.get(f"/api/timeline/person/{person['id']}?type_filter=call", headers=headers).json()
    assert timeline["total"] == 1
    assert timeline["items"][0]["title"] == "Intro call"


def test_note_crud_and_timeline_entry(client):
    headers = auth_headers(client)
    person = client.post("/api/records/person", json={"first_name": "Nel"}, headers=headers).json()
    note = client.post("/api/notes", json={
        "record_type": "person", "record_id": person["id"],
        "title": "Kickoff", "content": "- agenda\n- next steps",
    }, headers=headers).json()
    assert note["title"] == "Kickoff"

    updated = client.put(f"/api/notes/{note['id']}", json={"pinned": True}, headers=headers).json()
    assert updated["pinned"] is True

    notes = client.get(f"/api/notes/person/{person['id']}", headers=headers).json()
    assert notes[0]["pinned"] is True

    timeline = client.get(f"/api/timeline/person/{person['id']}", headers=headers).json()
    assert any(item["type"] == "note_created" for item in timeline["items"])

    assert client.delete(f"/api/notes/{note['id']}", headers=headers).json()["status"] == "deleted"
    assert client.delete(f"/api/notes/{note['id']}", headers=headers).json()["status"] == "not_found"


# ---- Tasks ----

def test_task_crud_and_complete(client):
    headers = auth_headers(client)
    deal = client.post("/api/records/deal", json={"name": "T-deal"}, headers=headers).json()
    task = client.post("/api/tasks", json={
        "title": "Send proposal", "due_date": iso(1),
        "record_type": "deal", "record_id": deal["id"],
    }, headers=headers).json()
    assert task["record"]["name"] == "T-deal"

    done = client.put(f"/api/tasks/{task['id']}", json={"completed": True}, headers=headers).json()
    assert done["completed"] is True

    timeline = client.get(f"/api/timeline/deal/{deal['id']}", headers=headers).json()
    types = [item["type"] for item in timeline["items"]]
    assert "task_created" in types and "task_completed" in types

    reopened = client.put(f"/api/tasks/{task['id']}", json={"completed": False}, headers=headers).json()
    assert reopened["completed"] is False

    assert client.delete(f"/api/tasks/{task['id']}", headers=headers).json()["status"] == "deleted"
    assert client.delete(f"/api/tasks/{task['id']}", headers=headers).json()["status"] == "not_found"


def test_my_work_buckets(client):
    headers = auth_headers(client)
    client.post("/api/tasks", json={"title": "Overdue", "due_date": iso(-2)}, headers=headers)
    client.post("/api/tasks", json={"title": "Today", "due_date": iso(0)}, headers=headers)
    client.post("/api/tasks", json={"title": "Soon", "due_date": iso(3)}, headers=headers)
    client.post("/api/tasks", json={"title": "Someday"}, headers=headers)

    work = client.get("/api/tasks/my-work", headers=headers).json()
    assert [t["title"] for t in work["overdue"]] == ["Overdue"]
    assert [t["title"] for t in work["today"]] == ["Today"]
    assert [t["title"] for t in work["upcoming"]] == ["Soon"]
    assert [t["title"] for t in work["someday"]] == ["Someday"]
    assert work["counts"]["open"] == 4
