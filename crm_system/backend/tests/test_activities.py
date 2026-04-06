"""Tests for Activity CRUD, completion, upcoming, and overdue queries."""

import pytest
from datetime import datetime, timedelta


def _create_contact(client):
    resp = client.post("/api/contacts", json={"firstName": "Test", "lastName": "User"})
    assert resp.status_code == 200
    return resp.json()


def _create_activity(client, contact_id, **overrides):
    data = {
        "entityType": "contact",
        "entityId": contact_id,
        "activityType": "call",
        "subject": "Follow-up call",
        "description": "Discuss next steps.",
        "priority": "normal",
    }
    data.update(overrides)
    resp = client.post("/api/activities", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateActivity:
    def test_create_activity(self, client):
        contact = _create_contact(client)
        activity = _create_activity(client, contact["id"])
        assert activity["entityType"] == "contact"
        assert activity["entityId"] == contact["id"]
        assert activity["activityType"] == "call"
        assert activity["subject"] == "Follow-up call"
        assert activity["isCompleted"] is False
        assert activity["id"] is not None

    def test_create_activity_with_due_date(self, client):
        contact = _create_contact(client)
        due = (datetime.utcnow() + timedelta(days=3)).isoformat()
        activity = _create_activity(client, contact["id"], dueDate=due)
        assert activity["dueDate"] is not None

    def test_create_activity_various_types(self, client):
        contact = _create_contact(client)
        for atype in ["call", "email", "meeting", "task"]:
            act = _create_activity(
                client, contact["id"],
                activityType=atype, subject=f"Test {atype}",
            )
            assert act["activityType"] == atype


class TestListActivities:
    def test_list_activities(self, client):
        contact = _create_contact(client)
        _create_activity(client, contact["id"], subject="Act 1")
        _create_activity(client, contact["id"], subject="Act 2")
        resp = client.get("/api/activities")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2

    def test_list_activities_filter_by_entity(self, client):
        contact = _create_contact(client)
        _create_activity(client, contact["id"])
        resp = client.get("/api/activities", params={
            "entity_type": "contact",
            "entity_id": contact["id"],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1

    def test_list_activities_filter_by_completion(self, client):
        contact = _create_contact(client)
        act = _create_activity(client, contact["id"])
        # Complete the activity
        client.put(f"/api/activities/{act['id']}/complete")

        resp = client.get("/api/activities", params={"is_completed": True})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        resp = client.get("/api/activities", params={"is_completed": False})
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


class TestCompleteActivity:
    def test_complete_activity(self, client):
        contact = _create_contact(client)
        activity = _create_activity(client, contact["id"])
        assert activity["isCompleted"] is False

        # Toggle to completed
        resp = client.put(f"/api/activities/{activity['id']}/complete")
        assert resp.status_code == 200
        body = resp.json()
        assert body["isCompleted"] is True
        assert body["completedAt"] is not None

    def test_uncomplete_activity(self, client):
        contact = _create_contact(client)
        activity = _create_activity(client, contact["id"])

        # Complete
        client.put(f"/api/activities/{activity['id']}/complete")
        # Toggle back
        resp = client.put(f"/api/activities/{activity['id']}/complete")
        assert resp.status_code == 200
        body = resp.json()
        assert body["isCompleted"] is False
        assert body["completedAt"] is None

    def test_complete_activity_not_found(self, client):
        resp = client.put("/api/activities/999/complete")
        assert resp.status_code == 404


class TestUpcomingActivities:
    def test_upcoming_activities(self, client):
        contact = _create_contact(client)
        future = (datetime.utcnow() + timedelta(days=2)).isoformat()
        _create_activity(client, contact["id"], subject="Upcoming", dueDate=future)

        resp = client.get("/api/activities/upcoming", params={"days": 7})
        assert resp.status_code == 200
        activities = resp.json()
        assert len(activities) >= 1
        assert any(a["subject"] == "Upcoming" for a in activities)

    def test_upcoming_excludes_completed(self, client):
        contact = _create_contact(client)
        future = (datetime.utcnow() + timedelta(days=2)).isoformat()
        act = _create_activity(client, contact["id"], subject="Done", dueDate=future)
        client.put(f"/api/activities/{act['id']}/complete")

        resp = client.get("/api/activities/upcoming")
        assert resp.status_code == 200
        activities = resp.json()
        assert not any(a["subject"] == "Done" for a in activities)


class TestOverdueActivities:
    def test_overdue_activities(self, client, db):
        contact = _create_contact(client)
        # Create activity with a past due date via direct DB (since API parses datetime)
        past = (datetime.utcnow() - timedelta(days=3)).isoformat()
        act = _create_activity(client, contact["id"], subject="Overdue Task", dueDate=past)

        resp = client.get("/api/activities/overdue")
        assert resp.status_code == 200
        activities = resp.json()
        assert len(activities) >= 1
        assert any(a["subject"] == "Overdue Task" for a in activities)

    def test_overdue_excludes_completed(self, client):
        contact = _create_contact(client)
        past = (datetime.utcnow() - timedelta(days=3)).isoformat()
        act = _create_activity(client, contact["id"], subject="Done Overdue", dueDate=past)
        client.put(f"/api/activities/{act['id']}/complete")

        resp = client.get("/api/activities/overdue")
        assert resp.status_code == 200
        activities = resp.json()
        assert not any(a["subject"] == "Done Overdue" for a in activities)
