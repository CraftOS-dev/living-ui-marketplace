"""
CRM System API routes.

This module keeps the Living UI system endpoints (state, action, UI
observation) and wires in:
- the auth router (multi-user JWT auth), and
- every CRM domain router under backend/api/ (auto-discovered).

The agent-facing endpoints are meaningful for a CRM (F11): GET /api/state
returns counts + pipeline summary + recent activity, and POST /api/action
supports create_contact / create_deal / move_deal / add_note / complete_task.
"""

import importlib
import logging
import pkgutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Activity,
    AppState,
    Company,
    Deal,
    ListEntry,
    Note,
    Person,
    RecordList,
    Stage,
    Task,
    UIScreenshot,
    UISnapshot,
)

logger = logging.getLogger(__name__)
router = APIRouter()

AGENT_ACTOR = "CraftBot Agent"


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


# ============================================================================
# State (agent-meaningful payload, F11)
# ============================================================================

def _crm_summary(db: Session) -> Dict[str, Any]:
    from crm_core import get_record

    pipeline_bits = []
    first_list = (
        db.query(RecordList).filter(RecordList.parent_object == "deal")
        .order_by(RecordList.position, RecordList.id).first()
    )
    if first_list is not None:
        stages = db.query(Stage).filter(Stage.list_id == first_list.id).order_by(Stage.position).all()
        entries = db.query(ListEntry).filter(ListEntry.list_id == first_list.id).all()
        deals = {d.id: d for d in db.query(Deal).filter(
            Deal.id.in_([e.record_id for e in entries] or [0])).all()}
        for stage in stages:
            stage_entries = [e for e in entries if e.stage_id == stage.id]
            pipeline_bits.append({
                "stage": stage.name,
                "count": len(stage_entries),
                "value": sum((deals.get(e.record_id).value or 0) for e in stage_entries if e.record_id in deals),
            })

    recent = db.query(Activity).order_by(Activity.occurred_at.desc()).limit(10).all()
    recent_payload = []
    for activity in recent:
        record = get_record(db, activity.record_type, activity.record_id)
        if record is None:
            continue
        recent_payload.append({
            "type": activity.type,
            "title": activity.title,
            "record": record.display_name(),
            "recordType": activity.record_type,
            "recordId": activity.record_id,
            "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
        })

    return {
        "counts": {
            "people": db.query(Person).count(),
            "companies": db.query(Company).count(),
            "deals": db.query(Deal).count(),
            "openTasks": db.query(Task).filter(Task.completed_at.is_(None)).count(),
        },
        "pipeline": {"list": first_list.name if first_list else None, "stages": pipeline_bits},
        "recentActivity": recent_payload,
    }


@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """App state + a CRM summary the agent can reason over."""
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    payload = dict(state.data or {})
    payload["crm"] = _crm_summary(db)
    return payload


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


# ============================================================================
# Agent actions (F11)
# ============================================================================

@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from crm_core import get_record, log_activity, pick_color

    action = request.action
    payload = request.payload or {}
    logger.info(f"[Routes] Executing action: {action}")

    if action == "create_contact":
        person = Person(
            first_name=payload.get("first_name") or payload.get("firstName") or "",
            last_name=payload.get("last_name") or payload.get("lastName") or "",
            emails=[payload["email"]] if payload.get("email") else [],
            job_title=payload.get("job_title") or "",
        )
        person.avatar_color = pick_color(person.display_name())
        company_name = payload.get("company") or ""
        if company_name:
            company = db.query(Company).filter(Company.name.ilike(company_name)).first()
            if company is None:
                company = Company(name=company_name, avatar_color=pick_color(company_name))
                db.add(company)
                db.flush()
            person.company_id = company.id
        db.add(person)
        db.flush()
        log_activity(db, "person", person.id, "created",
                     f"{person.display_name()} created", actor=AGENT_ACTOR)
        db.commit()
        return {"status": "created", "person": person.to_dict()}

    if action == "create_deal":
        deal = Deal(
            name=payload.get("name") or "New deal",
            value=float(payload.get("value") or 0),
            owner=AGENT_ACTOR,
        )
        db.add(deal)
        db.flush()
        first_list = (
            db.query(RecordList).filter(RecordList.parent_object == "deal")
            .order_by(RecordList.position).first()
        )
        if first_list is not None:
            first_stage = db.query(Stage).filter(Stage.list_id == first_list.id).order_by(Stage.position).first()
            db.add(ListEntry(list_id=first_list.id, record_type="deal", record_id=deal.id,
                             stage_id=first_stage.id if first_stage else None))
        log_activity(db, "deal", deal.id, "created", f"{deal.display_name()} created", actor=AGENT_ACTOR)
        db.commit()
        return {"status": "created", "deal": deal.to_dict()}

    if action == "move_deal":
        deal_id = int(payload.get("deal_id") or payload.get("dealId") or 0)
        stage_name = str(payload.get("stage") or "")
        entry = db.query(ListEntry).filter_by(record_type="deal", record_id=deal_id).first()
        if entry is None or not stage_name:
            return {"status": "not_found", "detail": "deal entry or stage missing"}
        stage = db.query(Stage).filter(
            Stage.list_id == entry.list_id, Stage.name.ilike(stage_name)).first()
        if stage is None:
            return {"status": "not_found", "detail": f"stage '{stage_name}' not in list"}
        old_stage = db.get(Stage, entry.stage_id) if entry.stage_id else None
        entry.stage_id = stage.id
        entry.stage_entered_at = datetime.utcnow()
        deal = db.get(Deal, deal_id)
        if deal is not None:
            if stage.is_won:
                deal.status, deal.closed_at = "won", datetime.utcnow()
            elif stage.is_lost:
                deal.status, deal.closed_at = "lost", datetime.utcnow()
            elif deal.status in ("won", "lost"):
                deal.status, deal.closed_at = "open", None
            log_activity(db, "deal", deal_id, "stage_change", f"Moved to {stage.name}",
                         actor=AGENT_ACTOR,
                         extra={"listId": entry.list_id,
                                "from": old_stage.name if old_stage else None,
                                "to": stage.name, "toColor": stage.color})
        db.commit()
        return {"status": "moved", "entry": entry.to_dict()}

    if action == "add_note":
        record_type = payload.get("record_type") or payload.get("recordType") or "person"
        record_id = int(payload.get("record_id") or payload.get("recordId") or 0)
        if get_record(db, record_type, record_id) is None:
            return {"status": "not_found", "detail": "record missing"}
        note = Note(record_type=record_type, record_id=record_id,
                    title=payload.get("title") or "Note",
                    content=payload.get("content") or "", created_by=AGENT_ACTOR)
        db.add(note)
        db.flush()
        log_activity(db, record_type, record_id, "note_created", note.title,
                     body=(note.content or "")[:280], actor=AGENT_ACTOR,
                     extra={"noteId": note.id})
        db.commit()
        return {"status": "created", "note": note.to_dict()}

    if action == "complete_task":
        task = db.get(Task, int(payload.get("task_id") or payload.get("taskId") or 0))
        if task is None:
            return {"status": "not_found", "detail": "task missing"}
        task.completed_at = datetime.utcnow()
        if task.record_type and task.record_id and get_record(db, task.record_type, task.record_id) is not None:
            log_activity(db, task.record_type, task.record_id, "task_completed",
                         f"Completed: {task.title}", actor=AGENT_ACTOR, extra={"taskId": task.id})
        db.commit()
        return {"status": "completed", "task": task.to_dict()}

    if action == "seed_demo":
        from seed_data import seed_demo_data
        stats = seed_demo_data(db, actor=AGENT_ACTOR)
        return {"status": "seeded", **stats}

    if action == "refresh":
        return {"status": "ok"}

    logger.warning(f"[Routes] Unknown action: {action}")
    return {"status": "unknown_action", "action": action}


# ============================================================================
# UI Observation Routes (Agent API — template-provided)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None, "visibleText": [], "inputValues": {},
            "componentState": {}, "currentView": None, "viewport": {},
            "timestamp": None, "status": "no_snapshot",
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
        return {"imageData": None, "width": None, "height": None,
                "timestamp": None, "status": "no_screenshot"}
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


# ============================================================================
# Router wiring: auth + all CRM domain routers under backend/api/
# ============================================================================

from auth_routes import router as auth_router  # noqa: E402

router.include_router(auth_router)

_api_dir = Path(__file__).parent / "api"
if _api_dir.exists():
    for _importer, _module_name, _is_pkg in pkgutil.iter_modules([str(_api_dir)]):
        module = importlib.import_module(f"api.{_module_name}")
        if hasattr(module, "router"):
            router.include_router(module.router)
            logger.info(f"[Routes] Included router: api.{_module_name}")
