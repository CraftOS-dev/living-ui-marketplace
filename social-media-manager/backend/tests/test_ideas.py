"""Tests for Ideas Board and Hashtag Sets routes."""


def test_list_ideas_returns_list(client):
    r = client.get("/api/ideas")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_idea(client):
    r = client.post("/api/ideas", json={"content": "Hook: 90% of founders skip this step"})
    assert r.status_code == 200
    data = r.json()
    assert data["id"] > 0
    assert data["content"] == "Hook: 90% of founders skip this step"
    assert data["status"] == "idea"
    assert data["source"] == "manual"


def test_update_idea_status(client):
    created = client.post("/api/ideas", json={"content": "test idea"}).json()
    r = client.put(f"/api/ideas/{created['id']}", json={"status": "archived"})
    assert r.status_code == 200
    assert r.json()["status"] == "archived"


def test_delete_idea(client):
    created = client.post("/api/ideas", json={"content": "to delete"}).json()
    r = client.delete(f"/api/ideas/{created['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"


def test_promote_idea_creates_draft(client):
    created = client.post("/api/ideas", json={"content": "Great hook text", "platform": "linkedin"}).json()
    r = client.post(f"/api/ideas/{created['id']}/promote")
    assert r.status_code == 200
    post = r.json()
    assert post["status"] == "draft"
    assert post["globalContent"] == "Great hook text"
    assert post["platform"] == "linkedin"


def test_create_hashtag_set(client):
    r = client.post("/api/hashtag-sets", json={"name": "SaaS Launch", "tags": ["#saas", "#buildinpublic", "#startup"]})
    assert r.status_code == 200
    data = r.json()
    assert data["id"] > 0
    assert data["name"] == "SaaS Launch"
    assert len(data["tags"]) == 3
    assert data["useCount"] == 0


def test_delete_hashtag_set(client):
    created = client.post("/api/hashtag-sets", json={"name": "Temp", "tags": ["#test"]}).json()
    r = client.delete(f"/api/hashtag-sets/{created['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"
