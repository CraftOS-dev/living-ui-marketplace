"""
Attachments (Files tab). Uploads arrive as JSON base64 so the marketplace
smoke test can exercise the route; files are stored under backend/uploads/.
"""

import base64
import logging
import mimetypes
import re
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import not_found_ok
from database import get_db
from models import Attachment

logger = logging.getLogger(__name__)
router = APIRouter(tags=["files"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


class FileUploadBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = 0
    file_name: Optional[str] = "file.txt"
    data_base64: Optional[str] = ""


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", name or "file")[:120] or "file"


# NOTE: registered before /files/{record_type}/{record_id} so "download"
# is never captured as a record_type.
@router.get("/files/download/{file_id}")
def download_file(
    file_id: int,
    db: Session = Depends(get_db),
):
    attachment = db.get(Attachment, file_id)
    if attachment is None:
        return JSONResponse({"status": "not_found"})
    path = UPLOAD_DIR / (attachment.file_path or "")
    if not path.is_file():
        return JSONResponse({"status": "file_missing"})
    return FileResponse(path, filename=attachment.file_name or path.name)


@router.get("/files/{record_type}/{record_id}")
def list_files(
    record_type: str,
    record_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Attachment)
        .filter_by(record_type=record_type, record_id=record_id)
        .order_by(Attachment.created_at.desc())
        .all()
    )
    return [a.to_dict() for a in rows]


@router.post("/files")
def upload_file(
    body: FileUploadBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        raw = base64.b64decode((body.data_base64 or "").encode(), validate=False)
    except Exception:
        raw = (body.data_base64 or "").encode()

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = _safe_name(body.file_name or "file.txt")
    attachment = Attachment(
        record_type=body.record_type or "person",
        record_id=body.record_id or 0,
        file_name=body.file_name or "file.txt",
        size=len(raw),
        mime=mimetypes.guess_type(safe)[0] or "application/octet-stream",
        created_by=user.username,
    )
    db.add(attachment)
    db.flush()
    disk_name = f"{attachment.id}_{safe}"
    (UPLOAD_DIR / disk_name).write_bytes(raw)
    attachment.file_path = disk_name
    db.commit()
    db.refresh(attachment)
    return attachment.to_dict()


@router.delete("/files/{file_id}")
def delete_file(
    file_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attachment = db.get(Attachment, file_id)
    if attachment is None:
        return not_found_ok("file")
    path = UPLOAD_DIR / (attachment.file_path or "")
    try:
        if attachment.file_path and path.is_file():
            path.unlink()
    except OSError:
        pass
    db.delete(attachment)
    db.commit()
    return {"status": "deleted", "id": file_id}
