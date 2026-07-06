"""
Living UI Data Models

SQLAlchemy models for data persistence.
Includes a flexible AppState model for storing arbitrary JSON state,
plus example Item model for reference.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


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


class Sheet(Base):
    """
    A single named spreadsheet (grid) in the workbook.

    The whole grid is stored as JSON so the backend stays a clean JSON API and
    remains the source of truth. Formula evaluation happens on read/write via
    ``formula.evaluate_sheet`` (see routes.py).

    - ``columns``: ordered list of ``{"name", "type", "width"}``. A column's
      position is its spreadsheet letter (0 -> "A", 1 -> "B", ...).
    - ``cells``: map of A1 ref -> ``{"raw": <str>, "format": {...}}`` for every
      non-empty cell. ``raw`` holds the literal value or a ``=`` formula.
    """
    __tablename__ = "sheets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, default="Sheet 1")
    columns = Column(JSON, default=list)  # [{name, type, width}, ...]
    num_rows = Column(Integer, default=30)
    cells = Column(JSON, default=dict)  # {"A1": {"raw": "...", "format": {...}}}
    row_heights = Column(JSON, default=dict)  # {"3": 42, ...} row index (str) -> px height
    position = Column(Integer, default=0)  # tab order
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "columns": self.columns or [],
            "numRows": self.num_rows if self.num_rows is not None else 0,
            "cells": self.cells or {},
            "rowHeights": self.row_heights or {},
            "position": self.position or 0,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def summary(self) -> Dict[str, Any]:
        """Lightweight representation for the sheet list / tab bar."""
        return {
            "id": self.id,
            "name": self.name,
            "numCols": len(self.columns or []),
            "numRows": self.num_rows if self.num_rows is not None else 0,
            "position": self.position or 0,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
