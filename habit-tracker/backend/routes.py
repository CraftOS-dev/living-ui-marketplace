"""
Habit Tracker API Routes

Domain endpoints (categories, habits, entries, stats, dashboard) plus the
standard Living UI agent endpoints (state, action, ui-snapshot, ui-screenshot,
items) inherited from the template.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Dict, Any, List, Optional
from datetime import datetime, date as date_cls
import logging

from database import get_db
from models import (
    AppState, Item, UISnapshot, UIScreenshot,
    Category, Habit, HabitEntry, HABIT_TYPES,
)
from services.streaks import (
    stats as compute_stats,
    heatmap as compute_heatmap,
    current_streak,
    dashboard_summary,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Helpers
# ============================================================================

def _today() -> date_cls:
    return date_cls.today()


def _parse_date(value: str) -> date_cls:
    try:
        return date_cls.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date '{value}'") from exc


def _habit_with_today(habit: Habit, today: date_cls) -> Dict[str, Any]:
    """Serialize habit + today's entry + current streak for list views."""
    base = habit.to_dict()
    entries = list(habit.entries)
    today_entry = next((e for e in entries if e.date == today), None)
    base["todayEntry"] = today_entry.to_dict() if today_entry else None
    base["currentStreak"] = current_streak(habit, entries, today=today)
    base["category"] = habit.category.to_dict() if habit.category else None
    return base


# ============================================================================
# Category schemas + routes
# ============================================================================

class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(default="#737373", max_length=20)


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    color: Optional[str] = Field(default=None, max_length=20)
    order: Optional[int] = None


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    items = db.query(Category).order_by(Category.order, Category.id).all()
    return [c.to_dict() for c in items]


@router.post("/categories")
def create_category(data: CategoryCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    next_order = db.query(Category).count()
    cat = Category(name=data.name, color=data.color, order=next_order)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat.to_dict()


@router.put("/categories/{cat_id}")
def update_category(cat_id: int, data: CategoryUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if data.name is not None:
        cat.name = data.name
    if data.color is not None:
        cat.color = data.color
    if data.order is not None:
        cat.order = data.order
    db.commit()
    db.refresh(cat)
    return cat.to_dict()


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for h in list(cat.habits):
        h.category_id = None
    db.delete(cat)
    db.commit()
    return {"status": "deleted", "id": str(cat_id)}


# ============================================================================
# Habit schemas + routes
# ============================================================================

class HabitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    type: str = Field(default="binary")
    target: Optional[float] = None
    unit: Optional[str] = Field(default=None, max_length=40)
    color: str = Field(default="#737373", max_length=20)
    icon: str = Field(default="Circle", max_length=60)
    category_id: Optional[int] = None

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in HABIT_TYPES:
            raise ValueError(f"type must be one of {HABIT_TYPES}")
        return v


class HabitUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    type: Optional[str] = None
    target: Optional[float] = None
    unit: Optional[str] = Field(default=None, max_length=40)
    color: Optional[str] = Field(default=None, max_length=20)
    icon: Optional[str] = Field(default=None, max_length=60)
    category_id: Optional[int] = None
    archived: Optional[bool] = None
    order: Optional[int] = None

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in HABIT_TYPES:
            raise ValueError(f"type must be one of {HABIT_TYPES}")
        return v


class ReorderRequest(BaseModel):
    habitIds: List[int]


@router.get("/habits")
def list_habits(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    query = db.query(Habit)
    if not include_archived:
        query = query.filter(Habit.archived.is_(False))
    habits = query.order_by(Habit.order, Habit.id).all()
    today = _today()
    return [_habit_with_today(h, today) for h in habits]


@router.post("/habits")
def create_habit(data: HabitCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    if data.category_id is not None:
        cat = db.query(Category).filter(Category.id == data.category_id).first()
        if not cat:
            raise HTTPException(status_code=400, detail="category_id does not exist")
    next_order = db.query(Habit).count()
    habit = Habit(
        name=data.name,
        description=data.description,
        type=data.type,
        target=data.target,
        unit=data.unit,
        color=data.color,
        icon=data.icon,
        category_id=data.category_id,
        order=next_order,
        archived=False,
    )
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return habit.to_dict()


@router.get("/habits/{habit_id}")
def get_habit(habit_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    base = _habit_with_today(habit, _today())
    base.update(compute_stats(habit, list(habit.entries)))
    return base


@router.put("/habits/{habit_id}")
def update_habit(habit_id: int, data: HabitUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    if data.category_id is not None:
        cat = db.query(Category).filter(Category.id == data.category_id).first()
        if not cat:
            raise HTTPException(status_code=400, detail="category_id does not exist")
    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(habit, field, value)
    db.commit()
    db.refresh(habit)
    return habit.to_dict()


@router.delete("/habits/{habit_id}")
def delete_habit(habit_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    db.delete(habit)
    db.commit()
    return {"status": "deleted", "id": str(habit_id)}


@router.post("/habits/reorder")
def reorder_habits(data: ReorderRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    ids = data.habitIds
    found = db.query(Habit).filter(Habit.id.in_(ids)).all()
    if len(found) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more habit IDs do not exist")
    by_id = {h.id: h for h in found}
    for index, habit_id in enumerate(ids):
        by_id[habit_id].order = index
    db.commit()
    return {"status": "reordered", "count": len(ids)}


# ============================================================================
# HabitEntry schemas + routes
# ============================================================================

class EntryUpsert(BaseModel):
    date: str
    value: Optional[float] = None
    note: Optional[str] = None


@router.get("/habits/{habit_id}/entries")
def list_entries(habit_id: int, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    entries = sorted(habit.entries, key=lambda e: e.date)
    return [e.to_dict() for e in entries]


@router.put("/habits/{habit_id}/entry")
def upsert_entry(habit_id: int, data: EntryUpsert, db: Session = Depends(get_db)) -> Dict[str, Any]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    target_date = _parse_date(data.date)

    entry = (
        db.query(HabitEntry)
        .filter(HabitEntry.habit_id == habit_id, HabitEntry.date == target_date)
        .first()
    )
    if entry is None:
        entry = HabitEntry(
            habit_id=habit_id,
            date=target_date,
            value=data.value if data.value is not None else 0,
            note=data.note,
        )
        db.add(entry)
    else:
        if data.value is not None:
            entry.value = data.value
        if data.note is not None:
            entry.note = data.note
    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.delete("/habits/{habit_id}/entry")
def delete_entry(habit_id: int, date: str, db: Session = Depends(get_db)) -> Dict[str, str]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    target_date = _parse_date(date)
    entry = (
        db.query(HabitEntry)
        .filter(HabitEntry.habit_id == habit_id, HabitEntry.date == target_date)
        .first()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"status": "deleted"}


# ============================================================================
# Stats, heatmap, dashboard
# ============================================================================

@router.get("/habits/{habit_id}/stats")
def habit_stats(
    habit_id: int,
    window: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    return compute_stats(habit, list(habit.entries), window=window)


@router.get("/habits/{habit_id}/heatmap")
def habit_heatmap(
    habit_id: int,
    days: int = Query(default=365, ge=7, le=730),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    cells = compute_heatmap(habit, list(habit.entries), days=days)
    return {
        "habitId": habit.id,
        "color": habit.color,
        "days": days,
        "cells": cells,
    }


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return dashboard_summary(db)


# ============================================================================
# Generic state / action endpoints (template; preserved for agent observation)
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


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
    """
    Generic action endpoint. Habit Tracker exposes:
      - {"action": "complete_habit",   "payload": {"habitId": 1, "date": "2026-05-01"}}
      - {"action": "uncomplete_habit", "payload": {"habitId": 1, "date": "2026-05-01"}}
      - {"action": "set_habit_value",  "payload": {"habitId": 1, "date": "...", "value": 5}}
      - {"action": "reset"} — clears generic app_state (NOT habits)
    """
    action = request.action
    payload = request.payload or {}

    if action == "complete_habit":
        habit_id = int(payload.get("habitId", 0))
        habit = db.query(Habit).filter(Habit.id == habit_id).first()
        if not habit:
            raise HTTPException(status_code=404, detail="Habit not found")
        target_date = _parse_date(payload.get("date") or _today().isoformat())
        if habit.type in ("binary", "negative"):
            value = 1
        else:
            value = float(payload.get("value", habit.target or 1))
        return _upsert_action(db, habit, target_date, value)

    if action == "uncomplete_habit":
        habit_id = int(payload.get("habitId", 0))
        habit = db.query(Habit).filter(Habit.id == habit_id).first()
        if not habit:
            raise HTTPException(status_code=404, detail="Habit not found")
        target_date = _parse_date(payload.get("date") or _today().isoformat())
        return _upsert_action(db, habit, target_date, 0)

    if action == "set_habit_value":
        habit_id = int(payload.get("habitId", 0))
        habit = db.query(Habit).filter(Habit.id == habit_id).first()
        if not habit:
            raise HTTPException(status_code=404, detail="Habit not found")
        target_date = _parse_date(payload.get("date") or _today().isoformat())
        value = float(payload.get("value", 0))
        return _upsert_action(db, habit, target_date, value)

    if action == "reset":
        state = db.query(AppState).first()
        if state:
            state.data = {}
            db.commit()
        return {"status": "reset", "data": {}}

    if action in ("increment", "decrement"):
        state = db.query(AppState).first()
        if not state:
            state = AppState(data={})
            db.add(state)
        current = state.data or {}
        key = payload.get("key", "counter")
        delta = 1 if action == "increment" else -1
        current[key] = current.get(key, 0) + delta
        state.data = current
        db.commit()
        return {"status": action, "data": current}

    return {"status": "unknown_action", "action": action}


def _upsert_action(db: Session, habit: Habit, target_date: date_cls, value: float) -> Dict[str, Any]:
    entry = (
        db.query(HabitEntry)
        .filter(HabitEntry.habit_id == habit.id, HabitEntry.date == target_date)
        .first()
    )
    if entry is None:
        entry = HabitEntry(habit_id=habit.id, date=target_date, value=value)
        db.add(entry)
    else:
        entry.value = value
    db.commit()
    db.refresh(entry)
    return {"status": "ok", "entry": entry.to_dict()}


# ============================================================================
# Items CRUD (template; kept for backward agent tooling compatibility)
# ============================================================================

class ItemCreate(BaseModel):
    title: str
    description: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None


class ItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None
    order: Optional[int] = None
    extra_data: Optional[Dict[str, Any]] = None


@router.get("/items")
def list_items(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    items = db.query(Item).order_by(Item.order, Item.id).all()
    return [item.to_dict() for item in items]


@router.post("/items")
def create_item(data: ItemCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    max_order = db.query(Item).count()
    item = Item(
        title=data.title,
        description=data.description,
        extra_data=data.extra_data or {},
        order=max_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item.to_dict()


@router.put("/items/{item_id}")
def update_item(item_id: int, data: ItemUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"status": "deleted", "id": str(item_id)}


# ============================================================================
# UI snapshot / screenshot (template; agent observation)
# ============================================================================

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
