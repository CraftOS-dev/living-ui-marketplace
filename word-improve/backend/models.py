"""
Word Improve Data Models

SQLAlchemy models. The new shape is:

- Session       : input text + mode + auto-generated title + compiled output
- SessionVariant: one *whole-text* LLM rewrite of the session input
                  (we generate N of these in a single LLM call)
- MergeSegment  : one row of the git-style merge view. Each segment holds the
                  candidate texts (one per source: original + each variant) for
                  one sentence position, plus the user's selection.

Plus the template-provided agent observation models (AppState / UISnapshot /
UIScreenshot) and the LLM response cache.
"""

from sqlalchemy import Column, Integer, String, DateTime, Text, JSON, ForeignKey
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


# ============================================================================
# Template-provided agent observation models
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


# ============================================================================
# Word Improve domain
# ============================================================================

class Session(Base):
    """One improvement run."""
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=True)
    original_text = Column(Text, nullable=False, default="")
    mode = Column(String(32), default="improve")
    tone = Column(String(32), nullable=True)
    custom_instruction = Column(Text, nullable=True)
    variant_count = Column(Integer, default=3)
    compiled_text = Column(Text, nullable=True)
    status = Column(String(32), default="draft")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    variants = relationship(
        "SessionVariant",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionVariant.idx",
    )
    segments = relationship(
        "MergeSegment",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="MergeSegment.position",
    )

    def to_summary(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title or self._fallback_title(),
            "mode": self.mode or "improve",
            "tone": self.tone,
            "variantCount": self.variant_count or 3,
            "status": self.status or "draft",
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_detail(self) -> Dict[str, Any]:
        return {
            **self.to_summary(),
            "originalText": self.original_text or "",
            "customInstruction": self.custom_instruction,
            "compiledText": self.compiled_text,
            "variants": [v.to_dict() for v in self.variants],
            "segments": [s.to_dict() for s in self.segments],
        }

    def _fallback_title(self) -> str:
        text = (self.original_text or "").strip()
        if not text:
            return f"Untitled session #{self.id}"
        first = text.split("\n", 1)[0].strip()
        return (first[:48] + "…") if len(first) > 48 else first


class SessionVariant(Base):
    """One whole-text LLM rewrite of a session."""
    __tablename__ = "session_variants"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        Integer,
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    idx = Column(Integer, default=0)
    text = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("Session", back_populates="variants")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "idx": self.idx or 0,
            "text": self.text or "",
        }


class MergeSegment(Base):
    """One sentence-position row of the git-style merge view.

    ``choices`` is a JSON list ``[{"source": "original" | "variant_<i>", "text": "..."}]``
    (length = 1 + variant_count). ``selection`` is the index into ``choices`` of
    the user's pick. ``kind`` is ``"auto"`` if all non-empty texts agree (no
    conflict — auto-resolved) or ``"conflict"`` if they differ.
    """
    __tablename__ = "merge_segments"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        Integer,
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position = Column(Integer, default=0)
    kind = Column(String(16), default="conflict")
    choices = Column(JSON, default=list)
    selection = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("Session", back_populates="segments")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "position": self.position or 0,
            "kind": self.kind or "conflict",
            "choices": self.choices or [],
            "selection": self.selection,
        }


class LLMCache(Base):
    __tablename__ = "llm_cache"

    id = Column(Integer, primary_key=True, index=True)
    cache_key = Column(String(64), unique=True, index=True, nullable=False)
    content = Column(JSON, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "cacheKey": self.cache_key,
            "content": self.content,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
        }
