"""
Tests for editor session persistence routes.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_get_session_default(client):
    """GET /session returns defaults when no session exists."""
    resp = client.get("/api/session")
    assert resp.status_code == 200
    data = resp.json()
    assert data["openTabs"] == []
    assert data["activeTab"] is None
    assert data["folderPanelWidth"] == 240
    assert data["previewPanelWidth"] == 380
    assert data["folderVisible"] is True
    assert data["previewVisible"] is True
    assert data["expandedDirs"] == []


def test_update_session_active_tab(client):
    resp = client.put("/api/session", json={"activeTab": "notes/hello.md"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["activeTab"] == "notes/hello.md"


def test_update_session_open_tabs(client):
    tabs = [{"path": "readme.md", "savedContent": "# Hello"}]
    resp = client.put("/api/session", json={"openTabs": tabs})
    assert resp.status_code == 200
    assert resp.json()["openTabs"] == tabs


def test_update_session_panel_widths(client):
    resp = client.put("/api/session", json={"folderPanelWidth": 300, "previewPanelWidth": 450})
    assert resp.status_code == 200
    data = resp.json()
    assert data["folderPanelWidth"] == 300
    assert data["previewPanelWidth"] == 450


def test_update_session_visibility(client):
    resp = client.put("/api/session", json={"folderVisible": False, "previewVisible": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data["folderVisible"] is False
    assert data["previewVisible"] is False


def test_update_session_expanded_dirs(client):
    resp = client.put("/api/session", json={"expandedDirs": ["notes", "docs"]})
    assert resp.status_code == 200
    assert resp.json()["expandedDirs"] == ["notes", "docs"]


def test_session_persists_across_requests(client):
    """Session updates should be cumulative (merge, not replace)."""
    client.put("/api/session", json={"activeTab": "readme.md"})
    client.put("/api/session", json={"folderPanelWidth": 320})
    resp = client.get("/api/session")
    assert resp.status_code == 200
    data = resp.json()
    assert data["activeTab"] == "readme.md"
    assert data["folderPanelWidth"] == 320


def test_session_update_partial_does_not_overwrite_others(client):
    """PUT with partial fields should not reset unmentioned fields."""
    client.put("/api/session", json={"folderVisible": False})
    client.put("/api/session", json={"activeTab": "readme.md"})
    resp = client.get("/api/session")
    data = resp.json()
    assert data["folderVisible"] is False
    assert data["activeTab"] == "readme.md"
