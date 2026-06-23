"""
Email Manager Data Models

SQLAlchemy models for column configuration persistence.
Emails are fetched live from Gmail — not stored here.
"""

from sqlalchemy import Column as SAColumn, Integer, String, DateTime, Boolean, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any, List

Base = declarative_base()


class AppState(Base):
    """Flexible application state storage for generic key-value data."""
    __tablename__ = "app_state"

    id = SAColumn(Integer, primary_key=True, default=1)
    data = SAColumn(JSON, default=dict)
    created_at = SAColumn(DateTime, default=datetime.utcnow)
    updated_at = SAColumn(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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
    """UI state snapshot for agent observation."""
    __tablename__ = "ui_snapshot"

    id = SAColumn(Integer, primary_key=True, default=1)
    html_structure = SAColumn(Text, nullable=True)
    visible_text = SAColumn(JSON, default=list)
    input_values = SAColumn(JSON, default=dict)
    component_state = SAColumn(JSON, default=dict)
    current_view = SAColumn(String(255), nullable=True)
    viewport = SAColumn(JSON, default=dict)
    timestamp = SAColumn(DateTime, default=datetime.utcnow)

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
    """UI screenshot for agent visual observation."""
    __tablename__ = "ui_screenshot"

    id = SAColumn(Integer, primary_key=True, default=1)
    image_data = SAColumn(Text, nullable=True)
    width = SAColumn(Integer, nullable=True)
    height = SAColumn(Integer, nullable=True)
    timestamp = SAColumn(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "imageData": self.image_data,
            "width": self.width,
            "height": self.height,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class ColumnConfig(Base):
    """Email column configuration for the Kanban board.

    Columns are always 5: positions 0-3 are user-customizable,
    position 4 is the locked general inbox feed.
    """
    __tablename__ = "columns"

    id = SAColumn(Integer, primary_key=True, index=True)
    title = SAColumn(String(255), nullable=False)
    query = SAColumn(Text, nullable=False, default="")
    icon = SAColumn(String(50), nullable=False, default="📧")
    ai_instructions = SAColumn(Text, nullable=True, default="")
    ai_enabled = SAColumn(Boolean, default=False)
    position = SAColumn(Integer, nullable=False, default=0)
    is_general = SAColumn(Boolean, default=False)
    unread_count = SAColumn(Integer, default=0)
    created_at = SAColumn(DateTime, default=datetime.utcnow)
    updated_at = SAColumn(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "query": self.query,
            "icon": self.icon,
            "aiInstructions": self.ai_instructions or "",
            "aiEnabled": self.ai_enabled,
            "position": self.position,
            "isGeneral": self.is_general,
            "unreadCount": self.unread_count,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


DEFAULT_COLUMNS: List[Dict[str, Any]] = [
    {
        "title": "GitHub",
        "query": "from:notifications@github.com OR from:noreply@github.com",
        "icon": "🐙",
        "ai_instructions": "Summarize PRs, issues, and CI results. Highlight items where I am directly mentioned or requested as a reviewer.",
        "position": 0,
        "is_general": False,
    },
    {
        "title": "Social",
        "query": "category:social",
        "icon": "👥",
        "ai_instructions": "Summarize social notifications. Highlight any direct messages or mentions.",
        "position": 1,
        "is_general": False,
    },
    {
        "title": "Updates",
        "query": "category:updates",
        "icon": "🔔",
        "ai_instructions": "Summarize product updates, newsletters, and announcements. Highlight anything requiring action.",
        "position": 2,
        "is_general": False,
    },
    {
        "title": "Finance",
        "query": "from:paypal.com OR from:stripe.com OR invoice OR receipt OR bank",
        "icon": "💳",
        "ai_instructions": "Summarize financial transactions, invoices, and payment notifications. Flag anything over $100.",
        "position": 3,
        "is_general": False,
    },
    {
        "title": "Everything",
        "query": "in:inbox",
        "icon": "📧",
        "ai_instructions": "Give a brief overview of the latest emails in my inbox.",
        "position": 4,
        "is_general": True,
    },
]


def seed_default_columns(db) -> None:
    """Insert default column configs if the table is empty."""
    count = db.query(ColumnConfig).count()
    if count == 0:
        for col_data in DEFAULT_COLUMNS:
            col = ColumnConfig(**col_data)
            db.add(col)
        db.commit()
