"""
Living UI Data Models

SQLAlchemy models for data persistence.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON, Float
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


class AppState(Base):
    """
    Flexible application state storage.
    Stores the entire app state as JSON.
    """
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
    """
    UI state snapshot for agent observation.
    """
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
    """
    UI screenshot for agent visual observation.
    """
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


class BoardItem(Base):
    """
    A board item on the Research canvas.

    Supports multiple types: image, video, youtube, doc, note.
    Each item has a canvas position (x, y) for free-form placement.
    """
    __tablename__ = "board_items"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(50), nullable=False)  # image, video, youtube, doc, note
    title = Column(String(255), nullable=False)
    x = Column(Float, default=0.0)  # Canvas X position
    y = Column(Float, default=0.0)  # Canvas Y position
    content = Column(Text, nullable=True)   # For notes: body text
    url = Column(Text, nullable=True)       # For URL-based items
    file_path = Column(Text, nullable=True) # For uploaded files
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "x": self.x or 0.0,
            "y": self.y or 0.0,
            "content": self.content,
            "url": self.url,
            "filePath": self.file_path,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Connection(Base):
    """
    A connection (edge) between two board items.
    Displayed as a red straight line on the canvas.
    """
    __tablename__ = "connections"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, nullable=False)  # Source BoardItem id
    target_id = Column(Integer, nullable=False)  # Target BoardItem id
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sourceId": self.source_id,
            "targetId": self.target_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# Keep Item for backward compatibility with existing routes
class Item(Base):
    """
    Legacy item model - kept for backward compatibility.
    """
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    completed = Column(Boolean, default=False)
    order = Column(Integer, default=0)
    extra_data = Column(JSON, default=dict)
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
