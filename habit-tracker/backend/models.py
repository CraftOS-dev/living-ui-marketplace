"""
Habit Tracker Data Models

Domain models:
- Category — optional grouping for habits.
- Habit — a tracked habit (binary / count / duration / negative).
- HabitEntry — one row per (habit, date) with the day's value and optional note.

Plus the template's AppState / UISnapshot / UIScreenshot / Item models which
are used by the standard Living UI agent endpoints.
"""

from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean, Text, JSON,
    Float, ForeignKey, Date, UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


# ============================================================================
# Habit Tracker domain models
# ============================================================================

HABIT_TYPES = ("binary", "count", "duration", "negative")


class Category(Base):
    """A user-defined grouping for habits (Health, Work, Mindfulness, ...)."""
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    color = Column(String(20), nullable=False, default="#737373")
    order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    habits = relationship(
        "Habit",
        back_populates="category",
        passive_deletes=True,
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "order": self.order,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Habit(Base):
    """A tracked habit. The 'type' drives which fields are meaningful."""
    __tablename__ = "habits"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(20), nullable=False, default="binary")
    target = Column(Float, nullable=True)
    unit = Column(String(40), nullable=True)
    color = Column(String(20), nullable=False, default="#737373")
    icon = Column(String(60), nullable=False, default="Circle")
    category_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    order = Column(Integer, nullable=False, default=0)
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category = relationship("Category", back_populates="habits")
    entries = relationship(
        "HabitEntry",
        back_populates="habit",
        cascade="all, delete-orphan",
    )

    def is_completed(self, value: float) -> bool:
        """Whether a given value satisfies this habit's target for one day."""
        if self.type in ("binary", "negative"):
            return (value or 0) > 0
        target = self.target or 0
        if target <= 0:
            return (value or 0) > 0
        return (value or 0) >= target

    def intensity(self, value: float) -> float:
        """Heatmap intensity 0..1 for a given value."""
        if value is None or value <= 0:
            return 0.0
        if self.type in ("binary", "negative"):
            return 1.0
        target = self.target or 0
        if target <= 0:
            return 1.0 if value > 0 else 0.0
        ratio = value / target
        if ratio >= 1:
            return 1.0
        return round(ratio, 4)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "type": self.type,
            "target": self.target,
            "unit": self.unit,
            "color": self.color,
            "icon": self.icon,
            "category_id": self.category_id,
            "categoryId": self.category_id,
            "order": self.order,
            "archived": self.archived,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class HabitEntry(Base):
    """One entry per (habit, date)."""
    __tablename__ = "habit_entries"
    __table_args__ = (
        UniqueConstraint("habit_id", "date", name="uq_habit_date"),
        Index("ix_habit_date", "habit_id", "date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    habit_id = Column(
        Integer,
        ForeignKey("habits.id", ondelete="CASCADE"),
        nullable=False,
    )
    date = Column(Date, nullable=False)
    value = Column(Float, nullable=False, default=0)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    habit = relationship("Habit", back_populates="entries")

    def to_dict(self) -> Dict[str, Any]:
        if self.habit is not None:
            completed = self.habit.is_completed(self.value or 0)
        else:
            completed = (self.value or 0) > 0
        return {
            "id": self.id,
            "habitId": self.habit_id,
            "date": self.date.isoformat() if self.date else None,
            "value": self.value or 0,
            "note": self.note,
            "completed": completed,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


# ============================================================================
# Living UI template models (kept for the standard agent endpoints)
# ============================================================================


class AppState(Base):
    """
    Flexible application state storage.

    Stores the entire app state as JSON, allowing any structure.
    This is the primary model used by the default state management.

    The agent should extend this with custom models for complex data needs.
    """
    __tablename__ = "app_state"

    id = Column(Integer, primary_key=True, default=1)
    data = Column(JSON, default=dict)  # Stores arbitrary state as JSON
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "id": self.id,
            "data": self.data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def update_data(self, updates: Dict[str, Any]) -> None:
        """Merge updates into existing data."""
        current = self.data or {}
        current.update(updates)
        self.data = current
        self.updated_at = datetime.utcnow()


# ============================================================================
# Example models for reference - Agent should customize these
# ============================================================================

class UISnapshot(Base):
    """
    UI state snapshot for agent observation.

    Frontend periodically posts UI state here.
    Agent can GET this to observe the UI without WebSocket.
    """
    __tablename__ = "ui_snapshot"

    id = Column(Integer, primary_key=True, default=1)
    html_structure = Column(Text, nullable=True)  # Simplified DOM structure
    visible_text = Column(JSON, default=list)  # Array of visible text content
    input_values = Column(JSON, default=dict)  # Form field values
    component_state = Column(JSON, default=dict)  # Registered component states
    current_view = Column(String(255), nullable=True)  # Current route/view
    viewport = Column(JSON, default=dict)  # Window dimensions, scroll position
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
    """
    UI screenshot for agent visual observation.

    Frontend captures and posts screenshot here.
    Agent can GET this to see the UI visually.
    """
    __tablename__ = "ui_screenshot"

    id = Column(Integer, primary_key=True, default=1)
    image_data = Column(Text, nullable=True)  # Base64 encoded PNG
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


class Item(Base):
    """
    Example model for list-based data (todos, notes, etc.)

    Customize or replace this model based on your Living UI needs.
    """
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    completed = Column(Boolean, default=False)
    order = Column(Integer, default=0)
    extra_data = Column(JSON, default=dict)  # Flexible extra data (avoid 'metadata' - reserved in SQLAlchemy)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "completed": self.completed,
            "order": self.order,
            "extraData": self.extra_data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
