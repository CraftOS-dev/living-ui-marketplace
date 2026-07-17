"""
CRM System Data Models

Attio-style architecture on SQLite:
- Fixed core objects (Person, Company, Deal) with system fields as real columns.
- Custom typed attributes via an EAV pair (Attribute + AttributeValue) that
  powers both object-scoped and list-scoped attributes.
- Lists layered on top of objects: a ListEntry carries workflow state (stage,
  board position) without altering the underlying record. Stages belong to a
  list, so every pipeline has independent, inline-editable stages.
- Every meaningful mutation writes an Activity row — the record timeline is
  generated, never hand-maintained.
"""

from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    DateTime,
    Boolean,
    Text,
    JSON,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base
from datetime import datetime
from typing import Dict, Any

Base = declarative_base()


def _iso(dt) -> Any:
    return dt.isoformat() if dt else None


# ============================================================================
# Template models (state storage + agent observation) — do not remove
# ============================================================================

class AppState(Base):
    """Flexible application state storage (JSON blob)."""
    __tablename__ = "app_state"

    id = Column(Integer, primary_key=True, default=1)
    data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "data": self.data or {},
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }

    def update_data(self, updates: Dict[str, Any]) -> None:
        current = self.data or {}
        current.update(updates)
        self.data = current
        self.updated_at = datetime.utcnow()


class UISnapshot(Base):
    """UI state snapshot for agent observation."""
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
            "timestamp": _iso(self.timestamp),
        }


class UIScreenshot(Base):
    """UI screenshot for agent visual observation."""
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
            "timestamp": _iso(self.timestamp),
        }


# ============================================================================
# Core records
# ============================================================================

class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(255), default="")
    last_name = Column(String(255), default="")
    emails = Column(JSON, default=list)   # list[str], first = primary
    phones = Column(JSON, default=list)   # list[str]
    job_title = Column(String(255), default="")
    company_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    linkedin = Column(String(512), default="")
    location = Column(String(255), default="")
    avatar_color = Column(String(32), default="")
    description = Column(Text, default="")
    last_interaction_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def display_name(self) -> str:
        name = f"{self.first_name or ''} {self.last_name or ''}".strip()
        return name or ((self.emails or [None])[0] or "Unnamed person")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "recordType": "person",
            "name": self.display_name(),
            "firstName": self.first_name or "",
            "lastName": self.last_name or "",
            "emails": self.emails or [],
            "phones": self.phones or [],
            "jobTitle": self.job_title or "",
            "companyId": self.company_id,
            "linkedin": self.linkedin or "",
            "location": self.location or "",
            "avatarColor": self.avatar_color or "",
            "description": self.description or "",
            "lastInteractionAt": _iso(self.last_interaction_at),
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), default="")
    domain = Column(String(255), default="", index=True)
    industry = Column(String(255), default="")
    size = Column(String(64), default="")           # e.g. "1-10", "11-50"
    location = Column(String(255), default="")
    annual_revenue = Column(Float, nullable=True)
    linkedin = Column(String(512), default="")
    avatar_color = Column(String(32), default="")
    description = Column(Text, default="")
    last_interaction_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def display_name(self) -> str:
        return self.name or self.domain or "Unnamed company"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "recordType": "company",
            "name": self.display_name(),
            "domain": self.domain or "",
            "industry": self.industry or "",
            "size": self.size or "",
            "location": self.location or "",
            "annualRevenue": self.annual_revenue,
            "linkedin": self.linkedin or "",
            "avatarColor": self.avatar_color or "",
            "description": self.description or "",
            "lastInteractionAt": _iso(self.last_interaction_at),
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class Deal(Base):
    __tablename__ = "deals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), default="")
    value = Column(Float, default=0)
    currency = Column(String(8), default="USD")
    company_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    primary_person_id = Column(Integer, ForeignKey("people.id", ondelete="SET NULL"), nullable=True, index=True)
    owner = Column(String(255), default="")          # username
    status = Column(String(16), default="open")      # open | won | lost
    expected_close_date = Column(String(16), default="")  # ISO date string
    closed_at = Column(DateTime, nullable=True)
    last_interaction_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def display_name(self) -> str:
        return self.name or "Unnamed deal"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "recordType": "deal",
            "name": self.display_name(),
            "value": self.value or 0,
            "currency": self.currency or "USD",
            "companyId": self.company_id,
            "primaryPersonId": self.primary_person_id,
            "owner": self.owner or "",
            "status": self.status or "open",
            "expectedCloseDate": self.expected_close_date or "",
            "closedAt": _iso(self.closed_at),
            "lastInteractionAt": _iso(self.last_interaction_at),
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class DealPerson(Base):
    """Many-to-many link between deals and people."""
    __tablename__ = "deal_people"
    __table_args__ = (UniqueConstraint("deal_id", "person_id", name="uq_deal_person"),)

    id = Column(Integer, primary_key=True)
    deal_id = Column(Integer, ForeignKey("deals.id", ondelete="CASCADE"), nullable=False, index=True)
    person_id = Column(Integer, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True)

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "dealId": self.deal_id, "personId": self.person_id}


# ============================================================================
# Custom attributes (EAV)
# ============================================================================

class Attribute(Base):
    """
    A custom attribute definition. Scoped either to an object type
    (object_type set, list_id NULL) or to a list (list_id set) — Attio's split
    between global record truth and list-specific workflow fields.
    """
    __tablename__ = "attributes"

    id = Column(Integer, primary_key=True, index=True)
    object_type = Column(String(16), nullable=True, index=True)  # person | company | deal
    list_id = Column(Integer, ForeignKey("lists.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), default="")
    slug = Column(String(255), default="", index=True)
    type = Column(String(32), default="text")
    # options: [{"id": "opt_x", "label": "...", "color": "#hex"}] for select/multiselect/status
    options = Column(JSON, default=list)
    is_system = Column(Boolean, default=False)
    ai_prompt = Column(Text, default="")   # for AI-computed attributes
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "objectType": self.object_type,
            "listId": self.list_id,
            "name": self.name or "",
            "slug": self.slug or "",
            "type": self.type or "text",
            "options": self.options or [],
            "isSystem": bool(self.is_system),
            "aiPrompt": self.ai_prompt or "",
            "position": self.position or 0,
            "createdAt": _iso(self.created_at),
        }


class AttributeValue(Base):
    """
    EAV storage for custom attribute values. list_entry_id = 0 means the value
    is record-scoped; otherwise it belongs to a specific list entry
    (list-scoped attributes). Using 0 instead of NULL keeps the uniqueness
    constraint effective in SQLite.
    """
    __tablename__ = "attribute_values"
    __table_args__ = (
        UniqueConstraint("attribute_id", "record_type", "record_id", "list_entry_id", name="uq_attr_value"),
        Index("ix_attr_values_record", "record_type", "record_id"),
    )

    id = Column(Integer, primary_key=True)
    attribute_id = Column(Integer, ForeignKey("attributes.id", ondelete="CASCADE"), nullable=False, index=True)
    record_type = Column(String(16), nullable=False)
    record_id = Column(Integer, nullable=False)
    list_entry_id = Column(Integer, default=0, nullable=False)
    value = Column(JSON, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "attributeId": self.attribute_id,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "listEntryId": self.list_entry_id or 0,
            "value": self.value,
        }


# ============================================================================
# Lists, stages, entries, views
# ============================================================================

class RecordList(Base):
    """A workflow grouping of records (e.g. 'Sales Pipeline', 'Investors')."""
    __tablename__ = "lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), default="")
    icon = Column(String(64), default="list")        # lucide icon name
    color = Column(String(32), default="")
    parent_object = Column(String(16), default="deal")  # person | company | deal
    description = Column(Text, default="")
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name or "",
            "icon": self.icon or "list",
            "color": self.color or "",
            "parentObject": self.parent_object or "deal",
            "description": self.description or "",
            "position": self.position or 0,
            "createdAt": _iso(self.created_at),
        }


class Stage(Base):
    """A kanban column. Stages belong to a list, so pipelines are independent."""
    __tablename__ = "stages"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), default="")
    color = Column(String(32), default="#8b8b94")
    position = Column(Integer, default=0)
    is_won = Column(Boolean, default=False)
    is_lost = Column(Boolean, default=False)
    probability = Column(Float, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "listId": self.list_id,
            "name": self.name or "",
            "color": self.color or "#8b8b94",
            "position": self.position or 0,
            "isWon": bool(self.is_won),
            "isLost": bool(self.is_lost),
            "probability": self.probability,
        }


class ListEntry(Base):
    """Membership of a record in a list + its kanban stage/position."""
    __tablename__ = "list_entries"
    __table_args__ = (
        UniqueConstraint("list_id", "record_type", "record_id", name="uq_list_entry"),
        Index("ix_entries_record", "record_type", "record_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True)
    record_type = Column(String(16), nullable=False)
    record_id = Column(Integer, nullable=False)
    stage_id = Column(Integer, ForeignKey("stages.id", ondelete="SET NULL"), nullable=True, index=True)
    position = Column(Float, default=0)
    stage_entered_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "listId": self.list_id,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "stageId": self.stage_id,
            "position": self.position or 0,
            "stageEnteredAt": _iso(self.stage_entered_at),
            "createdAt": _iso(self.created_at),
        }


class SavedView(Base):
    """A saved view: layout + filters + sorts + columns, per object or list."""
    __tablename__ = "views"

    id = Column(Integer, primary_key=True, index=True)
    object_type = Column(String(16), nullable=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), default="")
    layout = Column(String(16), default="table")     # table | kanban
    filters = Column(JSON, default=list)             # [{field, operator, value}]
    sorts = Column(JSON, default=list)               # [{field, dir}]
    visible_columns = Column(JSON, default=list)     # [field, ...]
    group_by = Column(String(255), default="")
    is_default = Column(Boolean, default=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "objectType": self.object_type,
            "listId": self.list_id,
            "name": self.name or "",
            "layout": self.layout or "table",
            "filters": self.filters or [],
            "sorts": self.sorts or [],
            "visibleColumns": self.visible_columns or [],
            "groupBy": self.group_by or "",
            "isDefault": bool(self.is_default),
            "position": self.position or 0,
            "createdAt": _iso(self.created_at),
        }


# ============================================================================
# Timeline, notes, tasks
# ============================================================================

class Activity(Base):
    """
    Timeline entry. Written by the system on every meaningful mutation
    (stage_change, field_change, created, email_sent, note_created, ...) and
    by users logging calls/meetings/emails manually.
    """
    __tablename__ = "activities"
    __table_args__ = (Index("ix_activities_record", "record_type", "record_id", "occurred_at"),)

    id = Column(Integer, primary_key=True, index=True)
    record_type = Column(String(16), nullable=False)
    record_id = Column(Integer, nullable=False)
    type = Column(String(32), default="other")
    title = Column(String(512), default="")
    body = Column(Text, default="")
    actor = Column(String(255), default="")
    occurred_at = Column(DateTime, default=datetime.utcnow)
    extra = Column(JSON, default=dict)   # avoid 'metadata' (reserved by SQLAlchemy)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "type": self.type or "other",
            "title": self.title or "",
            "body": self.body or "",
            "actor": self.actor or "",
            "occurredAt": _iso(self.occurred_at),
            "extra": self.extra or {},
        }


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_record", "record_type", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    record_type = Column(String(16), nullable=False)
    record_id = Column(Integer, nullable=False)
    title = Column(String(512), default="")
    content = Column(Text, default="")               # markdown
    pinned = Column(Boolean, default=False)
    created_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "title": self.title or "",
            "content": self.content or "",
            "pinned": bool(self.pinned),
            "createdBy": self.created_by or "",
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_record", "record_type", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(512), default="")
    description = Column(Text, default="")
    due_date = Column(String(16), default="")        # ISO date string, "" = no date
    completed_at = Column(DateTime, nullable=True)
    record_type = Column(String(16), nullable=True)
    record_id = Column(Integer, nullable=True)
    created_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title or "",
            "description": self.description or "",
            "dueDate": self.due_date or "",
            "completedAt": _iso(self.completed_at),
            "completed": self.completed_at is not None,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "createdBy": self.created_by or "",
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


# ============================================================================
# Email
# ============================================================================

class SmtpConfig(Base):
    """Singleton SMTP configuration (admin-managed)."""
    __tablename__ = "smtp_config"

    id = Column(Integer, primary_key=True, default=1)
    host = Column(String(255), default="")
    port = Column(Integer, default=587)
    username = Column(String(255), default="")
    password = Column(String(255), default="")
    from_email = Column(String(255), default="")
    from_name = Column(String(255), default="")
    use_tls = Column(Boolean, default=True)

    def to_dict(self, mask_password: bool = True) -> Dict[str, Any]:
        return {
            "host": self.host or "",
            "port": self.port or 587,
            "username": self.username or "",
            "password": ("********" if self.password else "") if mask_password else (self.password or ""),
            "fromEmail": self.from_email or "",
            "fromName": self.from_name or "",
            "useTls": bool(self.use_tls),
            "configured": bool(self.host and self.from_email),
        }


class EmailLog(Base):
    __tablename__ = "email_logs"
    __table_args__ = (Index("ix_email_logs_record", "record_type", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, nullable=True, index=True)
    record_type = Column(String(16), nullable=True)
    record_id = Column(Integer, nullable=True)
    direction = Column(String(16), default="outbound")  # outbound | logged
    to_addr = Column(String(512), default="")
    from_addr = Column(String(512), default="")
    subject = Column(String(512), default="")
    body = Column(Text, default="")
    status = Column(String(32), default="sent")      # sent | failed | logged
    error = Column(Text, default="")
    created_by = Column(String(255), default="")
    sent_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "personId": self.person_id,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "direction": self.direction or "outbound",
            "to": self.to_addr or "",
            "from": self.from_addr or "",
            "subject": self.subject or "",
            "body": self.body or "",
            "status": self.status or "sent",
            "error": self.error or "",
            "createdBy": self.created_by or "",
            "sentAt": _iso(self.sent_at),
        }


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), default="")
    subject = Column(String(512), default="")
    body = Column(Text, default="")                  # supports {{variable}} rendering
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name or "",
            "subject": self.subject or "",
            "body": self.body or "",
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
        }


# ============================================================================
# Tags & attachments
# ============================================================================

class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), default="")
    color = Column(String(32), default="#8b8b94")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "name": self.name or "", "color": self.color or "#8b8b94"}


class RecordTag(Base):
    __tablename__ = "record_tags"
    __table_args__ = (
        UniqueConstraint("tag_id", "record_type", "record_id", name="uq_record_tag"),
        Index("ix_record_tags_record", "record_type", "record_id"),
    )

    id = Column(Integer, primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True)
    record_type = Column(String(16), nullable=False)
    record_id = Column(Integer, nullable=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "tagId": self.tag_id,
            "recordType": self.record_type,
            "recordId": self.record_id,
        }


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (Index("ix_attachments_record", "record_type", "record_id"),)

    id = Column(Integer, primary_key=True, index=True)
    record_type = Column(String(16), nullable=False)
    record_id = Column(Integer, nullable=False)
    file_name = Column(String(512), default="")
    file_path = Column(String(1024), default="")
    size = Column(Integer, default=0)
    mime = Column(String(255), default="")
    created_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "recordType": self.record_type,
            "recordId": self.record_id,
            "fileName": self.file_name or "",
            "size": self.size or 0,
            "mime": self.mime or "",
            "createdBy": self.created_by or "",
            "createdAt": _iso(self.created_at),
        }


# ============================================================================
# AI audit
# ============================================================================

class AiRun(Base):
    """Audit row for every AI invocation (F9.6 — AI must be auditable)."""
    __tablename__ = "ai_runs"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(32), default="chat")   # summary | email_draft | score | chat
    record_type = Column(String(16), nullable=True)
    record_id = Column(Integer, nullable=True)
    input = Column(Text, default="")
    output = Column(Text, default="")
    model = Column(String(128), default="")
    created_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind or "chat",
            "recordType": self.record_type,
            "recordId": self.record_id,
            "input": self.input or "",
            "output": self.output or "",
            "model": self.model or "",
            "createdBy": self.created_by or "",
            "createdAt": _iso(self.created_at),
        }
