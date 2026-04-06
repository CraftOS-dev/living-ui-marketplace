"""Tests for Email Template CRUD and rendering."""

import pytest


def _create_template(client, **overrides):
    data = {
        "name": "Welcome Email",
        "subject": "Welcome {{first_name}}!",
        "body": "Hi {{first_name}}, welcome to {{company_name}}.",
        "category": "intro",
        "variables": ["first_name", "company_name"],
    }
    data.update(overrides)
    resp = client.post("/api/email-templates", json=data)
    assert resp.status_code == 200
    return resp.json()


class TestCreateTemplate:
    def test_create_template(self, client):
        tpl = _create_template(client)
        assert tpl["name"] == "Welcome Email"
        assert tpl["subject"] == "Welcome {{first_name}}!"
        assert tpl["body"] == "Hi {{first_name}}, welcome to {{company_name}}."
        assert tpl["category"] == "intro"
        assert tpl["variables"] == ["first_name", "company_name"]
        assert tpl["id"] is not None

    def test_create_template_minimal(self, client):
        resp = client.post("/api/email-templates", json={
            "name": "Simple",
            "subject": "Hello",
            "body": "Body text.",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Simple"
        assert body["category"] is None


class TestListTemplates:
    def test_list_templates_empty(self, client):
        resp = client.get("/api/email-templates")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_templates(self, client):
        _create_template(client, name="Template A")
        _create_template(client, name="Template B")
        resp = client.get("/api/email-templates")
        assert resp.status_code == 200
        templates = resp.json()
        assert len(templates) == 2

    def test_list_templates_filter_by_category(self, client):
        _create_template(client, name="Intro", category="intro")
        _create_template(client, name="Follow Up", category="follow_up")
        resp = client.get("/api/email-templates", params={"category": "follow_up"})
        assert resp.status_code == 200
        templates = resp.json()
        assert len(templates) == 1
        assert templates[0]["name"] == "Follow Up"


class TestRenderTemplate:
    def test_render_template(self, client):
        tpl = _create_template(client)
        resp = client.post(f"/api/email-templates/{tpl['id']}/render", json={
            "variables": {
                "first_name": "Alice",
                "company_name": "Acme Corp",
            },
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["subject"] == "Welcome Alice!"
        assert body["body"] == "Hi Alice, welcome to Acme Corp."

    def test_render_template_partial_variables(self, client):
        tpl = _create_template(client)
        resp = client.post(f"/api/email-templates/{tpl['id']}/render", json={
            "variables": {"first_name": "Bob"},
        })
        assert resp.status_code == 200
        body = resp.json()
        assert "Bob" in body["subject"]
        # Unreplaced variable stays as-is
        assert "{{company_name}}" in body["body"]

    def test_render_template_not_found(self, client):
        resp = client.post("/api/email-templates/999/render", json={
            "variables": {"first_name": "Ghost"},
        })
        assert resp.status_code == 404
