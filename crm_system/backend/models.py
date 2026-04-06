"""
CRM System Data Models

SQLAlchemy models for the complete CRM system.
Includes contacts, companies, deals, activities, notes, tags,
email templates, campaigns, AI models, SMTP config, and more.
"""

from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean, Text, JSON, Float,
    Date, ForeignKey, Table, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any, List

Base = declarative_base()


# ============================================================================
# Association Tables (Many-to-Many)
# ============================================================================

contact_tags = Table(
    "contact_tags", Base.metadata,
    Column("contact_id", Integer, ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

company_tags = Table(
    "company_tags", Base.metadata,
    Column("company_id", Integer, ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

deal_tags = Table(
    "deal_tags", Base.metadata,
    Column("deal_id", Integer, ForeignKey("deals.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

deal_contacts = Table(
    "deal_contacts", Base.metadata,
    Column("deal_id", Integer, ForeignKey("deals.id", ondelete="CASCADE"), primary_key=True),
    Column("contact_id", Integer, ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True),
    Column("role", String(100), nullable=True),
)


# ============================================================================
# Framework Models (Required by Living UI)
# ============================================================================

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


# ============================================================================
# Core CRM Models
# ============================================================================

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), nullable=True, index=True)
    phone = Column(String(50), nullable=True)
    job_title = Column(String(150), nullable=True)
    department = Column(String(100), nullable=True)
    linkedin_url = Column(String(500), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)
    zip_code = Column(String(20), nullable=True)
    source = Column(String(50), nullable=True)  # manual, csv_import, web_form, api
    status = Column(String(30), default="active")  # active, inactive, archived
    lead_score = Column(Float, nullable=True)  # AI-computed, 0-100
    lead_status = Column(String(30), default="new")  # new, contacted, qualified, unqualified, customer
    avatar_color = Column(String(7), nullable=True)
    custom_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    company = relationship("Company", back_populates="contacts")
    tags = relationship("Tag", secondary=contact_tags, back_populates="contacts")
    deals = relationship("Deal", secondary=deal_contacts, back_populates="contacts")

    __table_args__ = (
        Index("ix_contacts_last_name", "last_name"),
        Index("ix_contacts_lead_status", "lead_status"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "companyId": self.company_id,
            "companyName": self.company.name if self.company else None,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "email": self.email,
            "phone": self.phone,
            "jobTitle": self.job_title,
            "department": self.department,
            "linkedinUrl": self.linkedin_url,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "country": self.country,
            "zipCode": self.zip_code,
            "source": self.source,
            "status": self.status,
            "leadScore": self.lead_score,
            "leadStatus": self.lead_status,
            "avatarColor": self.avatar_color,
            "customData": self.custom_data or {},
            "tags": [t.to_dict() for t in self.tags] if self.tags else [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_dict_brief(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "email": self.email,
            "companyId": self.company_id,
            "companyName": self.company.name if self.company else None,
            "jobTitle": self.job_title,
            "leadScore": self.lead_score,
            "leadStatus": self.lead_status,
            "avatarColor": self.avatar_color,
            "status": self.status,
        }


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    domain = Column(String(255), nullable=True)
    industry = Column(String(100), nullable=True)
    size = Column(String(50), nullable=True)  # 1-10, 11-50, 51-200, 201-500, 500+
    annual_revenue = Column(Float, nullable=True)
    phone = Column(String(50), nullable=True)
    website = Column(String(500), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    custom_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    contacts = relationship("Contact", back_populates="company", passive_deletes=True)
    deals = relationship("Deal", back_populates="company", passive_deletes=True)
    children = relationship("Company", remote_side=[id],
                            foreign_keys=[parent_id],
                            passive_deletes=True,
                            post_update=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "domain": self.domain,
            "industry": self.industry,
            "size": self.size,
            "annualRevenue": self.annual_revenue,
            "phone": self.phone,
            "website": self.website,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "country": self.country,
            "description": self.description,
            "parentId": self.parent_id,
            "customData": self.custom_data or {},
            "contactCount": len(self.contacts) if self.contacts else 0,
            "dealCount": len(self.deals) if self.deals else 0,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_dict_brief(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "industry": self.industry,
            "size": self.size,
            "contactCount": len(self.contacts) if self.contacts else 0,
        }


class DealStage(Base):
    __tablename__ = "deal_stages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    position = Column(Integer, default=0)
    probability_default = Column(Float, default=0)
    color = Column(String(7), nullable=True)
    is_closed_won = Column(Boolean, default=False)
    is_closed_lost = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    deals = relationship("Deal", back_populates="stage")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "position": self.position,
            "probabilityDefault": self.probability_default,
            "color": self.color,
            "isClosedWon": self.is_closed_won,
            "isClosedLost": self.is_closed_lost,
            "dealCount": len(self.deals) if self.deals else 0,
            "totalValue": sum(d.value or 0 for d in self.deals) if self.deals else 0,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Deal(Base):
    __tablename__ = "deals"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    stage_id = Column(Integer, ForeignKey("deal_stages.id"), nullable=False, index=True)
    value = Column(Float, default=0)
    currency = Column(String(3), default="USD")
    probability = Column(Float, nullable=True)  # 0-100
    expected_close_date = Column(Date, nullable=True)
    actual_close_date = Column(Date, nullable=True)
    status = Column(String(20), default="open", index=True)  # open, won, lost
    loss_reason = Column(String(255), nullable=True)
    owner = Column(String(100), nullable=True)
    priority = Column(String(20), default="medium")  # low, medium, high, urgent
    description = Column(Text, nullable=True)
    position = Column(Integer, default=0)  # order within stage for kanban
    custom_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    stage = relationship("DealStage", back_populates="deals")
    company = relationship("Company", back_populates="deals")
    contacts = relationship("Contact", secondary=deal_contacts, back_populates="deals")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "companyId": self.company_id,
            "companyName": self.company.name if self.company else None,
            "stageId": self.stage_id,
            "stageName": self.stage.name if self.stage else None,
            "value": self.value,
            "currency": self.currency,
            "probability": self.probability,
            "expectedCloseDate": self.expected_close_date.isoformat() if self.expected_close_date else None,
            "actualCloseDate": self.actual_close_date.isoformat() if self.actual_close_date else None,
            "status": self.status,
            "lossReason": self.loss_reason,
            "owner": self.owner,
            "priority": self.priority,
            "description": self.description,
            "position": self.position,
            "customData": self.custom_data or {},
            "contacts": [c.to_dict_brief() for c in self.contacts] if self.contacts else [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_dict_brief(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "companyName": self.company.name if self.company else None,
            "stageId": self.stage_id,
            "stageName": self.stage.name if self.stage else None,
            "value": self.value,
            "currency": self.currency,
            "probability": self.probability,
            "status": self.status,
            "priority": self.priority,
            "position": self.position,
            "expectedCloseDate": self.expected_close_date.isoformat() if self.expected_close_date else None,
        }


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)  # contact, deal, company
    entity_id = Column(Integer, nullable=False)
    activity_type = Column(String(30), nullable=False)  # call, email, meeting, task, note, system
    subject = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    due_date = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True)
    is_completed = Column(Boolean, default=False)
    priority = Column(String(20), default="normal")  # low, normal, high, urgent
    duration_minutes = Column(Integer, nullable=True)
    outcome = Column(String(50), nullable=True)  # positive, neutral, negative
    assigned_to = Column(String(100), nullable=True)
    extra_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_activities_entity", "entity_type", "entity_id"),
        Index("ix_activities_type", "activity_type"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "activityType": self.activity_type,
            "subject": self.subject,
            "description": self.description,
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "isCompleted": self.is_completed,
            "priority": self.priority,
            "durationMinutes": self.duration_minutes,
            "outcome": self.outcome,
            "assignedTo": self.assigned_to,
            "extraData": self.extra_data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)  # contact, deal, company
    entity_id = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    pinned = Column(Boolean, default=False)
    sentiment_score = Column(Float, nullable=True)  # AI-computed, -1.0 to 1.0
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_notes_entity", "entity_type", "entity_id"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "content": self.content,
            "pinned": self.pinned,
            "sentimentScore": self.sentiment_score,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    color = Column(String(7), default="#6366f1")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    contacts = relationship("Contact", secondary=contact_tags, back_populates="tags")
    companies = relationship("Company", secondary=company_tags)
    deals = relationship("Deal", secondary=deal_tags)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    category = Column(String(50), nullable=True)  # follow_up, intro, proposal, etc.
    variables = Column(JSON, default=list)  # ["first_name", "company_name"]
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "subject": self.subject,
            "body": self.body,
            "category": self.category,
            "variables": self.variables or [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


# ============================================================================
# Data Management Models
# ============================================================================

class CustomField(Base):
    __tablename__ = "custom_fields"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)  # contact, deal, company
    field_name = Column(String(100), nullable=False)
    field_label = Column(String(200), nullable=False)
    field_type = Column(String(30), nullable=False)  # text, number, date, select, boolean
    options = Column(JSON, nullable=True)  # for select type
    required = Column(Boolean, default=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entityType": self.entity_type,
            "fieldName": self.field_name,
            "fieldLabel": self.field_label,
            "fieldType": self.field_type,
            "options": self.options,
            "required": self.required,
            "position": self.position,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)
    file_name = Column(String(255), nullable=False)
    status = Column(String(20), default="pending")  # pending, processing, completed, failed
    total_rows = Column(Integer, default=0)
    imported_rows = Column(Integer, default=0)
    skipped_rows = Column(Integer, default=0)
    error_log = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entityType": self.entity_type,
            "fileName": self.file_name,
            "status": self.status,
            "totalRows": self.total_rows,
            "importedRows": self.imported_rows,
            "skippedRows": self.skipped_rows,
            "errorLog": self.error_log or [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)  # contact, deal, company
    entity_id = Column(Integer, nullable=False)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, default=0)
    mime_type = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_attachments_entity", "entity_type", "entity_id"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "fileName": self.file_name,
            "filePath": self.file_path,
            "fileSize": self.file_size,
            "mimeType": self.mime_type,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# AI Models
# ============================================================================

class LeadScore(Base):
    __tablename__ = "lead_scores"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="CASCADE"), unique=True, index=True)
    score = Column(Float, nullable=False)  # 0-100
    factors = Column(JSON, default=dict)
    reasoning = Column(Text, nullable=True)
    scored_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "contactId": self.contact_id,
            "score": self.score,
            "factors": self.factors or {},
            "reasoning": self.reasoning,
            "scoredAt": self.scored_at.isoformat() if self.scored_at else None,
        }


class SalesForecast(Base):
    __tablename__ = "sales_forecasts"

    id = Column(Integer, primary_key=True, index=True)
    deal_id = Column(Integer, ForeignKey("deals.id", ondelete="CASCADE"), unique=True, index=True)
    close_probability = Column(Float)  # 0-100
    predicted_close_date = Column(Date, nullable=True)
    predicted_value = Column(Float, nullable=True)
    reasoning = Column(Text, nullable=True)
    forecast_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "dealId": self.deal_id,
            "closeProbability": self.close_probability,
            "predictedCloseDate": self.predicted_close_date.isoformat() if self.predicted_close_date else None,
            "predictedValue": self.predicted_value,
            "reasoning": self.reasoning,
            "forecastAt": self.forecast_at.isoformat() if self.forecast_at else None,
        }


class MeetingSummary(Base):
    __tablename__ = "meeting_summaries"

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(Integer, ForeignKey("activities.id", ondelete="CASCADE"), index=True)
    summary = Column(Text, nullable=False)
    action_items = Column(JSON, default=list)
    key_topics = Column(JSON, default=list)
    generated_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "activityId": self.activity_id,
            "summary": self.summary,
            "actionItems": self.action_items or [],
            "keyTopics": self.key_topics or [],
            "generatedAt": self.generated_at.isoformat() if self.generated_at else None,
        }


class SentimentRecord(Base):
    __tablename__ = "sentiment_records"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(Integer, nullable=False)
    score = Column(Float)  # -1.0 to 1.0
    label = Column(String(20))  # positive, neutral, negative
    source_type = Column(String(30))  # note, email, meeting
    source_id = Column(Integer)
    analyzed_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "score": self.score,
            "label": self.label,
            "sourceType": self.source_type,
            "sourceId": self.source_id,
            "analyzedAt": self.analyzed_at.isoformat() if self.analyzed_at else None,
        }


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String(10), nullable=False)  # user, assistant
    content = Column(Text, nullable=False)
    query_type = Column(String(30), nullable=True)  # search, report, action
    result_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "queryType": self.query_type,
            "resultData": self.result_data,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# Email & SMTP Models
# ============================================================================

class SmtpConfig(Base):
    __tablename__ = "smtp_config"

    id = Column(Integer, primary_key=True, default=1)
    smtp_server = Column(String(255), nullable=True)
    smtp_port = Column(Integer, default=587)
    email_address = Column(String(255), nullable=True)
    password = Column(String(500), nullable=True)  # stored encrypted
    use_tls = Column(Boolean, default=True)
    from_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "smtpServer": self.smtp_server,
            "smtpPort": self.smtp_port,
            "emailAddress": self.email_address,
            "password": "********" if self.password else None,  # masked
            "useTls": self.use_tls,
            "fromName": self.from_name,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class EmailLog(Base):
    __tablename__ = "email_logs"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True, index=True)
    to_email = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), default="draft")  # draft, sent, failed
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "contactId": self.contact_id,
            "toEmail": self.to_email,
            "subject": self.subject,
            "body": self.body,
            "status": self.status,
            "errorMessage": self.error_message,
            "sentAt": self.sent_at.isoformat() if self.sent_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================================
# Marketing Models
# ============================================================================

class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    campaign_type = Column(String(30), default="email")  # email, sequence
    status = Column(String(20), default="draft")  # draft, active, paused, completed
    subject = Column(String(500), nullable=True)
    body = Column(Text, nullable=True)
    template_id = Column(Integer, ForeignKey("email_templates.id", ondelete="SET NULL"), nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    stats = Column(JSON, default=dict)  # {"sent": 0, "opened": 0, "clicked": 0, "replied": 0}
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "campaignType": self.campaign_type,
            "status": self.status,
            "subject": self.subject,
            "body": self.body,
            "templateId": self.template_id,
            "scheduledAt": self.scheduled_at.isoformat() if self.scheduled_at else None,
            "sentAt": self.sent_at.isoformat() if self.sent_at else None,
            "stats": self.stats or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class CampaignContact(Base):
    __tablename__ = "campaign_contacts"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    status = Column(String(20), default="pending")  # pending, sent, opened, clicked, replied, bounced
    sent_at = Column(DateTime, nullable=True)
    opened_at = Column(DateTime, nullable=True)
    clicked_at = Column(DateTime, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "campaignId": self.campaign_id,
            "contactId": self.contact_id,
            "status": self.status,
            "sentAt": self.sent_at.isoformat() if self.sent_at else None,
            "openedAt": self.opened_at.isoformat() if self.opened_at else None,
            "clickedAt": self.clicked_at.isoformat() if self.clicked_at else None,
        }


class LeadCaptureForm(Base):
    __tablename__ = "lead_capture_forms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    fields = Column(JSON, nullable=False)  # field configuration
    submit_action = Column(String(30), default="create_contact")
    tag_ids = Column(JSON, default=list)  # auto-apply tags
    active = Column(Boolean, default=True)
    submissions_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "fields": self.fields or [],
            "submitAction": self.submit_action,
            "tagIds": self.tag_ids or [],
            "active": self.active,
            "submissionsCount": self.submissions_count,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
