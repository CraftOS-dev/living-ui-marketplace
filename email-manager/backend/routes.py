"""
Email Manager API Routes

Provides column configuration CRUD, Gmail integration status check,
email fetching (live from Gmail), and AI insights generation.
Also retains the standard Living UI agent observation routes.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import AppState, ColumnConfig, UISnapshot, UIScreenshot
from services.integration_client import integration
from datetime import datetime
import asyncio
import urllib.parse
import logging
from email.utils import parseaddr

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Gmail helpers
# ============================================================================

def _get_header(headers: list, name: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _parse_from(from_header: str) -> tuple:
    """Parse 'Name <email>' or bare email into (display_name, email_addr)."""
    name, addr = parseaddr(from_header)
    return (name or addr, addr or from_header.strip())


async def _fetch_column_emails(col: ColumnConfig) -> List[Dict[str, Any]]:
    """Fetch up to 20 emails for a column via Gmail API. Returns [] on any error."""
    if not integration.available:
        return []

    encoded_query = urllib.parse.quote(col.query)
    list_result = await integration.request(
        integration="google_workspace",
        method="GET",
        url=f"https://gmail.googleapis.com/gmail/v1/users/me/messages?q={encoded_query}&maxResults=20",
    )

    if "error" in list_result or list_result.get("status", 200) >= 400:
        logger.warning("[Routes] Gmail list error for column %s: %s", col.id, list_result)
        return []

    messages = list_result.get("data", {}).get("messages", [])
    if not messages:
        return []

    async def fetch_one(msg_id: str) -> Optional[Dict[str, Any]]:
        r = await integration.request(
            integration="google_workspace",
            method="GET",
            url=(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
                "?format=metadata&metadataHeaders=From,Subject,Date"
            ),
        )
        if "error" in r or r.get("status", 200) >= 400:
            return None
        data = r.get("data", {})
        headers = data.get("payload", {}).get("headers", [])
        label_ids = data.get("labelIds", [])
        from_raw = _get_header(headers, "From")
        from_name, from_email = _parse_from(from_raw)
        return {
            "id": msg_id,
            "from": from_raw,
            "fromName": from_name,
            "fromEmail": from_email,
            "subject": _get_header(headers, "Subject") or "(no subject)",
            "snippet": data.get("snippet", ""),
            "date": _get_header(headers, "Date"),
            "isUnread": "UNREAD" in label_ids,
        }

    results = await asyncio.gather(*[fetch_one(m["id"]) for m in messages])
    return [e for e in results if e is not None]


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


class ColumnUpdate(BaseModel):
    title: Optional[str] = None
    query: Optional[str] = None
    icon: Optional[str] = None
    ai_instructions: Optional[str] = None
    ai_enabled: Optional[bool] = None


class InsightRequest(BaseModel):
    force_refresh: Optional[bool] = False


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


# ============================================================================
# State Management Routes (required by AppController template)
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
        logger.warning(f"[Routes] Unknown action: {action}")
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# Column Configuration Routes
# ============================================================================

@router.get("/columns")
def list_columns(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """List all 5 column configurations ordered by position."""
    cols = db.query(ColumnConfig).order_by(ColumnConfig.position).all()
    return [c.to_dict() for c in cols]


@router.put("/columns/{column_id}")
def update_column(
    column_id: int,
    data: ColumnUpdate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Update a column's configuration. The general column's query cannot be changed."""
    col = db.query(ColumnConfig).filter(ColumnConfig.id == column_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    if data.title is not None:
        col.title = data.title
    if data.icon is not None:
        col.icon = data.icon
    if data.ai_instructions is not None:
        col.ai_instructions = data.ai_instructions
    if data.ai_enabled is not None:
        col.ai_enabled = data.ai_enabled
    # Query locked for the general "Everything" column
    if data.query is not None and not col.is_general:
        col.query = data.query

    col.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(col)
    logger.info(f"[Routes] Updated column {column_id}: {col.title}")
    return col.to_dict()


# ============================================================================
# Gmail Integration Routes
# ============================================================================

@router.get("/gmail/status")
async def get_gmail_status() -> Dict[str, Any]:
    """Check whether the Gmail (google_workspace) integration is connected."""
    integrations = await integration.get_integrations()
    gmail = next((i for i in integrations if i.get("id") == "google_workspace"), None)
    connected = gmail is not None and gmail.get("connected", False)
    return {"connected": connected, "email": None}


@router.get("/emails/{column_id}")
async def get_column_emails(
    column_id: int,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Fetch up to 20 live emails for a column via Gmail API."""
    col = db.query(ColumnConfig).filter(ColumnConfig.id == column_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    emails = await _fetch_column_emails(col)

    col.unread_count = sum(1 for e in emails if e.get("isUnread"))
    db.commit()

    return emails


@router.post("/columns/{column_id}/insights")
async def generate_column_insights(
    column_id: int,
    data: InsightRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Generate AI summary for a column's recent emails using CraftBot LLM."""
    col = db.query(ColumnConfig).filter(ColumnConfig.id == column_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    emails = await _fetch_column_emails(col)

    from llm_service import generate_insights, llm_available
    result = await generate_insights(col.title, col.ai_instructions or "", emails) if llm_available() else None

    if result:
        return {
            "summary": result["summary"],
            "points": result["points"],
            "columnId": column_id,
            "generatedAt": datetime.utcnow().isoformat(),
        }

    # Fallback when LLM or Gmail is unavailable
    if not emails:
        summary = f"No emails found in {col.title}."
        points = ["Connect Gmail to load emails.", "AI summaries appear here once emails are fetched."]
    else:
        unread = sum(1 for e in emails if e.get("isUnread"))
        senders = list({e["fromName"] for e in emails[:5] if e.get("fromName")})
        summary = f"{len(emails)} email(s) in {col.title} — {unread} unread."
        points = [
            f"{unread} unread out of {len(emails)} emails." if unread else f"{len(emails)} emails, all read.",
            f"Recent senders: {', '.join(senders[:3])}." if senders else "No sender info available.",
            "Configure a CraftBot LLM provider for full AI summaries.",
        ]

    return {
        "summary": summary,
        "points": points,
        "columnId": column_id,
        "generatedAt": datetime.utcnow().isoformat(),
    }


# ============================================================================
# UI Observation Routes (Agent API — do not remove)
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
            "status": "no_snapshot",
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
            "status": "no_screenshot",
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
