"""
Newsletter Tool — SQLAlchemy models.

Entities:
- Subscriber           : recipient with email, name, tags, status
- Template             : reusable email design (blocks + subject)
- Campaign             : an outgoing newsletter (blocks + subject + target + schedule)
- CampaignRecipient    : per-recipient delivery & tracking record
- SenderIdentity       : the from-name / from-email used for sends (singleton)
- LLMCache             : cache for AI generations
- AppState / UISnapshot / UIScreenshot : template-provided
"""

from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean, Text, JSON, ForeignKey, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any
import secrets

Base = declarative_base()


def _new_token(n: int = 22) -> str:
    """URL-safe random token used for tracking + unsubscribe links."""
    return secrets.token_urlsafe(n)


# ---------------------------------------------------------------------------
# Template-provided models (state, agent observability)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Newsletter Tool models
# ---------------------------------------------------------------------------

class Subscriber(Base):
    __tablename__ = "subscribers"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    first_name = Column(String(120), nullable=True)
    last_name = Column(String(120), nullable=True)
    status = Column(String(20), default="subscribed", nullable=False, index=True)
    tags = Column(JSON, default=list)
    bounce_reason = Column(String(255), nullable=True)
    unsubscribe_token = Column(String(64), unique=True, nullable=False, default=_new_token, index=True)
    source = Column(String(40), default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "email": self.email,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "status": self.status,
            "tags": self.tags or [],
            "bounceReason": self.bounce_reason,
            "unsubscribeToken": self.unsubscribe_token,
            "source": self.source,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Template(Base):
    __tablename__ = "templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), nullable=False)
    subject = Column(String(255), default="")
    preheader = Column(String(255), default="")
    blocks = Column(JSON, default=list)
    design = Column(JSON, default=dict)
    category = Column(String(40), default="custom")
    is_builtin = Column(Boolean, default=False, nullable=False)
    icon = Column(String(40), default="FiMail")
    usage_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "subject": self.subject or "",
            "preheader": self.preheader or "",
            "blocks": self.blocks or [],
            "design": self.design or {},
            "category": self.category,
            "isBuiltin": self.is_builtin,
            "icon": self.icon,
            "usageCount": int(self.usage_count or 0),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), nullable=False)
    subject = Column(String(255), default="")
    preheader = Column(String(255), default="")
    from_name = Column(String(120), nullable=True)
    from_email = Column(String(320), nullable=True)
    reply_to = Column(String(320), nullable=True)
    blocks = Column(JSON, default=list)
    design = Column(JSON, default=dict)
    target_tags = Column(JSON, default=list)
    target_all = Column(Boolean, default=True, nullable=False)
    status = Column(String(20), default="draft", nullable=False, index=True)
    scheduled_at = Column(DateTime, nullable=True, index=True)
    sent_at = Column(DateTime, nullable=True)
    total_recipients = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    opens_unique = Column(Integer, default=0)
    clicks_unique = Column(Integer, default=0)
    unsubscribes = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    recipients = relationship(
        "CampaignRecipient",
        back_populates="campaign",
        cascade="all, delete-orphan",
    )

    def to_summary(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "subject": self.subject or "",
            "preheader": self.preheader or "",
            "fromName": self.from_name,
            "fromEmail": self.from_email,
            "replyTo": self.reply_to,
            "status": self.status,
            "targetTags": self.target_tags or [],
            "targetAll": self.target_all,
            "scheduledAt": self.scheduled_at.isoformat() if self.scheduled_at else None,
            "sentAt": self.sent_at.isoformat() if self.sent_at else None,
            "totalRecipients": self.total_recipients or 0,
            "sentCount": self.sent_count or 0,
            "failedCount": self.failed_count or 0,
            "opensUnique": self.opens_unique or 0,
            "clicksUnique": self.clicks_unique or 0,
            "unsubscribes": self.unsubscribes or 0,
            "errorMessage": self.error_message,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_detail(self) -> Dict[str, Any]:
        d = self.to_summary()
        d["blocks"] = self.blocks or []
        d["design"] = self.design or {}
        return d


class CampaignRecipient(Base):
    __tablename__ = "campaign_recipients"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    subscriber_id = Column(Integer, nullable=True, index=True)
    email_snapshot = Column(String(320), nullable=False)
    name_snapshot = Column(String(255), nullable=True)
    status = Column(String(20), default="pending", nullable=False, index=True)
    open_token = Column(String(64), unique=True, nullable=False, default=_new_token, index=True)
    click_token = Column(String(64), unique=True, nullable=False, default=_new_token, index=True)
    sent_at = Column(DateTime, nullable=True)
    opened_at = Column(DateTime, nullable=True)
    clicked_at = Column(DateTime, nullable=True)
    error_message = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    campaign = relationship("Campaign", back_populates="recipients")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "campaignId": self.campaign_id,
            "subscriberId": self.subscriber_id,
            "email": self.email_snapshot,
            "name": self.name_snapshot,
            "status": self.status,
            "openToken": self.open_token,
            "clickToken": self.click_token,
            "sentAt": self.sent_at.isoformat() if self.sent_at else None,
            "openedAt": self.opened_at.isoformat() if self.opened_at else None,
            "clickedAt": self.clicked_at.isoformat() if self.clicked_at else None,
            "errorMessage": self.error_message,
        }


Index(
    "ix_recipient_campaign_subscriber",
    CampaignRecipient.campaign_id,
    CampaignRecipient.subscriber_id,
)


class SenderIdentity(Base):
    """Singleton row (id = 1) — the from-name / from-email used for sends."""
    __tablename__ = "sender_identity"

    id = Column(Integer, primary_key=True, default=1)
    from_name = Column(String(120), default="")
    from_email = Column(String(320), default="")
    reply_to = Column(String(320), default="")
    organization_name = Column(String(160), default="")
    organization_address = Column(String(255), default="")
    tracking_base_url = Column(String(255), default="")
    subscribe_key = Column(String(64), default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "fromName": self.from_name or "",
            "fromEmail": self.from_email or "",
            "replyTo": self.reply_to or "",
            "organizationName": self.organization_name or "",
            "organizationAddress": self.organization_address or "",
            "trackingBaseUrl": self.tracking_base_url or "",
            "subscribeKey": self.subscribe_key or "",
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class LLMCache(Base):
    __tablename__ = "llm_cache"

    id = Column(Integer, primary_key=True, index=True)
    cache_key = Column(String(64), unique=True, nullable=False, index=True)
    content = Column(JSON, default=dict)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
