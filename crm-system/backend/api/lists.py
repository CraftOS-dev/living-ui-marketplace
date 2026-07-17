"""
Lists (pipelines), stages, entries, and the kanban board payload.

Stage editing lives here so the board can edit stages inline (never buried in
Settings). Entry moves write stage_change activities and stamp
stage_entered_at for velocity metrics; moving a deal into a won/lost stage
updates the deal status.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import (
    get_record,
    log_activity,
    not_found_ok,
    pick_color,
    record_brief,
)
from database import get_db
from models import Attribute, AttributeValue, Deal, ListEntry, RecordList, SavedView, Stage

logger = logging.getLogger(__name__)
router = APIRouter(tags=["lists"])

DEFAULT_STAGES = [
    ("Lead", "#7c9ce8", False, False, 10),
    ("Contacted", "#6fbfbf", False, False, 20),
    ("Qualified", "#8fbf8f", False, False, 35),
    ("Demo", "#b5a642", False, False, 50),
    ("Proposal", "#d9a662", False, False, 65),
    ("Negotiation", "#c98bc9", False, False, 80),
    ("Won", "#4caf7d", True, False, 100),
    ("Lost", "#e08e8e", False, True, 0),
]


class ListCreate(BaseModel):
    name: Optional[str] = "New list"
    parent_object: Optional[Literal["person", "company", "deal"]] = "deal"
    icon: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    with_default_stages: Optional[bool] = True


class ListUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    position: Optional[int] = None


class StageCreate(BaseModel):
    name: Optional[str] = "New stage"
    color: Optional[str] = None
    is_won: Optional[bool] = False
    is_lost: Optional[bool] = False
    probability: Optional[float] = None


class StageUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_won: Optional[bool] = None
    is_lost: Optional[bool] = None
    probability: Optional[float] = None
    position: Optional[int] = None


class StageReorder(BaseModel):
    stage_ids: Optional[List[int]] = None


class EntryCreate(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = None
    record_id: Optional[int] = 0
    stage_id: Optional[int] = None


class EntryMove(BaseModel):
    stage_id: Optional[int] = None
    position: Optional[float] = None


def _list_payload(db: Session, record_list: RecordList) -> Dict[str, Any]:
    data = record_list.to_dict()
    data["stages"] = [
        s.to_dict()
        for s in db.query(Stage).filter(Stage.list_id == record_list.id).order_by(Stage.position, Stage.id).all()
    ]
    data["entryCount"] = db.query(ListEntry).filter(ListEntry.list_id == record_list.id).count()
    return data


@router.get("/lists")
def get_lists(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from bootstrap import ensure_defaults
    ensure_defaults(db)
    lists = db.query(RecordList).order_by(RecordList.position, RecordList.id).all()
    return [_list_payload(db, l) for l in lists]


@router.post("/lists")
def create_list(
    body: ListCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = (body.name or "New list").strip() or "New list"
    record_list = RecordList(
        name=name,
        parent_object=body.parent_object or "deal",
        icon=body.icon or ("kanban" if (body.parent_object or "deal") == "deal" else "list"),
        color=body.color or pick_color(name),
        description=body.description or "",
        position=db.query(RecordList).count(),
    )
    db.add(record_list)
    db.flush()

    if body.with_default_stages:
        if record_list.parent_object == "deal":
            stage_rows = DEFAULT_STAGES
        else:
            stage_rows = [
                ("New", "#7c9ce8", False, False, None),
                ("Contacted", "#6fbfbf", False, False, None),
                ("Engaged", "#8fbf8f", False, False, None),
                ("Active", "#4caf7d", True, False, None),
            ]
        for index, (stage_name, color, is_won, is_lost, probability) in enumerate(stage_rows):
            db.add(Stage(
                list_id=record_list.id, name=stage_name, color=color,
                position=index, is_won=is_won, is_lost=is_lost, probability=probability,
            ))

    # Every list ships with a default kanban + table view
    db.add(SavedView(list_id=record_list.id, name="Board", layout="kanban", is_default=True, position=0))
    db.add(SavedView(list_id=record_list.id, name="All entries", layout="table", position=1))
    db.commit()
    db.refresh(record_list)
    return _list_payload(db, record_list)


@router.get("/lists/{list_id}")
def get_list(
    list_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = db.get(RecordList, list_id)
    if record_list is None:
        return {"status": "not_found"}
    return _list_payload(db, record_list)


@router.put("/lists/{list_id}")
def update_list(
    list_id: int,
    body: ListUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = db.get(RecordList, list_id)
    if record_list is None:
        return not_found_ok("list")
    for field in ("name", "icon", "color", "description", "position"):
        value = getattr(body, field)
        if value is not None:
            setattr(record_list, field, value)
    db.commit()
    db.refresh(record_list)
    return _list_payload(db, record_list)


@router.delete("/lists/{list_id}")
def delete_list(
    list_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = db.get(RecordList, list_id)
    if record_list is None:
        return not_found_ok("list")
    # D-2: deleting a list never deletes the records themselves.
    db.query(ListEntry).filter(ListEntry.list_id == list_id).delete()
    db.query(Stage).filter(Stage.list_id == list_id).delete()
    db.query(SavedView).filter(SavedView.list_id == list_id).delete()
    list_attribute_ids = [a.id for a in db.query(Attribute).filter(Attribute.list_id == list_id).all()]
    if list_attribute_ids:
        db.query(AttributeValue).filter(AttributeValue.attribute_id.in_(list_attribute_ids)).delete()
        db.query(Attribute).filter(Attribute.id.in_(list_attribute_ids)).delete()
    db.delete(record_list)
    db.commit()
    return {"status": "deleted", "id": list_id}


# ============================================================================
# Board payload
# ============================================================================

@router.get("/lists/{list_id}/board")
def get_board(
    list_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = db.get(RecordList, list_id)
    if record_list is None:
        return {"status": "not_found", "list": None, "columns": []}

    stages = db.query(Stage).filter(Stage.list_id == list_id).order_by(Stage.position, Stage.id).all()
    entries = db.query(ListEntry).filter(ListEntry.list_id == list_id).order_by(ListEntry.position, ListEntry.id).all()

    now = datetime.utcnow()
    cards_by_stage: Dict[Optional[int], List[Dict[str, Any]]] = {}
    for entry in entries:
        record = get_record(db, entry.record_type, entry.record_id)
        if record is None:
            continue  # dangling entry (e.g. smoke-test junk) — skip defensively
        card = {
            "entry": entry.to_dict(),
            "record": record_brief(record),
            "daysInStage": max(0, (now - (entry.stage_entered_at or entry.created_at or now)).days),
        }
        if entry.record_type == "deal":
            card["record"]["companyId"] = record.company_id
            if record.company_id:
                from models import Company
                company = db.get(Company, record.company_id)
                card["company"] = record_brief(company)
            card["record"]["expectedCloseDate"] = record.expected_close_date or ""
        cards_by_stage.setdefault(entry.stage_id, []).append(card)

    columns = []
    for stage in stages:
        cards = cards_by_stage.get(stage.id, [])
        total_value = sum(
            (c["record"].get("value") or 0) for c in cards if c["record"].get("recordType") == "deal"
        )
        columns.append({
            "stage": stage.to_dict(),
            "cards": cards,
            "count": len(cards),
            "totalValue": total_value,
        })
    unstaged = cards_by_stage.get(None, [])
    return {
        "status": "ok",
        "list": record_list.to_dict(),
        "columns": columns,
        "unstaged": unstaged,
    }


# ============================================================================
# Stages (inline board editing)
# ============================================================================

@router.post("/lists/{list_id}/stages")
def create_stage(
    list_id: int,
    body: StageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = db.get(RecordList, list_id)
    if record_list is None:
        return not_found_ok("list")
    name = (body.name or "New stage").strip() or "New stage"
    stage = Stage(
        list_id=list_id,
        name=name,
        color=body.color or pick_color(name),
        position=db.query(Stage).filter(Stage.list_id == list_id).count(),
        is_won=bool(body.is_won),
        is_lost=bool(body.is_lost),
        probability=body.probability,
    )
    db.add(stage)
    db.commit()
    db.refresh(stage)
    return stage.to_dict()


@router.put("/stages/{stage_id}")
def update_stage(
    stage_id: int,
    body: StageUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stage = db.get(Stage, stage_id)
    if stage is None:
        return not_found_ok("stage")
    for field in ("name", "color", "is_won", "is_lost", "probability", "position"):
        value = getattr(body, field)
        if value is not None:
            setattr(stage, field, value)
    db.commit()
    db.refresh(stage)
    return stage.to_dict()


@router.delete("/stages/{stage_id}")
def delete_stage(
    stage_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stage = db.get(Stage, stage_id)
    if stage is None:
        return not_found_ok("stage")
    # Entries in the deleted stage fall back to the first remaining stage
    fallback = (
        db.query(Stage)
        .filter(Stage.list_id == stage.list_id, Stage.id != stage_id)
        .order_by(Stage.position, Stage.id)
        .first()
    )
    db.query(ListEntry).filter(ListEntry.stage_id == stage_id).update(
        {"stage_id": fallback.id if fallback else None, "stage_entered_at": datetime.utcnow()}
    )
    db.delete(stage)
    db.commit()
    return {"status": "deleted", "id": stage_id}


@router.put("/lists/{list_id}/stages-reorder")
def reorder_stages(
    list_id: int,
    body: StageReorder,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stages = {s.id: s for s in db.query(Stage).filter(Stage.list_id == list_id).all()}
    for index, stage_id in enumerate(body.stage_ids or []):
        if stage_id in stages:
            stages[stage_id].position = index
    db.commit()
    return {"status": "ok"}


# ============================================================================
# Entries
# ============================================================================

@router.post("/lists/{list_id}/entries")
def add_entry(
    list_id: int,
    body: EntryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = db.get(RecordList, list_id)
    if record_list is None:
        return not_found_ok("list")
    record_type = body.record_type or record_list.parent_object or "deal"
    if not body.record_id:
        return {"status": "noop"}

    existing = db.query(ListEntry).filter_by(
        list_id=list_id, record_type=record_type, record_id=body.record_id
    ).first()
    if existing:
        return existing.to_dict()

    stage_id = body.stage_id
    if stage_id is None:
        first_stage = (
            db.query(Stage).filter(Stage.list_id == list_id)
            .order_by(Stage.position, Stage.id).first()
        )
        stage_id = first_stage.id if first_stage else None

    max_position = (
        db.query(ListEntry).filter_by(list_id=list_id, stage_id=stage_id).count()
    )
    entry = ListEntry(
        list_id=list_id, record_type=record_type, record_id=body.record_id,
        stage_id=stage_id, position=float(max_position),
    )
    db.add(entry)

    record = get_record(db, record_type, body.record_id)
    if record is not None:
        log_activity(db, record_type, body.record_id, "list_added",
                     f"Added to {record_list.name}", actor=user.username,
                     extra={"listId": list_id}, touch=False)
    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.delete("/lists/{list_id}/entries/{entry_id}")
def remove_entry(
    list_id: int,
    entry_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = db.get(ListEntry, entry_id)
    if entry is None:
        return not_found_ok("entry")
    db.delete(entry)
    db.commit()
    return {"status": "deleted", "id": entry_id}


@router.put("/entries/{entry_id}/move")
def move_entry(
    entry_id: int,
    body: EntryMove,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = db.get(ListEntry, entry_id)
    if entry is None:
        return not_found_ok("entry")

    if body.position is not None:
        entry.position = body.position

    if body.stage_id is not None and body.stage_id != entry.stage_id:
        old_stage = db.get(Stage, entry.stage_id) if entry.stage_id else None
        new_stage = db.get(Stage, body.stage_id)
        entry.stage_id = body.stage_id
        entry.stage_entered_at = datetime.utcnow()

        record = get_record(db, entry.record_type, entry.record_id)
        if new_stage is not None and record is not None:
            log_activity(
                db, entry.record_type, entry.record_id, "stage_change",
                f"Moved to {new_stage.name}",
                actor=user.username,
                extra={
                    "listId": entry.list_id,
                    "from": old_stage.name if old_stage else None,
                    "to": new_stage.name,
                    "fromColor": old_stage.color if old_stage else None,
                    "toColor": new_stage.color,
                },
            )
            # Won/lost stages update the deal's global status
            if entry.record_type == "deal" and isinstance(record, Deal):
                if new_stage.is_won:
                    record.status = "won"
                    record.closed_at = datetime.utcnow()
                elif new_stage.is_lost:
                    record.status = "lost"
                    record.closed_at = datetime.utcnow()
                elif record.status in ("won", "lost"):
                    record.status = "open"
                    record.closed_at = None

    db.commit()
    db.refresh(entry)
    return entry.to_dict()
