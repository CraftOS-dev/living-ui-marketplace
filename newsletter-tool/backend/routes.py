"""
Newsletter Tool — API routes.

Conventions:
- Absolute imports only.
- No /api prefix here (main.py adds it via include_router).
- All DELETE endpoints are idempotent (return 200 status='not_found' if absent).
- Enum-like fields use ``Literal[...]`` so the marketplace smoke test picks a
  valid value from the OpenAPI ``enum`` array.
- Email fields carry a ``format: email`` json_schema_extra so the smoke test
  sends "test@test.com" instead of "test".
"""

from __future__ import annotations

import asyncio
import base64
import csv
import io
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse, Response, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from database import get_db
from models import (
    AppState,
    Campaign,
    CampaignRecipient,
    LLMCache,
    SenderIdentity,
    Subscriber,
    Template,
    UISnapshot,
    UIScreenshot,
)
from llm_service import (
    check_cache,
    generate_text_sync,
    llm_available,
    make_cache_key,
    parse_json_response,
    store_cache,
)
from prompts import SYSTEM_PROMPT, email_generation_prompt, stub_email
from email_renderer import build_substitution_context, render_email
from email_service import integrations_status
from campaign_send import prepare_campaign, send_campaign

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bootstrap — runs once on the first request after startup. We can't edit
# main.py to add startup hooks, so we register a router-level dependency that
# performs an idempotent init: seeds built-in templates and starts the
# scheduler thread. Subsequent calls are O(1).
# ---------------------------------------------------------------------------

_SCHEDULER_STARTED = False
_MIGRATIONS_RAN = False


def _ensure_migrations(db: DBSession) -> None:
    """Idempotent column-level migrations for schemas that grew over time.

    SQLAlchemy's create_all only creates missing tables, not missing columns.
    For dev databases that predate a column addition we add the column here.
    """
    global _MIGRATIONS_RAN
    if _MIGRATIONS_RAN:
        return
    try:
        from sqlalchemy import inspect, text
        bind = db.get_bind()
        inspector = inspect(bind)
        if "templates" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("templates")}
            if "usage_count" not in cols:
                db.execute(text("ALTER TABLE templates ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0"))
                db.commit()
                logger.info("[Bootstrap] Added usage_count column to templates")
        if "campaigns" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("campaigns")}
            if "design" not in cols:
                db.execute(text("ALTER TABLE campaigns ADD COLUMN design JSON DEFAULT '{}'"))
                db.commit()
                logger.info("[Bootstrap] Added design column to campaigns")
        if "templates" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("templates")}
            if "design" not in cols:
                db.execute(text("ALTER TABLE templates ADD COLUMN design JSON DEFAULT '{}'"))
                db.commit()
                logger.info("[Bootstrap] Added design column to templates")
        if "sender_identity" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("sender_identity")}
            if "subscribe_key" not in cols:
                db.execute(text("ALTER TABLE sender_identity ADD COLUMN subscribe_key VARCHAR(64) DEFAULT ''"))
                db.commit()
                logger.info("[Bootstrap] Added subscribe_key column to sender_identity")
    except Exception as e:
        logger.warning("[Bootstrap] Migration check failed: %s", e)
    _MIGRATIONS_RAN = True


def _bootstrap(db: DBSession = Depends(get_db)) -> None:
    """Seed built-in templates and start the scheduler.

    Template seeding is idempotent (skips templates that already exist by
    name + is_builtin) and runs on every request — cheap, and survives the
    autouse DB reset in tests. The scheduler thread is started once and
    skipped under pytest to keep tests deterministic.
    """
    _ensure_migrations(db)

    try:
        from seed_data import seed_builtin_templates
        seed_builtin_templates(db)
    except Exception as e:
        logger.warning("[Bootstrap] Template seed failed: %s", e)

    global _SCHEDULER_STARTED
    if _SCHEDULER_STARTED:
        return
    import os
    if os.environ.get("PYTEST_CURRENT_TEST"):
        _SCHEDULER_STARTED = True
        return
    try:
        from scheduler import start_scheduler
        start_scheduler()
        _SCHEDULER_STARTED = True
    except Exception as e:
        logger.warning("[Bootstrap] Scheduler start failed: %s", e)


router = APIRouter(dependencies=[Depends(_bootstrap)])


SubscriberStatus = Literal["subscribed", "unsubscribed", "bounced"]
CampaignStatus = Literal["draft", "scheduled", "sending", "sent", "failed", "cancelled"]
EmailTone = Literal["friendly", "professional", "playful", "concise", "warm", "persuasive"]
TemplateCategory = Literal[
    "custom", "onboarding", "newsletter", "launch", "promotion",
    "event", "digest", "feedback", "re-engagement",
]


# ============================================================================
# Pydantic schemas
# ============================================================================

EMAIL_FORMAT = {"format": "email"}
DATETIME_FORMAT = {"format": "date-time"}


class SubscriberCreate(BaseModel):
    email: str = Field(json_schema_extra=EMAIL_FORMAT)
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[SubscriberStatus] = "subscribed"
    source: Optional[str] = "manual"


class SubscriberUpdate(BaseModel):
    email: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[SubscriberStatus] = None


class SubscriberImport(BaseModel):
    csv_content: str
    tags: Optional[List[str]] = None


class TemplateCreate(BaseModel):
    name: str
    subject: Optional[str] = ""
    preheader: Optional[str] = ""
    blocks: Optional[List[Dict[str, Any]]] = None
    design: Optional[Dict[str, Any]] = None
    category: Optional[TemplateCategory] = "custom"
    icon: Optional[str] = "FiMail"


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    blocks: Optional[List[Dict[str, Any]]] = None
    design: Optional[Dict[str, Any]] = None
    category: Optional[TemplateCategory] = None
    icon: Optional[str] = None


class CampaignCreate(BaseModel):
    name: str
    subject: Optional[str] = ""
    preheader: Optional[str] = ""
    from_name: Optional[str] = None
    from_email: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    reply_to: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    blocks: Optional[List[Dict[str, Any]]] = None
    design: Optional[Dict[str, Any]] = None
    target_tags: Optional[List[str]] = None
    target_all: Optional[bool] = True
    template_id: Optional[int] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    from_name: Optional[str] = None
    from_email: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    reply_to: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    blocks: Optional[List[Dict[str, Any]]] = None
    design: Optional[Dict[str, Any]] = None
    target_tags: Optional[List[str]] = None
    target_all: Optional[bool] = None
    status: Optional[CampaignStatus] = None


class CampaignSchedule(BaseModel):
    scheduled_at: str = Field(json_schema_extra=DATETIME_FORMAT)


class AIGenerateRequest(BaseModel):
    prompt: str = "A short update for our subscribers"
    tone: EmailTone = "friendly"
    audience: Optional[str] = None
    include_cta: Optional[bool] = True


class SenderIdentityUpdate(BaseModel):
    from_name: Optional[str] = None
    from_email: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    reply_to: Optional[str] = Field(default=None, json_schema_extra=EMAIL_FORMAT)
    organization_name: Optional[str] = None
    organization_address: Optional[str] = None
    tracking_base_url: Optional[str] = None


class SubscribeRequest(BaseModel):
    """Public subscription form payload. Returns 200 for all outcomes (valid,
    invalid, already-subscribed) so an embedded JS snippet can branch on
    response.status without seeing 4xx errors."""
    email: str = Field(json_schema_extra=EMAIL_FORMAT)
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    tags: Optional[List[str]] = None
    source: Optional[str] = "form"
    key: Optional[str] = None


class StateUpdate(BaseModel):
    data: Dict[str, Any]


class UISnapshotUpdate(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


# ============================================================================
# Subscribers
# ============================================================================

def _apply_subscriber_update(sub: Subscriber, data: SubscriberUpdate) -> None:
    if data.email is not None:
        sub.email = data.email.strip().lower()
    if data.first_name is not None:
        sub.first_name = data.first_name.strip() or None
    if data.last_name is not None:
        sub.last_name = data.last_name.strip() or None
    if data.tags is not None:
        sub.tags = [t.strip() for t in data.tags if t and t.strip()]
    if data.status is not None:
        sub.status = data.status


@router.get("/subscribers")
def list_subscribers(
    status: Optional[SubscriberStatus] = Query(None),
    tag: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: DBSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    q = db.query(Subscriber)
    if status:
        q = q.filter(Subscriber.status == status)
    if search:
        like = f"%{search.lower()}%"
        from sqlalchemy import func, or_
        q = q.filter(or_(
            func.lower(Subscriber.email).like(like),
            func.lower(func.coalesce(Subscriber.first_name, "")).like(like),
            func.lower(func.coalesce(Subscriber.last_name, "")).like(like),
        ))
    subs = q.order_by(Subscriber.created_at.desc(), Subscriber.id.desc()).all()
    if tag:
        tag_l = tag.lower()
        subs = [s for s in subs if any((t or "").lower() == tag_l for t in (s.tags or []))]
    return [s.to_dict() for s in subs]


@router.post("/subscribers")
def create_subscriber(data: SubscriberCreate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    email = (data.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required")
    existing = db.query(Subscriber).filter(Subscriber.email == email).first()
    if existing:
        # Idempotent — update name/tags/status and return existing row.
        if data.first_name is not None:
            existing.first_name = data.first_name.strip() or None
        if data.last_name is not None:
            existing.last_name = data.last_name.strip() or None
        if data.tags is not None:
            merged = list({(t or "").strip() for t in (existing.tags or []) + data.tags if t and t.strip()})
            existing.tags = merged
        if data.status is not None:
            existing.status = data.status
        db.commit()
        db.refresh(existing)
        return existing.to_dict()

    sub = Subscriber(
        email=email,
        first_name=(data.first_name or "").strip() or None,
        last_name=(data.last_name or "").strip() or None,
        tags=[t.strip() for t in (data.tags or []) if t and t.strip()],
        status=data.status or "subscribed",
        source=(data.source or "manual"),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub.to_dict()


@router.get("/subscribers/{subscriber_id}")
def get_subscriber(subscriber_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    sub = db.query(Subscriber).filter(Subscriber.id == subscriber_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    return sub.to_dict()


@router.put("/subscribers/{subscriber_id}")
def update_subscriber(
    subscriber_id: int,
    data: SubscriberUpdate,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    sub = db.query(Subscriber).filter(Subscriber.id == subscriber_id).first()
    if not sub:
        return {"status": "not_found", "id": subscriber_id}
    _apply_subscriber_update(sub, data)
    db.commit()
    db.refresh(sub)
    return sub.to_dict()


@router.delete("/subscribers/{subscriber_id}")
def delete_subscriber(subscriber_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    sub = db.query(Subscriber).filter(Subscriber.id == subscriber_id).first()
    if not sub:
        return {"status": "not_found", "id": subscriber_id}
    db.delete(sub)
    db.commit()
    return {"status": "deleted", "id": subscriber_id}


@router.post("/subscribers/import")
def import_subscribers(data: SubscriberImport, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    """Bulk-import from a CSV string.

    Accepts:
    - 1-column form: just emails, one per line.
    - 3-column form: ``email,first_name,last_name``.
    - Lines starting with '#' or empty lines are ignored.
    """
    content = (data.csv_content or "").strip()
    tags_to_apply = [t.strip() for t in (data.tags or []) if t and t.strip()]

    inserted = 0
    updated = 0
    skipped = 0
    errors: List[str] = []

    if not content:
        return {"inserted": 0, "updated": 0, "skipped": 0, "errors": ["empty input"]}

    reader = csv.reader(io.StringIO(content))
    for row in reader:
        if not row:
            continue
        first_cell = (row[0] or "").strip()
        if not first_cell or first_cell.startswith("#"):
            continue
        if "@" not in first_cell:
            skipped += 1
            continue

        email = first_cell.lower()
        first_name = (row[1].strip() if len(row) > 1 else "") or None
        last_name = (row[2].strip() if len(row) > 2 else "") or None

        existing = db.query(Subscriber).filter(Subscriber.email == email).first()
        if existing:
            if first_name:
                existing.first_name = first_name
            if last_name:
                existing.last_name = last_name
            if tags_to_apply:
                merged = list({(t or "").strip() for t in (existing.tags or []) + tags_to_apply if t})
                existing.tags = merged
            updated += 1
        else:
            sub = Subscriber(
                email=email,
                first_name=first_name,
                last_name=last_name,
                tags=tags_to_apply,
                source="import",
            )
            db.add(sub)
            inserted += 1

    db.commit()
    return {"inserted": inserted, "updated": updated, "skipped": skipped, "errors": errors}


@router.get("/subscribers-export")
def export_subscribers(db: DBSession = Depends(get_db)) -> Response:
    """Download all subscribers as CSV. Separate path from /subscribers/{id} to
    avoid the path-parameter handler intercepting 'export'."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["email", "first_name", "last_name", "status", "tags", "created_at"])
    for s in db.query(Subscriber).order_by(Subscriber.id.asc()).all():
        writer.writerow([
            s.email,
            s.first_name or "",
            s.last_name or "",
            s.status,
            ";".join(s.tags or []),
            s.created_at.isoformat() if s.created_at else "",
        ])
    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=subscribers.csv"},
    )


@router.get("/tags")
def list_tags(db: DBSession = Depends(get_db)) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    for s in db.query(Subscriber).all():
        for tag in (s.tags or []):
            if not tag:
                continue
            counts[tag] = counts.get(tag, 0) + 1
    return [
        {"name": name, "count": count}
        for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    ]


# ============================================================================
# Templates
# ============================================================================

@router.get("/templates")
def list_templates(
    builtin_only: Optional[bool] = Query(None),
    db: DBSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    q = db.query(Template)
    if builtin_only is True:
        q = q.filter(Template.is_builtin == True)  # noqa: E712
    if builtin_only is False:
        q = q.filter(Template.is_builtin == False)  # noqa: E712
    templates = q.order_by(Template.is_builtin.desc(), Template.updated_at.desc(), Template.id.desc()).all()
    return [t.to_dict() for t in templates]


@router.post("/templates")
def create_template(data: TemplateCreate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    tpl = Template(
        name=(data.name or "Untitled template").strip()[:160] or "Untitled template",
        subject=(data.subject or "").strip()[:255],
        preheader=(data.preheader or "").strip()[:255],
        blocks=data.blocks or [],
        design=data.design or {},
        category=data.category or "custom",
        icon=(data.icon or "FiMail").strip()[:40] or "FiMail",
        is_builtin=False,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl.to_dict()


@router.get("/templates/{template_id}")
def get_template(template_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl.to_dict()


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    data: TemplateUpdate,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        return {"status": "not_found", "id": template_id}
    # All templates are fully editable. The is_builtin flag is metadata about
    # origin only — built-ins are seeded once at first startup and not
    # re-introduced afterward (see seed_data.seed_builtin_templates).
    if data.name is not None:
        tpl.name = data.name.strip()[:160] or tpl.name
    if data.subject is not None:
        tpl.subject = data.subject.strip()[:255]
    if data.preheader is not None:
        tpl.preheader = data.preheader.strip()[:255]
    if data.blocks is not None:
        tpl.blocks = data.blocks
    if data.design is not None:
        tpl.design = data.design
    if data.category is not None:
        tpl.category = data.category
    if data.icon is not None:
        tpl.icon = data.icon[:40] or "FiMail"
    db.commit()
    db.refresh(tpl)
    return tpl.to_dict()


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        return {"status": "not_found", "id": template_id}
    db.delete(tpl)
    db.commit()
    return {"status": "deleted", "id": template_id}


# ============================================================================
# Campaigns
# ============================================================================

def _campaign_from_template(db: DBSession, template_id: Optional[int]) -> Optional[Template]:
    if template_id is None:
        return None
    return db.query(Template).filter(Template.id == template_id).first()


@router.get("/campaigns")
def list_campaigns(
    status: Optional[CampaignStatus] = Query(None),
    db: DBSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    q = db.query(Campaign)
    if status:
        q = q.filter(Campaign.status == status)
    campaigns = q.order_by(Campaign.updated_at.desc(), Campaign.id.desc()).all()
    return [c.to_summary() for c in campaigns]


@router.post("/campaigns")
def create_campaign(data: CampaignCreate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    blocks = data.blocks
    subject = (data.subject or "").strip()
    preheader = (data.preheader or "").strip()
    template_used: Optional[Template] = None
    design_from_template: Dict[str, Any] = {}
    if data.template_id:
        template_used = _campaign_from_template(db, data.template_id)
        if template_used:
            if not blocks:
                blocks = list(template_used.blocks or [])
            if not subject:
                subject = template_used.subject or ""
            if not preheader:
                preheader = template_used.preheader or ""
            # Carry the template's design over to the new campaign.
            design_from_template = dict(template_used.design or {})

    campaign = Campaign(
        name=(data.name or "Untitled campaign").strip()[:160] or "Untitled campaign",
        subject=subject[:255],
        preheader=preheader[:255],
        from_name=(data.from_name or None),
        from_email=(data.from_email or None),
        reply_to=(data.reply_to or None),
        blocks=blocks or [],
        design=data.design or design_from_template or {},
        target_tags=[t.strip() for t in (data.target_tags or []) if t and t.strip()],
        target_all=True if data.target_all is None else bool(data.target_all),
        status="draft",
    )
    db.add(campaign)
    if template_used is not None:
        template_used.usage_count = (template_used.usage_count or 0) + 1
    db.commit()
    db.refresh(campaign)
    return campaign.to_detail()


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign.to_detail()


@router.put("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: int,
    data: CampaignUpdate,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        return {"status": "not_found", "id": campaign_id}
    if data.name is not None:
        campaign.name = data.name.strip()[:160] or campaign.name
    if data.subject is not None:
        campaign.subject = data.subject.strip()[:255]
    if data.preheader is not None:
        campaign.preheader = data.preheader.strip()[:255]
    if data.from_name is not None:
        campaign.from_name = data.from_name.strip() or None
    if data.from_email is not None:
        campaign.from_email = data.from_email.strip() or None
    if data.reply_to is not None:
        campaign.reply_to = data.reply_to.strip() or None
    if data.blocks is not None:
        campaign.blocks = data.blocks
    if data.design is not None:
        campaign.design = data.design
    if data.target_tags is not None:
        campaign.target_tags = [t.strip() for t in data.target_tags if t and t.strip()]
    if data.target_all is not None:
        campaign.target_all = bool(data.target_all)
    if data.status is not None:
        campaign.status = data.status
    db.commit()
    db.refresh(campaign)
    return campaign.to_detail()


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        return {"status": "not_found", "id": campaign_id}
    db.delete(campaign)
    db.commit()
    return {"status": "deleted", "id": campaign_id}


@router.post("/campaigns/{campaign_id}/duplicate")
def duplicate_campaign(campaign_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    src = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not src:
        return {"status": "not_found", "id": campaign_id}
    copy = Campaign(
        name=f"{src.name} (copy)",
        subject=src.subject,
        preheader=src.preheader,
        from_name=src.from_name,
        from_email=src.from_email,
        reply_to=src.reply_to,
        blocks=list(src.blocks or []),
        target_tags=list(src.target_tags or []),
        target_all=src.target_all,
        status="draft",
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy.to_detail()


def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


@router.post("/campaigns/{campaign_id}/send")
def send_campaign_now(campaign_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        return {"status": "not_found", "id": campaign_id}
    if campaign.status == "sending":
        return {"status": "already_sending", "id": campaign_id}
    result = _run_async(send_campaign(db, campaign_id))
    db.refresh(campaign)
    return {"campaign": campaign.to_summary(), "result": result}


@router.post("/campaigns/{campaign_id}/schedule")
def schedule_campaign(
    campaign_id: int,
    data: CampaignSchedule,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        return {"status": "not_found", "id": campaign_id}
    raw = data.scheduled_at or ""
    when: Optional[datetime] = None
    try:
        when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if when.tzinfo is not None:
            when = when.astimezone(tz=None).replace(tzinfo=None)
    except (ValueError, AttributeError):
        try:
            when = datetime.fromisoformat(raw)
        except ValueError:
            when = datetime.utcnow() + timedelta(hours=1)
    campaign.scheduled_at = when
    campaign.status = "scheduled"
    campaign.error_message = None
    prepare_campaign(db, campaign)
    db.commit()
    db.refresh(campaign)
    return campaign.to_detail()


@router.post("/campaigns/{campaign_id}/cancel")
def cancel_campaign(campaign_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        return {"status": "not_found", "id": campaign_id}
    if campaign.status not in ("scheduled", "draft"):
        return {"status": campaign.status, "id": campaign_id, "note": "Only scheduled or draft campaigns can be cancelled"}
    campaign.status = "cancelled"
    campaign.scheduled_at = None
    db.commit()
    db.refresh(campaign)
    return campaign.to_detail()


@router.get("/campaigns/{campaign_id}/recipients")
def list_campaign_recipients(
    campaign_id: int, db: DBSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    rs = (
        db.query(CampaignRecipient)
        .filter(CampaignRecipient.campaign_id == campaign_id)
        .order_by(CampaignRecipient.id.asc())
        .all()
    )
    return [r.to_dict() for r in rs]


@router.get("/campaigns/{campaign_id}/preview")
def preview_campaign(campaign_id: int, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        return {"status": "not_found", "id": campaign_id, "html": "", "text": ""}
    sample = (
        db.query(Subscriber)
        .filter(Subscriber.status == "subscribed")
        .order_by(Subscriber.id.asc())
        .first()
    )
    first_name = sample.first_name if sample else "Friend"
    last_name = sample.last_name if sample else ""
    email = sample.email if sample else "preview@example.com"
    identity = db.query(SenderIdentity).first()
    unsub_url = "#preview-unsubscribe"
    context = build_substitution_context(
        first_name=first_name,
        last_name=last_name,
        email=email,
        unsubscribe_url=unsub_url,
    )
    rendered = render_email(
        subject=campaign.subject or campaign.name,
        preheader=campaign.preheader or "",
        blocks=campaign.blocks or [],
        context=context,
        unsubscribe_url=unsub_url,
        organization_name=(identity.organization_name if identity else "") or "",
        organization_address=(identity.organization_address if identity else "") or "",
        tracking_base_url="",
        open_token="",
        click_token="",
        design=campaign.design or {},
    )
    return {
        "status": "ok",
        "subject": campaign.subject or campaign.name,
        "preheader": campaign.preheader or "",
        "html": rendered["html"],
        "text": rendered["text"],
    }


@router.post("/campaigns/generate")
def generate_campaign_copy(
    data: AIGenerateRequest,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    prompt = (data.prompt or "").strip() or "Send a short update to our subscribers."
    tone = data.tone or "friendly"
    audience = (data.audience or "").strip() or None
    include_cta = True if data.include_cta is None else bool(data.include_cta)

    cache_key = make_cache_key("email_v1", tone, audience or "", int(include_cta), prompt)
    cached = check_cache(db, cache_key)
    if isinstance(cached, dict) and "blocks" in cached:
        return {"status": "ok", "llmAvailable": llm_available(), **cached}

    if llm_available():
        user_prompt = email_generation_prompt(
            prompt=prompt, tone=tone, audience=audience, include_cta=include_cta,
        )
        raw = generate_text_sync(SYSTEM_PROMPT, user_prompt)
        parsed = parse_json_response(raw) if raw else None
        if isinstance(parsed, dict) and isinstance(parsed.get("blocks"), list):
            payload = {
                "subject": str(parsed.get("subject") or "")[:255],
                "preheader": str(parsed.get("preheader") or "")[:255],
                "blocks": [b for b in parsed["blocks"] if isinstance(b, dict)],
            }
            store_cache(db, cache_key, payload, hours=12)
            return {"status": "ok", "llmAvailable": True, **payload}

    payload = stub_email(prompt, tone)
    store_cache(db, cache_key, payload, hours=1)
    return {"status": "stub", "llmAvailable": llm_available(), **payload}


# ============================================================================
# Sender identity / integrations
# ============================================================================

@router.get("/sender-identity")
def get_sender_identity(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    identity = db.query(SenderIdentity).first()
    if not identity:
        identity = SenderIdentity(id=1)
        db.add(identity)
        db.commit()
        db.refresh(identity)
    # Lazily generate a subscribe key on first read so embed forms work right away.
    if not (identity.subscribe_key or "").strip():
        from models import _new_token
        identity.subscribe_key = _new_token(20)
        db.commit()
        db.refresh(identity)
    return identity.to_dict()


@router.post("/sender-identity/rotate-subscribe-key")
def rotate_subscribe_key(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    """Generate a new subscribe key. Any embed snippet still using the old
    key will stop working — re-copy the snippet after rotating."""
    from models import _new_token

    identity = db.query(SenderIdentity).first()
    if not identity:
        identity = SenderIdentity(id=1)
        db.add(identity)
        db.flush()
    identity.subscribe_key = _new_token(20)
    db.commit()
    db.refresh(identity)
    return identity.to_dict()


@router.post("/subscribe")
def public_subscribe(data: SubscribeRequest, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    """Public subscription endpoint — designed to be called from an embedded
    form on the user's website.

    Returns 200 in all cases with a ``status`` field the embed script can
    branch on: ``subscribed`` / ``resubscribed`` / ``already_subscribed`` /
    ``error`` (with a ``message``).
    """
    email = (data.email or "").strip().lower()
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return {"status": "error", "message": "A valid email address is required."}

    identity = db.query(SenderIdentity).first()
    expected_key = (identity.subscribe_key if identity else "") or ""
    if expected_key:
        provided = (data.key or "").strip()
        if provided != expected_key:
            return {"status": "error", "message": "Invalid or missing subscription key."}

    incoming_tags = [t.strip() for t in (data.tags or []) if t and t.strip()]

    existing = db.query(Subscriber).filter(Subscriber.email == email).first()
    if existing:
        was_unsubscribed = existing.status != "subscribed"
        if data.first_name and not existing.first_name:
            existing.first_name = data.first_name.strip()
        if data.last_name and not existing.last_name:
            existing.last_name = data.last_name.strip()
        if incoming_tags:
            merged = list({
                (t or "").strip()
                for t in (existing.tags or []) + incoming_tags
                if t and t.strip()
            })
            existing.tags = merged
        existing.status = "subscribed"
        existing.bounce_reason = None
        db.commit()
        return {
            "status": "resubscribed" if was_unsubscribed else "already_subscribed",
            "email": email,
        }

    sub = Subscriber(
        email=email,
        first_name=(data.first_name or "").strip() or None,
        last_name=(data.last_name or "").strip() or None,
        tags=incoming_tags,
        status="subscribed",
        source=(data.source or "form")[:40],
    )
    db.add(sub)
    db.commit()
    return {"status": "subscribed", "email": email}


@router.put("/sender-identity")
def update_sender_identity(
    data: SenderIdentityUpdate,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    identity = db.query(SenderIdentity).first()
    if not identity:
        identity = SenderIdentity(id=1)
        db.add(identity)
        db.flush()
    if data.from_name is not None:
        identity.from_name = data.from_name.strip()[:120]
    if data.from_email is not None:
        identity.from_email = data.from_email.strip()[:320]
    if data.reply_to is not None:
        identity.reply_to = data.reply_to.strip()[:320]
    if data.organization_name is not None:
        identity.organization_name = data.organization_name.strip()[:160]
    if data.organization_address is not None:
        identity.organization_address = data.organization_address.strip()[:255]
    if data.tracking_base_url is not None:
        identity.tracking_base_url = data.tracking_base_url.strip().rstrip("/")[:255]
    db.commit()
    db.refresh(identity)
    return identity.to_dict()


@router.get("/integrations")
def get_integrations_status(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        gmail = _run_async(integrations_status())
    except Exception as e:
        logger.warning("[Routes] integrations_status failed: %s", e)
        gmail = {"bridge": False, "google_workspace": False}
    return {
        "llm": {"connected": llm_available()},
        "gmail": gmail,
    }


# ============================================================================
# Analytics dashboard
# ============================================================================

@router.get("/analytics/overview")
def analytics_overview(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    total_subs = db.query(Subscriber).count()
    active_subs = db.query(Subscriber).filter(Subscriber.status == "subscribed").count()
    unsub = db.query(Subscriber).filter(Subscriber.status == "unsubscribed").count()
    bounced = db.query(Subscriber).filter(Subscriber.status == "bounced").count()

    sent_campaigns = db.query(Campaign).filter(Campaign.status == "sent").all()
    total_sent = sum(c.sent_count or 0 for c in sent_campaigns)
    total_opens = sum(c.opens_unique or 0 for c in sent_campaigns)
    total_clicks = sum(c.clicks_unique or 0 for c in sent_campaigns)

    open_rate = (total_opens / total_sent) if total_sent else 0
    click_rate = (total_clicks / total_sent) if total_sent else 0

    scheduled = db.query(Campaign).filter(Campaign.status == "scheduled").count()
    drafts = db.query(Campaign).filter(Campaign.status == "draft").count()

    cutoff = datetime.utcnow() - timedelta(days=30)
    new_30d = db.query(Subscriber).filter(Subscriber.created_at >= cutoff).count()

    by_day: Dict[str, int] = {}
    last7 = datetime.utcnow() - timedelta(days=6)
    for c in sent_campaigns:
        if c.sent_at and c.sent_at >= last7:
            key = c.sent_at.date().isoformat()
            by_day[key] = by_day.get(key, 0) + (c.sent_count or 0)

    return {
        "subscribers": {
            "total": total_subs,
            "active": active_subs,
            "unsubscribed": unsub,
            "bounced": bounced,
            "newLast30Days": new_30d,
        },
        "campaigns": {
            "totalSent": len(sent_campaigns),
            "scheduled": scheduled,
            "drafts": drafts,
            "emailsDelivered": total_sent,
            "uniqueOpens": total_opens,
            "uniqueClicks": total_clicks,
            "openRate": round(open_rate, 4),
            "clickRate": round(click_rate, 4),
            "sendsByDay": by_day,
        },
    }


@router.get("/analytics/recent-campaigns")
def analytics_recent(db: DBSession = Depends(get_db)) -> List[Dict[str, Any]]:
    campaigns = (
        db.query(Campaign)
        .filter(Campaign.status.in_(("sent", "sending")))
        .order_by(Campaign.sent_at.desc().nullslast(), Campaign.id.desc())
        .limit(10)
        .all()
    )
    return [c.to_summary() for c in campaigns]


# ============================================================================
# Public tracking + unsubscribe (no auth, called from inside the email body)
# ============================================================================

_PIXEL_BYTES = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


@router.get("/track/open/{token}")
def track_open(token: str, db: DBSession = Depends(get_db)) -> Response:
    recipient = (
        db.query(CampaignRecipient)
        .filter(CampaignRecipient.open_token == token)
        .first()
    )
    if recipient and recipient.opened_at is None:
        recipient.opened_at = datetime.utcnow()
        if recipient.status == "sent":
            recipient.status = "opened"
        campaign = db.query(Campaign).filter(Campaign.id == recipient.campaign_id).first()
        if campaign:
            campaign.opens_unique = (campaign.opens_unique or 0) + 1
        db.commit()
    return Response(content=_PIXEL_BYTES, media_type="image/gif", headers={
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
    })


@router.get("/track/click/{token}")
def track_click(
    token: str,
    url: str = Query(""),
    db: DBSession = Depends(get_db),
) -> Response:
    recipient = (
        db.query(CampaignRecipient)
        .filter(CampaignRecipient.click_token == token)
        .first()
    )
    if recipient:
        if recipient.clicked_at is None:
            campaign = db.query(Campaign).filter(Campaign.id == recipient.campaign_id).first()
            if campaign:
                campaign.clicks_unique = (campaign.clicks_unique or 0) + 1
        recipient.clicked_at = datetime.utcnow()
        if recipient.status in ("sent", "opened"):
            recipient.status = "clicked"
        db.commit()
    target = url if url.startswith(("http://", "https://")) else "https://example.com"
    return RedirectResponse(url=target, status_code=302)


@router.get("/unsubscribe/{token}")
def unsubscribe_page(token: str, db: DBSession = Depends(get_db)) -> HTMLResponse:
    sub = (
        db.query(Subscriber)
        .filter(Subscriber.unsubscribe_token == token)
        .first()
    )
    if sub and sub.status == "subscribed":
        sub.status = "unsubscribed"
        db.commit()
    body_text = (
        "You've been unsubscribed. We're sorry to see you go."
        if sub else "This unsubscribe link is no longer valid."
    )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:#F5F5F5;color:#262626;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0;padding:24px;}}
.card{{background:#fff;border-radius:12px;padding:48px;max-width:480px;
text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05);}}
h1{{margin:0 0 12px 0;font-size:24px;}}
p{{margin:0;color:#525252;line-height:1.5;}}
</style></head><body>
<div class="card"><h1>Unsubscribed</h1><p>{body_text}</p></div>
</body></html>"""
    return HTMLResponse(content=html)


@router.post("/unsubscribe/{token}")
def unsubscribe_one_click(token: str, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    sub = (
        db.query(Subscriber)
        .filter(Subscriber.unsubscribe_token == token)
        .first()
    )
    if not sub:
        return {"status": "not_found"}
    sub.status = "unsubscribed"
    db.commit()
    return {"status": "unsubscribed", "email": sub.email}


# ============================================================================
# Dashboard root
# ============================================================================

@router.get("/dashboard")
def dashboard(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    overview = analytics_overview(db)
    recent = analytics_recent(db)
    upcoming = (
        db.query(Campaign)
        .filter(Campaign.status == "scheduled")
        .order_by(Campaign.scheduled_at.asc())
        .limit(5)
        .all()
    )
    return {
        "overview": overview,
        "recentCampaigns": recent,
        "upcomingCampaigns": [c.to_summary() for c in upcoming],
    }


# ============================================================================
# Template-provided routes — state + action + UI observation
# ============================================================================

@router.get("/state")
def get_state(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.delete("/state")
def clear_state(db: DBSession = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    payload = request.payload or {}

    if action == "send_campaign":
        cid = payload.get("campaign_id") or payload.get("id")
        if not isinstance(cid, int):
            return {"status": "error", "error": "campaign_id is required"}
        return send_campaign_now(cid, db)

    if action == "schedule_campaign":
        cid = payload.get("campaign_id") or payload.get("id")
        when = payload.get("scheduled_at")
        if not isinstance(cid, int) or not isinstance(when, str):
            return {"status": "error", "error": "campaign_id and scheduled_at are required"}
        return schedule_campaign(cid, CampaignSchedule(scheduled_at=when), db)

    if action == "refresh":
        return {"status": "ok"}

    return {"status": "unknown_action", "action": action}


@router.get("/ui-snapshot")
def get_ui_snapshot(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
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
            "status": "no_snapshot",
        }
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
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
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: DBSession = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {
            "imageData": None,
            "width": None,
            "height": None,
            "timestamp": None,
            "status": "no_screenshot",
        }
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: DBSession = Depends(get_db)) -> Dict[str, Any]:
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
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}
