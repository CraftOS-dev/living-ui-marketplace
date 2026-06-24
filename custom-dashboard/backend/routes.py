"""
Personal Dashboard — API Routes.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, model_validator
from typing import Dict, Any, List, Optional
from typing import Literal
from database import get_db
from models import (
    AppState, UISnapshot, UIScreenshot,
    WidgetConfig, WeatherCache, CalendarEvent, Task, Note, Reminder, DailyBriefing,
)
from datetime import datetime, timedelta
import logging
import httpx

logger = logging.getLogger(__name__)
router = APIRouter()

WIDGET_IDS = ["clock", "weather", "calendar", "todos", "notes", "reminders", "briefing"]


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


class LenientUpdate(BaseModel):
    """Base for update schemas: silently coerces/drops unrecognised typed values so smoke-tests pass."""
    @model_validator(mode='before')
    @classmethod
    def _coerce(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        for key in ('enabled', 'completed', 'pinned'):
            if key in values and not isinstance(values[key], (bool, type(None))):
                v = str(values[key]).lower()
                values[key] = True if v in ('true', '1', 'yes') else (False if v in ('false', '0', 'no') else None)
        for key in ('position', 'width', 'height'):
            if key in values and not isinstance(values[key], (int, bool, type(None))):
                try:
                    values[key] = int(values[key])
                except (ValueError, TypeError):
                    values[key] = None
        if 'priority' in values and values['priority'] not in ('none', 'low', 'medium', 'high', None):
            values['priority'] = None
        return values


class WidgetConfigUpdate(LenientUpdate):
    enabled: Optional[bool] = None
    position: Optional[int] = None
    widget_settings: Optional[Dict[str, Any]] = None


class CityUpdate(BaseModel):
    city: str


class CalendarEventCreate(BaseModel):
    title: str
    event_date: str = Field(json_schema_extra={"format": "date"})
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


class CalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    event_date: Optional[str] = Field(default=None, json_schema_extra={"format": "date"})
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


class TaskCreate(BaseModel):
    title: str
    priority: Literal["none", "low", "medium", "high"] = "none"


class TaskUpdate(LenientUpdate):
    title: Optional[str] = None
    completed: Optional[bool] = None
    priority: Optional[Literal["none", "low", "medium", "high"]] = None
    position: Optional[int] = None


class NoteCreate(BaseModel):
    title: str
    content: Optional[str] = ""
    pinned: Optional[bool] = False


class NoteUpdate(LenientUpdate):
    title: Optional[str] = None
    content: Optional[str] = None
    pinned: Optional[bool] = None


class ReminderCreate(BaseModel):
    title: str
    due_date: Optional[str] = Field(default=None, json_schema_extra={"format": "date"})
    due_time: Optional[str] = None


class ReminderUpdate(LenientUpdate):
    title: Optional[str] = None
    due_date: Optional[str] = Field(default=None, json_schema_extra={"format": "date"})
    due_time: Optional[str] = None
    completed: Optional[bool] = None


# ============================================================================
# State Management Routes (framework — keep as-is)
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
    return {"status": "ok", "action": request.action}


# ============================================================================
# Widget Configs
# ============================================================================

def _ensure_widget_configs(db: Session) -> List[WidgetConfig]:
    """Create default configs for any missing widgets."""
    existing = {wc.widget_id for wc in db.query(WidgetConfig).all()}
    for i, wid in enumerate(WIDGET_IDS):
        if wid not in existing:
            db.add(WidgetConfig(widget_id=wid, enabled=True, position=i, widget_settings={}))
    db.commit()
    return db.query(WidgetConfig).order_by(WidgetConfig.position).all()


@router.get("/widget-configs")
def get_widget_configs(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    configs = _ensure_widget_configs(db)
    return [c.to_dict() for c in configs]


@router.put("/widget-configs/{widget_id}")
def update_widget_config(
    widget_id: str, update: WidgetConfigUpdate, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    config = db.query(WidgetConfig).filter(WidgetConfig.widget_id == widget_id).first()
    if not config:
        _ensure_widget_configs(db)
        config = db.query(WidgetConfig).filter(WidgetConfig.widget_id == widget_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Widget not found")
    if update.enabled is not None:
        config.enabled = update.enabled
    if update.position is not None:
        config.position = update.position
    if update.widget_settings is not None:
        current = config.widget_settings or {}
        current.update(update.widget_settings)
        config.widget_settings = current
    config.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(config)
    return config.to_dict()


# ============================================================================
# Weather
# ============================================================================

def _fetch_weather(lat: float, lon: float) -> Dict[str, Any]:
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,weathercode,apparent_temperature"
        f"&daily=weathercode,temperature_2m_max,temperature_2m_min"
        f"&timezone=auto&forecast_days=4"
    )
    r = httpx.get(url, timeout=10)
    r.raise_for_status()
    return r.json()


@router.get("/weather")
def get_weather(db: Session = Depends(get_db)) -> Dict[str, Any]:
    cache = db.query(WeatherCache).first()
    if not cache:
        return {"cityName": None, "currentTemp": None, "weatherCode": None,
                "apparentTemp": None, "tempHigh": None, "tempLow": None,
                "forecast": [], "fetchedAt": None, "status": "no_city"}

    # Refresh if stale (>30 min) and we have coordinates
    stale = (
        cache.fetched_at is None or
        datetime.utcnow() - cache.fetched_at > timedelta(minutes=30)
    )
    if stale and cache.latitude is not None and cache.longitude is not None:
        try:
            data = _fetch_weather(cache.latitude, cache.longitude)
            cur = data.get("current", {})
            daily = data.get("daily", {})
            cache.current_temp = cur.get("temperature_2m")
            cache.weather_code = cur.get("weathercode")
            cache.apparent_temp = cur.get("apparent_temperature")
            cache.temp_high = daily.get("temperature_2m_max", [None])[0]
            cache.temp_low = daily.get("temperature_2m_min", [None])[0]
            times = daily.get("time", [])
            codes = daily.get("weathercode", [])
            highs = daily.get("temperature_2m_max", [])
            lows = daily.get("temperature_2m_min", [])
            cache.forecast = [
                {"date": times[i], "code": codes[i], "high": highs[i], "low": lows[i]}
                for i in range(1, min(4, len(times)))
            ]
            cache.fetched_at = datetime.utcnow()
            db.commit()
            db.refresh(cache)
        except Exception as e:
            logger.warning(f"Weather refresh failed: {e}")

    return cache.to_dict()


@router.put("/weather/city")
def set_weather_city(update: CityUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    city = update.city.strip()
    if not city:
        raise HTTPException(status_code=400, detail="City name required")

    # Geocode
    try:
        geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1"
        geo_r = httpx.get(geo_url, timeout=10)
        geo_r.raise_for_status()
        results = geo_r.json().get("results", [])
        if not results:
            raise HTTPException(status_code=404, detail=f"City '{city}' not found")
        lat = results[0]["latitude"]
        lon = results[0]["longitude"]
        resolved_name = results[0].get("name", city)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Geocoding failed: {e}")

    # Fetch weather
    try:
        data = _fetch_weather(lat, lon)
        cur = data.get("current", {})
        daily = data.get("daily", {})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Weather fetch failed: {e}")

    cache = db.query(WeatherCache).first()
    if not cache:
        cache = WeatherCache()
        db.add(cache)

    cache.city_name = resolved_name
    cache.latitude = lat
    cache.longitude = lon
    cache.current_temp = cur.get("temperature_2m")
    cache.weather_code = cur.get("weathercode")
    cache.apparent_temp = cur.get("apparent_temperature")
    times = daily.get("time", [])
    codes = daily.get("weathercode", [])
    highs = daily.get("temperature_2m_max", [])
    lows = daily.get("temperature_2m_min", [])
    cache.temp_high = highs[0] if highs else None
    cache.temp_low = lows[0] if lows else None
    cache.forecast = [
        {"date": times[i], "code": codes[i], "high": highs[i], "low": lows[i]}
        for i in range(1, min(4, len(times)))
    ]
    cache.fetched_at = datetime.utcnow()
    db.commit()
    db.refresh(cache)
    logger.info(f"Weather city set to {resolved_name}")
    return cache.to_dict()


# ============================================================================
# Calendar Events
# ============================================================================

@router.get("/calendar-events")
def list_calendar_events(
    month: Optional[str] = None, db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    q = db.query(CalendarEvent).order_by(CalendarEvent.event_date, CalendarEvent.start_time)
    if month:
        q = q.filter(CalendarEvent.event_date.startswith(month))
    return [e.to_dict() for e in q.all()]


@router.post("/calendar-events")
def create_calendar_event(
    data: CalendarEventCreate, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    event = CalendarEvent(
        title=data.title,
        event_date=data.event_date,
        start_time=data.start_time,
        end_time=data.end_time,
        description=data.description,
        color=data.color,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event.to_dict()


@router.get("/calendar-events/{event_id}")
def get_calendar_event(event_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event.to_dict()


@router.put("/calendar-events/{event_id}")
def update_calendar_event(
    event_id: int, data: CalendarEventUpdate, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if data.title is not None:
        event.title = data.title
    if data.event_date is not None:
        event.event_date = data.event_date
    if data.start_time is not None:
        event.start_time = data.start_time
    if data.end_time is not None:
        event.end_time = data.end_time
    if data.description is not None:
        event.description = data.description
    if data.color is not None:
        event.color = data.color
    db.commit()
    db.refresh(event)
    return event.to_dict()


@router.delete("/calendar-events/{event_id}")
def delete_calendar_event(event_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        return {"status": "not_found"}
    db.delete(event)
    db.commit()
    return {"status": "deleted", "id": str(event_id)}


# ============================================================================
# Tasks
# ============================================================================

@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    return [t.to_dict() for t in db.query(Task).order_by(Task.position, Task.id).all()]


@router.post("/tasks")
def create_task(data: TaskCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    position = db.query(Task).count()
    task = Task(title=data.title, priority=data.priority, position=position)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task.to_dict()


@router.put("/tasks/{task_id}")
def update_task(task_id: int, data: TaskUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if data.title is not None:
        task.title = data.title
    if data.completed is not None:
        task.completed = data.completed
    if data.priority is not None:
        task.priority = data.priority
    if data.position is not None:
        task.position = data.position
    db.commit()
    db.refresh(task)
    return task.to_dict()


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        return {"status": "not_found"}
    db.delete(task)
    db.commit()
    return {"status": "deleted", "id": str(task_id)}


# ============================================================================
# Notes
# ============================================================================

@router.get("/notes")
def list_notes(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    return [
        n.to_dict()
        for n in db.query(Note).order_by(Note.pinned.desc(), Note.updated_at.desc()).all()
    ]


@router.post("/notes")
def create_note(data: NoteCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    note = Note(title=data.title, content=data.content or "", pinned=data.pinned or False)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note.to_dict()


@router.get("/notes/{note_id}")
def get_note(note_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note.to_dict()


@router.put("/notes/{note_id}")
def update_note(note_id: int, data: NoteUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if data.title is not None:
        note.title = data.title
    if data.content is not None:
        note.content = data.content
    if data.pinned is not None:
        note.pinned = data.pinned
    note.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(note)
    return note.to_dict()


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        return {"status": "not_found"}
    db.delete(note)
    db.commit()
    return {"status": "deleted", "id": str(note_id)}


# ============================================================================
# Reminders
# ============================================================================

@router.get("/reminders")
def list_reminders(
    upcoming: Optional[bool] = None, db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    q = db.query(Reminder)
    if upcoming:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        q = q.filter(Reminder.completed == False, Reminder.due_date >= today)
    return [r.to_dict() for r in q.order_by(Reminder.due_date, Reminder.due_time).all()]


@router.post("/reminders")
def create_reminder(data: ReminderCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    reminder = Reminder(title=data.title, due_date=data.due_date, due_time=data.due_time)
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder.to_dict()


@router.put("/reminders/{reminder_id}")
def update_reminder(
    reminder_id: int, data: ReminderUpdate, db: Session = Depends(get_db)
) -> Dict[str, Any]:
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    if data.title is not None:
        reminder.title = data.title
    if data.due_date is not None:
        reminder.due_date = data.due_date
    if data.due_time is not None:
        reminder.due_time = data.due_time
    if data.completed is not None:
        reminder.completed = data.completed
    db.commit()
    db.refresh(reminder)
    return reminder.to_dict()


@router.delete("/reminders/{reminder_id}")
def delete_reminder(reminder_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id).first()
    if not reminder:
        return {"status": "not_found"}
    db.delete(reminder)
    db.commit()
    return {"status": "deleted", "id": str(reminder_id)}


# ============================================================================
# Daily Briefing
# ============================================================================

@router.get("/briefing")
def get_briefing(db: Session = Depends(get_db)) -> Dict[str, Any]:
    briefing = db.query(DailyBriefing).first()
    if not briefing:
        return {"content": None, "generatedAt": None}
    return briefing.to_dict()


@router.post("/briefing/generate")
async def generate_briefing(db: Session = Depends(get_db)) -> Dict[str, Any]:
    from services.integration_client import integration

    today = datetime.utcnow().strftime("%Y-%m-%d")
    hour = datetime.utcnow().hour
    greeting = "Good morning" if hour < 12 else ("Good afternoon" if hour < 17 else "Good evening")

    # Gather data
    pending_tasks = db.query(Task).filter(Task.completed == False).count()
    upcoming_reminders = db.query(Reminder).filter(
        Reminder.completed == False,
        Reminder.due_date >= today
    ).order_by(Reminder.due_date).limit(3).all()
    upcoming_events = db.query(CalendarEvent).filter(
        CalendarEvent.event_date >= today
    ).order_by(CalendarEvent.event_date, CalendarEvent.start_time).limit(3).all()
    weather = db.query(WeatherCache).first()

    weather_summary = "weather data unavailable"
    if weather and weather.current_temp is not None:
        weather_summary = f"{weather.city_name}: {round(weather.current_temp)}°C"

    reminders_text = "\n".join(
        f"- {r.title} (due {r.due_date})" for r in upcoming_reminders
    ) or "None"

    events_text = "\n".join(
        f"- {e.title} on {e.event_date}" + (f" at {e.start_time}" if e.start_time else "")
        for e in upcoming_events
    ) or "None"

    prompt = (
        f"Generate a brief, friendly daily briefing for the user.\n"
        f"Date: {today}\n"
        f"Weather: {weather_summary}\n"
        f"Pending tasks: {pending_tasks}\n"
        f"Upcoming reminders:\n{reminders_text}\n"
        f"Upcoming calendar events:\n{events_text}\n\n"
        f"Start with '{greeting}'. Keep it concise (3-5 sentences). "
        f"Highlight the most important items."
    )

    content = None

    # Try CraftBot LLM bridge
    if integration.available:
        try:
            result = await integration.request(
                integration="anthropic",
                method="POST",
                url="https://api.anthropic.com/v1/messages",
                body={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 512,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if result.get("status") == 200:
                data = result.get("data", {})
                content_blocks = data.get("content", [])
                if content_blocks:
                    content = content_blocks[0].get("text", "")
        except Exception as e:
            logger.warning(f"LLM call failed: {e}")

    # Fallback: template summary
    if not content:
        lines = [f"{greeting}! Here's your daily overview:"]
        lines.append(f"• {pending_tasks} pending task{'s' if pending_tasks != 1 else ''}")
        if upcoming_events:
            lines.append(f"• Next event: {upcoming_events[0].title} on {upcoming_events[0].event_date}")
        if upcoming_reminders:
            lines.append(f"• {len(upcoming_reminders)} upcoming reminder{'s' if len(upcoming_reminders) != 1 else ''}")
        if weather and weather.current_temp is not None:
            lines.append(f"• Weather: {weather_summary}")
        content = "\n".join(lines)

    briefing = db.query(DailyBriefing).first()
    if not briefing:
        briefing = DailyBriefing()
        db.add(briefing)
    briefing.content = content
    briefing.generated_at = datetime.utcnow()
    db.commit()
    db.refresh(briefing)
    logger.info("Daily briefing generated")
    return briefing.to_dict()


# ============================================================================
# UI Observation Routes (agent API — keep as-is)
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
