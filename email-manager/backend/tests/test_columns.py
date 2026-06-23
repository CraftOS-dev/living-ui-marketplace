"""
Tests for email column configuration routes.
"""

import pytest
from models import ColumnConfig, DEFAULT_COLUMNS


@pytest.fixture
def seeded_columns(db):
    """Insert the default 5 columns into the test database."""
    for col_data in DEFAULT_COLUMNS:
        col = ColumnConfig(**col_data)
        db.add(col)
    db.commit()
    return db.query(ColumnConfig).order_by(ColumnConfig.position).all()


def test_list_columns_returns_five(client, seeded_columns):
    """GET /columns should return all 5 seeded columns."""
    response = client.get("/api/columns")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 5


def test_list_columns_ordered_by_position(client, seeded_columns):
    """Columns should come back in position order 0–4."""
    response = client.get("/api/columns")
    positions = [c["position"] for c in response.json()]
    assert positions == [0, 1, 2, 3, 4]


def test_list_columns_has_required_fields(client, seeded_columns):
    """Each column dict should expose the expected fields."""
    col = client.get("/api/columns").json()[0]
    for field in ("id", "title", "query", "icon", "aiInstructions", "aiEnabled", "position", "isGeneral", "unreadCount"):
        assert field in col, f"Missing field: {field}"


def test_last_column_is_general(client, seeded_columns):
    """The rightmost column (position 4) should be marked isGeneral=True."""
    cols = client.get("/api/columns").json()
    last = cols[-1]
    assert last["isGeneral"] is True
    assert last["position"] == 4


def test_update_column_title(client, seeded_columns):
    """PUT /columns/{id} should update the title."""
    col_id = seeded_columns[0].id
    response = client.put(f"/api/columns/{col_id}", json={"title": "My Custom Column"})
    assert response.status_code == 200
    assert response.json()["title"] == "My Custom Column"


def test_update_column_query(client, seeded_columns):
    """PUT /columns/{id} should update the Gmail query for non-general columns."""
    col_id = seeded_columns[1].id
    new_query = "from:boss@company.com subject:urgent"
    response = client.put(f"/api/columns/{col_id}", json={"query": new_query})
    assert response.status_code == 200
    assert response.json()["query"] == new_query


def test_update_column_icon(client, seeded_columns):
    """PUT /columns/{id} should update the icon."""
    col_id = seeded_columns[2].id
    response = client.put(f"/api/columns/{col_id}", json={"icon": "🚀"})
    assert response.status_code == 200
    assert response.json()["icon"] == "🚀"


def test_update_column_ai_enabled(client, seeded_columns):
    """PUT /columns/{id} should toggle aiEnabled."""
    col_id = seeded_columns[0].id
    response = client.put(f"/api/columns/{col_id}", json={"ai_enabled": True})
    assert response.status_code == 200
    assert response.json()["aiEnabled"] is True


def test_general_column_query_locked(client, seeded_columns):
    """PUT /columns/{id} should NOT change the query of the general column (isGeneral=True)."""
    general = next(c for c in seeded_columns if c.is_general)
    original_query = general.query
    response = client.put(f"/api/columns/{general.id}", json={"query": "from:hacker@evil.com"})
    assert response.status_code == 200
    assert response.json()["query"] == original_query


def test_update_column_not_found(client):
    """PUT /columns/9999 should return 404."""
    response = client.put("/api/columns/9999", json={"title": "Ghost"})
    assert response.status_code == 404


def test_get_emails_empty_stub(client, seeded_columns):
    """GET /emails/{id} should return an empty list in Part 1."""
    col_id = seeded_columns[0].id
    response = client.get(f"/api/emails/{col_id}")
    assert response.status_code == 200
    assert response.json() == []


def test_get_emails_column_not_found(client):
    """GET /emails/9999 should return 404."""
    response = client.get("/api/emails/9999")
    assert response.status_code == 404


def test_gmail_status_returns_connected_field(client):
    """GET /gmail/status should return a dict with 'connected' bool."""
    response = client.get("/api/gmail/status")
    assert response.status_code == 200
    data = response.json()
    assert "connected" in data
    assert isinstance(data["connected"], bool)


def test_insights_returns_placeholder(client, seeded_columns):
    """POST /columns/{id}/insights should return a summary dict in Part 1."""
    col_id = seeded_columns[0].id
    response = client.post(f"/api/columns/{col_id}/insights", json={})
    assert response.status_code == 200
    data = response.json()
    assert "summary" in data
    assert "points" in data
    assert isinstance(data["points"], list)


def test_insights_column_not_found(client):
    """POST /columns/9999/insights should return 404."""
    response = client.post("/api/columns/9999/insights", json={})
    assert response.status_code == 404


def test_health_check(client):
    """Health endpoint should always return 200."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
