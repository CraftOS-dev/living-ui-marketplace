"""
Creator Command Center — Data Models

Caches data from external platforms (YouTube, Discord, Twitter, Notion)
so the UI loads instantly from SQLite, with a Sync button to refresh from live APIs.
"""

from sqlalchemy import Column, Integer, String, DateTime, Text, JSON, Float
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


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


# ============================================================
# YouTube — cached channel and video data
# ============================================================

class YouTubeChannel(Base):
    __tablename__ = "youtube_channels"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(String(255), unique=True, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    thumbnail_url = Column(String(500), default="")
    subscriber_count = Column(Integer, default=0)
    video_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    synced_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "channelId": self.channel_id,
            "title": self.title,
            "description": self.description,
            "thumbnailUrl": self.thumbnail_url,
            "subscriberCount": self.subscriber_count,
            "videoCount": self.video_count,
            "viewCount": self.view_count,
            "syncedAt": self.synced_at.isoformat() if self.synced_at else None,
        }


class YouTubeVideo(Base):
    __tablename__ = "youtube_videos"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(String(255), unique=True, nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, default="")
    thumbnail_url = Column(String(500), default="")
    published_at = Column(String(100), default="")
    view_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    duration = Column(String(50), default="")
    synced_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "videoId": self.video_id,
            "title": self.title,
            "description": self.description,
            "thumbnailUrl": self.thumbnail_url,
            "publishedAt": self.published_at,
            "viewCount": self.view_count,
            "likeCount": self.like_count,
            "commentCount": self.comment_count,
            "duration": self.duration,
            "syncedAt": self.synced_at.isoformat() if self.synced_at else None,
        }


# ============================================================
# Content Analysis
# ============================================================

class ContentAnalysis(Base):
    __tablename__ = "content_analyses"

    id = Column(Integer, primary_key=True, index=True)
    analysis_type = Column(String(50), default="full")
    status = Column(String(20), default="pending")  # pending, running, completed, failed
    progress = Column(Integer, default=0)
    progress_message = Column(String(255), default="")
    report_json = Column(JSON, default=dict)
    summary = Column(Text, default="")
    recommendations = Column(JSON, default=list)
    todos = Column(JSON, default=list)
    content_ideas = Column(JSON, default=list)
    video_count_analyzed = Column(Integer, default=0)
    video_metrics_snapshot = Column(JSON, default=dict)  # {video_id: {title, views, likes, comments, engagement_rate}}
    error_message = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "analysisType": self.analysis_type,
            "status": self.status,
            "progress": self.progress,
            "progressMessage": self.progress_message,
            "report": self.report_json or {},
            "summary": self.summary or "",
            "recommendations": self.recommendations or [],
            "todos": self.todos or [],
            "contentIdeas": self.content_ideas or [],
            "videoCountAnalyzed": self.video_count_analyzed,
            "videoMetricsSnapshot": self.video_metrics_snapshot or {},
            "errorMessage": self.error_message or "",
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }


class VideoTranscript(Base):
    __tablename__ = "video_transcripts"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(String(255), unique=True, nullable=False)
    transcript_text = Column(Text, default="")
    language = Column(String(10), default="en")
    is_auto_generated = Column(Integer, default=0)
    fetched_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "videoId": self.video_id,
            "transcriptText": self.transcript_text or "",
            "language": self.language,
            "isAutoGenerated": bool(self.is_auto_generated),
            "fetchedAt": self.fetched_at.isoformat() if self.fetched_at else None,
        }


class ThumbnailAnalysis(Base):
    __tablename__ = "thumbnail_analyses"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(String(255), unique=True, nullable=False)
    analysis_text = Column(Text, default="")
    analyzed_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "videoId": self.video_id,
            "analysisText": self.analysis_text or "",
            "analyzedAt": self.analyzed_at.isoformat() if self.analyzed_at else None,
        }
