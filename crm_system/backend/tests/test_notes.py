"""Tests for Note CRUD and pin/unpin operations."""

import pytest


def _create_contact(client):
    resp = client.post("/api/contacts", json={"firstName": "Note", "lastName": "User"})
    assert resp.status_code == 200
    return resp.json()


def _create_note(client, contact_id, **overrides):
    data = {
        "entityType": "contact",
        "entityId": contact_id,
        "content": "This is a test note.",
    }
    data.update(overrides)
    resp = client.post("/api/notes", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateNote:
    def test_create_note(self, client):
        contact = _create_contact(client)
        note = _create_note(client, contact["id"])
        assert note["entityType"] == "contact"
        assert note["entityId"] == contact["id"]
        assert note["content"] == "This is a test note."
        assert note["pinned"] is False
        assert note["id"] is not None
        assert note["createdAt"] is not None

    def test_create_note_for_deal(self, client):
        # Create a stage and deal first
        stage = client.post("/api/stages", json={"name": "Test Stage"}).json()
        deal = client.post("/api/deals", json={
            "title": "Test Deal", "stageId": stage["id"], "value": 100,
        }).json()
        note = _create_note(client, deal["id"], entityType="deal", content="Deal note")
        assert note["entityType"] == "deal"
        assert note["entityId"] == deal["id"]


class TestListNotes:
    def test_list_notes(self, client):
        contact = _create_contact(client)
        _create_note(client, contact["id"], content="Note 1")
        _create_note(client, contact["id"], content="Note 2")
        resp = client.get("/api/notes", params={
            "entity_type": "contact",
            "entity_id": contact["id"],
        })
        assert resp.status_code == 200
        notes = resp.json()
        assert len(notes) == 2

    def test_list_notes_empty(self, client):
        resp = client.get("/api/notes", params={"entity_type": "contact", "entity_id": 999})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_notes_pinned_first(self, client):
        contact = _create_contact(client)
        n1 = _create_note(client, contact["id"], content="Unpinned")
        n2 = _create_note(client, contact["id"], content="Pinned")
        # Pin the second note
        client.put(f"/api/notes/{n2['id']}/pin")

        resp = client.get("/api/notes", params={
            "entity_type": "contact",
            "entity_id": contact["id"],
        })
        notes = resp.json()
        assert notes[0]["content"] == "Pinned"
        assert notes[0]["pinned"] is True


class TestUpdateNote:
    def test_update_note(self, client):
        contact = _create_contact(client)
        note = _create_note(client, contact["id"])
        resp = client.put(f"/api/notes/{note['id']}", json={"content": "Updated content"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["content"] == "Updated content"

    def test_update_note_not_found(self, client):
        resp = client.put("/api/notes/999", json={"content": "Ghost"})
        assert resp.status_code == 404


class TestDeleteNote:
    def test_delete_note(self, client):
        contact = _create_contact(client)
        note = _create_note(client, contact["id"])
        resp = client.delete(f"/api/notes/{note['id']}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        # Verify gone from list
        resp = client.get("/api/notes", params={
            "entity_type": "contact",
            "entity_id": contact["id"],
        })
        assert len(resp.json()) == 0

    def test_delete_note_not_found(self, client):
        resp = client.delete("/api/notes/999")
        assert resp.status_code == 404


class TestPinNote:
    def test_pin_note(self, client):
        contact = _create_contact(client)
        note = _create_note(client, contact["id"])
        assert note["pinned"] is False

        # Pin
        resp = client.put(f"/api/notes/{note['id']}/pin")
        assert resp.status_code == 200
        body = resp.json()
        assert body["pinned"] is True

    def test_unpin_note(self, client):
        contact = _create_contact(client)
        note = _create_note(client, contact["id"])

        # Pin then unpin
        client.put(f"/api/notes/{note['id']}/pin")
        resp = client.put(f"/api/notes/{note['id']}/pin")
        assert resp.status_code == 200
        assert resp.json()["pinned"] is False

    def test_pin_note_not_found(self, client):
        resp = client.put("/api/notes/999/pin")
        assert resp.status_code == 404
