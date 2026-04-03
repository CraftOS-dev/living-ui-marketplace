"""
Tests for Node Connections feature.
"""


def test_list_connections_empty(client):
    response = client.get("/api/connections")
    assert response.status_code == 200
    assert response.json() == []


def test_create_connection(client):
    item1 = client.post("/api/items", json={"type": "note", "title": "A"}).json()
    item2 = client.post("/api/items", json={"type": "note", "title": "B"}).json()
    response = client.post("/api/connections", json={"source_id": item1["id"], "target_id": item2["id"]})
    assert response.status_code == 200
    data = response.json()
    assert data["sourceId"] == item1["id"]
    assert data["targetId"] == item2["id"]
    assert "id" in data


def test_create_duplicate_connection_returns_existing(client):
    item1 = client.post("/api/items", json={"type": "note", "title": "A"}).json()
    item2 = client.post("/api/items", json={"type": "note", "title": "B"}).json()
    r1 = client.post("/api/connections", json={"source_id": item1["id"], "target_id": item2["id"]})
    r2 = client.post("/api/connections", json={"source_id": item1["id"], "target_id": item2["id"]})
    assert r1.json()["id"] == r2.json()["id"]


def test_list_connections_returns_all(client):
    item1 = client.post("/api/items", json={"type": "note", "title": "A"}).json()
    item2 = client.post("/api/items", json={"type": "note", "title": "B"}).json()
    item3 = client.post("/api/items", json={"type": "note", "title": "C"}).json()
    client.post("/api/connections", json={"source_id": item1["id"], "target_id": item2["id"]})
    client.post("/api/connections", json={"source_id": item2["id"], "target_id": item3["id"]})
    response = client.get("/api/connections")
    assert len(response.json()) == 2


def test_delete_connection(client):
    item1 = client.post("/api/items", json={"type": "note", "title": "A"}).json()
    item2 = client.post("/api/items", json={"type": "note", "title": "B"}).json()
    conn = client.post("/api/connections", json={"source_id": item1["id"], "target_id": item2["id"]}).json()
    response = client.delete(f"/api/connections/{conn['id']}")
    assert response.status_code == 200
    assert response.json()["status"] == "deleted"
    assert client.get("/api/connections").json() == []


def test_delete_connection_not_found(client):
    response = client.delete("/api/connections/9999")
    assert response.status_code == 404
