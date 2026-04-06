"""Tests for Tag CRUD and duplicate name constraint."""

import pytest


def _create_tag(client, **overrides):
    data = {"name": "VIP", "color": "#ef4444"}
    data.update(overrides)
    resp = client.post("/api/tags", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateTag:
    def test_create_tag(self, client):
        tag = _create_tag(client)
        assert tag["name"] == "VIP"
        assert tag["color"] == "#ef4444"
        assert tag["id"] is not None
        assert tag["createdAt"] is not None

    def test_create_tag_default_color(self, client):
        resp = client.post("/api/tags", json={"name": "Default Color"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["color"] == "#6366f1"


class TestListTags:
    def test_list_tags_empty(self, client):
        resp = client.get("/api/tags")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_tags(self, client):
        _create_tag(client, name="Alpha")
        _create_tag(client, name="Beta")
        _create_tag(client, name="Gamma")
        resp = client.get("/api/tags")
        assert resp.status_code == 200
        tags = resp.json()
        assert len(tags) == 3
        # Ordered alphabetically by name
        names = [t["name"] for t in tags]
        assert names == sorted(names)

    def test_list_tags_includes_contact_count(self, client):
        tag = _create_tag(client, name="Countable")
        # Create a contact with this tag
        client.post("/api/contacts", json={
            "firstName": "Tagged",
            "lastName": "User",
            "tagIds": [tag["id"]],
        })
        resp = client.get("/api/tags")
        tags = resp.json()
        target = next(t for t in tags if t["name"] == "Countable")
        assert target["contactCount"] == 1


class TestUpdateTag:
    def test_update_tag(self, client):
        tag = _create_tag(client)
        resp = client.put(f"/api/tags/{tag['id']}", json={"name": "Premium", "color": "#f59e0b"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Premium"
        assert body["color"] == "#f59e0b"

    def test_update_tag_not_found(self, client):
        resp = client.put("/api/tags/999", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteTag:
    def test_delete_tag(self, client):
        tag = _create_tag(client)
        resp = client.delete(f"/api/tags/{tag['id']}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        resp = client.get("/api/tags")
        assert len(resp.json()) == 0

    def test_delete_tag_not_found(self, client):
        resp = client.delete("/api/tags/999")
        assert resp.status_code == 404


class TestDuplicateTagName:
    def test_duplicate_tag_name(self, client):
        _create_tag(client, name="Unique Tag")
        resp = client.post("/api/tags", json={"name": "Unique Tag"})
        assert resp.status_code == 400
        assert "already exists" in resp.json()["detail"].lower()
