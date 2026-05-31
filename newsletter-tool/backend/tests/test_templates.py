"""Tests for templates and built-in seeding."""


def test_create_template(client):
    r = client.post("/api/templates", json={
        "name": "My template",
        "subject": "Hello",
        "blocks": [{"type": "text", "text": "Body"}],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "My template"
    assert body["subject"] == "Hello"
    assert body["isBuiltin"] is False
    assert body["blocks"] == [{"type": "text", "text": "Body"}]


def test_list_seeds_built_ins_on_first_call(client):
    # The bootstrap hook (dependency on the router) seeds built-ins on the
    # first request. Hitting any endpoint should give us a non-empty list.
    r = client.get("/api/templates")
    assert r.status_code == 200
    names = {t["name"] for t in r.json()}
    assert "Welcome new subscriber" in names
    assert "Weekly newsletter" in names


def test_filter_builtin_only(client):
    client.get("/api/templates")  # seed
    r = client.get("/api/templates?builtin_only=true")
    assert r.status_code == 200
    assert all(t["isBuiltin"] for t in r.json())
    r2 = client.get("/api/templates?builtin_only=false")
    assert all(not t["isBuiltin"] for t in r2.json())


def test_get_template_404(client):
    r = client.get("/api/templates/99999")
    assert r.status_code == 404


def test_update_user_template(client):
    tpl = client.post("/api/templates", json={"name": "T", "blocks": []}).json()
    r = client.put(f"/api/templates/{tpl['id']}", json={"name": "T2", "subject": "X"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "T2"
    assert body["subject"] == "X"


def test_builtin_can_be_edited(client):
    """Built-in templates are fully editable now; the is_builtin flag is
    metadata only."""
    builtin = next(t for t in client.get("/api/templates").json() if t["isBuiltin"])
    r = client.put(f"/api/templates/{builtin['id']}", json={"name": "My welcome"})
    assert r.status_code == 200
    refetch = client.get(f"/api/templates/{builtin['id']}").json()
    assert refetch["name"] == "My welcome"


def test_delete_user_template(client):
    tpl = client.post("/api/templates", json={"name": "T", "blocks": []}).json()
    r = client.delete(f"/api/templates/{tpl['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"


def test_delete_builtin_is_allowed(client):
    """Built-ins are deletable. The seed only re-runs when the table is empty
    so a single deletion doesn't spawn the template back."""
    builtin = next(t for t in client.get("/api/templates").json() if t["isBuiltin"])
    r = client.delete(f"/api/templates/{builtin['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"


def test_delete_missing_is_idempotent(client):
    r = client.delete("/api/templates/99999")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"
