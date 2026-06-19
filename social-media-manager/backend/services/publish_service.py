"""Platform-specific publish logic. Called by scheduler and publish-now route."""
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


async def publish_post(post) -> Dict[str, Any]:
    from services.integration_client import integration
    if post.platform == "twitter":
        return await _publish_twitter(integration, post)
    elif post.platform == "linkedin":
        return await _publish_linkedin(integration, post)
    elif post.platform == "google_youtube":
        return await _publish_youtube(integration, post)
    raise ValueError(f"Unknown platform: {post.platform}")


async def _publish_twitter(integration, post) -> Dict[str, Any]:
    content = post.effective_content()
    result = await integration.request(
        integration="twitter",
        method="POST",
        url="https://api.twitter.com/2/tweets",
        body={"text": content},
    )
    if "error" in result:
        raise Exception(result["error"])
    status = result.get("status", 0)
    if status in (200, 201):
        tweet_id = (result.get("data") or {}).get("data", {}).get("id", "")
        return {"platform_post_id": str(tweet_id)}
    raise Exception(f"Twitter error {status}: {result.get('data', result.get('error', 'unknown'))}")


async def _publish_linkedin(integration, post) -> Dict[str, Any]:
    from database import SessionLocal
    from models import PlatformAccount
    db = SessionLocal()
    try:
        acct = db.query(PlatformAccount).filter(PlatformAccount.platform == "linkedin").first()
        author_urn = (acct.extra_data or {}).get("author_urn") if acct else None
    finally:
        db.close()

    if not author_urn:
        raise Exception("LinkedIn author URN not cached. Sync accounts first via Settings.")

    content = post.effective_content()
    body = {
        "author": author_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": content},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    result = await integration.request(
        integration="linkedin", method="POST",
        url="https://api.linkedin.com/v2/ugcPosts", body=body,
    )
    if "error" in result:
        raise Exception(result["error"])
    status = result.get("status", 0)
    if status in (200, 201):
        return {"platform_post_id": str((result.get("data") or {}).get("id", ""))}
    raise Exception(f"LinkedIn error {status}: {result.get('data', result.get('error', 'unknown'))}")


async def _publish_youtube(integration, post) -> Dict[str, Any]:
    # YouTube Community Posts is not available via the YouTube Data API.
    # Video upload requires the youtube.upload OAuth scope which must be
    # enabled separately in CraftBot. Raise a clear error so the scheduler
    # marks this post as failed with a helpful message.
    raise Exception(
        "YouTube posting requires the youtube.upload OAuth scope. "
        "Ask your CraftBot admin to enable it, then retry."
    )
