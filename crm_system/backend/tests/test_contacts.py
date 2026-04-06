"""Tests for Contact CRUD, search, pagination, and bulk operations."""

import pytest


def _create_contact(client, **overrides):
    """Helper to create a contact with default data."""
    data = {
        "firstName": "John",
        "lastName": "Doe",
        "email": "john.doe@example.com",
        "phone": "+1-555-0100",
        "jobTitle": "Software Engineer",
        "department": "Engineering",
        "city": "San Francisco",
        "state": "CA",
        "country": "US",
        "source": "manual",
        "leadStatus": "new",
    }
    data.update(overrides)
    resp = client.post("/api/contacts", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateContact:
    def test_create_contact(self, client):
        data = {
            "firstName": "Alice",
            "lastName": "Smith",
            "email": "alice@example.com",
            "phone": "+1-555-0101",
            "jobTitle": "Product Manager",
            "department": "Product",
            "city": "New York",
            "state": "NY",
            "country": "US",
            "zipCode": "10001",
            "source": "manual",
            "leadStatus": "new",
        }
        resp = client.post("/api/contacts", json=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["firstName"] == "Alice"
        assert body["lastName"] == "Smith"
        assert body["email"] == "alice@example.com"
        assert body["phone"] == "+1-555-0101"
        assert body["jobTitle"] == "Product Manager"
        assert body["department"] == "Product"
        assert body["city"] == "New York"
        assert body["state"] == "NY"
        assert body["country"] == "US"
        assert body["zipCode"] == "10001"
        assert body["source"] == "manual"
        assert body["leadStatus"] == "new"
        assert body["id"] is not None
        assert body["createdAt"] is not None
        assert body["avatarColor"] is not None

    def test_create_contact_minimal(self, client):
        resp = client.post("/api/contacts", json={"firstName": "Min", "lastName": "Imal"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["firstName"] == "Min"
        assert body["lastName"] == "Imal"
        assert body["email"] is None

    def test_create_contact_missing_required_fields(self, client):
        resp = client.post("/api/contacts", json={"firstName": "Only"})
        assert resp.status_code == 422


class TestListContacts:
    def test_list_contacts_empty(self, client):
        resp = client.get("/api/contacts")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["page"] == 1

    def test_list_contacts_returns_paginated_results(self, client):
        for i in range(5):
            _create_contact(client, firstName=f"User{i}", lastName="Test", email=f"user{i}@test.com")
        resp = client.get("/api/contacts", params={"per_page": 3, "page": 1})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) == 3
        assert body["total"] == 5
        assert body["pages"] == 2

    def test_list_contacts_page_2(self, client):
        for i in range(5):
            _create_contact(client, firstName=f"User{i}", lastName="Test", email=f"user{i}@test.com")
        resp = client.get("/api/contacts", params={"per_page": 3, "page": 2})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) == 2

    def test_list_contacts_filter_by_status(self, client):
        _create_contact(client, firstName="Active", lastName="User", email="a@test.com")
        resp = client.get("/api/contacts", params={"status": "active"})
        assert resp.status_code == 200

    def test_list_contacts_search(self, client):
        _create_contact(client, firstName="Unique", lastName="Person", email="unique@test.com")
        _create_contact(client, firstName="Other", lastName="Dude", email="other@test.com")
        resp = client.get("/api/contacts", params={"search": "Unique"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["firstName"] == "Unique"


class TestGetContact:
    def test_get_contact(self, client):
        created = _create_contact(client)
        resp = client.get(f"/api/contacts/{created['id']}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == created["id"]
        assert body["firstName"] == "John"
        assert body["lastName"] == "Doe"

    def test_contact_not_found(self, client):
        resp = client.get("/api/contacts/999")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


class TestUpdateContact:
    def test_update_contact(self, client):
        created = _create_contact(client)
        resp = client.put(
            f"/api/contacts/{created['id']}",
            json={"firstName": "Jane", "email": "jane@example.com"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["firstName"] == "Jane"
        assert body["email"] == "jane@example.com"
        # Unchanged fields preserved
        assert body["lastName"] == "Doe"

    def test_update_contact_not_found(self, client):
        resp = client.put("/api/contacts/999", json={"firstName": "Ghost"})
        assert resp.status_code == 404


class TestDeleteContact:
    def test_delete_contact(self, client):
        created = _create_contact(client)
        resp = client.delete(f"/api/contacts/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        # Verify gone
        resp = client.get(f"/api/contacts/{created['id']}")
        assert resp.status_code == 404

    def test_delete_contact_not_found(self, client):
        resp = client.delete("/api/contacts/999")
        assert resp.status_code == 404


class TestSearchContacts:
    def test_search_contacts(self, client):
        _create_contact(client, firstName="Searchable", lastName="Smith", email="search@test.com")
        _create_contact(client, firstName="Other", lastName="Person", email="other@test.com")
        resp = client.get("/api/contacts/search", params={"q": "Searchable"})
        assert resp.status_code == 200
        results = resp.json()
        assert isinstance(results, list)
        assert len(results) == 1
        assert results[0]["firstName"] == "Searchable"

    def test_search_contacts_by_email(self, client):
        _create_contact(client, firstName="Email", lastName="Search", email="specific@domain.com")
        resp = client.get("/api/contacts/search", params={"q": "specific@domain"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1

    def test_search_contacts_no_results(self, client):
        resp = client.get("/api/contacts/search", params={"q": "nonexistent"})
        assert resp.status_code == 200
        assert resp.json() == []


class TestContactTimeline:
    def test_contact_timeline(self, client):
        contact = _create_contact(client)
        cid = contact["id"]

        # Create an activity for this contact
        client.post("/api/activities", json={
            "entityType": "contact",
            "entityId": cid,
            "activityType": "call",
            "subject": "Follow-up call",
        })

        # Create a note for this contact
        client.post("/api/notes", json={
            "entityType": "contact",
            "entityId": cid,
            "content": "Had a great conversation.",
        })

        resp = client.get(f"/api/contacts/{cid}/timeline")
        assert resp.status_code == 200
        timeline = resp.json()
        assert isinstance(timeline, list)
        assert len(timeline) == 2
        types = {item["timelineType"] for item in timeline}
        assert "activity" in types
        assert "note" in types

    def test_contact_timeline_empty(self, client):
        contact = _create_contact(client)
        resp = client.get(f"/api/contacts/{contact['id']}/timeline")
        assert resp.status_code == 200
        assert resp.json() == []
