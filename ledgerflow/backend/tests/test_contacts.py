"""
Tests for Contact API endpoints.

Covers CRUD, filtering by type, and soft-delete behavior.
"""


def _create_contact(client, **overrides):
    """Helper to create a contact with defaults."""
    payload = {
        "name": "Acme Corp",
        "contactType": "customer",
    }
    payload.update(overrides)
    return client.post("/api/contacts", json=payload)


class TestCreateContact:
    def test_create_customer(self, client):
        """POST /api/contacts with type=customer returns 201."""
        resp = _create_contact(client, contactType="customer")
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Acme Corp"
        assert data["contactType"] == "customer"
        assert "id" in data

    def test_create_vendor(self, client):
        """POST /api/contacts with type=vendor returns 201."""
        resp = _create_contact(client, name="Supplier Inc", contactType="vendor")
        assert resp.status_code == 201
        assert resp.json()["contactType"] == "vendor"

    def test_create_both_type(self, client):
        """POST /api/contacts with type=both returns 201."""
        resp = _create_contact(client, name="Partner LLC", contactType="both")
        assert resp.status_code == 201
        assert resp.json()["contactType"] == "both"

    def test_create_with_all_fields(self, client):
        """POST /api/contacts with every optional field returns 201."""
        resp = _create_contact(
            client,
            name="Full Contact",
            contactType="customer",
            email="full@example.com",
            phone="+1-555-0100",
            address="123 Main St, Anytown, US",
            taxId="12-3456789",
            notes="Important client",
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["email"] == "full@example.com"
        assert data["phone"] == "+1-555-0100"
        assert data["address"] == "123 Main St, Anytown, US"
        assert data["taxId"] == "12-3456789"
        assert data["notes"] == "Important client"


class TestListContacts:
    def test_list_empty(self, client):
        """GET /api/contacts returns empty list when none exist."""
        resp = client.get("/api/contacts")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_populated(self, client):
        """GET /api/contacts returns all contacts."""
        _create_contact(client, name="Client A")
        _create_contact(client, name="Client B")
        resp = client.get("/api/contacts")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_filter_by_customer(self, client):
        """GET /api/contacts?type=customer returns only customers."""
        _create_contact(client, name="Customer Co", contactType="customer")
        _create_contact(client, name="Vendor Co", contactType="vendor")
        resp = client.get("/api/contacts", params={"type": "customer"})
        assert resp.status_code == 200
        contacts = resp.json()
        assert len(contacts) == 1
        assert contacts[0]["contactType"] == "customer"

    def test_filter_by_vendor(self, client):
        """GET /api/contacts?type=vendor returns only vendors."""
        _create_contact(client, name="Customer Co", contactType="customer")
        _create_contact(client, name="Vendor Co", contactType="vendor")
        resp = client.get("/api/contacts", params={"type": "vendor"})
        assert resp.status_code == 200
        contacts = resp.json()
        assert len(contacts) == 1
        assert contacts[0]["contactType"] == "vendor"

    def test_filter_by_unknown_type(self, client):
        """Filtering by a non-existent type returns empty list."""
        _create_contact(client, name="Customer Co", contactType="customer")
        resp = client.get("/api/contacts", params={"type": "unknown"})
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetContact:
    def test_get_by_id(self, client):
        """GET /api/contacts/:id returns the correct contact."""
        created = _create_contact(client).json()
        resp = client.get(f"/api/contacts/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Acme Corp"

    def test_get_missing_id(self, client):
        """GET /api/contacts/999 returns 404."""
        resp = client.get("/api/contacts/999")
        assert resp.status_code == 404


class TestUpdateContact:
    def test_update_fields(self, client):
        """PUT /api/contacts/:id can update name and email."""
        created = _create_contact(client).json()
        resp = client.put(
            f"/api/contacts/{created['id']}",
            json={"name": "Acme Updated", "email": "new@acme.com"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Acme Updated"
        assert data["email"] == "new@acme.com"


class TestDeleteContact:
    def test_delete_soft_deletes(self, client):
        """DELETE /api/contacts/:id soft-deletes the contact."""
        created = _create_contact(client).json()
        resp = client.delete(f"/api/contacts/{created['id']}")
        assert resp.status_code == 200

        # Contact should not appear in list
        contacts = client.get("/api/contacts").json()
        ids = [c["id"] for c in contacts]
        assert created["id"] not in ids
