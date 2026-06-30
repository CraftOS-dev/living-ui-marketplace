"""Tests for node CRUD and agent actions."""


def _make_session(client, title="S", topic="T"):
    r = client.post("/api/sessions", json={"title": title, "topic": topic})
    return r.json()


def test_create_node_manual(client):
    result = _make_session(client)
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    r = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "Q?", "nodeType": "question"})
    assert r.status_code == 200
    node = r.json()
    assert node["content"] == "Q?"
    assert node["nodeType"] == "question"
    assert node["parentId"] == root_id
    assert node["depth"] == 1
    assert node["createdBy"] == "user"


def test_create_node_idea(client):
    result = _make_session(client)
    s_id = result["session"]["id"]
    r = client.post("/api/nodes", json={"sessionId": s_id, "content": "Big idea", "nodeType": "idea"})
    assert r.status_code == 200
    assert r.json()["nodeType"] == "idea"
    assert r.json()["depth"] == 0


def test_update_node_content(client):
    result = _make_session(client)
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    node = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "Old", "nodeType": "question"}).json()
    r = client.put(f"/api/nodes/{node['id']}", json={"content": "New"})
    assert r.status_code == 200
    assert r.json()["content"] == "New"


def test_update_node_position(client):
    result = _make_session(client)
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    node = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "N", "nodeType": "question"}).json()
    r = client.put(f"/api/nodes/{node['id']}", json={"x": 100.0, "y": 200.0})
    assert r.status_code == 200
    assert r.json()["x"] == 100.0
    assert r.json()["y"] == 200.0


def test_update_node_not_found(client):
    r = client.put("/api/nodes/9999", json={"content": "x"})
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_delete_node(client):
    result = _make_session(client)
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    node = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "N", "nodeType": "question"}).json()
    r = client.delete(f"/api/nodes/{node['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"
    nodes = client.get(f"/api/sessions/{s_id}/nodes").json()
    assert all(n["id"] != node["id"] for n in nodes)


def test_delete_node_not_found(client):
    r = client.delete("/api/nodes/9999")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_delete_node_cascades_subtree(client):
    result = _make_session(client)
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    child = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "C", "nodeType": "question"}).json()
    grandchild = client.post("/api/nodes", json={"sessionId": s_id, "parentId": child["id"], "content": "GC", "nodeType": "question"}).json()
    client.delete(f"/api/nodes/{child['id']}")
    nodes = client.get(f"/api/sessions/{s_id}/nodes").json()
    node_ids = [n["id"] for n in nodes]
    assert child["id"] not in node_ids
    assert grandchild["id"] not in node_ids
    assert root_id in node_ids


def test_expand_node(client):
    result = _make_session(client, topic="Artificial Intelligence")
    root_id = result["rootNode"]["id"]
    r = client.post(f"/api/nodes/{root_id}/expand")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert len(data["newNodes"]) == 3
    for node in data["newNodes"]:
        assert node["parentId"] == root_id
        assert node["nodeType"] == "question"
        assert node["createdBy"] == "agent"
        assert node["depth"] == 1


def test_expand_node_not_found(client):
    r = client.post("/api/nodes/9999/expand")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_expand_bridge_offline_returns_503(client, monkeypatch):
    """No CraftBot bridge -> honest 503, never fake/hardcoded content."""
    import services.integration_client as ic
    monkeypatch.setattr(ic, "BRIDGE_URL", "")
    monkeypatch.setattr(ic, "BRIDGE_TOKEN", "")
    result = _make_session(client, topic="Offline Test")
    root_id = result["rootNode"]["id"]
    r = client.post(f"/api/nodes/{root_id}/expand")
    assert r.status_code == 503
    assert "not connected" in r.json()["detail"].lower()


def test_answer_node(client):
    result = _make_session(client, topic="Climate Change")
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    q_node = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "What causes climate change?", "nodeType": "question"}).json()
    r = client.post(f"/api/nodes/{q_node['id']}/answer")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["node"]["nodeType"] == "answer"
    assert data["node"]["parentId"] == q_node["id"]
    assert data["node"]["createdBy"] == "agent"


def test_answer_non_question_node(client):
    result = _make_session(client)
    root_id = result["rootNode"]["id"]
    r = client.post(f"/api/nodes/{root_id}/answer")
    assert r.status_code == 200
    assert r.json()["status"] == "error"


def test_explore_session(client):
    result = _make_session(client, topic="Quantum Computing")
    s_id = result["session"]["id"]
    r = client.post(f"/api/sessions/{s_id}/explore")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["action"] in ("expand", "answer", "none")


def test_explore_session_not_found(client):
    r = client.post("/api/sessions/9999/explore")
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_action_expand_node(client):
    result = _make_session(client, topic="Space Exploration")
    root_id = result["rootNode"]["id"]
    r = client.post("/api/action", json={"action": "expand_node", "payload": {"node_id": root_id}})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert len(r.json()["newNodes"]) == 3


def test_action_answer_node(client):
    result = _make_session(client, topic="Philosophy")
    s_id = result["session"]["id"]
    root_id = result["rootNode"]["id"]
    q = client.post("/api/nodes", json={"sessionId": s_id, "parentId": root_id, "content": "What is consciousness?", "nodeType": "question"}).json()
    r = client.post("/api/action", json={"action": "answer_node", "payload": {"node_id": q["id"]}})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_action_explore(client):
    result = _make_session(client, topic="Machine Learning")
    s_id = result["session"]["id"]
    r = client.post("/api/action", json={"action": "explore", "payload": {"session_id": s_id}})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
