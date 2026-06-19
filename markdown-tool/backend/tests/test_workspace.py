"""
Tests for workspace file system API routes.
Uses tmp_path fixture — no real filesystem mutations.
"""
import sys
from pathlib import Path

import pytest

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


@pytest.fixture
def workspace(tmp_path):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "hello.md").write_text("# Hello\n\nWorld.", encoding="utf-8")
    (tmp_path / "readme.md").write_text("# Root README", encoding="utf-8")
    (tmp_path / "image.png").write_bytes(b"\x89PNG")
    return tmp_path


@pytest.fixture(autouse=True)
def patch_workspace(workspace, monkeypatch):
    import routes
    monkeypatch.setenv("WORKSPACE_ROOT", str(workspace))
    monkeypatch.setattr(routes, "_get_workspace_root", lambda: workspace.resolve())


# ──────────────────────────────────────────────────────────────
# List directory
# ──────────────────────────────────────────────────────────────

def test_list_root(client):
    resp = client.get("/api/files")
    assert resp.status_code == 200
    items = resp.json()
    names = [i["name"] for i in items]
    assert "notes" in names
    assert "readme.md" in names
    # Directories come before files
    dirs = [i for i in items if i["is_dir"]]
    files = [i for i in items if not i["is_dir"]]
    if dirs and files:
        assert items.index(dirs[0]) < items.index(files[0])


def test_list_subdir(client):
    resp = client.get("/api/files?path=notes")
    assert resp.status_code == 200
    items = resp.json()
    names = [i["name"] for i in items]
    assert "hello.md" in names


def test_list_nonexistent_returns_404(client):
    resp = client.get("/api/files?path=nonexistent_dir")
    assert resp.status_code == 404


def test_list_items_have_expected_fields(client):
    resp = client.get("/api/files")
    assert resp.status_code == 200
    for item in resp.json():
        assert "name" in item
        assert "path" in item
        assert "is_dir" in item
        assert "is_markdown" in item


def test_list_markdown_flag(client):
    resp = client.get("/api/files")
    assert resp.status_code == 200
    items = {i["name"]: i for i in resp.json()}
    assert items["readme.md"]["is_markdown"] is True
    assert items["image.png"]["is_markdown"] is False
    assert items["notes"]["is_markdown"] is False


# ──────────────────────────────────────────────────────────────
# Read file
# ──────────────────────────────────────────────────────────────

def test_read_file(client):
    resp = client.get("/api/files/read?path=readme.md")
    assert resp.status_code == 200
    data = resp.json()
    assert data["content"] == "# Root README"
    assert data["name"] == "readme.md"


def test_read_file_in_subdir(client):
    resp = client.get("/api/files/read?path=notes/hello.md")
    assert resp.status_code == 200
    assert "Hello" in resp.json()["content"]


def test_read_nonexistent_returns_404(client):
    resp = client.get("/api/files/read?path=missing.md")
    assert resp.status_code == 404


def test_read_directory_returns_400(client):
    resp = client.get("/api/files/read?path=notes")
    assert resp.status_code == 400


# ──────────────────────────────────────────────────────────────
# Write file
# ──────────────────────────────────────────────────────────────

def test_write_existing_file(client):
    resp = client.put("/api/files/write", json={"path": "readme.md", "content": "# Updated"})
    assert resp.status_code == 200
    # Read back and verify
    read_resp = client.get("/api/files/read?path=readme.md")
    assert read_resp.json()["content"] == "# Updated"


def test_write_creates_new_file(client):
    resp = client.put("/api/files/write", json={"path": "new_file.md", "content": "# New"})
    assert resp.status_code == 200
    read_resp = client.get("/api/files/read?path=new_file.md")
    assert read_resp.json()["content"] == "# New"


def test_write_creates_parent_dirs(client):
    resp = client.put("/api/files/write", json={"path": "deep/nested/file.md", "content": "nested"})
    assert resp.status_code == 200


# ──────────────────────────────────────────────────────────────
# Create file / directory
# ──────────────────────────────────────────────────────────────

def test_create_file(client):
    resp = client.post("/api/files/create", json={"path": "created.md", "type": "file"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "created"
    # File should exist and be empty
    read_resp = client.get("/api/files/read?path=created.md")
    assert read_resp.json()["content"] == ""


def test_create_directory(client):
    resp = client.post("/api/files/create", json={"path": "new_folder", "type": "directory"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"
    # Should appear in listing
    list_resp = client.get("/api/files")
    names = [i["name"] for i in list_resp.json()]
    assert "new_folder" in names


def test_create_existing_returns_409(client):
    resp = client.post("/api/files/create", json={"path": "readme.md", "type": "file"})
    assert resp.status_code == 409


# ──────────────────────────────────────────────────────────────
# Rename
# ──────────────────────────────────────────────────────────────

def test_rename_file(client):
    resp = client.put("/api/files/rename", json={"old_path": "readme.md", "new_path": "renamed.md"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "renamed"
    # Old path gone
    assert client.get("/api/files/read?path=readme.md").status_code == 404
    # New path exists
    assert client.get("/api/files/read?path=renamed.md").status_code == 200


def test_rename_nonexistent_returns_404(client):
    resp = client.put("/api/files/rename", json={"old_path": "ghost.md", "new_path": "new.md"})
    assert resp.status_code == 404


def test_rename_to_existing_returns_409(client):
    client.post("/api/files/create", json={"path": "other.md", "type": "file"})
    resp = client.put("/api/files/rename", json={"old_path": "readme.md", "new_path": "other.md"})
    assert resp.status_code == 409


# ──────────────────────────────────────────────────────────────
# Delete
# ──────────────────────────────────────────────────────────────

def test_delete_file(client):
    resp = client.delete("/api/files/delete?path=readme.md")
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"
    assert client.get("/api/files/read?path=readme.md").status_code == 404


def test_delete_directory(client):
    resp = client.delete("/api/files/delete?path=notes")
    assert resp.status_code == 200
    # notes dir should be gone
    list_resp = client.get("/api/files")
    names = [i["name"] for i in list_resp.json()]
    assert "notes" not in names


def test_delete_nonexistent_returns_200_not_found(client):
    """DELETE must be idempotent: return 200 with status not_found, not 404."""
    resp = client.delete("/api/files/delete?path=ghost.md")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


def test_delete_missing_path_returns_400(client):
    resp = client.delete("/api/files/delete")
    assert resp.status_code == 400


# ──────────────────────────────────────────────────────────────
# Security: path traversal
# ──────────────────────────────────────────────────────────────

def test_path_traversal_blocked_on_read(client):
    resp = client.get("/api/files/read?path=../../../etc/passwd")
    assert resp.status_code == 400


def test_path_traversal_blocked_on_delete(client):
    resp = client.delete("/api/files/delete?path=../../important")
    assert resp.status_code == 400
