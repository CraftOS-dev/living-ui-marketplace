"""
Living UI API Routes

REST API endpoints for the Research Board.
Provides CRUD for board items and state management.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import AppState, BoardItem, Connection, UISnapshot, UIScreenshot
from datetime import datetime
import logging
import os
import shutil
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()

# Directory for uploaded files
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    """Schema for updating app state."""
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    """Schema for executing an action."""
    action: str
    payload: Optional[Dict[str, Any]] = None


class BoardItemCreate(BaseModel):
    """Schema for creating a board item."""
    type: str
    title: str
    x: Optional[float] = 0.0
    y: Optional[float] = 0.0
    content: Optional[str] = None
    url: Optional[str] = None


class BoardItemUpdate(BaseModel):
    """Schema for updating a board item."""
    title: Optional[str] = None
    x: Optional[Any] = None
    y: Optional[Any] = None
    content: Optional[str] = None
    url: Optional[str] = None
    file_path: Optional[str] = None

    def get_x(self) -> Optional[float]:
        """Get x as float, ignoring non-numeric values."""
        try:
            return float(self.x) if self.x is not None else None
        except (ValueError, TypeError):
            return None

    def get_y(self) -> Optional[float]:
        """Get y as float, ignoring non-numeric values."""
        try:
            return float(self.y) if self.y is not None else None
        except (ValueError, TypeError):
            return None


class UISnapshotUpdate(BaseModel):
    """Schema for updating UI snapshot."""
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    """Schema for updating UI screenshot."""
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


# ============================================================================
# State Management Routes
# ============================================================================

@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get the current application state."""
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Update the application state."""
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
    """Replace the entire application state."""
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
    """Clear all application state."""
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Execute a named action."""
    action = request.action
    payload = request.payload or {}
    logger.info(f"[Routes] Executing action: {action}")

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
        logger.warning(f"[Routes] Unknown action: {action}")
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# Board Items CRUD Routes
# ============================================================================

@router.get("/items")
def list_items(
    search: Optional[str] = None,
    type: Optional[str] = None,
    db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    """Get all board items, with optional search and type filter."""
    query = db.query(BoardItem)
    if type:
        query = query.filter(BoardItem.type == type)
    if search:
        query = query.filter(BoardItem.title.ilike(f"%{search}%"))
    items = query.order_by(BoardItem.created_at.desc()).all()
    return [item.to_dict() for item in items]


@router.post("/items")
def create_item(data: BoardItemCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Create a new board item."""
    item = BoardItem(
        type=data.type,
        title=data.title,
        x=data.x if data.x is not None else 0.0,
        y=data.y if data.y is not None else 0.0,
        content=data.content,
        url=data.url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    logger.info(f"[Routes] Created board item: {item.id} ({item.type})")
    return item.to_dict()


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get a specific board item by ID."""
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item.to_dict()


@router.put("/items/{item_id}")
def update_item(item_id: int, data: BoardItemUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Update a board item (including canvas position)."""
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if data.title is not None:
        item.title = data.title
    x_val = data.get_x()
    if x_val is not None:
        item.x = x_val
    y_val = data.get_y()
    if y_val is not None:
        item.y = y_val
    if data.content is not None:
        item.content = data.content
    if data.url is not None:
        item.url = data.url
    if data.file_path is not None:
        item.file_path = data.file_path

    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    logger.info(f"[Routes] Updated board item: {item_id}")
    return item.to_dict()


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    """Delete a board item."""
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Delete associated file if exists
    if item.file_path and os.path.exists(item.file_path):
        try:
            os.remove(item.file_path)
        except Exception as e:
            logger.warning(f"[Routes] Could not delete file {item.file_path}: {e}")

    db.delete(item)
    db.commit()
    logger.info(f"[Routes] Deleted board item: {item_id}")
    return {"status": "deleted", "id": str(item_id)}


# ============================================================================
# File Upload Route
# ============================================================================

@router.post("/upload")
async def upload_file(file: UploadFile = File(None)) -> Dict[str, Any]:
    """Upload a file (image, video, document) and return its path."""
    if file is None or not file.filename:
        return {
            "filePath": None,
            "fileName": None,
            "contentType": None,
            "error": "No file provided"
        }

    # Generate unique filename
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"[Routes] File upload failed: {e}")
        raise HTTPException(status_code=500, detail="File upload failed")

    logger.info(f"[Routes] File uploaded: {unique_name}")
    return {
        "filePath": f"/api/files/{unique_name}",
        "fileName": file.filename,
        "contentType": file.content_type,
    }


@router.get("/files/{filename}")
async def serve_file(filename: str):
    """Serve an uploaded file."""
    from fastapi.responses import FileResponse
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


# ============================================================================
# Connection Routes (Node Connections)
# ============================================================================

class ConnectionCreate(BaseModel):
    """Schema for creating a connection between two items."""
    source_id: int
    target_id: int


@router.get("/connections")
def list_connections(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Get all connections."""
    connections = db.query(Connection).all()
    return [c.to_dict() for c in connections]


@router.post("/connections")
def create_connection(data: ConnectionCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Create a connection between two items."""
    # Check for duplicate connection
    existing = db.query(Connection).filter(
        Connection.source_id == data.source_id,
        Connection.target_id == data.target_id
    ).first()
    if existing:
        return existing.to_dict()

    connection = Connection(source_id=data.source_id, target_id=data.target_id)
    db.add(connection)
    db.commit()
    db.refresh(connection)
    logger.info(f"[Routes] Created connection: {data.source_id} -> {data.target_id}")
    return connection.to_dict()


@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    """Delete a connection."""
    connection = db.query(Connection).filter(Connection.id == connection_id).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.delete(connection)
    db.commit()
    logger.info(f"[Routes] Deleted connection: {connection_id}")
    return {"status": "deleted", "id": str(connection_id)}


# ============================================================================
# UI Observation Routes (Agent API)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get the current UI snapshot."""
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
    """Update the UI snapshot."""
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
    """Get the current UI screenshot."""
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
    """Update the UI screenshot."""
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
