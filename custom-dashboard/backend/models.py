"""
Personal Dashboard — SQLAlchemy models.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON, Float
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


# ============================================================================
# Dashboard models
# ============================================================================

class WidgetConfig(Base):
    """Per-widget configuration: enabled state, display order, widget-specific settings."""
    __tablename__ = "widget_configs"

    id = Column(Integer, primary_key=True, index=True)
    widget_id = Column(String(50), nullable=False, unique=True)
    enabled = Column(Boolean, default=True)
    position = Column(Integer, default=0)
    widget_settings = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "widgetId": self.widget_id,
            "enabled": self.enabled,
            "position": self.position,
            "widgetSettings": self.widget_settings or {},
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class WeatherCache(Base):
    """Cached weather data from Open-Meteo (refreshed every 30 min)."""
    __tablename__ = "weather_cache"

    id = Column(Integer, primary_key=True, default=1)
    city_name = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    current_temp = Column(Float, nullable=True)
    weather_code = Column(Integer, nullable=True)
    apparent_temp = Column(Float, nullable=True)
    temp_high = Column(Float, nullable=True)
    temp_low = Column(Float, nullable=True)
    forecast = Column(JSON, default=list)
    fetched_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cityName": self.city_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "currentTemp": self.current_temp,
            "weatherCode": self.weather_code,
            "apparentTemp": self.apparent_temp,
            "tempHigh": self.temp_high,
            "tempLow": self.temp_low,
            "forecast": self.forecast or [],
            "fetchedAt": self.fetched_at.isoformat() if self.fetched_at else None,
        }


class CalendarEvent(Base):
    """User-created calendar events."""
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    event_date = Column(String(10), nullable=False)   # YYYY-MM-DD
    start_time = Column(String(5), nullable=True)     # HH:MM
    end_time = Column(String(5), nullable=True)       # HH:MM
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "eventDate": self.event_date,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "description": self.description,
            "color": self.color,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Task(Base):
    """To-do list tasks."""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    completed = Column(Boolean, default=False)
    priority = Column(String(10), default="none")
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "completed": self.completed,
            "priority": self.priority or "none",
            "position": self.position,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Note(Base):
    """Quick notes / scratchpad entries."""
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    content = Column(Text, default="")
    pinned = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content or "",
            "pinned": self.pinned,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Reminder(Base):
    """Timed reminders with optional due date and time."""
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    due_date = Column(String(10), nullable=True)   # YYYY-MM-DD
    due_time = Column(String(5), nullable=True)    # HH:MM
    completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "dueDate": self.due_date,
            "dueTime": self.due_time,
            "completed": self.completed,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class DailyBriefing(Base):
    """Last AI-generated daily briefing (singleton row)."""
    __tablename__ = "daily_briefings"

    id = Column(Integer, primary_key=True, default=1)
    content = Column(Text, nullable=True)
    generated_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "content": self.content,
            "generatedAt": self.generated_at.isoformat() if self.generated_at else None,
        }


# ============================================================================
# Framework models (required by Living UI system — do not remove)
# ============================================================================

class AppState(Base):
    __tablename__ = "app_state"

    id = Column(Integer, primary_key=True, default=1)
    data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "data": self.data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def update_data(self, updates: Dict[str, Any]) -> None:
        current = self.data or {}
        current.update(updates)
        self.data = current
        self.updated_at = datetime.utcnow()


class UISnapshot(Base):
    __tablename__ = "ui_snapshot"

    id = Column(Integer, primary_key=True, default=1)
    html_structure = Column(Text, nullable=True)
    visible_text = Column(JSON, default=list)
    input_values = Column(JSON, default=dict)
    component_state = Column(JSON, default=dict)
    current_view = Column(String(255), nullable=True)
    viewport = Column(JSON, default=dict)
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "htmlStructure": self.html_structure,
            "visibleText": self.visible_text or [],
            "inputValues": self.input_values or {},
            "componentState": self.component_state or {},
            "currentView": self.current_view,
            "viewport": self.viewport or {},
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class UIScreenshot(Base):
    __tablename__ = "ui_screenshot"

    id = Column(Integer, primary_key=True, default=1)
    image_data = Column(Text, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "imageData": self.image_data,
            "width": self.width,
            "height": self.height,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }
