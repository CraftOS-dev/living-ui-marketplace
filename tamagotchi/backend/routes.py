"""
Living UI API Routes

REST API endpoints for state management and Tamagotchi pet operations.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import AppState, Item, UISnapshot, UIScreenshot, Pet, ActivityLog
from datetime import datetime
import logging
import base64

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


class ItemCreate(BaseModel):
    title: str
    description: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None


class ItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[Any] = None
    order: Optional[Any] = None
    extra_data: Optional[Any] = None

    def get_completed(self) -> Optional[bool]:
        if self.completed is None:
            return None
        if isinstance(self.completed, bool):
            return self.completed
        return str(self.completed).lower() in ('true', '1', 'yes')

    def get_order(self) -> Optional[int]:
        if self.order is None:
            return None
        try:
            return int(self.order)
        except (ValueError, TypeError):
            return None

    def get_extra_data(self) -> Optional[Dict[str, Any]]:
        if self.extra_data is None:
            return None
        if isinstance(self.extra_data, dict):
            return self.extra_data
        return {}


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


class PetCreate(BaseModel):
    name: str


# ============================================================================
# Helper: get active pet
# ============================================================================

def get_active_pet(db: Session) -> Optional[Pet]:
    """Get the current active (non-retired) pet."""
    return db.query(Pet).filter(Pet.is_retired == False).first()


def apply_tick_and_save(pet: Pet, db: Session) -> Pet:
    """Apply time-based decay to pet stats and save."""
    now = datetime.utcnow()
    if pet.last_updated:
        elapsed = (now - pet.last_updated).total_seconds() / 60.0
        pet.apply_decay(elapsed)
    pet.last_updated = now
    db.commit()
    db.refresh(pet)
    return pet


def log_action(pet: Pet, action: str, description: str, db: Session) -> None:
    """Add an entry to the activity log."""
    entry = ActivityLog(
        pet_id=pet.id,
        action=action,
        description=description,
        timestamp=datetime.utcnow(),
    )
    db.add(entry)
    db.commit()


def is_on_cooldown(pet: Pet, action: str, cooldown_seconds: int) -> bool:
    """Check if an action is on cooldown."""
    cooldowns = pet.cooldowns or {}
    last_used_str = cooldowns.get(action)
    if not last_used_str:
        return False
    try:
        last_used = datetime.fromisoformat(last_used_str)
        elapsed = (datetime.utcnow() - last_used).total_seconds()
        return elapsed < cooldown_seconds
    except Exception:
        return False


def set_cooldown(pet: Pet, action: str) -> None:
    """Set cooldown timestamp for an action."""
    cooldowns = dict(pet.cooldowns or {})
    cooldowns[action] = datetime.utcnow().isoformat()
    pet.cooldowns = cooldowns


# ============================================================================
# Pet Routes
# ============================================================================

@router.get("/pet")
def get_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get the current active pet with up-to-date stats."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    # Apply decay based on elapsed time
    pet = apply_tick_and_save(pet, db)
    return pet.to_dict()


@router.post("/pet")
def create_pet(data: PetCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Create a new pet (hatch an egg). Returns existing pet if one already exists."""
    existing = get_active_pet(db)
    if existing:
        existing = apply_tick_and_save(existing, db)
        return existing.to_dict()
    pet = Pet(
        name=data.name,
        stage="egg",
        hunger=80.0,
        happiness=80.0,
        health=100.0,
        is_sleeping=False,
        is_sick=False,
        is_retired=False,
        evolution_points=0,
        age_minutes=0.0,
        cooldowns={},
        created_at=datetime.utcnow(),
        last_updated=datetime.utcnow(),
    )
    db.add(pet)
    db.commit()
    db.refresh(pet)
    log_action(pet, "hatch", f"{data.name} has hatched from an egg!", db)
    logger.info(f"[Routes] Created pet: {pet.name}")
    return pet.to_dict()


@router.put("/pet/tick")
def tick_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Manually trigger a stat update tick. Frontend calls this periodically."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    pet = apply_tick_and_save(pet, db)
    return pet.to_dict()


@router.post("/pet/feed")
def feed_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Feed the pet. Increases hunger by 30. Cooldown: 30 seconds."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.is_retired:
        raise HTTPException(status_code=400, detail="pet_retired")
    if is_on_cooldown(pet, "feed", 30):
        raise HTTPException(status_code=429, detail="feed_cooldown")
    # Apply decay first
    pet = apply_tick_and_save(pet, db)
    pet.hunger = min(100.0, pet.hunger + 30.0)
    pet.happiness = min(100.0, pet.happiness + 5.0)  # small happiness boost
    set_cooldown(pet, "feed")
    db.commit()
    db.refresh(pet)
    log_action(pet, "feed", f"Fed {pet.name} a yummy snack! 🍖", db)
    return pet.to_dict()


@router.post("/pet/play")
def play_with_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Play with the pet. Increases happiness by 25, costs some hunger. Cooldown: 60 seconds."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.is_retired:
        raise HTTPException(status_code=400, detail="pet_retired")
    if pet.is_sleeping:
        raise HTTPException(status_code=400, detail="pet_sleeping")
    if is_on_cooldown(pet, "play", 60):
        raise HTTPException(status_code=429, detail="play_cooldown")
    pet = apply_tick_and_save(pet, db)
    pet.happiness = min(100.0, pet.happiness + 25.0)
    pet.hunger = max(0.0, pet.hunger - 5.0)  # playing makes them hungry
    set_cooldown(pet, "play")
    db.commit()
    db.refresh(pet)
    log_action(pet, "play", f"Played with {pet.name}! They loved it! 🎮", db)
    return pet.to_dict()


@router.post("/pet/sleep")
def put_pet_to_sleep(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Put the pet to sleep. Stats decay slower while sleeping, health recovers."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.is_retired:
        raise HTTPException(status_code=400, detail="pet_retired")
    if pet.is_sleeping:
        raise HTTPException(status_code=400, detail="already_sleeping")
    pet = apply_tick_and_save(pet, db)
    pet.is_sleeping = True
    db.commit()
    db.refresh(pet)
    log_action(pet, "sleep", f"{pet.name} is now sleeping. Zzz... 💤", db)
    return pet.to_dict()


@router.post("/pet/wake")
def wake_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Wake the pet up."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.is_retired:
        raise HTTPException(status_code=400, detail="pet_retired")
    if not pet.is_sleeping:
        raise HTTPException(status_code=400, detail="not_sleeping")
    pet = apply_tick_and_save(pet, db)
    pet.is_sleeping = False
    db.commit()
    db.refresh(pet)
    log_action(pet, "wake", f"{pet.name} woke up! Good morning! ☀️", db)
    return pet.to_dict()


@router.post("/pet/clean")
def clean_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Clean the pet. Reduces sick chance, small happiness boost. Cooldown: 120 seconds."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.is_retired:
        raise HTTPException(status_code=400, detail="pet_retired")
    if is_on_cooldown(pet, "clean", 120):
        raise HTTPException(status_code=429, detail="clean_cooldown")
    pet = apply_tick_and_save(pet, db)
    pet.happiness = min(100.0, pet.happiness + 10.0)
    pet.health = min(100.0, pet.health + 5.0)  # cleaning helps health
    set_cooldown(pet, "clean")
    db.commit()
    db.refresh(pet)
    log_action(pet, "clean", f"Cleaned {pet.name}! Squeaky clean! 🛁", db)
    return pet.to_dict()


@router.post("/pet/medicine")
def give_medicine(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Give medicine to the pet. Cures sickness, restores health. Pet doesn't like it."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.is_retired:
        raise HTTPException(status_code=400, detail="pet_retired")
    if is_on_cooldown(pet, "medicine", 60):
        raise HTTPException(status_code=429, detail="medicine_cooldown")
    pet = apply_tick_and_save(pet, db)
    pet.is_sick = False
    pet.health = min(100.0, pet.health + 20.0)
    pet.happiness = max(0.0, pet.happiness - 5.0)  # pet doesn't like medicine
    set_cooldown(pet, "medicine")
    db.commit()
    db.refresh(pet)
    log_action(pet, "medicine", f"Gave {pet.name} medicine. Yuck! But feeling better! 💊", db)
    return pet.to_dict()


@router.get("/pet/evolution-status")
def get_evolution_status(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Check if the pet is ready to evolve or retire."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    from models import VALID_STAGES, STAGE_THRESHOLDS
    stage_idx = VALID_STAGES.index(pet.stage)
    is_max_stage = pet.stage == "adult"
    can_retire = is_max_stage and pet.evolution_points >= STAGE_THRESHOLDS["adult"]
    next_stage = VALID_STAGES[stage_idx + 1] if stage_idx < len(VALID_STAGES) - 1 else None
    current_threshold = STAGE_THRESHOLDS.get(pet.stage, 0)
    return {
        "stage": pet.stage,
        "evolution_points": pet.evolution_points,
        "current_threshold": current_threshold,
        "next_stage": next_stage,
        "can_retire": can_retire,
        "is_max_stage": is_max_stage,
    }


@router.post("/pet/retire")
def retire_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Trigger the retirement ceremony for an adult pet."""
    pet = get_active_pet(db)
    if not pet:
        raise HTTPException(status_code=404, detail="no_pet")
    if pet.stage != "adult":
        pet = apply_tick_and_save(pet, db)
        result = pet.to_dict()
        result["can_retire"] = False
        result["retire_message"] = "not_adult"
        return result
    from models import STAGE_THRESHOLDS
    if pet.evolution_points < STAGE_THRESHOLDS["adult"]:
        pet = apply_tick_and_save(pet, db)
        result = pet.to_dict()
        result["can_retire"] = False
        result["retire_message"] = "not_ready_to_retire"
        return result
    pet = apply_tick_and_save(pet, db)
    pet.is_retired = True
    pet.retired_at = datetime.utcnow()
    db.commit()
    db.refresh(pet)
    log_action(pet, "retire", f"{pet.name} has retired with honour! A legend! 🌟", db)
    return pet.to_dict()


@router.get("/pet/activity")
def get_activity_log(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Get the last 20 activity log entries for the active pet."""
    pet = get_active_pet(db)
    if not pet:
        # Return empty list if no active pet
        return []
    logs = (
        db.query(ActivityLog)
        .filter(ActivityLog.pet_id == pet.id)
        .order_by(ActivityLog.timestamp.desc())
        .limit(20)
        .all()
    )
    return [log.to_dict() for log in logs]


@router.get("/pet/retired")
def get_retired_pet(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get the most recently retired pet (for memorial display). Returns null if none."""
    pet = db.query(Pet).filter(Pet.is_retired == True).order_by(Pet.retired_at.desc()).first()
    if not pet:
        return {"retired": False, "pet": None}
    return pet.to_dict()


# ============================================================================
# State Management Routes (Primary API)
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
    elif action == "increment":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) + 1
        state.data = current_data
        db.commit()
        return {"status": "incremented", "data": current_data}
    else:
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# Item CRUD Routes
# ============================================================================

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
    if data.title is not None:
        item.title = data.title
    if data.description is not None:
        item.description = data.description
    completed = data.get_completed()
    if completed is not None:
        item.completed = completed
    order = data.get_order()
    if order is not None:
        item.order = order
    extra_data = data.get_extra_data()
    if extra_data is not None:
        item.extra_data = extra_data
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
