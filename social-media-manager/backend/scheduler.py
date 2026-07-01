import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
MAX_RETRIES = 3
TICK_SECONDS = 60


async def scheduler_loop() -> None:
    logger.info("[Scheduler] Started — tick=%ss, max_retries=%s", TICK_SECONDS, MAX_RETRIES)
    while True:
        await asyncio.sleep(TICK_SECONDS)
        try:
            await _tick()
        except asyncio.CancelledError:
            logger.info("[Scheduler] Cancelled")
            raise
        except Exception as e:
            logger.exception("[Scheduler] Tick error: %s", e)


async def _tick() -> None:
    from database import SessionLocal
    from models import Post
    from services.publish_service import publish_post

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        due = (
            db.query(Post)
            .filter(
                Post.status == "scheduled",
                Post.scheduled_at.isnot(None),
                Post.scheduled_at <= now,
            )
            .order_by(Post.scheduled_at.asc())
            .all()
        )
        for post in due:
            post.status = "publishing"
            db.commit()
            try:
                result = await publish_post(post)
                post.status = "published"
                post.published_at = datetime.utcnow()
                post.platform_post_id = result.get("platform_post_id")
                post.error_message = None
                db.commit()
                logger.info("[Scheduler] Published post %s on %s", post.id, post.platform)
            except Exception as e:
                post.retry_count = (post.retry_count or 0) + 1
                if post.retry_count >= MAX_RETRIES:
                    post.status = "failed"
                    post.error_message = str(e)
                    logger.error("[Scheduler] Post %s failed after %s retries: %s", post.id, MAX_RETRIES, e)
                else:
                    post.status = "scheduled"  # will retry next tick
                    post.error_message = f"Retry {post.retry_count}/{MAX_RETRIES}: {e}"
                    logger.warning("[Scheduler] Post %s retry %s/%s: %s", post.id, post.retry_count, MAX_RETRIES, e)
                db.commit()
    finally:
        db.close()
