"""
Background scheduler — sends scheduled campaigns when their time arrives.

A single daemon thread polls the campaigns table every TICK_SECONDS and sends
any campaign whose status is 'scheduled' and scheduled_at <= now.

Sends are serialized to keep things simple and avoid races against the same
campaign. Failures during send are caught by send_campaign and recorded on the
Campaign row itself.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

TICK_SECONDS = int(os.environ.get("NEWSLETTER_SCHEDULER_TICK", "20"))

_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def _tick():
    from database import SessionLocal
    from models import Campaign
    from campaign_send import send_campaign_sync

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        due = (
            db.query(Campaign)
            .filter(
                Campaign.status == "scheduled",
                Campaign.scheduled_at.isnot(None),
                Campaign.scheduled_at <= now,
            )
            .order_by(Campaign.scheduled_at.asc())
            .all()
        )
        for campaign in due:
            logger.info(
                "[Scheduler] Sending campaign %s (%s) at %s",
                campaign.id, campaign.name, now.isoformat(),
            )
            campaign.status = "sending"
            db.commit()
            try:
                send_campaign_sync(db, campaign.id)
            except Exception as e:
                logger.exception("[Scheduler] Send failed for campaign %s: %s", campaign.id, e)
                campaign.status = "failed"
                campaign.error_message = f"Scheduler error: {e!s}"
                db.commit()
    finally:
        db.close()


def _loop():
    logger.info("[Scheduler] Started — tick=%ss", TICK_SECONDS)
    while not _stop.is_set():
        try:
            _tick()
        except Exception as e:
            logger.exception("[Scheduler] Tick failed: %s", e)
        _stop.wait(TICK_SECONDS)
    logger.info("[Scheduler] Stopped")


def start_scheduler() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="newsletter-scheduler", daemon=True)
    _thread.start()


def stop_scheduler() -> None:
    _stop.set()
