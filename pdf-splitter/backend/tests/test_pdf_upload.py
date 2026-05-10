"""
Tests for PDF Upload & Storage feature.
Covers: upload PDF, list PDFs, get PDF details, delete PDF.
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


def test_upload_pdf(client: TestClient):
    """Test uploading a PDF file."""
    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/api/pdfs/upload",
        files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "test.pdf"
    assert data["id"] is not None
    assert data["page_count"] >= 1
    assert data["file_size"] > 0
    assert "uploaded_at" in data


def test_upload_non_pdf(client: TestClient):
    """Test uploading a non-PDF file returns error."""
    response = client.post(
        "/api/pdfs/upload",
        files={"file": ("test.txt", io.BytesIO(b"not a pdf"), "text/plain")},
    )
    assert response.status_code == 400


def test_list_pdfs_empty(client: TestClient):
    """Test listing PDFs when none uploaded."""
    response = client.get("/api/pdfs")
    assert response.status_code == 200
    assert response.json() == []


def test_list_pdfs(client: TestClient):
    """Test listing PDFs after upload."""
    pdf_bytes = _make_minimal_pdf()
    client.post(
        "/api/pdfs/upload",
        files={"file": ("doc1.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    client.post(
        "/api/pdfs/upload",
        files={"file": ("doc2.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    response = client.get("/api/pdfs")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_get_pdf_detail(client: TestClient):
    """Test getting a specific PDF's details."""
    pdf_bytes = _make_minimal_pdf()
    upload = client.post(
        "/api/pdfs/upload",
        files={"file": ("detail.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    pdf_id = upload.json()["id"]
    response = client.get(f"/api/pdfs/{pdf_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == pdf_id
    assert data["filename"] == "detail.pdf"


def test_get_pdf_not_found(client: TestClient):
    """Test getting a non-existent PDF returns 404."""
    response = client.get("/api/pdfs/9999")
    assert response.status_code == 404


def test_delete_pdf(client: TestClient):
    """Test deleting a PDF."""
    pdf_bytes = _make_minimal_pdf()
    upload = client.post(
        "/api/pdfs/upload",
        files={"file": ("delete_me.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    pdf_id = upload.json()["id"]
    response = client.delete(f"/api/pdfs/{pdf_id}")
    assert response.status_code == 200
    response = client.get(f"/api/pdfs/{pdf_id}")
    assert response.status_code == 404


def test_delete_pdf_not_found(client: TestClient):
    """Test deleting a non-existent PDF returns 404."""
    response = client.delete("/api/pdfs/9999")
    assert response.status_code == 404
