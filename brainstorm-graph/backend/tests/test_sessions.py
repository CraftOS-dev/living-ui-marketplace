"""Tests for session CRUD."""


def test_list_sessions_empty(client):
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert r.json() == []


def test_create_session(client):
    r = client.post("/api/sessions", json={"title": "AI Research", "topic": "Artificial Intelligence"})
    assert r.status_code == 200
    data = r.json()
    assert data["session"]["title"] == "AI Research"
    assert data["session"]["topic"] == "Artificial Intelligence"
    assert data["rootNode"]["nodeType"] == "idea"
    assert data["rootNode"]["parentId"] is None
    assert data["rootNode"]["depth"] == 0


def test_list_sessions(client):
    client.post("/api/sessions", json={"title": "S1", "topic": "Topic 1"})
    client.post("/api/sessions", json={"title": "S2", "topic": "Topic 2"})
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_update_session(client):
    s = client.post("/api/sessions", json={"title": "Old", "topic": "T"}).json()["session"]
    r = client.put(f"/api/sessions/{s['id']}", json={"title": "New"})
    assert r.status_code == 200
    assert r.json()["title"] == "New"


def test_update_session_not_found(client):
    r = client.put("/api/sessions/9999", json={"title": "x"})
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_delete_session(client):
    s = client.post("/api/sessions", json={"title": "Del", "topic": "T"}).json()["session"]
    r = client.delete(f"/api/sessions/{s['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"
    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 0


def test_delete_session_not_found(client):
    r = client.delete("/api/sessions/9999")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_delete_session_cascades_nodes(client):
    result = client.post("/api/sessions", json={"title": "S", "topic": "T"}).json()
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "Child", "nodeType": "question"})
    client.delete(f"/api/sessions/{s_id}")
    r = client.get(f"/api/sessions/{s_id}/nodes")
    assert r.status_code == 200
    assert r.json() == []


def test_get_session_nodes(client):
    result = client.post("/api/sessions", json={"title": "S", "topic": "T"}).json()
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "Q1", "nodeType": "question"})
    r = client.get(f"/api/sessions/{s_id}/nodes")
    assert r.status_code == 200
    nodes = r.json()
    assert len(nodes) == 2  # root + Q1
