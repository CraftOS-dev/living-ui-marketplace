"""
Tests for Page Preview & Thumbnails feature.
Covers: get single thumbnail, thumbnail list, error cases.
"""
import io
import pytest
from fastapi.testclient import TestClient


def _make_minimal_pdf():
    """Create a minimal valid PDF bytes for testing."""
    pdf_content = (
        b"%PDF-1.0\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n190\n%%EOF"
    )
    return pdf_content


def _upload_pdf(client: TestClient, filename: str = "test.pdf"):
    """Helper to upload a PDF and return the document data."""
    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/api/pdfs/upload",
        files={"file": (filename, io.BytesIO(pdf_bytes), "application/pdf")},
    )
    assert response.status_code == 200
    return response.json()


def test_get_thumbnail(client: TestClient):
    """Test getting a thumbnail for page 1."""
    doc = _upload_pdf(client)
    response = client.get(f"/api/pdfs/{doc['id']}/thumbnails/1")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    # Should return actual PNG data
    assert len(response.content) > 0
    # PNG magic bytes
    assert response.content[:4] == b"\x89PNG"


def test_get_thumbnail_page_out_of_range(client: TestClient):
    """Test getting a thumbnail for a page that doesn't exist."""
    doc = _upload_pdf(client)
    # Page 0 is invalid (1-indexed)
    response = client.get(f"/api/pdfs/{doc['id']}/thumbnails/0")
    assert response.status_code == 400
    # Page beyond count
    response = client.get(f"/api/pdfs/{doc['id']}/thumbnails/999")
    assert response.status_code == 400


def test_get_thumbnail_pdf_not_found(client: TestClient):
    """Test getting a thumbnail for a non-existent PDF."""
    response = client.get("/api/pdfs/9999/thumbnails/1")
    assert response.status_code == 404


def test_get_thumbnail_list(client: TestClient):
    """Test getting the list of thumbnail URLs for a document."""
    doc = _upload_pdf(client)
    response = client.get(f"/api/pdfs/{doc['id']}/thumbnails")
    assert response.status_code == 200
    data = response.json()
    assert data["pdf_id"] == doc["id"]
    assert data["page_count"] == doc["page_count"]
    assert len(data["thumbnails"]) == doc["page_count"]
    # Each thumbnail entry should have page and url
    thumb = data["thumbnails"][0]
    assert thumb["page"] == 1
    assert f"/api/pdfs/{doc['id']}/thumbnails/1" in thumb["url"]


def test_get_thumbnail_list_pdf_not_found(client: TestClient):
    """Test getting thumbnail list for a non-existent PDF."""
    response = client.get("/api/pdfs/9999/thumbnails")
    assert response.status_code == 404


def test_thumbnail_caching(client: TestClient):
    """Test that requesting the same thumbnail twice works (cached)."""
    doc = _upload_pdf(client)
    # First request generates the thumbnail
    r1 = client.get(f"/api/pdfs/{doc['id']}/thumbnails/1")
    assert r1.status_code == 200
    # Second request should serve from cache
    r2 = client.get(f"/api/pdfs/{doc['id']}/thumbnails/1")
    assert r2.status_code == 200
    # Both should return the same PNG content
    assert r1.content == r2.content
