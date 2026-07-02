"""
Living UI API Routes

REST API endpoints for state management and data operations.
Provides both generic state storage and Social Media Manager specific routes.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional, Literal
from database import get_db, SessionLocal
from models import AppState, UISnapshot, UIScreenshot, Post, PostAnalytics, PlatformAccount
from datetime import datetime
import logging
import base64
import os
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================================================================
# Pydantic Schemas — Social Media Manager
# ============================================================================

Platform = Literal["twitter", "linkedin", "google_youtube"]
PostStatus = Literal["draft", "scheduled", "publishing", "published", "failed", "cancelled"]


class PostCreate(BaseModel):
    globalContent: str = ""
    platform: Platform
    status: PostStatus = "draft"
    scheduledAt: Optional[str] = None   # ISO 8601
    mediaUrls: Optional[List[str]] = None
    extraData: Optional[Dict[str, Any]] = None  # {"overrides": {"twitter": "..."}}


class PostUpdate(BaseModel):
    globalContent: Optional[str] = None
    status: Optional[PostStatus] = None
    scheduledAt: Optional[str] = None
    mediaUrls: Optional[List[str]] = None
    extraData: Optional[Dict[str, Any]] = None


class ScheduleRequest(BaseModel):
    scheduledAt: str  # ISO 8601


class CaptionRequest(BaseModel):
    platform: Platform
    topic: str
    tone: Literal["professional", "casual", "playful", "persuasive", "informative"] = "casual"
    keywords: Optional[List[str]] = None


class HookRequest(BaseModel):
    topic: str
    description: Optional[str] = None
    platform: Platform
    audience: str = "general audience"
    tone: Literal["professional", "casual", "playful", "persuasive", "edgy"] = "casual"
    goal: Literal["grow_followers", "drive_clicks", "drive_dms", "increase_saves", "spark_debate"] = "grow_followers"
    count: int = Field(default=5, ge=3, le=7)


class PostRequest(BaseModel):
    topic: str
    hook: str
    description: Optional[str] = None
    platform: Platform
    audience: str = "general audience"
    tone: Literal["professional", "casual", "playful", "persuasive", "edgy"] = "casual"
    goal: Literal["grow_followers", "drive_clicks", "drive_dms", "increase_saves", "spark_debate"] = "grow_followers"


class HumanizeRequest(BaseModel):
    text: str
    platform: Platform
    tone: Literal["professional", "casual", "playful", "persuasive", "informative"] = "casual"


class InsightsRequest(BaseModel):
    platform: Platform
    post_id: str
    max_comments: int = Field(default=100, ge=10, le=200)


class IdeaCreate(BaseModel):
    content: str
    title: Optional[str] = None
    platform: Optional[Platform] = None
    tags: List[str] = []
    source: str = "manual"


class IdeaUpdate(BaseModel):
    content: Optional[str] = None
    title: Optional[str] = None
    platform: Optional[Platform] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None


class HashtagSetCreate(BaseModel):
    name: str
    platform: Optional[Platform] = None
    tags: List[str] = []


class HashtagSetUpdate(BaseModel):
    name: Optional[str] = None
    platform: Optional[Platform] = None
    tags: Optional[List[str]] = None
    incrementUseCount: bool = False


# ============================================================================
# Template State Management Routes (keep verbatim)
# ============================================================================

class StateUpdate(BaseModel):
    """Schema for updating app state."""
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    """Schema for executing an action."""
    action: str
    payload: Optional[Dict[str, Any]] = None


class UISnapshotUpdate(BaseModel):
    """Schema for updating UI snapshot."""
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    """Schema for updating UI screenshot."""
    imageData: str  # Base64 encoded PNG
    width: Optional[int] = None
    height: Optional[int] = None


@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    logger.info(f"[Routes] State updated: {list(update.data.keys())}")
    return state.data or {}


@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
    db.commit()
    db.refresh(state)
    logger.info("[Routes] State replaced")
    return state.data or {}


@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    logger.info("[Routes] State cleared")
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    payload = request.payload or {}
    logger.info(f"[Routes] Executing action: {action}")
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}
    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    elif action == "increment":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) + 1
        state.data = current_data
        db.commit()
        return {"status": "incremented", "data": current_data}
    elif action == "decrement":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) - 1
        state.data = current_data
        db.commit()
        return {"status": "decremented", "data": current_data}
    else:
        logger.warning(f"[Routes] Unknown action: {action}")
        return {"status": "unknown_action", "action": action, "data": current_data}


@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None,
            "visibleText": [],
            "inputValues": {},
            "componentState": {},
            "currentView": None,
            "viewport": {},
            "timestamp": None,
            "status": "no_snapshot"
        }
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)
    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport
    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    logger.info("[Routes] UI snapshot updated")
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {
            "imageData": None,
            "width": None,
            "height": None,
            "timestamp": None,
            "status": "no_screenshot"
        }
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)
    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(screenshot)
    logger.info(f"[Routes] UI screenshot updated ({data.width}x{data.height})")
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}


# ============================================================================
# Integration & Accounts
# ============================================================================

@router.get("/integrations/status")
async def get_integrations_status() -> Dict[str, Any]:
    from services.integration_client import integration
    all_integrations = await integration.get_integrations()
    platform_ids = {"twitter", "linkedin", "google_youtube"}
    platform_status: Dict[str, bool] = {p: False for p in platform_ids}
    bridge_available = integration.available
    for item in all_integrations:
        pid = item.get("id", "")
        if pid in platform_ids:
            platform_status[pid] = item.get("connected", False) and item.get("granted", False)
    return {
        "bridgeAvailable": bridge_available,
        "platforms": platform_status,
    }


@router.post("/accounts/sync")
async def sync_accounts(db: Session = Depends(get_db)) -> Dict[str, Any]:
    from services.integration_client import integration
    if not integration.available:
        return {"synced": [], "accounts": [], "error": "Bridge not available"}

    synced = []
    for platform in ["twitter", "linkedin", "google_youtube"]:
        try:
            if platform == "twitter":
                result = await integration.request(
                    integration="twitter",
                    method="GET",
                    url="https://api.twitter.com/2/users/me?user.fields=public_metrics,profile_image_url",
                )
                if result.get("status") == 200:
                    data = (result.get("data") or {}).get("data", {})
                    acct = db.query(PlatformAccount).filter(PlatformAccount.platform == "twitter").first()
                    if not acct:
                        acct = PlatformAccount(platform="twitter")
                        db.add(acct)
                    acct.account_id = str(data.get("id", ""))
                    acct.display_name = data.get("name", "")
                    acct.username = data.get("username", "")
                    acct.avatar_url = data.get("profile_image_url")
                    acct.follower_count = (data.get("public_metrics") or {}).get("followers_count", 0)
                    acct.synced_at = datetime.utcnow()
                    db.commit()
                    synced.append("twitter")

            elif platform == "linkedin":
                result = await integration.request(
                    integration="linkedin",
                    method="GET",
                    url="https://api.linkedin.com/v2/userinfo",
                )
                if result.get("status") == 200:
                    data = result.get("data") or {}
                    sub = data.get("sub", "")
                    acct = db.query(PlatformAccount).filter(PlatformAccount.platform == "linkedin").first()
                    if not acct:
                        acct = PlatformAccount(platform="linkedin")
                        db.add(acct)
                    acct.account_id = str(sub)
                    acct.display_name = data.get("name", "")
                    acct.username = data.get("email")
                    acct.avatar_url = data.get("picture")
                    acct.extra_data = {"author_urn": f"urn:li:person:{sub}"}
                    acct.synced_at = datetime.utcnow()
                    db.commit()
                    synced.append("linkedin")

            elif platform == "google_youtube":
                result = await integration.request(
                    integration="google_youtube",
                    method="GET",
                    url="https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
                )
                if result.get("status") == 200:
                    items = ((result.get("data") or {}).get("items") or [])
                    if items:
                        ch = items[0]
                        snippet = ch.get("snippet", {})
                        stats = ch.get("statistics", {})
                        acct = db.query(PlatformAccount).filter(PlatformAccount.platform == "google_youtube").first()
                        if not acct:
                            acct = PlatformAccount(platform="google_youtube")
                            db.add(acct)
                        acct.account_id = str(ch.get("id", ""))
                        acct.display_name = snippet.get("title", "")
                        acct.username = snippet.get("customUrl")
                        acct.avatar_url = (snippet.get("thumbnails") or {}).get("default", {}).get("url")
                        acct.follower_count = int(stats.get("subscriberCount", 0) or 0)
                        acct.synced_at = datetime.utcnow()
                        db.commit()
                        synced.append("google_youtube")
        except Exception as e:
            logger.warning("[Routes] sync_accounts failed for %s: %s", platform, e)

    accounts = [a.to_dict() for a in db.query(PlatformAccount).all()]
    return {"synced": synced, "accounts": accounts}


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    accounts = db.query(PlatformAccount).all()
    return [a.to_dict() for a in accounts]


# ============================================================================
# Posts CRUD
# ============================================================================

def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


@router.get("/posts")
def list_posts(
    platform: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    q = db.query(Post)
    if platform:
        q = q.filter(Post.platform == platform)
    if status:
        q = q.filter(Post.status == status)
    posts = q.order_by(Post.created_at.desc()).all()
    return [p.to_dict() for p in posts]


@router.post("/posts")
def create_post(data: PostCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    post = Post(
        global_content=data.globalContent,
        platform=data.platform,
        status=data.status,
        scheduled_at=_parse_dt(data.scheduledAt),
        media_urls=data.mediaUrls or [],
        extra_data=data.extraData or {},
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    logger.info("[Routes] Created post %s on %s", post.id, post.platform)
    return post.to_dict()


@router.get("/posts/{post_id}")
def get_post(post_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"post": None, "analytics": None}
    analytics = db.query(PostAnalytics).filter(PostAnalytics.post_id == post_id).first()
    return {
        "post": post.to_dict(),
        "analytics": analytics.to_dict() if analytics else None,
    }


@router.put("/posts/{post_id}")
def update_post(post_id: int, data: PostUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"status": "not_found"}
    if data.globalContent is not None:
        post.global_content = data.globalContent
    if data.status is not None:
        post.status = data.status
    if data.scheduledAt is not None:
        post.scheduled_at = _parse_dt(data.scheduledAt)
    if data.mediaUrls is not None:
        post.media_urls = data.mediaUrls
    if data.extraData is not None:
        post.extra_data = data.extraData
    post.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(post)
    logger.info("[Routes] Updated post %s", post_id)
    return post.to_dict()


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"status": "not_found"}
    db.delete(post)
    db.commit()
    logger.info("[Routes] Deleted post %s", post_id)
    return {"status": "deleted"}


# ============================================================================
# Post Actions
# ============================================================================

@router.post("/posts/{post_id}/schedule")
def schedule_post(post_id: int, data: ScheduleRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"status": "not_found"}
    post.scheduled_at = _parse_dt(data.scheduledAt)
    post.status = "scheduled"
    post.retry_count = 0
    db.commit()
    db.refresh(post)
    logger.info("[Routes] Scheduled post %s for %s", post_id, data.scheduledAt)
    return post.to_dict()


@router.post("/posts/{post_id}/publish-now")
async def publish_now(post_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from services.publish_service import publish_post
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"status": "error", "message": f"Post {post_id} not found"}
    try:
        result = await publish_post(post)
        post.status = "published"
        post.published_at = datetime.utcnow()
        post.platform_post_id = result.get("platform_post_id")
        post.error_message = None
        db.commit()
        db.refresh(post)
        logger.info("[Routes] Published post %s now on %s", post_id, post.platform)
        return {"status": "ok", "post": post.to_dict()}
    except Exception as e:
        logger.warning("[Routes] publish_now failed for post %s: %s", post_id, e)
        return {"status": "error", "message": str(e)}


@router.post("/posts/{post_id}/cancel")
def cancel_post(post_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"status": "not_found"}
    post.status = "cancelled"
    post.scheduled_at = None
    post.retry_count = 0
    db.commit()
    db.refresh(post)
    logger.info("[Routes] Cancelled post %s", post_id)
    return post.to_dict()


# ============================================================================
# Queue & Calendar
# ============================================================================

@router.get("/queue")
def get_queue(limit: int = 50, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    posts = (
        db.query(Post)
        .filter(Post.status.in_(["scheduled", "publishing"]))
        .order_by(Post.scheduled_at.asc())
        .limit(limit)
        .all()
    )
    return [p.to_dict() for p in posts]


@router.get("/calendar")
def get_calendar(year: int, month: int, db: Session = Depends(get_db)) -> Dict[str, List[Dict[str, Any]]]:
    # Get all posts whose scheduled_at OR published_at falls in the given month
    all_posts = db.query(Post).all()
    result: Dict[str, List[Dict[str, Any]]] = {}
    for post in all_posts:
        dt = post.scheduled_at or post.published_at
        if dt and dt.year == year and dt.month == month:
            day_key = dt.strftime("%Y-%m-%d")
            if day_key not in result:
                result[day_key] = []
            result[day_key].append(post.to_dict())
    return result


# ============================================================================
# Analytics
# ============================================================================

@router.get("/analytics/summary")
def analytics_summary(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    platforms = ["twitter", "linkedin", "google_youtube"]
    summary = []
    for platform in platforms:
        posts = db.query(Post).filter(Post.platform == platform, Post.status == "published").all()
        total_posts = len(posts)
        totals = {"impressions": 0, "likes": 0, "comments": 0, "shares": 0}
        for post in posts:
            if post.analytics:
                totals["impressions"] += post.analytics.impressions or 0
                totals["likes"] += post.analytics.likes or 0
                totals["comments"] += post.analytics.comments or 0
                totals["shares"] += post.analytics.shares or 0
        summary.append({
            "platform": platform,
            "totalPosts": total_posts,
            "totalImpressions": totals["impressions"],
            "totalLikes": totals["likes"],
            "totalComments": totals["comments"],
            "totalShares": totals["shares"],
        })
    return summary


@router.post("/posts/{post_id}/analytics/sync")
async def sync_post_analytics(post_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from services.integration_client import integration
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        return {"status": "unavailable", "message": "Post not found"}
    if not integration.available:
        return {"status": "unavailable", "message": "Bridge not available"}

    try:
        # Fetch analytics from platform
        platform_post_id = post.platform_post_id or ""
        if post.platform == "twitter" and platform_post_id:
            result = await integration.request(
                integration="twitter",
                method="GET",
                url=f"https://api.twitter.com/2/tweets/{platform_post_id}?tweet.fields=public_metrics",
            )
            metrics = {}
            if result.get("status") == 200:
                metrics = (result.get("data") or {}).get("data", {}).get("public_metrics", {})
            analytics_data = {
                "impressions": metrics.get("impression_count", 0),
                "likes": metrics.get("like_count", 0),
                "comments": metrics.get("reply_count", 0),
                "shares": metrics.get("retweet_count", 0),
                "clicks": metrics.get("url_link_clicks", 0),
                "raw": metrics,
            }
        elif post.platform == "linkedin" and platform_post_id:
            result = await integration.request(
                integration="linkedin",
                method="GET",
                url=f"https://api.linkedin.com/v2/socialMetadata/{platform_post_id}",
            )
            metrics = {}
            if result.get("status") == 200:
                metrics = result.get("data") or {}
            analytics_data = {
                "impressions": metrics.get("impressionCount", 0),
                "likes": metrics.get("likeCount", 0),
                "comments": metrics.get("commentCount", 0),
                "shares": metrics.get("shareCount", 0),
                "clicks": metrics.get("clickCount", 0),
                "raw": metrics,
            }
        else:
            # Fallback: just record that we tried
            analytics_data = {"impressions": 0, "likes": 0, "comments": 0, "shares": 0, "clicks": 0, "raw": {}}

        # Upsert analytics
        analytics = db.query(PostAnalytics).filter(PostAnalytics.post_id == post_id).first()
        if not analytics:
            analytics = PostAnalytics(post_id=post_id)
            db.add(analytics)
        analytics.impressions = analytics_data.get("impressions", 0)
        analytics.likes = analytics_data.get("likes", 0)
        analytics.comments = analytics_data.get("comments", 0)
        analytics.shares = analytics_data.get("shares", 0)
        analytics.clicks = analytics_data.get("clicks", 0)
        analytics.fetched_at = datetime.utcnow()
        analytics.raw_data = analytics_data.get("raw", {})
        db.commit()
        db.refresh(analytics)
        logger.info("[Routes] Synced analytics for post %s", post_id)
        return analytics.to_dict()
    except Exception as e:
        logger.warning("[Routes] analytics/sync failed for post %s: %s", post_id, e)
        return {"status": "unavailable", "message": str(e)}


@router.get("/posts/{post_id}/analytics")
def get_post_analytics(post_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    analytics = db.query(PostAnalytics).filter(PostAnalytics.post_id == post_id).first()
    if not analytics:
        return {"status": "not_found"}
    return analytics.to_dict()


# ============================================================================
# AI Caption
# ============================================================================

@router.post("/ai/generate-caption")
async def generate_caption(data: CaptionRequest) -> Dict[str, Any]:
    from services.integration_client import integration
    char_limits = {"twitter": 280, "linkedin": 3000, "google_youtube": 10000}
    limit = char_limits.get(data.platform, 280)
    platform_name = {"twitter": "Twitter/X", "linkedin": "LinkedIn", "google_youtube": "YouTube"}.get(data.platform, data.platform)

    keywords_str = ""
    if data.keywords:
        keywords_str = f"\nInclude these keywords naturally: {', '.join(data.keywords)}"

    prompt = (
        f"Write a {data.tone} social media caption for {platform_name}.\n"
        f"Topic: {data.topic}\n"
        f"Tone: {data.tone}\n"
        f"Character limit: {limit} characters{keywords_str}\n\n"
        f"Return only the caption text, no explanations or quotes."
    )
    system = f"You are a social media copywriter. Write concise, engaging captions optimized for {platform_name}. Stay within {limit} characters."

    if not integration.available:
        return {"status": "unavailable", "caption": ""}

    try:
        caption = await integration.llm_complete(prompt, system)
        if not caption:
            return {"status": "unavailable", "caption": ""}
        return {"status": "ok", "caption": caption.strip()}
    except Exception as e:
        logger.warning("[Routes] generate-caption failed: %s", e)
        return {"status": "unavailable", "caption": ""}


# ============================================================================
# AI Writing Suite
# ============================================================================

# Shared so hooks and full posts come out sounding human in the same generation pass.
HUMANIZE_RULES = (
    "Sound authentically human, not AI-generated:\n"
    "- Vary sentence length. Short punches. Then longer elaborations.\n"
    "- Avoid AI-tell words: leverage, delve, multifaceted, navigate, facilitate, ensure, "
    "realm, intricate, foster, pivotal, comprehensive, tapestry, robust, crucial, imperative, innovative.\n"
    "- No 'not only X but also Y' parallel constructions.\n"
    "- No hollow openers ('In today's world', 'It's important to note', 'In conclusion').\n"
    "- Take one clear, non-hedged stance. Prefer specifics over vague claims. Never invent facts."
)
PLATFORM_NAMES = {"twitter": "Twitter/X", "linkedin": "LinkedIn", "google_youtube": "YouTube"}
PLATFORM_CHAR_LIMITS = {"twitter": 280, "linkedin": 3000, "google_youtube": 10000}


@router.post("/ai/generate-hooks")
async def generate_hooks(data: HookRequest) -> Dict[str, Any]:
    from services.integration_client import integration
    if not integration.available:
        return {"status": "unavailable", "hooks": []}

    platform_name = {"twitter": "Twitter/X", "linkedin": "LinkedIn", "google_youtube": "YouTube"}.get(data.platform, data.platform)
    platform_constraints = {
        "twitter": "punchy, ≤200 chars, no hollow openers like 'In today's world'",
        "linkedin": "professional-human, max 2 lines, first-person preferred",
        "google_youtube": "written as a spoken sentence (the first thing viewers hear)",
    }.get(data.platform, "")

    description_line = f"Post description: {data.description}\n" if data.description else ""
    prompt = (
        f"Topic: {data.topic}\n"
        f"{description_line}"
        f"Platform: {platform_name} — {platform_constraints}\n"
        f"Audience: {data.audience}\n"
        f"Tone: {data.tone}\n"
        f"Goal: {data.goal}\n\n"
        f"Generate exactly {data.count} hooks."
    )
    system = (
        f"You are an expert social media copywriter for {platform_name}. "
        f"Generate exactly {data.count} attention-grabbing opening hooks. "
        "CRITICAL: Use a DIFFERENT framework for each hook. Available frameworks: "
        "Data/Number (statistics/counts), Curiosity Gap (information asymmetry), "
        "Problem-Solution (pain + resolution), Social Proof (authority/results), "
        "Contrarian (challenges advice), Story (narrative opening), Question (direct address). "
        f"{HUMANIZE_RULES} "
        "Return ONLY valid JSON array, no markdown fences: "
        '[{"hook":"...","framework":"Data/Number","explanation":"one sentence why it works"}]'
    )
    try:
        result = await integration.llm_complete(prompt, system)
        if not result:
            return {"status": "unavailable", "hooks": []}
        import json, re
        # Strip markdown fences if present
        cleaned = re.sub(r"```(?:json)?|```", "", result).strip()
        hooks = json.loads(cleaned)
        if not isinstance(hooks, list):
            hooks = []
        return {"status": "ok", "hooks": hooks}
    except Exception as e:
        logger.warning("[Routes] generate-hooks failed: %s", e)
        return {"status": "error", "hooks": [], "message": str(e)}


@router.post("/ai/generate-post")
async def generate_post(data: PostRequest) -> Dict[str, Any]:
    from services.integration_client import integration
    if not integration.available:
        return {"status": "unavailable", "post": ""}

    platform_name = PLATFORM_NAMES.get(data.platform, data.platform)
    limit = PLATFORM_CHAR_LIMITS.get(data.platform, 3000)

    description_line = f"Post description: {data.description}\n" if data.description else ""
    prompt = (
        f"Chosen hook (open with this, refine only if needed): {data.hook}\n"
        f"Topic: {data.topic}\n"
        f"{description_line}"
        f"Platform: {platform_name} (max {limit} characters)\n"
        f"Audience: {data.audience}\n"
        f"Tone: {data.tone}\n"
        f"Goal: {data.goal}\n\n"
        "Write the full post."
    )
    system = (
        f"You are an expert social media copywriter for {platform_name}. "
        "Write one complete, ready-to-publish post that opens with the chosen hook and delivers on it. "
        f"Stay within {limit} characters and match the platform's native style. "
        f"{HUMANIZE_RULES} "
        "Return ONLY the post text — no preamble, no quotes, no explanation."
    )
    try:
        result = await integration.llm_complete(prompt, system)
        if not result:
            return {"status": "unavailable", "post": ""}
        return {"status": "ok", "post": result.strip()}
    except Exception as e:
        logger.warning("[Routes] generate-post failed: %s", e)
        return {"status": "error", "post": "", "message": str(e)}


@router.post("/ai/humanize")
async def humanize_text(data: HumanizeRequest) -> Dict[str, Any]:
    from services.integration_client import integration
    if not integration.available:
        return {"status": "unavailable", "result": "", "originalLength": len(data.text), "resultLength": 0}

    char_limits = {"twitter": 280, "linkedin": 3000, "google_youtube": 10000}
    limit = char_limits.get(data.platform, 3000)
    platform_name = {"twitter": "Twitter/X", "linkedin": "LinkedIn", "google_youtube": "YouTube"}.get(data.platform, data.platform)

    prompt = f"Platform: {platform_name} (character limit: {limit})\nTone: {data.tone}\n\nOriginal text:\n{data.text}"
    system = (
        "You are an expert editor who rewrites AI-generated text to sound authentically human. "
        "Apply ALL of these transformations:\n"
        "1. BURSTINESS: Vary sentence length dramatically. Short punches. Then longer elaborations.\n"
        "2. VOCABULARY: Remove AI tells: leverage, delve, multifaceted, navigate, facilitate, ensure, "
        "realm, intricate, foster, pivotal, comprehensive, tapestry, robust, crucial, imperative, innovative\n"
        "3. STRUCTURE: Remove parallel constructions ('not only X but also Y')\n"
        "4. PREAMBLE: Delete openers like 'In today's world', 'It's important to note', 'In conclusion'\n"
        "5. STANCE: Add one clear non-hedged opinion — human writers take a side\n"
        "6. SPECIFICITY: Replace vague claims with specifics where possible\n"
        "7. PRESERVE: Keep ALL factual content — never invent data\n"
        "Return ONLY the rewritten text. No explanation, no preamble, no quotes."
    )
    try:
        result = await integration.llm_complete(prompt, system)
        if not result:
            return {"status": "unavailable", "result": "", "originalLength": len(data.text), "resultLength": 0}
        humanized = result.strip()
        return {
            "status": "ok",
            "result": humanized,
            "originalLength": len(data.text),
            "resultLength": len(humanized),
        }
    except Exception as e:
        logger.warning("[Routes] humanize failed: %s", e)
        return {"status": "error", "result": "", "originalLength": len(data.text), "resultLength": 0, "message": str(e)}


@router.post("/ai/comment-insights")
async def comment_insights(data: InsightsRequest) -> Dict[str, Any]:
    from services.integration_client import integration
    if not integration.available:
        return {"status": "unavailable", "commentsFetched": 0, "message": "Integration bridge not available"}

    platform_name = {"twitter": "Twitter/X", "linkedin": "LinkedIn", "google_youtube": "YouTube"}.get(data.platform, data.platform)

    # Fetch comments per platform
    comments: List[str] = []
    fetch_error: Optional[str] = None

    try:
        if data.platform == "google_youtube":
            result = await integration.request(
                integration="google_youtube",
                method="GET",
                url=f"https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId={data.post_id}&maxResults={data.max_comments}",
            )
            if result.get("status") == 200:
                items = (result.get("data") or {}).get("items", [])
                comments = [
                    item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {}).get("textDisplay", "")
                    for item in items
                ]
                comments = [c for c in comments if c]
            else:
                fetch_error = f"YouTube API error {result.get('status')}"

        elif data.platform == "twitter":
            result = await integration.request(
                integration="twitter",
                method="GET",
                url=f"https://api.twitter.com/2/tweets/search/recent?query=conversation_id%3A{data.post_id}&tweet.fields=text,author_id,created_at&max_results={min(data.max_comments, 100)}",
            )
            status = result.get("status", 0)
            if status == 200:
                tweets = (result.get("data") or {}).get("data", [])
                comments = [t.get("text", "") for t in tweets if t.get("text")]
            elif status in (401, 403, 429):
                return {
                    "status": "error",
                    "commentsFetched": 0,
                    "message": "X API Basic tier ($100/mo) required for reply access. Only the last 7 days of replies are accessible.",
                }
            else:
                fetch_error = f"Twitter API error {status}"

        elif data.platform == "linkedin":
            result = await integration.request(
                integration="linkedin",
                method="GET",
                url=f"https://api.linkedin.com/rest/socialActions/{data.post_id}/comments",
                headers={"LinkedIn-Version": "202506", "X-Restli-Protocol-Version": "2.0.0"},
            )
            status = result.get("status", 0)
            if status == 200:
                elements = (result.get("data") or {}).get("elements", [])
                comments = [
                    (el.get("message") or {}).get("text", "")
                    for el in elements
                ]
                comments = [c for c in comments if c]
            elif status in (401, 403):
                return {
                    "status": "restricted",
                    "commentsFetched": 0,
                    "message": "LinkedIn comment access requires org admin permissions. Comments are only readable for pages you manage.",
                }
            else:
                fetch_error = f"LinkedIn API error {status}"

    except Exception as e:
        fetch_error = str(e)

    if fetch_error:
        return {"status": "error", "commentsFetched": 0, "message": fetch_error}

    if not comments:
        return {"status": "ok", "commentsFetched": 0, "analysis": None, "message": "No comments found on this post yet."}

    # LLM analysis
    comments_text = "\n---\n".join(comments[:data.max_comments])
    prompt = f"Platform: {platform_name}\nTotal comments: {len(comments)}\n\nComments:\n{comments_text}"
    system = (
        f"Analyze these {len(comments)} comments from a {platform_name} post. "
        "Return ONLY valid JSON (no markdown fences): "
        '{"sentiment":{"positive":0-100,"neutral":0-100,"negative":0-100},'
        '"themes":[{"theme":"...","count":N,"quote":"...","sentiment":"positive|neutral|negative"}],'
        '"top_questions":["..."],'
        '"insights":["...","...","..."],'
        '"top_comments":[{"text":"...","reason":"why worth replying"}]} '
        "Rules: max 5 themes, max 5 questions, exactly 3 insights, max 3 top_comments. "
        "Sentiment percentages must sum to 100."
    )
    try:
        raw = await integration.llm_complete(prompt, system)
        if not raw:
            return {"status": "unavailable", "commentsFetched": len(comments)}
        import json, re
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
        analysis = json.loads(cleaned)
        return {"status": "ok", "platform": data.platform, "commentsFetched": len(comments), "analysis": analysis}
    except Exception as e:
        logger.warning("[Routes] comment-insights LLM failed: %s", e)
        return {"status": "error", "commentsFetched": len(comments), "message": f"Analysis failed: {e}"}


# ============================================================================
# Media Upload
# ============================================================================

UPLOADS_DIR = Path(__file__).parent / "uploads"


@router.post("/media/upload")
async def upload_media(file: UploadFile = File(...)) -> Dict[str, str]:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "file").suffix or ""
    filename = f"{uuid.uuid4()}{ext}"
    file_path = UPLOADS_DIR / filename
    contents = await file.read()
    file_path.write_bytes(contents)
    logger.info("[Routes] Uploaded media: %s (%d bytes)", filename, len(contents))
    return {"url": f"/api/media/{filename}"}


@router.get("/media/{filename}")
def serve_media(filename: str) -> FileResponse:
    file_path = UPLOADS_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))


# ============================================================================
# Ideas Board
# ============================================================================

@router.get("/ideas")
async def list_ideas(
    platform: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    from models import Idea
    query = db.query(Idea)
    if platform:
        query = query.filter(Idea.platform == platform)
    if status:
        query = query.filter(Idea.status == status)
    if q:
        q_lower = f"%{q.lower()}%"
        from sqlalchemy import or_, func
        query = query.filter(
            or_(
                func.lower(Idea.content).like(q_lower),
                func.lower(Idea.title).like(q_lower),
            )
        )
    ideas = query.order_by(Idea.created_at.desc()).all()
    return [i.to_dict() for i in ideas]


@router.post("/ideas")
async def create_idea(data: IdeaCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from models import Idea
    idea = Idea(
        content=data.content,
        title=data.title,
        platform=data.platform,
        tags=data.tags,
        source=data.source,
    )
    db.add(idea)
    db.commit()
    db.refresh(idea)
    return idea.to_dict()


@router.put("/ideas/{idea_id}")
async def update_idea(idea_id: int, data: IdeaUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from models import Idea
    idea = db.query(Idea).filter(Idea.id == idea_id).first()
    if not idea:
        return {"status": "not_found"}
    if data.content is not None:
        idea.content = data.content
    if data.title is not None:
        idea.title = data.title
    if data.platform is not None:
        idea.platform = data.platform
    if data.tags is not None:
        idea.tags = data.tags
    if data.status is not None:
        idea.status = data.status
    idea.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(idea)
    return idea.to_dict()


@router.delete("/ideas/{idea_id}")
async def delete_idea(idea_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    from models import Idea
    idea = db.query(Idea).filter(Idea.id == idea_id).first()
    if not idea:
        return {"status": "not_found"}
    db.delete(idea)
    db.commit()
    return {"status": "deleted"}


@router.post("/ideas/{idea_id}/promote")
async def promote_idea(idea_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from models import Idea, Post
    idea = db.query(Idea).filter(Idea.id == idea_id).first()
    if not idea:
        return {"status": "not_found"}
    post = Post(
        global_content=idea.content,
        platform=idea.platform or "twitter",
        status="draft",
    )
    db.add(post)
    idea.status = "archived"
    idea.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(post)
    return post.to_dict()


# ============================================================================
# Hashtag Sets
# ============================================================================

@router.get("/hashtag-sets")
async def list_hashtag_sets(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    from models import HashtagSet
    sets = db.query(HashtagSet).order_by(HashtagSet.created_at.desc()).all()
    return [s.to_dict() for s in sets]


@router.post("/hashtag-sets")
async def create_hashtag_set(data: HashtagSetCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from models import HashtagSet
    hs = HashtagSet(name=data.name, platform=data.platform, tags=data.tags)
    db.add(hs)
    db.commit()
    db.refresh(hs)
    return hs.to_dict()


@router.put("/hashtag-sets/{set_id}")
async def update_hashtag_set(set_id: int, data: HashtagSetUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    from models import HashtagSet
    hs = db.query(HashtagSet).filter(HashtagSet.id == set_id).first()
    if not hs:
        return {"status": "not_found"}
    if data.name is not None:
        hs.name = data.name
    if data.platform is not None:
        hs.platform = data.platform
    if data.tags is not None:
        hs.tags = data.tags
    if data.incrementUseCount:
        hs.use_count = (hs.use_count or 0) + 1
    hs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(hs)
    return hs.to_dict()


@router.delete("/hashtag-sets/{set_id}")
async def delete_hashtag_set(set_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    from models import HashtagSet
    hs = db.query(HashtagSet).filter(HashtagSet.id == set_id).first()
    if not hs:
        return {"status": "not_found"}
    db.delete(hs)
    db.commit()
    return {"status": "deleted"}
