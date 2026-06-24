"""Upload, list, get, delete, preview."""
import io
import pytest
from PIL import Image
from fastapi.testclient import TestClient


def _make_png(width=100, height=80, color=(255, 0, 0)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


def _upload(client: TestClient, name="test.png", content=None):
    content = content or _make_png()
    return client.post(
        "/api/images/upload",
        files={"file": (name, io.BytesIO(content), "image/png")},
    )


def test_upload_image(client: TestClient):
    response = _upload(client)
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "test.png"
    assert data["id"] is not None
    assert data["width"] == 100
    assert data["height"] == 80
    assert data["format"] == "PNG"
    assert data["file_size"] > 0


def test_upload_non_image(client: TestClient):
    response = client.post(
        "/api/images/upload",
        files={"file": ("test.txt", io.BytesIO(b"not an image"), "text/plain")},
    )
    assert response.status_code == 400


def test_list_images_empty(client: TestClient):
    response = client.get("/api/images")
    assert response.status_code == 200
    assert response.json() == []


def test_list_images(client: TestClient):
    _upload(client, "a.png")
    _upload(client, "b.png")
    response = client.get("/api/images")
    assert response.status_code == 200
    names = {d["filename"] for d in response.json()}
    assert names == {"a.png", "b.png"}


def test_get_image(client: TestClient):
    uploaded = _upload(client).json()
    response = client.get(f"/api/images/{uploaded['id']}")
    assert response.status_code == 200
    assert response.json()["filename"] == "test.png"


def test_get_image_not_found(client: TestClient):
    response = client.get("/api/images/9999")
    assert response.status_code == 404


def test_delete_image(client: TestClient):
    uploaded = _upload(client).json()
    response = client.delete(f"/api/images/{uploaded['id']}")
    assert response.status_code == 200
    assert client.get("/api/images").json() == []


def test_preview_image(client: TestClient):
    uploaded = _upload(client).json()
    response = client.get(f"/api/images/{uploaded['id']}/preview")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/")


def test_upload_no_file(client: TestClient):
    response = client.post("/api/images/upload")
    assert response.status_code == 200
    assert "message" in response.json()
