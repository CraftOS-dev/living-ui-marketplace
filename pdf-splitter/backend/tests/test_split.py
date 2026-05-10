"""
Tests for PDF Split & Download feature.
Covers: split by pages/ranges/every_n, download individual/zip, list splits, error cases.
"""
import io
import zipfile
import pytest
from fastapi.testclient import TestClient


def _make_minimal_pdf():
    """Create a minimal valid 1-page PDF bytes for testing."""
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


def _make_multipage_pdf(num_pages: int = 5):
    """Create a multi-page PDF using PyMuPDF."""
    import fitz
    doc = fitz.open()
    for i in range(num_pages):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Page {i + 1}", fontsize=24)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _upload_pdf(client: TestClient, filename: str = "test.pdf", num_pages: int = 1):
    """Upload a PDF and return the response data."""
    if num_pages == 1:
        pdf_bytes = _make_minimal_pdf()
    else:
        pdf_bytes = _make_multipage_pdf(num_pages)
    response = client.post(
        "/api/pdfs/upload",
        files={"file": (filename, io.BytesIO(pdf_bytes), "application/pdf")},
    )
    assert response.status_code == 200
    return response.json()


# ============================================================================
# Split by pages
# ============================================================================

def test_split_by_pages(client: TestClient):
    """Test splitting a PDF by individual pages."""
    doc = _upload_pdf(client, "multi.pdf", num_pages=5)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1, 3, 5]}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["document_id"] == doc["id"]
    assert data["split_type"] == "pages"
    assert data["file_count"] == 3
    assert "files" in data
    assert len(data["files"]) == 3
    # Each file should have filename and pages
    for f in data["files"]:
        assert "filename" in f
        assert "pages" in f


def test_split_by_pages_single(client: TestClient):
    """Test splitting a single page from a PDF."""
    doc = _upload_pdf(client, "single_split.pdf", num_pages=3)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [2]}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["file_count"] == 1


# ============================================================================
# Split by ranges
# ============================================================================

def test_split_by_ranges(client: TestClient):
    """Test splitting a PDF by page ranges."""
    doc = _upload_pdf(client, "ranges.pdf", num_pages=10)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "ranges", "config": {"ranges": [[1, 3], [5, 7], [9, 10]]}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["file_count"] == 3
    assert len(data["files"]) == 3


def test_split_by_ranges_single_range(client: TestClient):
    """Test splitting with a single range."""
    doc = _upload_pdf(client, "single_range.pdf", num_pages=5)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "ranges", "config": {"ranges": [[2, 4]]}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["file_count"] == 1


# ============================================================================
# Split every N pages
# ============================================================================

def test_split_every_n(client: TestClient):
    """Test splitting a PDF every N pages."""
    doc = _upload_pdf(client, "every_n.pdf", num_pages=10)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "every_n", "config": {"n": 3}},
    )
    assert response.status_code == 200
    data = response.json()
    # 10 pages / 3 = 4 chunks (3, 3, 3, 1)
    assert data["file_count"] == 4
    assert len(data["files"]) == 4


def test_split_every_n_exact_division(client: TestClient):
    """Test splitting when pages divide evenly."""
    doc = _upload_pdf(client, "exact.pdf", num_pages=6)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "every_n", "config": {"n": 2}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["file_count"] == 3


# ============================================================================
# Error cases
# ============================================================================

def test_split_pdf_not_found(client: TestClient):
    """Test splitting a non-existent PDF."""
    response = client.post(
        "/api/pdfs/9999/split",
        json={"split_type": "pages", "config": {"pages": [1]}},
    )
    assert response.status_code == 404


def test_split_invalid_type(client: TestClient):
    """Test splitting with an invalid split type returns 422 (Pydantic Literal rejects unknown values)."""
    doc = _upload_pdf(client, "invalid_type.pdf", num_pages=3)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "invalid", "config": {}},
    )
    assert response.status_code == 422


def test_split_no_valid_pages(client: TestClient):
    """Test splitting with page numbers all out of range."""
    doc = _upload_pdf(client, "no_valid.pdf", num_pages=3)
    response = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [99, 100]}},
    )
    assert response.status_code == 400


# ============================================================================
# Download individual split file
# ============================================================================

def test_download_split_file(client: TestClient):
    """Test downloading an individual split PDF."""
    doc = _upload_pdf(client, "dl_test.pdf", num_pages=3)
    split_resp = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1, 2, 3]}},
    )
    split_id = split_resp.json()["id"]

    # Download first file
    response = client.get(f"/api/splits/{split_id}/download/0")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 0


def test_download_split_file_not_found(client: TestClient):
    """Test downloading from a non-existent split job."""
    response = client.get("/api/splits/9999/download/0")
    assert response.status_code == 404


def test_download_split_file_index_out_of_range(client: TestClient):
    """Test downloading with an invalid file index."""
    doc = _upload_pdf(client, "idx_test.pdf", num_pages=2)
    split_resp = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1]}},
    )
    split_id = split_resp.json()["id"]

    response = client.get(f"/api/splits/{split_id}/download/99")
    assert response.status_code == 404


# ============================================================================
# Download ZIP
# ============================================================================

def test_download_split_zip(client: TestClient):
    """Test downloading all split files as a ZIP."""
    doc = _upload_pdf(client, "zip_test.pdf", num_pages=4)
    split_resp = client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1, 2, 3, 4]}},
    )
    split_id = split_resp.json()["id"]

    response = client.get(f"/api/splits/{split_id}/download-zip")
    assert response.status_code == 200
    assert "zip" in response.headers["content-type"]
    # Verify it's a valid ZIP
    zf = zipfile.ZipFile(io.BytesIO(response.content))
    assert len(zf.namelist()) == 4
    zf.close()


def test_download_zip_not_found(client: TestClient):
    """Test downloading ZIP from a non-existent split job."""
    response = client.get("/api/splits/9999/download-zip")
    assert response.status_code == 404


# ============================================================================
# List splits
# ============================================================================

def test_list_splits_empty(client: TestClient):
    """Test listing splits when none exist."""
    response = client.get("/api/splits")
    assert response.status_code == 200
    assert response.json() == []


def test_list_splits(client: TestClient):
    """Test listing all split jobs."""
    doc = _upload_pdf(client, "list_test.pdf", num_pages=4)
    # Create two splits
    client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1, 2]}},
    )
    client.post(
        f"/api/pdfs/{doc['id']}/split",
        json={"split_type": "every_n", "config": {"n": 2}},
    )
    response = client.get("/api/splits")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_list_pdf_splits(client: TestClient):
    """Test listing splits for a specific PDF."""
    doc1 = _upload_pdf(client, "doc1.pdf", num_pages=3)
    doc2 = _upload_pdf(client, "doc2.pdf", num_pages=3)
    # Split doc1 twice, doc2 once
    client.post(
        f"/api/pdfs/{doc1['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1]}},
    )
    client.post(
        f"/api/pdfs/{doc1['id']}/split",
        json={"split_type": "pages", "config": {"pages": [2]}},
    )
    client.post(
        f"/api/pdfs/{doc2['id']}/split",
        json={"split_type": "pages", "config": {"pages": [1]}},
    )
    # doc1 should have 2 splits
    response = client.get(f"/api/pdfs/{doc1['id']}/splits")
    assert response.status_code == 200
    assert len(response.json()) == 2
    # doc2 should have 1 split
    response = client.get(f"/api/pdfs/{doc2['id']}/splits")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_pdf_splits_not_found(client: TestClient):
    """Test listing splits for a non-existent PDF."""
    response = client.get("/api/pdfs/9999/splits")
    assert response.status_code == 404
