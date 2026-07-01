"""
Living UI Data Models

SQLAlchemy models for data persistence.
Includes a flexible AppState model for storing arbitrary JSON state,
plus Social Media Manager specific models.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


class AppState(Base):
    """
    Flexible application state storage.

    Stores the entire app state as JSON, allowing any structure.
    This is the primary model used by the default state management.
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


class UISnapshot(Base):
    """
    UI state snapshot for agent observation.

    Frontend periodically posts UI state here.
    Agent can GET this to observe the UI without WebSocket.
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


# ============================================================================
# Social Media Manager Models
# ============================================================================

class Post(Base):
    __tablename__ = "posts"

    id               = Column(Integer, primary_key=True, index=True)
    # global_content is the base text. per-platform overrides stored in extra_data["overrides"]
    global_content   = Column(Text, nullable=False, default="")
    platform         = Column(String(30), nullable=False, index=True)
    # "twitter" | "linkedin" | "google_youtube"
    status           = Column(String(20), nullable=False, default="draft", index=True)
    # "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled"
    scheduled_at     = Column(DateTime, nullable=True, index=True)
    published_at     = Column(DateTime, nullable=True)
    platform_post_id = Column(String(255), nullable=True)
    error_message    = Column(Text, nullable=True)
    retry_count      = Column(Integer, default=0, nullable=False)
    media_urls       = Column(JSON, default=list)
    # extra_data: {"overrides": {"twitter": "...", "linkedin": "..."}}
    extra_data       = Column(JSON, default=dict)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    analytics = relationship("PostAnalytics", back_populates="post", cascade="all, delete-orphan", uselist=False)

    def effective_content(self) -> str:
        """Return platform-specific override if set, else global_content."""
        overrides = (self.extra_data or {}).get("overrides", {})
        return overrides.get(self.platform) or self.global_content

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "globalContent": self.global_content,
            "platform": self.platform,
            "status": self.status,
            "scheduledAt": self.scheduled_at.isoformat() if self.scheduled_at else None,
            "publishedAt": self.published_at.isoformat() if self.published_at else None,
            "platformPostId": self.platform_post_id,
            "errorMessage": self.error_message,
            "retryCount": self.retry_count,
            "mediaUrls": self.media_urls or [],
            "extraData": self.extra_data or {},
            "effectiveContent": self.effective_content(),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class PostAnalytics(Base):
    __tablename__ = "post_analytics"

    id          = Column(Integer, primary_key=True, index=True)
    post_id     = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    impressions = Column(Integer, default=0, nullable=False)
    likes       = Column(Integer, default=0, nullable=False)
    comments    = Column(Integer, default=0, nullable=False)
    shares      = Column(Integer, default=0, nullable=False)
    clicks      = Column(Integer, default=0, nullable=False)
    fetched_at  = Column(DateTime, nullable=True)
    raw_data    = Column(JSON, default=dict)

    post = relationship("Post", back_populates="analytics")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "postId": self.post_id,
            "impressions": self.impressions or 0,
            "likes": self.likes or 0,
            "comments": self.comments or 0,
            "shares": self.shares or 0,
            "clicks": self.clicks or 0,
            "fetchedAt": self.fetched_at.isoformat() if self.fetched_at else None,
            "rawData": self.raw_data or {},
        }


class PlatformAccount(Base):
    __tablename__ = "platform_accounts"

    id             = Column(Integer, primary_key=True, index=True)
    platform       = Column(String(30), nullable=False, unique=True, index=True)
    account_id     = Column(String(255), nullable=False, default="")
    display_name   = Column(String(255), nullable=False, default="")
    username       = Column(String(255), nullable=True)
    profile_url    = Column(String(500), nullable=True)
    avatar_url     = Column(String(500), nullable=True)
    follower_count = Column(Integer, default=0, nullable=False)
    # extra_data: {"author_urn": "urn:li:person:ABC"} for LinkedIn
    extra_data     = Column(JSON, default=dict)
    synced_at      = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "platform": self.platform,
            "accountId": self.account_id,
            "displayName": self.display_name,
            "username": self.username,
            "profileUrl": self.profile_url,
            "avatarUrl": self.avatar_url,
            "followerCount": self.follower_count or 0,
            "extraData": self.extra_data or {},
            "syncedAt": self.synced_at.isoformat() if self.synced_at else None,
        }


class Idea(Base):
    __tablename__ = "ideas"
    id         = Column(Integer, primary_key=True, index=True)
    title      = Column(String(255), nullable=True)
    content    = Column(Text, default="")
    platform   = Column(String(30), nullable=True)
    tags       = Column(JSON, default=list)
    source     = Column(String(50), default="manual")
    status     = Column(String(20), default="idea")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "platform": self.platform,
            "tags": self.tags or [],
            "source": self.source,
            "status": self.status,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class HashtagSet(Base):
    __tablename__ = "hashtag_sets"
    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(255), default="")
    platform   = Column(String(30), nullable=True)
    tags       = Column(JSON, default=list)
    use_count  = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "platform": self.platform,
            "tags": self.tags or [],
            "useCount": self.use_count,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
