"""
Creator Command Center — API Routes

REST API for YouTube integration, integration status, and state management.
Uses the CraftBot integration bridge to make authenticated external API calls.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import AppState, YouTubeChannel, YouTubeVideo, UISnapshot, UIScreenshot, ContentAnalysis
from datetime import datetime
from fastapi import BackgroundTasks
import asyncio
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]

class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


# ============================================================================
# State Management (system routes)
# ============================================================================

@router.get("/state")
def get_state(db: Session = Depends(get_db)):
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.to_dict()

@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)):
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.to_dict()

@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)):
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
        state.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(state)
    return state.to_dict()

@router.delete("/state")
def clear_state(db: Session = Depends(get_db)):
    state = db.query(AppState).first()
    if state:
        state.data = {}
        state.updated_at = datetime.utcnow()
        db.commit()
    return {"status": "cleared"}

@router.post("/action")
def execute_action(req: ActionRequest, db: Session = Depends(get_db)):
    return {"status": "ok", "action": req.action, "result": None}


# ============================================================================
# UI Observation (system routes)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)):
    snapshot = db.query(UISnapshot).first()
    return snapshot.to_dict() if snapshot else {}

@router.post("/ui-snapshot")
def update_ui_snapshot(data: Dict[str, Any], db: Session = Depends(get_db)):
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)
    snapshot.html_structure = data.get("htmlStructure")
    snapshot.visible_text = data.get("visibleText", [])
    snapshot.input_values = data.get("inputValues", {})
    snapshot.component_state = data.get("componentState", {})
    snapshot.current_view = data.get("currentView")
    snapshot.viewport = data.get("viewport", {})
    snapshot.timestamp = datetime.utcnow()
    db.commit()
    return {"status": "ok"}

@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)):
    screenshot = db.query(UIScreenshot).first()
    return screenshot.to_dict() if screenshot else {}

@router.post("/ui-screenshot")
def update_ui_screenshot(data: Dict[str, Any], db: Session = Depends(get_db)):
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)
    screenshot.image_data = data.get("imageData")
    screenshot.width = data.get("width")
    screenshot.height = data.get("height")
    screenshot.timestamp = datetime.utcnow()
    db.commit()
    return {"status": "ok"}


# ============================================================================
# Integration Status
# ============================================================================

@router.get("/integrations/status")
async def get_integration_status():
    """Check which external integrations are connected."""
    from services.integration_client import integration

    if not integration.available:
        return {
            "bridgeAvailable": False,
            "integrations": [],
        }

    integrations = await integration.get_integrations()
    return {
        "bridgeAvailable": True,
        "integrations": integrations,
    }


# ============================================================================
# YouTube — Channel & Videos
# ============================================================================

@router.get("/youtube/channels")
def get_youtube_channels(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Get cached YouTube channels."""
    channels = db.query(YouTubeChannel).all()
    return [c.to_dict() for c in channels]


@router.get("/youtube/videos")
def get_youtube_videos(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Get cached YouTube videos."""
    videos = db.query(YouTubeVideo).order_by(YouTubeVideo.published_at.desc()).all()
    return [v.to_dict() for v in videos]


@router.post("/youtube/sync")
async def sync_youtube(db: Session = Depends(get_db)):
    """Pull latest data from YouTube API and cache locally."""
    from services.integration_client import integration

    if not integration.available:
        raise HTTPException(status_code=424, detail="Integration bridge not available")

    errors = []

    # Clear old cached data before syncing fresh
    db.query(YouTubeChannel).delete()
    db.query(YouTubeVideo).delete()
    db.commit()

    # 1. Sync channels
    channel_result = await integration.request(
        integration="google_workspace",
        method="GET",
        url="https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    )

    if channel_result.get("status") == 200:
        data = channel_result.get("data", {})
        items = data.get("items", []) if isinstance(data, dict) else []
        for item in items:
            snippet = item.get("snippet", {})
            stats = item.get("statistics", {})
            channel_id = item.get("id", "")

            existing = db.query(YouTubeChannel).filter(YouTubeChannel.channel_id == channel_id).first()
            if existing:
                existing.title = snippet.get("title", existing.title)
                existing.description = snippet.get("description", "")
                thumbs = snippet.get("thumbnails", {})
                existing.thumbnail_url = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default", {})).get("url", "")
                existing.subscriber_count = int(stats.get("subscriberCount", 0))
                existing.video_count = int(stats.get("videoCount", 0))
                existing.view_count = int(stats.get("viewCount", 0))
                existing.synced_at = datetime.utcnow()
            else:
                thumbs = snippet.get("thumbnails", {})
                channel = YouTubeChannel(
                    channel_id=channel_id,
                    title=snippet.get("title", ""),
                    description=snippet.get("description", ""),
                    thumbnail_url=(thumbs.get("high") or thumbs.get("medium") or thumbs.get("default", {})).get("url", ""),
                    subscriber_count=int(stats.get("subscriberCount", 0)),
                    video_count=int(stats.get("videoCount", 0)),
                    view_count=int(stats.get("viewCount", 0)),
                )
                db.add(channel)
        db.commit()
    else:
        errors.append(f"Channel sync failed: {channel_result.get('data', 'Unknown error')}")

    # 2. Sync recent videos — first get video IDs from search
    search_result = await integration.request(
        integration="google_workspace",
        method="GET",
        url="https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&order=date&maxResults=20",
    )

    if search_result.get("status") == 200:
        data = search_result.get("data", {})
        search_items = data.get("items", []) if isinstance(data, dict) else []
        video_ids = [item.get("id", {}).get("videoId", "") for item in search_items if item.get("id", {}).get("videoId")]

        if video_ids:
            # Get detailed stats for each video
            stats_result = await integration.request(
                integration="google_workspace",
                method="GET",
                url=f"https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id={','.join(video_ids)}",
            )

            if stats_result.get("status") == 200:
                stats_data = stats_result.get("data", {})
                video_items = stats_data.get("items", []) if isinstance(stats_data, dict) else []
                for item in video_items:
                    snippet = item.get("snippet", {})
                    stats = item.get("statistics", {})
                    content = item.get("contentDetails", {})
                    vid = item.get("id", "")

                    existing = db.query(YouTubeVideo).filter(YouTubeVideo.video_id == vid).first()
                    if existing:
                        existing.title = snippet.get("title", existing.title)
                        existing.description = snippet.get("description", "")[:500]
                        existing.thumbnail_url = snippet.get("thumbnails", {}).get("medium", {}).get("url", "")
                        existing.published_at = snippet.get("publishedAt", "")
                        existing.view_count = int(stats.get("viewCount", 0))
                        existing.like_count = int(stats.get("likeCount", 0))
                        existing.comment_count = int(stats.get("commentCount", 0))
                        existing.duration = content.get("duration", "")
                        existing.synced_at = datetime.utcnow()
                    else:
                        video = YouTubeVideo(
                            video_id=vid,
                            title=snippet.get("title", ""),
                            description=snippet.get("description", "")[:500],
                            thumbnail_url=snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                            published_at=snippet.get("publishedAt", ""),
                            view_count=int(stats.get("viewCount", 0)),
                            like_count=int(stats.get("likeCount", 0)),
                            comment_count=int(stats.get("commentCount", 0)),
                            duration=content.get("duration", ""),
                        )
                        db.add(video)
                db.commit()
            else:
                errors.append(f"Video stats failed: {stats_result.get('data', 'Unknown error')}")
    else:
        errors.append(f"Video search failed: {search_result.get('data', 'Unknown error')}")

    channels = db.query(YouTubeChannel).all()
    videos = db.query(YouTubeVideo).order_by(YouTubeVideo.published_at.desc()).all()

    return {
        "status": "ok" if not errors else "partial",
        "errors": errors,
        "channels": [c.to_dict() for c in channels],
        "videos": [v.to_dict() for v in videos],
        "syncedAt": datetime.utcnow().isoformat(),
    }


# ============================================================================
# Content Analysis
# ============================================================================

@router.post("/analysis/start")
async def start_analysis(db: Session = Depends(get_db)):
    """Start a new content analysis. Runs in the background."""
    from database import SessionLocal

    # Check if an analysis is already running
    running = db.query(ContentAnalysis).filter(ContentAnalysis.status == "running").first()
    if running:
        return {"status": "already_running", "analysisId": running.id, "progress": running.progress}

    analysis = ContentAnalysis(status="pending", progress=0, progress_message="Starting analysis...")
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    # Run in background
    from services.analysis_service import run_analysis
    asyncio.create_task(run_analysis(analysis.id, SessionLocal))

    return {"status": "started", "analysisId": analysis.id}


@router.get("/analysis/status/{analysis_id}")
def get_analysis_status(analysis_id: int, db: Session = Depends(get_db)):
    """Get progress of a running analysis."""
    analysis = db.query(ContentAnalysis).filter(ContentAnalysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {
        "id": analysis.id,
        "status": analysis.status,
        "progress": analysis.progress,
        "progressMessage": analysis.progress_message,
    }


@router.get("/analysis/latest")
def get_latest_analysis(db: Session = Depends(get_db)):
    """Get the most recent completed analysis."""
    analysis = db.query(ContentAnalysis).filter(
        ContentAnalysis.status == "completed"
    ).order_by(ContentAnalysis.completed_at.desc()).first()
    if not analysis:
        return None
    return analysis.to_dict()


@router.get("/analysis/{analysis_id}")
def get_analysis(analysis_id: int, db: Session = Depends(get_db)):
    """Get a specific analysis result."""
    analysis = db.query(ContentAnalysis).filter(ContentAnalysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.to_dict()
