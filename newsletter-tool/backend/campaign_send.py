"""
Campaign sender — turns a Campaign + its recipients into actual Gmail sends.

Used by:
- The POST /api/campaigns/{id}/send route (immediate send).
- The background scheduler (scheduled sends).

Behavior:
- Builds recipients from target_tags / target_all by querying Subscriber.
- Renders one email per recipient with their personalization context.
- Sends via email_service.send_via_gmail (production Gmail API).
- Records per-recipient status into CampaignRecipient.
- Updates Campaign aggregates (sent_count, failed_count, status, sent_at).
- Catches IntegrationUnavailable and marks the campaign 'failed' with a clear
  error message rather than crashing.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import List, Optional
from urllib.parse import quote

from sqlalchemy.orm import Session as DBSession

from models import Campaign, CampaignRecipient, SenderIdentity, Subscriber
from email_renderer import build_substitution_context, render_email
from email_service import (
    IntegrationUnavailable,
    SendFailed,
    send_via_gmail,
)

logger = logging.getLogger(__name__)


def _select_recipients(db: DBSession, campaign: Campaign) -> List[Subscriber]:
    q = db.query(Subscriber).filter(Subscriber.status == "subscribed")
    if not campaign.target_all and campaign.target_tags:
        # tag match — any of the target tags
        # Tags are stored as a JSON list; SQLite has no array contains, so we
        # filter in Python after a broad query. Fine for the marketplace scale.
        subs = q.all()
        target_set = {t.lower() for t in (campaign.target_tags or []) if t}
        return [
            s for s in subs
            if any((tag or "").lower() in target_set for tag in (s.tags or []))
        ]
    return q.all()


def _ensure_sender_identity(db: DBSession) -> SenderIdentity:
    identity = db.query(SenderIdentity).first()
    if not identity:
        identity = SenderIdentity(id=1)
        db.add(identity)
        db.commit()
        db.refresh(identity)
    return identity


def prepare_campaign(db: DBSession, campaign: Campaign) -> int:
    """Materialize per-recipient rows for this campaign. Idempotent: if there
    are already recipients, return the existing count. Returns the number of
    recipients prepared.
    """
    existing = (
        db.query(CampaignRecipient)
        .filter(CampaignRecipient.campaign_id == campaign.id)
        .count()
    )
    if existing > 0:
        campaign.total_recipients = existing
        db.commit()
        return existing

    subs = _select_recipients(db, campaign)
    for sub in subs:
        full_name = " ".join(
            n for n in [sub.first_name, sub.last_name] if n
        ).strip()
        db.add(CampaignRecipient(
            campaign_id=campaign.id,
            subscriber_id=sub.id,
            email_snapshot=sub.email,
            name_snapshot=full_name or None,
            status="pending",
        ))
    campaign.total_recipients = len(subs)
    db.commit()
    return len(subs)


async def send_campaign(db: DBSession, campaign_id: int) -> dict:
    """Send all pending recipients for one campaign. Returns a summary dict."""

    campaign: Optional[Campaign] = (
        db.query(Campaign).filter(Campaign.id == campaign_id).first()
    )
    if not campaign:
        return {"status": "not_found", "sent": 0, "failed": 0}

    identity = _ensure_sender_identity(db)
    from_name = campaign.from_name or identity.from_name or ""
    from_email = campaign.from_email or identity.from_email or ""
    reply_to = campaign.reply_to or identity.reply_to or None
    tracking_base_url = (identity.tracking_base_url or "").strip()

    if not from_email:
        campaign.status = "failed"
        campaign.error_message = (
            "Set a from-email in Settings before sending."
        )
        db.commit()
        return {"status": "failed", "sent": 0, "failed": 0, "error": campaign.error_message}

    prepare_campaign(db, campaign)

    campaign.status = "sending"
    db.commit()

    pending = (
        db.query(CampaignRecipient)
        .filter(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.status == "pending",
        )
        .all()
    )

    sent = 0
    failed = 0
    integration_down = False

    for recipient in pending:
        unsubscribe_url = ""
        if tracking_base_url and recipient.subscriber_id:
            sub = (
                db.query(Subscriber)
                .filter(Subscriber.id == recipient.subscriber_id)
                .first()
            )
            if sub:
                unsubscribe_url = (
                    f"{tracking_base_url.rstrip('/')}/api/unsubscribe/{quote(sub.unsubscribe_token)}"
                )

        first_name, last_name = None, None
        if recipient.subscriber_id:
            sub = (
                db.query(Subscriber)
                .filter(Subscriber.id == recipient.subscriber_id)
                .first()
            )
            if sub:
                first_name = sub.first_name
                last_name = sub.last_name

        context = build_substitution_context(
            first_name=first_name,
            last_name=last_name,
            email=recipient.email_snapshot,
            unsubscribe_url=unsubscribe_url,
        )

        rendered = render_email(
            subject=campaign.subject or campaign.name,
            preheader=campaign.preheader or "",
            blocks=campaign.blocks or [],
            context=context,
            unsubscribe_url=unsubscribe_url,
            organization_name=identity.organization_name or "",
            organization_address=identity.organization_address or "",
            tracking_base_url=tracking_base_url,
            open_token=recipient.open_token,
            click_token=recipient.click_token,
            design=campaign.design or {},
        )

        try:
            await send_via_gmail(
                from_name=from_name,
                from_email=from_email,
                reply_to=reply_to,
                to_email=recipient.email_snapshot,
                to_name=recipient.name_snapshot,
                subject=campaign.subject or campaign.name,
                html=rendered["html"],
                text=rendered["text"],
                unsubscribe_url=unsubscribe_url,
            )
            recipient.status = "sent"
            recipient.sent_at = datetime.utcnow()
            recipient.error_message = None
            sent += 1
        except IntegrationUnavailable as e:
            recipient.status = "failed"
            recipient.error_message = str(e)
            failed += 1
            integration_down = True
            db.commit()
            # No point continuing — every send would fail the same way.
            break
        except SendFailed as e:
            recipient.status = "failed"
            recipient.error_message = str(e)[:500]
            failed += 1
        except Exception as e:
            recipient.status = "failed"
            recipient.error_message = f"Unexpected error: {e!s}"[:500]
            failed += 1
            logger.exception("[Send] Unexpected error sending to %s", recipient.email_snapshot)

        db.commit()

    campaign.sent_count = (
        db.query(CampaignRecipient)
        .filter(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.status == "sent",
        )
        .count()
    )
    campaign.failed_count = (
        db.query(CampaignRecipient)
        .filter(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.status == "failed",
        )
        .count()
    )

    still_pending = (
        db.query(CampaignRecipient)
        .filter(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.status == "pending",
        )
        .count()
    )

    if integration_down:
        campaign.status = "failed"
        campaign.error_message = (
            "Connect Google Workspace in CraftBot to send. The campaign will "
            "stay paused until you retry."
        )
    elif still_pending == 0 and campaign.failed_count == 0:
        campaign.status = "sent"
        campaign.sent_at = datetime.utcnow()
        campaign.error_message = None
    elif still_pending == 0 and campaign.sent_count > 0:
        campaign.status = "sent"
        campaign.sent_at = datetime.utcnow()
        campaign.error_message = (
            f"{campaign.failed_count} recipient(s) failed; see the recipients tab."
        )
    elif still_pending == 0:
        campaign.status = "failed"
        campaign.error_message = "All recipients failed; see the recipients tab."
    else:
        # Mixed state — partial send. Keep as 'sending' to retry later.
        pass

    db.commit()
    return {
        "status": campaign.status,
        "sent": sent,
        "failed": failed,
        "totalRecipients": campaign.total_recipients,
        "errorMessage": campaign.error_message,
    }


def send_campaign_sync(db: DBSession, campaign_id: int) -> dict:
    """Synchronous wrapper used by the scheduler thread."""
    try:
        return asyncio.run(send_campaign(db, campaign_id))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(send_campaign(db, campaign_id))
        finally:
            loop.close()
