"""
Tests for Canvas Items feature.
Covers CRUD operations for board items (images, videos, youtube, docs, notes).
"""
import pytest


class TestCreateItem:
    """Tests for POST /api/items"""

    def test_create_image_item(self, client):
        """Create an image item with URL."""
        response = client.post("/api/items", json={
            "type": "image",
            "title": "Concept Art",
            "url": "https://example.com/art.jpg",
            "x": 100,
            "y": 200
        })
        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "image"
        assert data["title"] == "Concept Art"
        assert data["url"] == "https://example.com/art.jpg"
        assert data["x"] == 100
        assert data["y"] == 200
        assert "id" in data
        assert "createdAt" in data

    def test_create_video_item(self, client):
        """Create a video item."""
        response = client.post("/api/items", json={
            "type": "video",
            "title": "Gameplay Demo",
            "url": "https://example.com/demo.mp4",
            "x": 300,
            "y": 100
        })
        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "video"
        assert data["title"] == "Gameplay Demo"

    def test_create_youtube_item(self, client):
        """Create a YouTube link item."""
        response = client.post("/api/items", json={
            "type": "youtube",
            "title": "Game Design Tutorial",
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "x": 50,
            "y": 50
        })
        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "youtube"
        assert data["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    def test_create_doc_item(self, client):
        """Create a document item."""
        response = client.post("/api/items", json={
            "type": "doc",
            "title": "Game Design Document",
            "url": "https://example.com/gdd.pdf",
            "x": 400,
            "y": 300
        })
        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "doc"
        assert data["title"] == "Game Design Document"

    def test_create_note_item(self, client):
        """Create a note item with content."""
        response = client.post("/api/items", json={
            "type": "note",
            "title": "Mechanic Idea",
            "content": "Double jump mechanic with wall sliding",
            "x": 200,
            "y": 400
        })
        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "note"
        assert data["title"] == "Mechanic Idea"
        assert data["content"] == "Double jump mechanic with wall sliding"

    def test_create_item_requires_title(self, client):
        """Creating an item without title should fail."""
        response = client.post("/api/items", json={
            "type": "image",
            "url": "https://example.com/art.jpg"
        })
        assert response.status_code == 422

    def test_create_item_requires_type(self, client):
        """Creating an item without type should fail."""
        response = client.post("/api/items", json={
            "title": "Some Item"
        })
        assert response.status_code == 422

    def test_create_item_default_position(self, client):
        """Item created without position defaults to 0,0."""
        response = client.post("/api/items", json={
            "type": "note",
            "title": "Quick Note"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["x"] == 0
        assert data["y"] == 0


class TestListItems:
    """Tests for GET /api/items"""

    def test_list_items_empty(self, client):
        """Returns empty list when no items exist."""
        response = client.get("/api/items")
        assert response.status_code == 200
        assert response.json() == []

    def test_list_items_returns_all(self, client):
        """Returns all created items."""
        client.post("/api/items", json={"type": "note", "title": "Note 1"})
        client.post("/api/items", json={"type": "image", "title": "Image 1", "url": "https://example.com/img.jpg"})
        response = client.get("/api/items")
        assert response.status_code == 200
        items = response.json()
        assert len(items) == 2

    def test_list_items_has_required_fields(self, client):
        """Each item in list has required fields."""
        client.post("/api/items", json={"type": "note", "title": "Test Note", "content": "Body text"})
        response = client.get("/api/items")
        item = response.json()[0]
        assert "id" in item
        assert "type" in item
        assert "title" in item
        assert "x" in item
        assert "y" in item
        assert "createdAt" in item


class TestGetItem:
    """Tests for GET /api/items/{item_id}"""

    def test_get_item_by_id(self, client):
        """Get a specific item by ID."""
        create_resp = client.post("/api/items", json={"type": "note", "title": "My Note", "content": "Hello"})
        item_id = create_resp.json()["id"]
        response = client.get(f"/api/items/{item_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == item_id
        assert data["title"] == "My Note"
        assert data["content"] == "Hello"

    def test_get_item_not_found(self, client):
        """Returns 404 for non-existent item."""
        response = client.get("/api/items/9999")
        assert response.status_code == 404


class TestUpdateItem:
    """Tests for PUT /api/items/{item_id}"""

    def test_update_item_title(self, client):
        """Update item title."""
        create_resp = client.post("/api/items", json={"type": "note", "title": "Old Title"})
        item_id = create_resp.json()["id"]
        response = client.put(f"/api/items/{item_id}", json={"title": "New Title"})
        assert response.status_code == 200
        assert response.json()["title"] == "New Title"

    def test_update_item_position(self, client):
        """Update item canvas position (x, y)."""
        create_resp = client.post("/api/items", json={"type": "note", "title": "Note", "x": 0, "y": 0})
        item_id = create_resp.json()["id"]
        response = client.put(f"/api/items/{item_id}", json={"x": 500, "y": 300})
        assert response.status_code == 200
        data = response.json()
        assert data["x"] == 500
        assert data["y"] == 300

    def test_update_note_content(self, client):
        """Update note content."""
        create_resp = client.post("/api/items", json={"type": "note", "title": "Note", "content": "Old content"})
        item_id = create_resp.json()["id"]
        response = client.put(f"/api/items/{item_id}", json={"content": "New content"})
        assert response.status_code == 200
        assert response.json()["content"] == "New content"

    def test_update_item_not_found(self, client):
        """Returns 404 for non-existent item."""
        response = client.put("/api/items/9999", json={"title": "New Title"})
        assert response.status_code == 404


class TestDeleteItem:
    """Tests for DELETE /api/items/{item_id}"""

    def test_delete_item(self, client):
        """Delete an item successfully."""
        create_resp = client.post("/api/items", json={"type": "note", "title": "To Delete"})
        item_id = create_resp.json()["id"]
        response = client.delete(f"/api/items/{item_id}")
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    def test_delete_item_removes_from_list(self, client):
        """Deleted item no longer appears in list."""
        create_resp = client.post("/api/items", json={"type": "note", "title": "To Delete"})
        item_id = create_resp.json()["id"]
        client.delete(f"/api/items/{item_id}")
        response = client.get("/api/items")
        ids = [item["id"] for item in response.json()]
        assert item_id not in ids

    def test_delete_item_not_found(self, client):
        """Returns 404 for non-existent item."""
        response = client.delete("/api/items/9999")
        assert response.status_code == 404
