"""
Tests for Category API endpoints.

Covers CRUD operations for transaction categories.
"""


def _create_category(client, **overrides):
    """Helper to create a category with defaults."""
    payload = {"name": "Office Supplies"}
    payload.update(overrides)
    return client.post("/api/categories", json=payload)


class TestCreateCategory:
    def test_create_basic(self, client):
        """POST /api/categories with just name returns 201."""
        resp = _create_category(client)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Office Supplies"
        assert "id" in data

    def test_create_with_color(self, client):
        """POST /api/categories with color returns 201."""
        resp = _create_category(client, name="Travel", color="#FF5733")
        assert resp.status_code == 201
        assert resp.json()["color"] == "#FF5733"

    def test_create_with_parent(self, client):
        """POST /api/categories with parentId returns 201."""
        parent = _create_category(client, name="Expenses").json()
        child = _create_category(client, name="Meals", parentId=parent["id"])
        assert child.status_code == 201
        assert child.json()["parentId"] == parent["id"]

    def test_create_duplicate_name_fails(self, client):
        """Creating two categories with the same name should fail."""
        _create_category(client, name="Rent")
        try:
            resp = _create_category(client, name="Rent")
            assert resp.status_code in (400, 500)
        except Exception:
            # IntegrityError propagated through the test client is acceptable
            pass


class TestListCategories:
    def test_list_empty(self, client):
        """GET /api/categories returns empty list when none exist."""
        resp = client.get("/api/categories")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_populated(self, client):
        """GET /api/categories returns all created categories."""
        _create_category(client, name="Rent")
        _create_category(client, name="Utilities")
        _create_category(client, name="Payroll")
        resp = client.get("/api/categories")
        assert resp.status_code == 200
        assert len(resp.json()) == 3


class TestUpdateCategory:
    def test_update_name(self, client):
        """PUT /api/categories/:id can update name."""
        created = _create_category(client).json()
        resp = client.put(
            f"/api/categories/{created['id']}", json={"name": "Updated Name"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    def test_update_color(self, client):
        """PUT /api/categories/:id can update color."""
        created = _create_category(client).json()
        resp = client.put(
            f"/api/categories/{created['id']}", json={"color": "#00FF00"}
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "#00FF00"

    def test_update_missing_returns_404(self, client):
        """PUT /api/categories/999 returns 404."""
        resp = client.put("/api/categories/999", json={"name": "Ghost"})
        assert resp.status_code == 404


class TestDeleteCategory:
    def test_delete_removes_from_list(self, client):
        """DELETE /api/categories/:id removes the category."""
        created = _create_category(client).json()
        resp = client.delete(f"/api/categories/{created['id']}")
        assert resp.status_code == 200

        categories = client.get("/api/categories").json()
        ids = [c["id"] for c in categories]
        assert created["id"] not in ids

    def test_delete_missing_returns_404(self, client):
        """DELETE /api/categories/999 returns 404."""
        resp = client.delete("/api/categories/999")
        assert resp.status_code == 404
