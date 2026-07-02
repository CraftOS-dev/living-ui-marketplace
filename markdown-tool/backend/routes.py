"""
Living UI API Routes — Markdown Editor

State management, workspace file operations, and editor session persistence.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional, Literal
from database import get_db
from models import AppState, EditorSession, UISnapshot, UIScreenshot
from datetime import datetime
import logging
import os
import pathlib
import shutil

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Workspace root — configurable via WORKSPACE_ROOT env var
# ============================================================================

def _get_workspace_root() -> pathlib.Path:
    env = os.environ.get("WORKSPACE_ROOT", "")
    if env:
        return pathlib.Path(env).resolve()
    default = pathlib.Path(__file__).parent.parent / "workspace"
    default.mkdir(parents=True, exist_ok=True)
    return default.resolve()


def _safe_path(rel: str) -> pathlib.Path:
    root = _get_workspace_root()
    cleaned = rel.lstrip("/\\").replace("\\", "/")
    resolved = (root / cleaned).resolve()
    if not str(resolved).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid path: outside workspace root")
    return resolved


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


class FileWriteRequest(BaseModel):
    path: str
    content: str


class FileCreateRequest(BaseModel):
    path: str
    type: Literal["file", "directory"] = "file"


class FileRenameRequest(BaseModel):
    old_path: str
    new_path: str


class SessionUpdate(BaseModel):
    openTabs: Optional[List[Dict[str, Any]]] = None
    activeTab: Optional[str] = None
    folderPanelWidth: Optional[int] = None
    previewPanelWidth: Optional[int] = None
    folderVisible: Optional[bool] = None
    previewVisible: Optional[bool] = None
    expandedDirs: Optional[List[str]] = None


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
# Workspace File Routes
# ============================================================================

@router.get("/files")
def list_files(path: str = Query(default="")) -> List[Dict[str, Any]]:
    """List directory contents at the given relative path within the workspace."""
    target = _safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    items = []
    try:
        for entry in os.scandir(target):
            items.append({
                "name": entry.name,
                "path": path.rstrip("/") + ("/" if path else "") + entry.name,
                "is_dir": entry.is_dir(),
                "is_markdown": entry.name.lower().endswith(".md") and entry.is_file(),
                "modified": entry.stat().st_mtime,
            })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    return items


@router.get("/files/read")
def read_file(path: str = Query(...)) -> Dict[str, Any]:
    """Read a file's text content."""
    target = _safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    try:
        content = target.read_text(encoding="utf-8")
        return {"path": path, "name": target.name, "content": content, "modified": target.stat().st_mtime}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")


@router.put("/files/write")
def write_file(data: FileWriteRequest) -> Dict[str, Any]:
    """Write content to a file (creates parents if needed)."""
    target = _safe_path(data.path)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(data.content, encoding="utf-8")
        logger.info(f"[Routes] Wrote file: {data.path}")
        return {"status": "saved", "path": data.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {e}")


@router.post("/files/create")
def create_item(data: FileCreateRequest) -> Dict[str, Any]:
    """Create a new file or directory."""
    target = _safe_path(data.path)
    if target.exists():
        raise HTTPException(status_code=409, detail="Already exists")
    try:
        if data.type == "directory":
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("", encoding="utf-8")
        logger.info(f"[Routes] Created {data.type}: {data.path}")
        return {"status": "created", "path": data.path, "type": data.type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create: {e}")


@router.post("/files/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    relative_paths: List[str] = Form(...),
    parent_path: str = Form(default=""),
    overwrite: bool = Form(default=False),
) -> Dict[str, Any]:
    """Upload one or more files (optionally preserving a folder structure via relative_paths)."""
    if len(files) != len(relative_paths):
        raise HTTPException(status_code=400, detail="files and relative_paths length mismatch")
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    resolved = []
    for f, rel in zip(files, relative_paths):
        if not rel or not rel.strip():
            raise HTTPException(status_code=400, detail="Empty relative path")
        full_rel = (parent_path.rstrip("/") + "/" + rel) if parent_path else rel
        resolved.append((_safe_path(full_rel), full_rel, f))

    if not overwrite:
        conflicts = [full_rel for target, full_rel, _ in resolved if target.exists()]
        if conflicts:
            raise HTTPException(status_code=409, detail={"conflicts": conflicts})

    written = []
    try:
        for target, full_rel, upload in resolved:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(await upload.read())
            written.append(full_rel)
        logger.info(f"[Routes] Uploaded {len(written)} file(s)")
        return {"status": "uploaded", "written": written}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload: {e}")


@router.put("/files/rename")
def rename_item(data: FileRenameRequest) -> Dict[str, Any]:
    """Rename or move a file or directory."""
    src = _safe_path(data.old_path)
    dst = _safe_path(data.new_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Source not found")
    if dst.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
        logger.info(f"[Routes] Renamed {data.old_path} → {data.new_path}")
        return {"status": "renamed", "old_path": data.old_path, "new_path": data.new_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename: {e}")


@router.delete("/files/delete")
def delete_item(path: Optional[str] = Query(default=None)) -> Dict[str, Any]:
    """Delete a file or directory. Returns 200 even if already absent (idempotent)."""
    if not path:
        raise HTTPException(status_code=400, detail="path query parameter required")
    target = _safe_path(path)
    if not target.exists():
        return {"status": "not_found", "path": path}
    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        logger.info(f"[Routes] Deleted: {path}")
        return {"status": "deleted", "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {e}")


# ============================================================================
# Editor Session Routes
# ============================================================================

@router.get("/session")
def get_session(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get the persisted editor session (open tabs, panel widths, etc.)."""
    session = db.query(EditorSession).first()
    if not session:
        session = EditorSession()
        db.add(session)
        db.commit()
        db.refresh(session)
    return session.to_dict()


@router.put("/session")
def update_session(data: SessionUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Update (merge) the editor session."""
    session = db.query(EditorSession).first()
    if not session:
        session = EditorSession()
        db.add(session)

    if data.openTabs is not None:
        session.open_tabs = data.openTabs
    if data.activeTab is not None:
        session.active_tab = data.activeTab
    if data.folderPanelWidth is not None:
        session.folder_panel_width = data.folderPanelWidth
    if data.previewPanelWidth is not None:
        session.preview_panel_width = data.previewPanelWidth
    if data.folderVisible is not None:
        session.folder_visible = data.folderVisible
    if data.previewVisible is not None:
        session.preview_visible = data.previewVisible
    if data.expandedDirs is not None:
        session.expanded_dirs = data.expandedDirs

    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    logger.info("[Routes] Session updated")
    return session.to_dict()


# ============================================================================
# UI Observation Routes (Agent API)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {"htmlStructure": None, "visibleText": [], "inputValues": {}, "componentState": {}, "currentView": None, "viewport": {}, "timestamp": None, "status": "no_snapshot"}
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
        return {"imageData": None, "width": None, "height": None, "timestamp": None, "status": "no_screenshot"}
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
