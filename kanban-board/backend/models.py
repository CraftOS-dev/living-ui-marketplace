"""
Kanban Board Data Models

SQLAlchemy models for the Kanban board application.
Includes Board, BoardList, Card, Label, ChecklistItem models
plus framework models (AppState, UISnapshot, UIScreenshot).
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON, Float, ForeignKey, Table
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any, List

Base = declarative_base()

# Association table for many-to-many Card <-> Label
card_labels = Table(
    "card_labels",
    Base.metadata,
    Column("card_id", Integer, ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
    Column("label_id", Integer, ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True),
)


class Board(Base):
    __tablename__ = "boards"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    lists = relationship("BoardList", back_populates="board", cascade="all, delete-orphan",
                         order_by="BoardList.position")
    labels = relationship("Label", back_populates="board", cascade="all, delete-orphan")

    def to_dict(self, include_lists: bool = False, include_labels: bool = False) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_lists:
            result["lists"] = [lst.to_dict(include_cards=True) for lst in self.lists]
        if include_labels:
            result["labels"] = [lbl.to_dict() for lbl in self.labels]
        return result


class BoardList(Base):
    __tablename__ = "board_lists"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    board = relationship("Board", back_populates="lists")
    cards = relationship("Card", back_populates="board_list", cascade="all, delete-orphan",
                         order_by="Card.position")

    def to_dict(self, include_cards: bool = False) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "id": self.id,
            "boardId": self.board_id,
            "title": self.title,
            "position": self.position,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_cards:
            result["cards"] = [c.to_dict() for c in self.cards if not c.archived]
        return result


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("board_lists.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), default="none")
    due_date = Column(DateTime, nullable=True)
    position = Column(Integer, default=0)
    archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    board_list = relationship("BoardList", back_populates="cards")
    labels = relationship("Label", secondary=card_labels, back_populates="cards")
    checklist_items = relationship("ChecklistItem", back_populates="card", cascade="all, delete-orphan",
                                   order_by="ChecklistItem.position")

    def to_dict(self) -> Dict[str, Any]:
        checklist = self.checklist_items or []
        completed_count = sum(1 for item in checklist if item.completed)
        return {
            "id": self.id,
            "listId": self.list_id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority or "none",
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "position": self.position,
            "archived": self.archived,
            "labels": [lbl.to_dict() for lbl in (self.labels or [])],
            "checklistItems": [item.to_dict() for item in checklist],
            "checklistTotal": len(checklist),
            "checklistCompleted": completed_count,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Label(Base):
    __tablename__ = "labels"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    color = Column(String(7), nullable=False)

    board = relationship("Board", back_populates="labels")
    cards = relationship("Card", secondary=card_labels, back_populates="labels")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "boardId": self.board_id,
            "name": self.name,
            "color": self.color,
        }


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="CASCADE"), nullable=False)
    text = Column(String(500), nullable=False)
    completed = Column(Boolean, default=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    card = relationship("Card", back_populates="checklist_items")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "cardId": self.card_id,
            "text": self.text,
            "completed": self.completed,
            "position": self.position,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# Framework models (required by Living UI system)
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
