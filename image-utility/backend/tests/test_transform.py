"""Transform pipeline and download."""
import io
import pytest
from PIL import Image
from fastapi.testclient import TestClient


def _make_png(width=200, height=150) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (0, 128, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _upload(client: TestClient) -> dict:
    response = client.post(
        "/api/images/upload",
        files={"file": ("photo.png", io.BytesIO(_make_png()), "image/png")},
    )
    assert response.status_code == 200
    return response.json()


def test_crop_changes_dimensions(client: TestClient):
    asset = _upload(client)
    response = client.post(
        f"/api/images/{asset['id']}/transform",
        json={
            "crop": {"x": 10, "y": 10, "width": 100, "height": 80},
            "format": "PNG",
            "quality": 85,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["output"]["width"] == 100
    assert data["output"]["height"] == 80


def test_resize_changes_dimensions(client: TestClient):
    asset = _upload(client)
    response = client.post(
        f"/api/images/{asset['id']}/transform",
        json={
            "resize": {"width": 50, "height": 40, "maintain_aspect": False},
            "format": "PNG",
            "quality": 85,
        },
    )
    assert response.status_code == 200
    assert response.json()["output"]["width"] == 50
    assert response.json()["output"]["height"] == 40


def test_convert_png_to_jpeg(client: TestClient):
    asset = _upload(client)
    response = client.post(
        f"/api/images/{asset['id']}/transform",
        json={"format": "JPEG", "quality": 85},
    )
    assert response.status_code == 200
    assert response.json()["output"]["format"] == "JPEG"


def test_quality_affects_size(client: TestClient):
    asset = _upload(client)
    high = client.post(
        f"/api/images/{asset['id']}/transform",
        json={"format": "JPEG", "quality": 95},
    ).json()
    low = client.post(
        f"/api/images/{asset['id']}/transform",
        json={"format": "JPEG", "quality": 20},
    ).json()
    assert low["output"]["size"] < high["output"]["size"]


def test_download_after_transform(client: TestClient):
    asset = _upload(client)
    client.post(
        f"/api/images/{asset['id']}/transform",
        json={"format": "PNG", "quality": 85},
    )
    response = client.get(f"/api/images/{asset['id']}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert len(response.content) > 0


def test_download_without_transform(client: TestClient):
    asset = _upload(client)
    response = client.get(f"/api/images/{asset['id']}/download")
    assert response.status_code == 404


def test_invalid_crop(client: TestClient):
    asset = _upload(client)
    response = client.post(
        f"/api/images/{asset['id']}/transform",
        json={
            "crop": {"x": 0, "y": 0, "width": 500, "height": 500},
            "format": "PNG",
            "quality": 85,
        },
    )
    assert response.status_code == 400


def test_transform_not_found(client: TestClient):
    response = client.post(
        "/api/images/9999/transform",
        json={"format": "PNG", "quality": 85},
    )
    assert response.status_code == 404
