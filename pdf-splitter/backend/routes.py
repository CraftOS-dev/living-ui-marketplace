"""
Living UI API Routes

REST API endpoints for state management, PDF upload, thumbnails, splitting, and history.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional, Literal
from database import get_db
from models import AppState, PDFDocument, SplitJob, UISnapshot, UIScreenshot
from datetime import datetime
from pathlib import Path
import logging
import shutil

logger = logging.getLogger(__name__)
router = APIRouter()

# Upload directory for PDFs
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Output directory for split PDFs
SPLITS_DIR = Path(__file__).parent / "splits"
SPLITS_DIR.mkdir(exist_ok=True)


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


class UISnapshotUpdate(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


class SplitRequest(BaseModel):
    split_type: Literal["pages", "ranges", "every_n"]
    config: Dict[str, Any]  # {"pages": [1,3,5]} or {"ranges": [[1,5],[8,8]]} or {"n": 5}


# ============================================================================
# State Management Routes
# ============================================================================

@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    payload = request.payload or {}
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}

    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    else:
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# PDF Upload & Management Routes
# ============================================================================

@router.post("/pdfs/upload")
def upload_pdf(file: UploadFile = File(None), db: Session = Depends(get_db)):
    """Upload a PDF file."""
    # Validate file is provided
    if file is None:
        return {"message": "No file provided. Send a PDF file in the 'file' field."}
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Read file content
    content = file.file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    # Save file to disk
    import uuid
    unique_name = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = UPLOAD_DIR / unique_name
    with open(file_path, "wb") as f:
        f.write(content)

    # Get page count using PyMuPDF
    try:
        import fitz
        doc = fitz.open(str(file_path))
        page_count = len(doc)
        doc.close()
    except Exception as e:
        # If PyMuPDF fails, try to clean up and return error
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=400, detail=f"Failed to process PDF: {str(e)}")

    # Create database record
    pdf_doc = PDFDocument(
        filename=file.filename,
        file_path=str(file_path),
        file_size=len(content),
        page_count=page_count,
    )
    db.add(pdf_doc)
    db.commit()
    db.refresh(pdf_doc)

    logger.info(f"[Routes] Uploaded PDF: {file.filename} ({page_count} pages)")
    return pdf_doc.to_dict()


@router.get("/pdfs")
def list_pdfs(db: Session = Depends(get_db)):
    """List all uploaded PDFs."""
    pdfs = db.query(PDFDocument).order_by(PDFDocument.uploaded_at.desc()).all()
    return [pdf.to_dict() for pdf in pdfs]


@router.get("/pdfs/{pdf_id}")
def get_pdf(pdf_id: int, db: Session = Depends(get_db)):
    """Get PDF details."""
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    return pdf.to_dict()


@router.delete("/pdfs/{pdf_id}")
def delete_pdf(pdf_id: int, db: Session = Depends(get_db)):
    """Delete a PDF and its files."""
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")

    # Delete file from disk
    file_path = Path(pdf.file_path)
    if file_path.exists():
        file_path.unlink()

    # Delete split outputs
    for split in pdf.splits:
        split_dir = Path(split.output_dir)
        if split_dir.exists():
            shutil.rmtree(split_dir)

    db.delete(pdf)
    db.commit()
    logger.info(f"[Routes] Deleted PDF: {pdf_id}")
    return {"status": "deleted", "id": pdf_id}


# ============================================================================
# Thumbnail Routes
# ============================================================================

@router.get("/pdfs/{pdf_id}/thumbnails/{page_num}")
def get_thumbnail(pdf_id: int, page_num: int, db: Session = Depends(get_db)):
    """Get a thumbnail PNG for a specific page."""
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")

    if page_num < 1 or page_num > pdf.page_count:
        raise HTTPException(status_code=400, detail=f"Page {page_num} out of range (1-{pdf.page_count})")

    # Generate thumbnail
    thumb_dir = UPLOAD_DIR / f"thumbs_{pdf_id}"
    thumb_dir.mkdir(exist_ok=True)
    thumb_path = thumb_dir / f"page_{page_num}.png"

    if not thumb_path.exists():
        try:
            import fitz
            doc = fitz.open(pdf.file_path)
            page = doc[page_num - 1]  # 0-indexed
            # Render at 1.5x zoom for decent quality thumbnails
            mat = fitz.Matrix(1.5, 1.5)
            pix = page.get_pixmap(matrix=mat)
            pix.save(str(thumb_path))
            doc.close()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate thumbnail: {str(e)}")

    return FileResponse(str(thumb_path), media_type="image/png")


@router.get("/pdfs/{pdf_id}/thumbnails")
def get_thumbnail_list(pdf_id: int, db: Session = Depends(get_db)):
    """Get list of thumbnail URLs for all pages."""
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")

    thumbnails = []
    for i in range(1, pdf.page_count + 1):
        thumbnails.append({
            "page": i,
            "url": f"/api/pdfs/{pdf_id}/thumbnails/{i}",
        })
    return {"pdf_id": pdf_id, "page_count": pdf.page_count, "thumbnails": thumbnails}


# ============================================================================
# Split & Download Routes
# ============================================================================

@router.post("/pdfs/{pdf_id}/split")
def split_pdf(pdf_id: int, request: SplitRequest, db: Session = Depends(get_db)):
    """Split a PDF based on the given configuration."""
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")

    import fitz
    import uuid

    try:
        src_doc = fitz.open(pdf.file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open PDF: {str(e)}")

    total_pages = len(src_doc)
    split_type = request.split_type
    config = request.config

    # Determine page groups to extract
    page_groups = []  # list of (label, [page_numbers_0_indexed])

    if split_type == "pages":
        # Individual pages: {"pages": [1, 3, 5]}
        pages = config.get("pages", [])
        for p in pages:
            if 1 <= p <= total_pages:
                page_groups.append((f"page_{p}", [p - 1]))

    elif split_type == "ranges":
        # Page ranges: {"ranges": [[1, 5], [8, 10]]}
        ranges = config.get("ranges", [])
        for r in ranges:
            start, end = r[0], r[1]
            start = max(1, start)
            end = min(total_pages, end)
            if start <= end:
                page_indices = list(range(start - 1, end))
                page_groups.append((f"pages_{start}-{end}", page_indices))

    elif split_type == "every_n":
        # Split every N pages: {"n": 5}
        n = config.get("n", 1)
        if n < 1:
            n = 1
        for i in range(0, total_pages, n):
            chunk_pages = list(range(i, min(i + n, total_pages)))
            start_page = i + 1
            end_page = min(i + n, total_pages)
            page_groups.append((f"pages_{start_page}-{end_page}", chunk_pages))

    if not page_groups:
        src_doc.close()
        raise HTTPException(status_code=400, detail="No valid pages to split")

    # Create output directory
    output_id = uuid.uuid4().hex[:12]
    output_dir = SPLITS_DIR / output_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate split PDFs
    output_files = []
    for label, page_indices in page_groups:
        out_doc = fitz.open()
        for idx in page_indices:
            out_doc.insert_pdf(src_doc, from_page=idx, to_page=idx)
        out_path = output_dir / f"{label}.pdf"
        out_doc.save(str(out_path))
        out_doc.close()
        output_files.append({
            "filename": f"{label}.pdf",
            "pages": [i + 1 for i in page_indices],
        })

    src_doc.close()

    # Save split job to database
    split_job = SplitJob(
        document_id=pdf_id,
        split_type=split_type,
        split_config=config,
        output_dir=str(output_dir),
        file_count=len(output_files),
    )
    db.add(split_job)
    db.commit()
    db.refresh(split_job)

    logger.info(f"[Routes] Split PDF {pdf_id}: {len(output_files)} files")
    result = split_job.to_dict()
    result["files"] = output_files
    return result


@router.get("/splits/{split_id}/download/{file_index}")
def download_split_file(split_id: int, file_index: int, db: Session = Depends(get_db)):
    """Download an individual split PDF file."""
    split_job = db.query(SplitJob).filter(SplitJob.id == split_id).first()
    if not split_job:
        raise HTTPException(status_code=404, detail="Split job not found")

    output_dir = Path(split_job.output_dir)
    if not output_dir.exists():
        raise HTTPException(status_code=404, detail="Split output not found")

    files = sorted(output_dir.glob("*.pdf"))
    if file_index < 0 or file_index >= len(files):
        raise HTTPException(status_code=404, detail="File index out of range")

    return FileResponse(str(files[file_index]), media_type="application/pdf", filename=files[file_index].name)


@router.get("/splits/{split_id}/download-zip")
def download_split_zip(split_id: int, db: Session = Depends(get_db)):
    """Download all split PDFs as a ZIP file."""
    import zipfile
    import tempfile

    split_job = db.query(SplitJob).filter(SplitJob.id == split_id).first()
    if not split_job:
        raise HTTPException(status_code=404, detail="Split job not found")

    output_dir = Path(split_job.output_dir)
    if not output_dir.exists():
        raise HTTPException(status_code=404, detail="Split output not found")

    files = sorted(output_dir.glob("*.pdf"))
    if not files:
        raise HTTPException(status_code=404, detail="No split files found")

    # Create ZIP in temp location
    zip_path = output_dir / "split_output.zip"
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(str(f), f.name)

    return FileResponse(str(zip_path), media_type="application/zip", filename="split_output.zip")


@router.get("/splits")
def list_splits(db: Session = Depends(get_db)):
    """List all split jobs."""
    splits = db.query(SplitJob).order_by(SplitJob.created_at.desc()).all()
    return [s.to_dict() for s in splits]


@router.get("/pdfs/{pdf_id}/splits")
def list_pdf_splits(pdf_id: int, db: Session = Depends(get_db)):
    """List split jobs for a specific PDF."""
    pdf = db.query(PDFDocument).filter(PDFDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    splits = db.query(SplitJob).filter(SplitJob.document_id == pdf_id).order_by(SplitJob.created_at.desc()).all()
    return [s.to_dict() for s in splits]


# ============================================================================
# UI Observation Routes (Agent API)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None,
            "visibleText": [],
            "inputValues": {},
            "componentState": {},
            "currentView": None,
            "viewport": {},
            "timestamp": None,
            "status": "no_snapshot"
        }
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)

    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport

    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {
            "imageData": None,
            "width": None,
            "height": None,
            "timestamp": None,
            "status": "no_screenshot"
        }
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)

    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()

    db.commit()
    db.refresh(screenshot)
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}
