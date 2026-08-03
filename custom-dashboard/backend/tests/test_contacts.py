"""Tests for contact endpoints."""


def test_create_contact(client):
    response = client.post("/api/contacts", json={"name": "Ada Lovelace", "email": "ada@example.com"})
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Ada Lovelace"
    assert data["email"] == "ada@example.com"
    assert data["notes"] == ""
    assert "id" in data


def test_list_contacts(client):
    client.post("/api/contacts", json={"name": "Bob"})
    client.post("/api/contacts", json={"name": "Ada"})
    response = client.get("/api/contacts")
    assert response.status_code == 200
    names = [c["name"] for c in response.json()]
    assert names == ["Ada", "Bob"]


def test_get_contact(client):
    created = client.post("/api/contacts", json={"name": "Grace Hopper", "phone": "555-1234"}).json()
    response = client.get(f"/api/contacts/{created['id']}")
    assert response.status_code == 200
    assert response.json()["phone"] == "555-1234"


def test_get_contact_not_found(client):
    assert client.get("/api/contacts/9999").status_code == 404


def test_update_contact(client):
    contact = client.post("/api/contacts", json={"name": "Draft"}).json()
    response = client.put(f"/api/contacts/{contact['id']}", json={"notes": "Met at conference"})
    assert response.status_code == 200
    assert response.json()["notes"] == "Met at conference"


def test_delete_contact(client):
    contact = client.post("/api/contacts", json={"name": "Delete me"}).json()
    response = client.delete(f"/api/contacts/{contact['id']}")
    assert response.status_code == 200
    assert client.get(f"/api/contacts/{contact['id']}").status_code == 404


def test_delete_contact_idempotent(client):
    response = client.delete("/api/contacts/9999")
    assert response.status_code == 200
    assert response.json()["status"] == "not_found"
