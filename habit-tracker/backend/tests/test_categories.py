"""Tests for Category CRUD endpoints."""


def test_list_categories_empty(client):
    response = client.get("/api/categories")
    assert response.status_code == 200
    assert response.json() == []


def test_create_category(client):
    response = client.post("/api/categories", json={
        "name": "Health",
        "color": "#22C55E",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Health"
    assert data["color"] == "#22C55E"
    assert "id" in data
    assert data["order"] == 0


def test_create_category_assigns_increasing_order(client):
    a = client.post("/api/categories", json={"name": "A", "color": "#000"}).json()
    b = client.post("/api/categories", json={"name": "B", "color": "#000"}).json()
    c = client.post("/api/categories", json={"name": "C", "color": "#000"}).json()
    assert a["order"] == 0
    assert b["order"] == 1
    assert c["order"] == 2


def test_list_categories_returns_in_order(client):
    client.post("/api/categories", json={"name": "First", "color": "#111"})
    client.post("/api/categories", json={"name": "Second", "color": "#222"})
    response = client.get("/api/categories")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["name"] == "First"
    assert data[1]["name"] == "Second"


def test_update_category(client):
    cat = client.post("/api/categories", json={"name": "Old", "color": "#111"}).json()
    response = client.put(f"/api/categories/{cat['id']}", json={
        "name": "New",
        "color": "#FF0000",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New"
    assert data["color"] == "#FF0000"


def test_update_category_not_found(client):
    response = client.put("/api/categories/9999", json={"name": "X", "color": "#000"})
    assert response.status_code == 404


def test_delete_category(client):
    cat = client.post("/api/categories", json={"name": "X", "color": "#000"}).json()
    response = client.delete(f"/api/categories/{cat['id']}")
    assert response.status_code == 200

    response = client.get("/api/categories")
    assert response.json() == []


def test_delete_category_not_found(client):
    response = client.delete("/api/categories/9999")
    assert response.status_code == 404
