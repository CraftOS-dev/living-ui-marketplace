"""
Record timeline (activities) + notes.

Activities are mostly system-written (crm_core.log_activity); this router
serves the timeline read model and user-logged entries (calls, meetings,
manual email logs pasted onto the timeline).
"""

import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import get_record, log_activity, not_found_ok
from database import get_db
from models import Activity, Note

logger = logging.getLogger(__name__)
router = APIRouter(tags=["timeline"])

ActivityKind = Literal["note", "call", "meeting", "email", "other"]


class ActivityLogBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = 0
    type: Optional[ActivityKind] = "other"
    title: Optional[str] = ""
    body: Optional[str] = ""
    occurred_at: Optional[str] = Field(None, json_schema_extra={"format": "date"})


class NoteCreate(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = 0
    title: Optional[str] = ""
    content: Optional[str] = ""
    pinned: Optional[bool] = False


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    pinned: Optional[bool] = None


@router.get("/timeline/{record_type}/{record_id}")
def get_timeline(
    record_type: str,  # plain str: the smoke test substitutes ids into every path param
    record_id: int,
    type_filter: str = "",
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Activity).filter_by(record_type=record_type, record_id=record_id)
    if type_filter:
        kinds = [k.strip() for k in type_filter.split(",") if k.strip()]
        if kinds:
            query = query.filter(Activity.type.in_(kinds))
    total = query.count()
    page = max(1, page)
    page_size = min(200, max(1, page_size))
    items = (
        query.order_by(Activity.occurred_at.desc(), Activity.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": [a.to_dict() for a in items], "total": total, "page": page, "pageSize": page_size}


@router.post("/activities")
def log_manual_activity(
    body: ActivityLogBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.record_id:
        return {"status": "noop"}
    occurred_at = None
    if body.occurred_at:
        try:
            occurred_at = datetime.fromisoformat(body.occurred_at)
        except ValueError:
            occurred_at = None
    kind_titles = {"call": "Call logged", "meeting": "Meeting logged", "email": "Email logged", "note": "Note", "other": "Activity logged"}
    activity = log_activity(
        db,
        body.record_type or "person",
        body.record_id,
        body.type or "other",
        (body.title or "").strip() or kind_titles.get(body.type or "other", "Activity logged"),
        body=body.body or "",
        actor=user.username,
        occurred_at=occurred_at,
    )
    db.commit()
    db.refresh(activity)
    return activity.to_dict()


@router.delete("/activities/{activity_id}")
def delete_activity(
    activity_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    activity = db.get(Activity, activity_id)
    if activity is None:
        return not_found_ok("activity")
    db.delete(activity)
    db.commit()
    return {"status": "deleted", "id": activity_id}


# ============================================================================
# Notes
# ============================================================================

@router.get("/notes/{record_type}/{record_id}")
def list_notes(
    record_type: str,  # plain str: the smoke test substitutes ids into every path param
    record_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notes = (
        db.query(Note).filter_by(record_type=record_type, record_id=record_id)
        .order_by(Note.pinned.desc(), Note.updated_at.desc())
        .all()
    )
    return [n.to_dict() for n in notes]


@router.post("/notes")
def create_note(
    body: NoteCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.record_id:
        return {"status": "noop"}
    note = Note(
        record_type=body.record_type or "person",
        record_id=body.record_id,
        title=body.title or "",
        content=body.content or "",
        pinned=bool(body.pinned),
        created_by=user.username,
    )
    db.add(note)
    db.flush()
    if get_record(db, note.record_type, note.record_id) is not None:
        preview = (body.content or "").strip().replace("\n", " ")
        log_activity(
            db, note.record_type, note.record_id, "note_created",
            body.title or "Note added",
            body=preview[:280],
            actor=user.username,
            extra={"noteId": note.id},
        )
    db.commit()
    db.refresh(note)
    return note.to_dict()


@router.put("/notes/{note_id}")
def update_note(
    note_id: int,
    body: NoteUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(Note, note_id)
    if note is None:
        return not_found_ok("note")
    if body.title is not None:
        note.title = body.title
    if body.content is not None:
        note.content = body.content
    if body.pinned is not None:
        note.pinned = body.pinned
    note.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(note)
    return note.to_dict()


@router.delete("/notes/{note_id}")
def delete_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = db.get(Note, note_id)
    if note is None:
        return not_found_ok("note")
    db.delete(note)
    db.commit()
    return {"status": "deleted", "id": note_id}
