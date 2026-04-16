"""
CRM System API Routes

REST API endpoints for the complete CRM system.
Covers contacts, companies, deals, activities, notes, tags, email templates,
dashboard, search, import/export, custom fields, attachments, SMTP/email,
campaigns, lead capture forms, reports, AI features, and demo data seeding.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, and_, desc, asc, cast, String
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from database import get_db
from models import (
    AppState, UISnapshot, UIScreenshot,
    Contact, Company, DealStage, Deal, Activity, Note, Tag, EmailTemplate,
    CustomField, ImportJob, Attachment,
    LeadScore, SalesForecast, MeetingSummary, SentimentRecord, ChatMessage,
    SmtpConfig, EmailLog,
    Campaign, CampaignContact, LeadCaptureForm,
    contact_tags, company_tags, deal_tags, deal_contacts,
)
from datetime import datetime, date, timedelta
from pathlib import Path
import logging
import json
import csv
import io
import uuid
import math
import shutil

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOADS_DIR = Path(__file__).parent / "uploads"


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]

class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None

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

class ContactCreate(BaseModel):
    firstName: str
    lastName: str
    email: Optional[str] = None
    phone: Optional[str] = None
    companyId: Optional[int] = None
    jobTitle: Optional[str] = None
    department: Optional[str] = None
    linkedinUrl: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    zipCode: Optional[str] = None
    source: Optional[str] = "manual"
    leadStatus: Optional[str] = "new"
    tagIds: Optional[List[int]] = None
    customData: Optional[Dict[str, Any]] = None

class ContactUpdate(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    companyId: Optional[Any] = None
    jobTitle: Optional[str] = None
    department: Optional[str] = None
    linkedinUrl: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    zipCode: Optional[str] = None
    source: Optional[str] = None
    status: Optional[str] = None
    leadStatus: Optional[str] = None
    tagIds: Optional[Any] = None
    customData: Optional[Any] = None

class CompanyCreate(BaseModel):
    name: str
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    annualRevenue: Optional[Any] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    description: Optional[str] = None
    parentId: Optional[Any] = None
    customData: Optional[Any] = None

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    annualRevenue: Optional[Any] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    description: Optional[str] = None
    parentId: Optional[Any] = None
    customData: Optional[Any] = None

class DealCreate(BaseModel):
    title: str
    companyId: Optional[Any] = None
    stageId: Any = None
    value: Optional[Any] = 0
    currency: Optional[str] = "USD"
    probability: Optional[Any] = None
    expectedCloseDate: Optional[str] = None
    owner: Optional[str] = None
    priority: Optional[str] = "medium"
    description: Optional[str] = None
    contactIds: Optional[Any] = None
    customData: Optional[Any] = None

class DealUpdate(BaseModel):
    title: Optional[str] = None
    companyId: Optional[Any] = None
    stageId: Optional[Any] = None
    value: Optional[Any] = None
    currency: Optional[str] = None
    probability: Optional[Any] = None
    expectedCloseDate: Optional[str] = None
    actualCloseDate: Optional[str] = None
    status: Optional[str] = None
    lossReason: Optional[str] = None
    owner: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    position: Optional[Any] = None
    contactIds: Optional[Any] = None
    customData: Optional[Any] = None

class DealMoveRequest(BaseModel):
    stageId: Any
    position: Any

class StageCreate(BaseModel):
    name: str
    position: Optional[Any] = None
    probabilityDefault: Optional[Any] = 0
    color: Optional[str] = None
    isClosedWon: Optional[Any] = False
    isClosedLost: Optional[Any] = False

class StageUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[Any] = None
    probabilityDefault: Optional[Any] = None
    color: Optional[str] = None
    isClosedWon: Optional[Any] = None
    isClosedLost: Optional[Any] = None

class ActivityCreate(BaseModel):
    entityType: str
    entityId: Any = None
    activityType: str
    subject: str
    description: Optional[str] = None
    dueDate: Optional[str] = None
    priority: Optional[str] = "normal"
    durationMinutes: Optional[Any] = None
    assignedTo: Optional[str] = None
    extraData: Optional[Any] = None

class ActivityUpdate(BaseModel):
    subject: Optional[str] = None
    description: Optional[str] = None
    dueDate: Optional[str] = None
    isCompleted: Optional[Any] = None
    priority: Optional[str] = None
    durationMinutes: Optional[Any] = None
    outcome: Optional[str] = None
    assignedTo: Optional[str] = None
    extraData: Optional[Any] = None

class NoteCreate(BaseModel):
    entityType: str
    entityId: Any = None
    content: str

class NoteUpdate(BaseModel):
    content: Optional[str] = None
    pinned: Optional[Any] = None

class TagCreate(BaseModel):
    name: str
    color: Optional[str] = "#6366f1"

class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

class TemplateCreate(BaseModel):
    name: str
    subject: str
    body: str
    category: Optional[str] = None
    variables: Optional[Any] = None

class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    variables: Optional[Any] = None

class TemplateRenderRequest(BaseModel):
    variables: Optional[Any] = None

class CustomFieldCreate(BaseModel):
    entityType: str
    fieldName: str
    fieldLabel: str
    fieldType: str
    options: Optional[Any] = None
    required: Optional[Any] = False

class CustomFieldUpdate(BaseModel):
    fieldLabel: Optional[str] = None
    options: Optional[Any] = None
    required: Optional[Any] = None
    position: Optional[Any] = None

class SmtpConfigUpdate(BaseModel):
    smtpServer: Optional[str] = None
    smtpPort: Optional[Any] = 587
    emailAddress: Optional[str] = None
    password: Optional[str] = None
    useTls: Optional[Any] = True
    fromName: Optional[str] = None

class EmailSendRequest(BaseModel):
    contactId: Optional[Any] = None
    toEmail: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None

class CampaignCreate(BaseModel):
    name: str
    campaignType: Optional[str] = "email"
    subject: Optional[str] = None
    body: Optional[str] = None
    templateId: Optional[Any] = None

class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    templateId: Optional[Any] = None
    scheduledAt: Optional[str] = None

class FormCreate(BaseModel):
    name: str
    fields: Optional[Any] = None
    submitAction: Optional[str] = "create_contact"
    tagIds: Optional[Any] = None

class FormUpdate(BaseModel):
    name: Optional[str] = None
    fields: Optional[Any] = None
    submitAction: Optional[str] = None
    tagIds: Optional[Any] = None
    active: Optional[Any] = None

class FormSubmission(BaseModel):
    data: Optional[Any] = None

class AIEmailRequest(BaseModel):
    contactId: Optional[Any] = None
    purpose: Optional[str] = None
    tone: Optional[str] = "professional"
    context: Optional[str] = None

class BulkDeleteRequest(BaseModel):
    ids: List[int]

class BulkTagRequest(BaseModel):
    ids: List[int]
    tagIds: List[int]
    action: str = "add"  # add or remove

class ImportRequest(BaseModel):
    data: List[Dict[str, Any]]
    mapping: Optional[Dict[str, str]] = None


# ============================================================================
# Helper Functions
# ============================================================================

def paginate_query(query, page: int, per_page: int):
    """Apply pagination to a SQLAlchemy query."""
    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": items,
        "total": total,
        "page": page,
        "perPage": per_page,
        "pages": math.ceil(total / per_page) if per_page > 0 else 0,
    }


def parse_date(date_str: Optional[str]) -> Optional[date]:
    """Parse ISO date string to date object."""
    if not date_str:
        return None
    try:
        return date.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None


def parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO datetime string to datetime object."""
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def generate_avatar_color() -> str:
    """Generate a random pastel color for contact avatars."""
    import random
    colors = ["#6366f1", "#8b5cf6", "#06b6d4", "#3b82f6", "#22c55e",
              "#f59e0b", "#ef4444", "#ec4899", "#f97316", "#14b8a6"]
    return random.choice(colors)


def safe_int(val: Any) -> Optional[int]:
    """Safely convert to int, returning None on failure."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def safe_float(val: Any) -> Optional[float]:
    """Safely convert to float, returning None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_bool(val: Any) -> Optional[bool]:
    """Safely convert to bool, returning None on failure."""
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        if val.lower() in ("true", "1", "yes"):
            return True
        if val.lower() in ("false", "0", "no"):
            return False
    return None


def safe_list(val: Any) -> Optional[list]:
    """Safely convert to list, returning None on failure."""
    if val is None:
        return None
    if isinstance(val, list):
        return val
    return None


def safe_dict(val: Any) -> Optional[dict]:
    """Safely convert to dict, returning None on failure."""
    if val is None:
        return None
    if isinstance(val, dict):
        return val
    return None


# ============================================================================
# State Management Routes (Framework Required)
# ============================================================================

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
    return state.data or {}


@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.post("/action")
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}
    if request.action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    return {"status": "unknown_action", "action": request.action, "data": current_data}


# ============================================================================
# UI Observation Routes (Framework Required)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {"htmlStructure": None, "visibleText": [], "inputValues": {},
                "componentState": {}, "currentView": None, "viewport": {}, "timestamp": None}
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)
    if data.htmlStructure is not None: snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None: snapshot.visible_text = data.visibleText
    if data.inputValues is not None: snapshot.input_values = data.inputValues
    if data.componentState is not None: snapshot.component_state = data.componentState
    if data.currentView is not None: snapshot.current_view = data.currentView
    if data.viewport is not None: snapshot.viewport = data.viewport
    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {"imageData": None, "width": None, "height": None, "timestamp": None}
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
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}


# ============================================================================
# Contacts
# ============================================================================

@router.get("/contacts")
def list_contacts(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    status: Optional[str] = None,
    lead_status: Optional[str] = None,
    company_id: Optional[int] = None,
    tag: Optional[str] = None,
    sort: str = "created_at",
    order: str = "desc",
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(Contact).options(joinedload(Contact.company), joinedload(Contact.tags))
    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(
            Contact.first_name.ilike(search_term),
            Contact.last_name.ilike(search_term),
            Contact.email.ilike(search_term),
            Contact.phone.ilike(search_term),
        ))
    if status:
        query = query.filter(Contact.status == status)
    if lead_status:
        query = query.filter(Contact.lead_status == lead_status)
    if company_id:
        query = query.filter(Contact.company_id == company_id)
    if tag:
        query = query.join(Contact.tags).filter(Tag.name == tag)

    sort_col = getattr(Contact, sort.replace("_", "_"), Contact.created_at)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    result = paginate_query(query, page, per_page)
    return {
        "items": [c.to_dict() for c in result["items"]],
        "total": result["total"],
        "page": result["page"],
        "perPage": result["perPage"],
        "pages": result["pages"],
    }


@router.post("/contacts")
def create_contact(data: ContactCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contact = Contact(
        first_name=data.firstName,
        last_name=data.lastName,
        email=data.email,
        phone=data.phone,
        company_id=safe_int(data.companyId),
        job_title=data.jobTitle,
        department=data.department,
        linkedin_url=data.linkedinUrl,
        address=data.address,
        city=data.city,
        state=data.state,
        country=data.country,
        zip_code=data.zipCode,
        source=data.source,
        lead_status=data.leadStatus or "new",
        avatar_color=generate_avatar_color(),
        custom_data=safe_dict(data.customData) or {},
    )
    db.add(contact)
    db.flush()

    tag_ids = safe_list(data.tagIds)
    if tag_ids:
        tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all()
        contact.tags = tags

    db.commit()
    db.refresh(contact)
    return contact.to_dict()


@router.get("/contacts/search")
def search_contacts(q: str = Query(..., min_length=1), limit: int = 20, db: Session = Depends(get_db)) -> List[Dict]:
    search_term = f"%{q}%"
    contacts = db.query(Contact).options(joinedload(Contact.company)).filter(or_(
        Contact.first_name.ilike(search_term),
        Contact.last_name.ilike(search_term),
        Contact.email.ilike(search_term),
    )).limit(limit).all()
    return [c.to_dict_brief() for c in contacts]


@router.get("/contacts/duplicates")
def find_duplicate_contacts(db: Session = Depends(get_db)) -> List[Dict]:
    dupes = db.query(Contact.email, func.count(Contact.id).label("cnt")).filter(
        Contact.email.isnot(None), Contact.email != ""
    ).group_by(Contact.email).having(func.count(Contact.id) > 1).all()
    result = []
    for email, count in dupes:
        contacts = db.query(Contact).options(joinedload(Contact.company)).filter(
            Contact.email == email
        ).all()
        result.append({
            "email": email, "count": count,
            "contacts": [c.to_dict_brief() for c in contacts],
        })
    return result


@router.post("/contacts/bulk-delete")
def bulk_delete_contacts(data: BulkDeleteRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deleted = db.query(Contact).filter(Contact.id.in_(data.ids)).delete(synchronize_session=False)
    db.commit()
    return {"status": "deleted", "count": deleted}


@router.post("/contacts/bulk-tag")
def bulk_tag_contacts(data: BulkTagRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contacts = db.query(Contact).filter(Contact.id.in_(data.ids)).all()
    tags = db.query(Tag).filter(Tag.id.in_(data.tagIds)).all()
    for contact in contacts:
        if data.action == "add":
            for tag in tags:
                if tag not in contact.tags:
                    contact.tags.append(tag)
        elif data.action == "remove":
            for tag in tags:
                if tag in contact.tags:
                    contact.tags.remove(tag)
    db.commit()
    return {"status": "updated", "count": len(contacts)}


@router.post("/contacts/merge")
def merge_contacts(data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)) -> Dict[str, Any]:
    data = data or {}
    primary_id = data.get("primaryId")
    merge_id = data.get("mergeId")
    if not primary_id or not merge_id:
        raise HTTPException(status_code=400, detail="primaryId and mergeId required")
    primary = db.query(Contact).filter(Contact.id == primary_id).first()
    merge = db.query(Contact).filter(Contact.id == merge_id).first()
    if not primary or not merge:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.query(Activity).filter(Activity.entity_type == "contact", Activity.entity_id == merge_id).update(
        {"entity_id": primary_id}, synchronize_session=False)
    db.query(Note).filter(Note.entity_type == "contact", Note.entity_id == merge_id).update(
        {"entity_id": primary_id}, synchronize_session=False)
    for field in ["email", "phone", "job_title", "department", "linkedin_url",
                   "address", "city", "state", "country", "zip_code"]:
        if not getattr(primary, field) and getattr(merge, field):
            setattr(primary, field, getattr(merge, field))
    db.delete(merge)
    db.commit()
    db.refresh(primary)
    return primary.to_dict()


@router.get("/contacts/{contact_id}")
def get_contact(contact_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contact = db.query(Contact).options(
        joinedload(Contact.company), joinedload(Contact.tags), joinedload(Contact.deals)
    ).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    result = contact.to_dict()
    result["deals"] = [d.to_dict_brief() for d in contact.deals] if contact.deals else []
    return result


@router.put("/contacts/{contact_id}")
def update_contact(contact_id: int, data: ContactUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contact = db.query(Contact).options(
        joinedload(Contact.company), joinedload(Contact.tags)
    ).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    if data.firstName is not None: contact.first_name = data.firstName
    if data.lastName is not None: contact.last_name = data.lastName
    if data.email is not None: contact.email = data.email
    if data.phone is not None: contact.phone = data.phone
    if data.companyId is not None: contact.company_id = safe_int(data.companyId)
    if data.jobTitle is not None: contact.job_title = data.jobTitle
    if data.department is not None: contact.department = data.department
    if data.linkedinUrl is not None: contact.linkedin_url = data.linkedinUrl
    if data.address is not None: contact.address = data.address
    if data.city is not None: contact.city = data.city
    if data.state is not None: contact.state = data.state
    if data.country is not None: contact.country = data.country
    if data.zipCode is not None: contact.zip_code = data.zipCode
    if data.source is not None: contact.source = data.source
    if data.status is not None: contact.status = data.status
    if data.leadStatus is not None: contact.lead_status = data.leadStatus
    if data.customData is not None: contact.custom_data = safe_dict(data.customData)
    if data.tagIds is not None:
        tag_ids = safe_list(data.tagIds)
        tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []
        contact.tags = tags

    db.commit()
    db.refresh(contact)
    return contact.to_dict()


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"status": "deleted", "id": str(contact_id)}


@router.get("/contacts/{contact_id}/timeline")
def get_contact_timeline(contact_id: int, db: Session = Depends(get_db)) -> List[Dict]:
    activities = db.query(Activity).filter(
        Activity.entity_type == "contact", Activity.entity_id == contact_id
    ).order_by(desc(Activity.created_at)).limit(50).all()
    notes = db.query(Note).filter(
        Note.entity_type == "contact", Note.entity_id == contact_id
    ).order_by(desc(Note.created_at)).limit(50).all()

    timeline = []
    for a in activities:
        item = a.to_dict()
        item["timelineType"] = "activity"
        timeline.append(item)
    for n in notes:
        item = n.to_dict()
        item["timelineType"] = "note"
        timeline.append(item)

    timeline.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return timeline[:50]


# ============================================================================
# Companies
# ============================================================================

@router.get("/companies")
def list_companies(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    industry: Optional[str] = None,
    sort: str = "created_at",
    order: str = "desc",
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(Company).options(joinedload(Company.contacts), joinedload(Company.deals))
    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(Company.name.ilike(search_term), Company.domain.ilike(search_term)))
    if industry:
        query = query.filter(Company.industry == industry)

    sort_col = getattr(Company, sort, Company.created_at)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    result = paginate_query(query, page, per_page)
    return {
        "items": [c.to_dict() for c in result["items"]],
        "total": result["total"],
        "page": result["page"],
        "perPage": result["perPage"],
        "pages": result["pages"],
    }


@router.post("/companies")
def create_company(data: CompanyCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    company = Company(
        name=data.name, domain=data.domain, industry=data.industry,
        size=data.size, annual_revenue=safe_float(data.annualRevenue), phone=data.phone,
        website=data.website, address=data.address, city=data.city,
        state=data.state, country=data.country, description=data.description,
        parent_id=safe_int(data.parentId), custom_data=safe_dict(data.customData) or {},
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return company.to_dict()


@router.get("/companies/{company_id}")
def get_company(company_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    company = db.query(Company).options(
        joinedload(Company.contacts), joinedload(Company.deals)
    ).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company.to_dict()


@router.put("/companies/{company_id}")
def update_company(company_id: int, data: CompanyUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    if data.name is not None: company.name = data.name
    if data.domain is not None: company.domain = data.domain
    if data.industry is not None: company.industry = data.industry
    if data.size is not None: company.size = data.size
    if data.annualRevenue is not None: company.annual_revenue = safe_float(data.annualRevenue)
    if data.phone is not None: company.phone = data.phone
    if data.website is not None: company.website = data.website
    if data.address is not None: company.address = data.address
    if data.city is not None: company.city = data.city
    if data.state is not None: company.state = data.state
    if data.country is not None: company.country = data.country
    if data.description is not None: company.description = data.description
    if data.parentId is not None: company.parent_id = safe_int(data.parentId)
    if data.customData is not None: company.custom_data = safe_dict(data.customData)

    db.commit()
    db.refresh(company)
    return company.to_dict()


@router.delete("/companies/{company_id}")
def delete_company(company_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    # Nullify child company references to avoid circular dependency
    db.query(Company).filter(Company.parent_id == company_id).update(
        {"parent_id": None}, synchronize_session=False)
    # Nullify contact references
    db.query(Contact).filter(Contact.company_id == company_id).update(
        {"company_id": None}, synchronize_session=False)
    # Nullify deal references
    db.query(Deal).filter(Deal.company_id == company_id).update(
        {"company_id": None}, synchronize_session=False)
    db.delete(company)
    db.commit()
    return {"status": "deleted", "id": str(company_id)}


@router.get("/companies/{company_id}/contacts")
def get_company_contacts(company_id: int, db: Session = Depends(get_db)) -> List[Dict]:
    contacts = db.query(Contact).filter(Contact.company_id == company_id).all()
    return [c.to_dict_brief() for c in contacts]


@router.get("/companies/{company_id}/deals")
def get_company_deals(company_id: int, db: Session = Depends(get_db)) -> List[Dict]:
    deals = db.query(Deal).options(joinedload(Deal.stage)).filter(Deal.company_id == company_id).all()
    return [d.to_dict_brief() for d in deals]


# ============================================================================
# Deal Stages
# ============================================================================

@router.get("/stages")
def list_stages(db: Session = Depends(get_db)) -> List[Dict]:
    stages = db.query(DealStage).options(joinedload(DealStage.deals)).order_by(DealStage.position).all()
    return [s.to_dict() for s in stages]


@router.post("/stages")
def create_stage(data: StageCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    position = safe_int(data.position)
    if position is None:
        max_pos = db.query(func.max(DealStage.position)).scalar() or 0
        position = max_pos + 1
    stage = DealStage(
        name=data.name, position=position, probability_default=safe_float(data.probabilityDefault),
        color=data.color, is_closed_won=safe_bool(data.isClosedWon), is_closed_lost=safe_bool(data.isClosedLost),
    )
    db.add(stage)
    db.commit()
    db.refresh(stage)
    return stage.to_dict()


@router.put("/stages/reorder")
def reorder_stages(data: Optional[Any] = None, db: Session = Depends(get_db)) -> List[Dict]:
    items = safe_list(data) or []
    for item in items:
        if isinstance(item, dict) and "id" in item:
            stage = db.query(DealStage).filter(DealStage.id == item["id"]).first()
            if stage and "position" in item:
                stage.position = item["position"]
    db.commit()
    stages = db.query(DealStage).options(joinedload(DealStage.deals)).order_by(DealStage.position).all()
    return [s.to_dict() for s in stages]


@router.put("/stages/{stage_id}")
def update_stage(stage_id: int, data: StageUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    stage = db.query(DealStage).filter(DealStage.id == stage_id).first()
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    if data.name is not None: stage.name = data.name
    if data.position is not None: stage.position = safe_int(data.position)
    if data.probabilityDefault is not None: stage.probability_default = safe_float(data.probabilityDefault)
    if data.color is not None: stage.color = data.color
    if data.isClosedWon is not None: stage.is_closed_won = safe_bool(data.isClosedWon)
    if data.isClosedLost is not None: stage.is_closed_lost = safe_bool(data.isClosedLost)
    db.commit()
    db.refresh(stage)
    return stage.to_dict()


@router.delete("/stages/{stage_id}")
def delete_stage(stage_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    stage = db.query(DealStage).filter(DealStage.id == stage_id).first()
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    deal_count = db.query(Deal).filter(Deal.stage_id == stage_id).count()
    if deal_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete stage with {deal_count} deals. Move deals first.")
    db.delete(stage)
    db.commit()
    return {"status": "deleted", "id": str(stage_id)}


# ============================================================================
# Deals
# ============================================================================

@router.get("/deals")
def list_deals(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    stage_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    sort: str = "created_at",
    order: str = "desc",
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(Deal).options(
        joinedload(Deal.stage), joinedload(Deal.company), joinedload(Deal.contacts)
    )
    if search:
        query = query.filter(Deal.title.ilike(f"%{search}%"))
    if stage_id:
        query = query.filter(Deal.stage_id == stage_id)
    if status:
        query = query.filter(Deal.status == status)
    if priority:
        query = query.filter(Deal.priority == priority)

    sort_col = getattr(Deal, sort, Deal.created_at)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    result = paginate_query(query, page, per_page)
    return {
        "items": [d.to_dict() for d in result["items"]],
        "total": result["total"],
        "page": result["page"],
        "perPage": result["perPage"],
        "pages": result["pages"],
    }


@router.post("/deals")
def create_deal(data: DealCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    stage_id = safe_int(data.stageId)
    if not stage_id:
        raise HTTPException(status_code=400, detail="Invalid stage ID")
    stage = db.query(DealStage).filter(DealStage.id == stage_id).first()
    if not stage:
        raise HTTPException(status_code=400, detail="Invalid stage ID")

    max_pos = db.query(func.max(Deal.position)).filter(Deal.stage_id == stage_id).scalar() or 0
    probability_val = safe_float(data.probability)
    deal = Deal(
        title=data.title, company_id=safe_int(data.companyId), stage_id=stage_id,
        value=safe_float(data.value) or 0, currency=data.currency or "USD",
        probability=probability_val if probability_val is not None else stage.probability_default,
        expected_close_date=parse_date(data.expectedCloseDate),
        owner=data.owner, priority=data.priority or "medium",
        description=data.description, position=max_pos + 1,
        custom_data=safe_dict(data.customData) or {},
    )
    db.add(deal)
    db.flush()

    contact_ids = safe_list(data.contactIds)
    if contact_ids:
        contacts = db.query(Contact).filter(Contact.id.in_(contact_ids)).all()
        deal.contacts = contacts

    db.commit()
    db.refresh(deal)
    return deal.to_dict()


@router.get("/deals/pipeline")
def get_pipeline(db: Session = Depends(get_db)) -> List[Dict]:
    stages = db.query(DealStage).options(joinedload(DealStage.deals)).order_by(DealStage.position).all()
    pipeline = []
    for stage in stages:
        open_deals = [d for d in stage.deals if d.status == "open"] if stage.deals else []
        pipeline.append({
            **stage.to_dict(),
            "deals": sorted(
                [d.to_dict_brief() for d in open_deals],
                key=lambda x: x.get("position", 0)
            ),
        })
    return pipeline


@router.post("/deals/bulk-update")
def bulk_update_deals(data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)) -> Dict[str, Any]:
    data = data or {}
    ids = data.get("ids", [])
    updates = data.get("updates", {})
    count = 0
    for deal in db.query(Deal).filter(Deal.id.in_(ids)).all():
        if "stageId" in updates:
            deal.stage_id = updates["stageId"]
        if "status" in updates:
            deal.status = updates["status"]
        if "priority" in updates:
            deal.priority = updates["priority"]
        count += 1
    db.commit()
    return {"status": "updated", "count": count}


@router.get("/deals/{deal_id}")
def get_deal(deal_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deal = db.query(Deal).options(
        joinedload(Deal.stage), joinedload(Deal.company), joinedload(Deal.contacts)
    ).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal.to_dict()


@router.put("/deals/{deal_id}")
def update_deal(deal_id: int, data: DealUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deal = db.query(Deal).options(
        joinedload(Deal.stage), joinedload(Deal.company), joinedload(Deal.contacts)
    ).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    if data.title is not None: deal.title = data.title
    if data.companyId is not None: deal.company_id = safe_int(data.companyId)
    if data.stageId is not None: deal.stage_id = safe_int(data.stageId)
    if data.value is not None: deal.value = safe_float(data.value) or 0
    if data.currency is not None: deal.currency = data.currency
    if data.probability is not None: deal.probability = safe_float(data.probability)
    if data.expectedCloseDate is not None: deal.expected_close_date = parse_date(data.expectedCloseDate)
    if data.actualCloseDate is not None: deal.actual_close_date = parse_date(data.actualCloseDate)
    if data.status is not None:
        deal.status = data.status
        if data.status == "won":
            deal.actual_close_date = date.today()
        elif data.status == "lost":
            deal.actual_close_date = date.today()
    if data.lossReason is not None: deal.loss_reason = data.lossReason
    if data.owner is not None: deal.owner = data.owner
    if data.priority is not None: deal.priority = data.priority
    if data.description is not None: deal.description = data.description
    if data.position is not None: deal.position = safe_int(data.position)
    if data.customData is not None: deal.custom_data = safe_dict(data.customData)
    if data.contactIds is not None:
        contact_ids = safe_list(data.contactIds)
        contacts = db.query(Contact).filter(Contact.id.in_(contact_ids)).all() if contact_ids else []
        deal.contacts = contacts

    db.commit()
    db.refresh(deal)
    return deal.to_dict()


@router.delete("/deals/{deal_id}")
def delete_deal(deal_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    db.delete(deal)
    db.commit()
    return {"status": "deleted", "id": str(deal_id)}


@router.put("/deals/{deal_id}/move")
def move_deal(deal_id: int, data: DealMoveRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deal = db.query(Deal).options(joinedload(Deal.stage), joinedload(Deal.company)).filter(
        Deal.id == deal_id
    ).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    stage = db.query(DealStage).filter(DealStage.id == data.stageId).first()
    if not stage:
        raise HTTPException(status_code=400, detail="Invalid stage ID")

    deal.stage_id = data.stageId
    deal.position = data.position
    deal.probability = stage.probability_default

    if stage.is_closed_won:
        deal.status = "won"
        deal.actual_close_date = date.today()
    elif stage.is_closed_lost:
        deal.status = "lost"
        deal.actual_close_date = date.today()
    else:
        deal.status = "open"
        deal.actual_close_date = None

    db.commit()
    db.refresh(deal)
    return deal.to_dict()


@router.post("/deals/{deal_id}/contacts")
def link_contact_to_deal(deal_id: int, data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    data = data or {}
    contact = db.query(Contact).filter(Contact.id == data.get("contactId")).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact not in deal.contacts:
        deal.contacts.append(contact)
        db.commit()
    return {"status": "linked"}


@router.delete("/deals/{deal_id}/contacts/{contact_id}")
def unlink_contact_from_deal(deal_id: int, contact_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if contact and contact in deal.contacts:
        deal.contacts.remove(contact)
        db.commit()
    return {"status": "unlinked"}


# ============================================================================
# Activities
# ============================================================================

@router.get("/activities")
def list_activities(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    activity_type: Optional[str] = None,
    is_completed: Optional[bool] = None,
    sort: str = "created_at",
    order: str = "desc",
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(Activity)
    if entity_type:
        query = query.filter(Activity.entity_type == entity_type)
    if entity_id:
        query = query.filter(Activity.entity_id == entity_id)
    if activity_type:
        query = query.filter(Activity.activity_type == activity_type)
    if is_completed is not None:
        query = query.filter(Activity.is_completed == is_completed)

    sort_col = getattr(Activity, sort, Activity.created_at)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    result = paginate_query(query, page, per_page)
    return {
        "items": [a.to_dict() for a in result["items"]],
        "total": result["total"],
        "page": result["page"],
        "perPage": result["perPage"],
        "pages": result["pages"],
    }


@router.post("/activities")
def create_activity(data: ActivityCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    entity_id = safe_int(data.entityId) or 0
    activity = Activity(
        entity_type=data.entityType, entity_id=entity_id,
        activity_type=data.activityType, subject=data.subject,
        description=data.description, due_date=parse_datetime(data.dueDate),
        priority=data.priority, duration_minutes=safe_int(data.durationMinutes),
        assigned_to=data.assignedTo, extra_data=safe_dict(data.extraData) or {},
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity.to_dict()


@router.get("/activities/calendar")
def get_calendar_activities(
    start: str = Query(...), end: str = Query(...),
    db: Session = Depends(get_db),
) -> List[Dict]:
    start_dt = parse_datetime(start)
    end_dt = parse_datetime(end)
    if not start_dt or not end_dt:
        raise HTTPException(status_code=400, detail="Invalid date format")
    activities = db.query(Activity).filter(
        Activity.due_date.isnot(None),
        Activity.due_date >= start_dt,
        Activity.due_date <= end_dt,
    ).order_by(asc(Activity.due_date)).all()
    return [a.to_dict() for a in activities]


@router.get("/activities/upcoming")
def get_upcoming_activities(
    days: int = Query(7, ge=1, le=365),
    db: Session = Depends(get_db),
) -> List[Dict]:
    now = datetime.utcnow()
    end = now + timedelta(days=days)
    activities = db.query(Activity).filter(
        Activity.is_completed == False,
        Activity.due_date.isnot(None),
        Activity.due_date >= now,
        Activity.due_date <= end,
    ).order_by(asc(Activity.due_date)).all()
    return [a.to_dict() for a in activities]


@router.get("/activities/overdue")
def get_overdue_activities(
    db: Session = Depends(get_db),
) -> List[Dict]:
    now = datetime.utcnow()
    activities = db.query(Activity).filter(
        Activity.is_completed == False,
        Activity.due_date.isnot(None),
        Activity.due_date < now,
    ).order_by(asc(Activity.due_date)).all()
    return [a.to_dict() for a in activities]


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity.to_dict()


@router.put("/activities/{activity_id}")
def update_activity(activity_id: int, data: ActivityUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    if data.subject is not None: activity.subject = data.subject
    if data.description is not None: activity.description = data.description
    if data.dueDate is not None: activity.due_date = parse_datetime(data.dueDate)
    if data.isCompleted is not None:
        completed = safe_bool(data.isCompleted)
        activity.is_completed = completed
        activity.completed_at = datetime.utcnow() if completed else None
    if data.priority is not None: activity.priority = data.priority
    if data.durationMinutes is not None: activity.duration_minutes = safe_int(data.durationMinutes)
    if data.outcome is not None: activity.outcome = data.outcome
    if data.assignedTo is not None: activity.assigned_to = data.assignedTo
    if data.extraData is not None: activity.extra_data = safe_dict(data.extraData)

    db.commit()
    db.refresh(activity)
    return activity.to_dict()


@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    db.delete(activity)
    db.commit()
    return {"status": "deleted", "id": str(activity_id)}


@router.put("/activities/{activity_id}/complete")
def complete_activity(activity_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity.is_completed = not activity.is_completed
    activity.completed_at = datetime.utcnow() if activity.is_completed else None
    db.commit()
    db.refresh(activity)
    return activity.to_dict()


# ============================================================================
# Notes
# ============================================================================

@router.get("/notes")
def list_notes(
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    db: Session = Depends(get_db),
) -> List[Dict]:
    query = db.query(Note)
    if entity_type:
        query = query.filter(Note.entity_type == entity_type)
    if entity_id:
        query = query.filter(Note.entity_id == entity_id)
    notes = query.order_by(desc(Note.pinned), desc(Note.created_at)).all()
    return [n.to_dict() for n in notes]


@router.post("/notes")
def create_note(data: NoteCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    entity_id = safe_int(data.entityId) or 0
    note = Note(entity_type=data.entityType, entity_id=entity_id, content=data.content)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note.to_dict()


@router.put("/notes/{note_id}")
def update_note(note_id: int, data: NoteUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if data.content is not None: note.content = data.content
    if data.pinned is not None: note.pinned = safe_bool(data.pinned)
    db.commit()
    db.refresh(note)
    return note.to_dict()


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"status": "deleted", "id": str(note_id)}


@router.put("/notes/{note_id}/pin")
def toggle_pin_note(note_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    note.pinned = not note.pinned
    db.commit()
    db.refresh(note)
    return note.to_dict()


# ============================================================================
# Tags
# ============================================================================

@router.get("/tags")
def list_tags(db: Session = Depends(get_db)) -> List[Dict]:
    tags = db.query(Tag).order_by(Tag.name).all()
    result = []
    for tag in tags:
        d = tag.to_dict()
        d["contactCount"] = len(tag.contacts) if tag.contacts else 0
        result.append(d)
    return result


@router.post("/tags")
def create_tag(data: TagCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    existing = db.query(Tag).filter(Tag.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tag name already exists")
    tag = Tag(name=data.name, color=data.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag.to_dict()


@router.put("/tags/{tag_id}")
def update_tag(tag_id: int, data: TagUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if data.name is not None: tag.name = data.name
    if data.color is not None: tag.color = data.color
    db.commit()
    db.refresh(tag)
    return tag.to_dict()


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()
    return {"status": "deleted", "id": str(tag_id)}


# ============================================================================
# Email Templates
# ============================================================================

@router.get("/email-templates")
def list_templates(category: Optional[str] = None, db: Session = Depends(get_db)) -> List[Dict]:
    query = db.query(EmailTemplate)
    if category:
        query = query.filter(EmailTemplate.category == category)
    templates = query.order_by(desc(EmailTemplate.updated_at)).all()
    return [t.to_dict() for t in templates]


@router.post("/email-templates")
def create_template(data: TemplateCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    template = EmailTemplate(
        name=data.name, subject=data.subject, body=data.body,
        category=data.category, variables=safe_list(data.variables) or [],
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template.to_dict()


@router.get("/email-templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    template = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template.to_dict()


@router.put("/email-templates/{template_id}")
def update_template(template_id: int, data: TemplateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    template = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if data.name is not None: template.name = data.name
    if data.subject is not None: template.subject = data.subject
    if data.body is not None: template.body = data.body
    if data.category is not None: template.category = data.category
    if data.variables is not None: template.variables = safe_list(data.variables)
    db.commit()
    db.refresh(template)
    return template.to_dict()


@router.delete("/email-templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    template = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    return {"status": "deleted", "id": str(template_id)}


@router.post("/email-templates/{template_id}/render")
def render_template(template_id: int, data: TemplateRenderRequest, db: Session = Depends(get_db)) -> Dict[str, str]:
    template = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    subject = template.subject
    body = template.body
    variables = safe_dict(data.variables) or {}
    for key, value in variables.items():
        subject = subject.replace(f"{{{{{key}}}}}", value)
        body = body.replace(f"{{{{{key}}}}}", value)

    return {"subject": subject, "body": body}


# ============================================================================
# Dashboard & Reports
# ============================================================================

@router.get("/dashboard/summary")
def get_dashboard_summary(db: Session = Depends(get_db)) -> Dict[str, Any]:
    total_contacts = db.query(func.count(Contact.id)).scalar() or 0
    total_companies = db.query(func.count(Company.id)).scalar() or 0
    open_deals = db.query(func.count(Deal.id)).filter(Deal.status == "open").scalar() or 0
    won_deals = db.query(func.count(Deal.id)).filter(Deal.status == "won").scalar() or 0
    lost_deals = db.query(func.count(Deal.id)).filter(Deal.status == "lost").scalar() or 0
    pipeline_value = db.query(func.sum(Deal.value)).filter(Deal.status == "open").scalar() or 0
    won_value = db.query(func.sum(Deal.value)).filter(Deal.status == "won").scalar() or 0
    overdue_tasks = db.query(func.count(Activity.id)).filter(
        Activity.is_completed == False, Activity.due_date < datetime.utcnow()
    ).scalar() or 0
    upcoming_tasks = db.query(func.count(Activity.id)).filter(
        Activity.is_completed == False,
        Activity.due_date >= datetime.utcnow(),
        Activity.due_date <= datetime.utcnow() + timedelta(days=7),
    ).scalar() or 0

    # New contacts this month
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    new_contacts_month = db.query(func.count(Contact.id)).filter(
        Contact.created_at >= month_start
    ).scalar() or 0

    # Conversion rate
    total_deals = won_deals + lost_deals
    conversion_rate = round((won_deals / total_deals * 100), 1) if total_deals > 0 else 0

    return {
        "totalContacts": total_contacts,
        "totalCompanies": total_companies,
        "openDeals": open_deals,
        "wonDeals": won_deals,
        "lostDeals": lost_deals,
        "pipelineValue": pipeline_value,
        "wonValue": won_value,
        "overdueTasks": overdue_tasks,
        "upcomingTasks": upcoming_tasks,
        "newContactsMonth": new_contacts_month,
        "conversionRate": conversion_rate,
    }


@router.get("/dashboard/pipeline")
def get_dashboard_pipeline(db: Session = Depends(get_db)) -> List[Dict]:
    stages = db.query(DealStage).order_by(DealStage.position).all()
    result = []
    for stage in stages:
        count = db.query(func.count(Deal.id)).filter(
            Deal.stage_id == stage.id, Deal.status == "open"
        ).scalar() or 0
        value = db.query(func.sum(Deal.value)).filter(
            Deal.stage_id == stage.id, Deal.status == "open"
        ).scalar() or 0
        result.append({
            "id": stage.id,
            "name": stage.name,
            "color": stage.color,
            "dealCount": count,
            "totalValue": value,
        })
    return result


@router.get("/dashboard/recent-activities")
def get_recent_activities(limit: int = 10, db: Session = Depends(get_db)) -> List[Dict]:
    activities = db.query(Activity).order_by(desc(Activity.created_at)).limit(limit).all()
    return [a.to_dict() for a in activities]


@router.get("/reports/sales")
def get_sales_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    group_by: str = "month",
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(Deal).filter(Deal.status.in_(["won", "lost"]))
    if start_date:
        query = query.filter(Deal.actual_close_date >= parse_date(start_date))
    if end_date:
        query = query.filter(Deal.actual_close_date <= parse_date(end_date))

    deals = query.all()

    won = [d for d in deals if d.status == "won"]
    lost = [d for d in deals if d.status == "lost"]

    return {
        "totalDeals": len(deals),
        "wonDeals": len(won),
        "lostDeals": len(lost),
        "wonValue": sum(d.value or 0 for d in won),
        "lostValue": sum(d.value or 0 for d in lost),
        "avgDealSize": round(sum(d.value or 0 for d in won) / len(won), 2) if won else 0,
        "conversionRate": round(len(won) / len(deals) * 100, 1) if deals else 0,
        "deals": [d.to_dict_brief() for d in deals],
    }


@router.get("/reports/conversion")
def get_conversion_report(db: Session = Depends(get_db)) -> List[Dict]:
    stages = db.query(DealStage).order_by(DealStage.position).all()
    result = []
    for stage in stages:
        total = db.query(func.count(Deal.id)).filter(Deal.stage_id == stage.id).scalar() or 0
        result.append({
            "stageName": stage.name,
            "color": stage.color,
            "count": total,
        })
    return result


@router.get("/reports/activity")
def get_activity_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(Activity)
    if start_date:
        query = query.filter(Activity.created_at >= parse_datetime(start_date))
    if end_date:
        query = query.filter(Activity.created_at <= parse_datetime(end_date))

    activities = query.all()

    by_type = {}
    for a in activities:
        by_type[a.activity_type] = by_type.get(a.activity_type, 0) + 1

    completed = len([a for a in activities if a.is_completed])

    return {
        "totalActivities": len(activities),
        "completedActivities": completed,
        "byType": by_type,
        "completionRate": round(completed / len(activities) * 100, 1) if activities else 0,
    }


# ============================================================================
# Global Search
# ============================================================================

@router.get("/search")
def global_search(q: str = Query(..., min_length=1), limit: int = 20, db: Session = Depends(get_db)) -> Dict[str, Any]:
    search_term = f"%{q}%"

    contacts = db.query(Contact).options(joinedload(Contact.company)).filter(or_(
        Contact.first_name.ilike(search_term),
        Contact.last_name.ilike(search_term),
        Contact.email.ilike(search_term),
    )).limit(limit).all()

    companies = db.query(Company).filter(or_(
        Company.name.ilike(search_term),
        Company.domain.ilike(search_term),
    )).limit(limit).all()

    deals = db.query(Deal).options(joinedload(Deal.stage), joinedload(Deal.company)).filter(
        Deal.title.ilike(search_term)
    ).limit(limit).all()

    return {
        "contacts": [c.to_dict_brief() for c in contacts],
        "companies": [c.to_dict_brief() for c in companies],
        "deals": [d.to_dict_brief() for d in deals],
    }


# ============================================================================
# Custom Fields
# ============================================================================

@router.get("/custom-fields")
def list_custom_fields(entity_type: Optional[str] = None, db: Session = Depends(get_db)) -> List[Dict]:
    query = db.query(CustomField)
    if entity_type:
        query = query.filter(CustomField.entity_type == entity_type)
    fields = query.order_by(CustomField.position).all()
    return [f.to_dict() for f in fields]


@router.post("/custom-fields")
def create_custom_field(data: CustomFieldCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    field = CustomField(
        entity_type=data.entityType, field_name=data.fieldName,
        field_label=data.fieldLabel, field_type=data.fieldType,
        options=safe_list(data.options), required=safe_bool(data.required),
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field.to_dict()


@router.put("/custom-fields/{field_id}")
def update_custom_field(field_id: int, data: CustomFieldUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    field = db.query(CustomField).filter(CustomField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Custom field not found")
    if data.fieldLabel is not None: field.field_label = data.fieldLabel
    if data.options is not None: field.options = safe_list(data.options)
    if data.required is not None: field.required = safe_bool(data.required)
    if data.position is not None: field.position = safe_int(data.position)
    db.commit()
    db.refresh(field)
    return field.to_dict()


@router.delete("/custom-fields/{field_id}")
def delete_custom_field(field_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    field = db.query(CustomField).filter(CustomField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Custom field not found")
    db.delete(field)
    db.commit()
    return {"status": "deleted", "id": str(field_id)}


# ============================================================================
# Import / Export
# ============================================================================

@router.post("/import/contacts")
def import_contacts(data: ImportRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    job = ImportJob(entity_type="contact", file_name="api_import", total_rows=len(data.data))
    db.add(job)
    db.flush()

    imported = 0
    skipped = 0
    errors = []

    mapping = data.mapping or {}

    for i, row in enumerate(data.data):
        try:
            first_name = row.get(mapping.get("firstName", "firstName"), row.get("first_name", ""))
            last_name = row.get(mapping.get("lastName", "lastName"), row.get("last_name", ""))
            if not first_name or not last_name:
                skipped += 1
                errors.append({"row": i + 1, "error": "Missing first or last name"})
                continue

            contact = Contact(
                first_name=first_name,
                last_name=last_name,
                email=row.get(mapping.get("email", "email"), row.get("email")),
                phone=row.get(mapping.get("phone", "phone"), row.get("phone")),
                job_title=row.get(mapping.get("jobTitle", "jobTitle"), row.get("job_title")),
                company_id=row.get("companyId"),
                source="csv_import",
                avatar_color=generate_avatar_color(),
            )
            db.add(contact)
            imported += 1
        except Exception as e:
            skipped += 1
            errors.append({"row": i + 1, "error": str(e)})

    job.imported_rows = imported
    job.skipped_rows = skipped
    job.error_log = errors
    job.status = "completed"
    job.completed_at = datetime.utcnow()
    db.commit()

    return job.to_dict()


@router.post("/import/companies")
def import_companies(data: ImportRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    job = ImportJob(entity_type="company", file_name="api_import", total_rows=len(data.data))
    db.add(job)
    db.flush()

    imported = 0
    skipped = 0
    errors = []

    for i, row in enumerate(data.data):
        try:
            name = row.get("name", "")
            if not name:
                skipped += 1
                errors.append({"row": i + 1, "error": "Missing company name"})
                continue

            company = Company(
                name=name,
                domain=row.get("domain"),
                industry=row.get("industry"),
                size=row.get("size"),
                phone=row.get("phone"),
                website=row.get("website"),
            )
            db.add(company)
            imported += 1
        except Exception as e:
            skipped += 1
            errors.append({"row": i + 1, "error": str(e)})

    job.imported_rows = imported
    job.skipped_rows = skipped
    job.error_log = errors
    job.status = "completed"
    job.completed_at = datetime.utcnow()
    db.commit()

    return job.to_dict()


@router.get("/export/contacts")
def export_contacts(db: Session = Depends(get_db)):
    contacts = db.query(Contact).options(joinedload(Contact.company)).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "First Name", "Last Name", "Email", "Phone", "Job Title",
                      "Company", "Lead Status", "Source", "City", "Country", "Created At"])
    for c in contacts:
        writer.writerow([c.id, c.first_name, c.last_name, c.email, c.phone, c.job_title,
                          c.company.name if c.company else "", c.lead_status, c.source,
                          c.city, c.country,
                          c.created_at.isoformat() if c.created_at else ""])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=contacts_export.csv"},
    )


@router.get("/export/deals")
def export_deals(db: Session = Depends(get_db)):
    deals = db.query(Deal).options(joinedload(Deal.stage), joinedload(Deal.company)).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Title", "Company", "Stage", "Value", "Currency",
                      "Status", "Priority", "Expected Close", "Created At"])
    for d in deals:
        writer.writerow([d.id, d.title, d.company.name if d.company else "",
                          d.stage.name if d.stage else "", d.value, d.currency,
                          d.status, d.priority,
                          d.expected_close_date.isoformat() if d.expected_close_date else "",
                          d.created_at.isoformat() if d.created_at else ""])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=deals_export.csv"},
    )


@router.get("/import/jobs")
def list_import_jobs(db: Session = Depends(get_db)) -> List[Dict]:
    jobs = db.query(ImportJob).order_by(desc(ImportJob.created_at)).limit(20).all()
    return [j.to_dict() for j in jobs]


# ============================================================================
# Attachments
# ============================================================================

@router.post("/attachments")
async def upload_attachment(
    entity_type: str = Form(...),
    entity_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    UPLOADS_DIR.mkdir(exist_ok=True)
    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{file_id}_{file.filename}"
    file_path = UPLOADS_DIR / safe_name

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    attachment = Attachment(
        entity_type=entity_type, entity_id=entity_id,
        file_name=file.filename, file_path=str(file_path),
        file_size=len(content), mime_type=file.content_type,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment.to_dict()


@router.get("/attachments/{entity_type}/{entity_id}")
def list_attachments(entity_type: str, entity_id: int, db: Session = Depends(get_db)) -> List[Dict]:
    attachments = db.query(Attachment).filter(
        Attachment.entity_type == entity_type, Attachment.entity_id == entity_id
    ).order_by(desc(Attachment.created_at)).all()
    return [a.to_dict() for a in attachments]


@router.get("/attachments/download/{attachment_id}")
def download_attachment(attachment_id: int, db: Session = Depends(get_db)):
    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    file_path = Path(attachment.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(str(file_path), filename=attachment.file_name, media_type=attachment.mime_type)


@router.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    file_path = Path(attachment.file_path)
    if file_path.exists():
        file_path.unlink()
    db.delete(attachment)
    db.commit()
    return {"status": "deleted", "id": str(attachment_id)}


# ============================================================================
# SMTP & Email
# ============================================================================

@router.get("/smtp/config")
def get_smtp_config(db: Session = Depends(get_db)) -> Dict[str, Any]:
    config = db.query(SmtpConfig).first()
    if not config:
        return {"configured": False}
    result = config.to_dict()
    result["configured"] = bool(config.smtp_server and config.email_address)
    return result


@router.put("/smtp/config")
def update_smtp_config(data: SmtpConfigUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    config = db.query(SmtpConfig).first()
    if not config:
        config = SmtpConfig()
        db.add(config)

    config.smtp_server = data.smtpServer
    config.smtp_port = safe_int(data.smtpPort) or 587
    config.email_address = data.emailAddress
    if data.password:
        config.password = data.password
    config.use_tls = safe_bool(data.useTls)
    config.from_name = data.fromName

    db.commit()
    db.refresh(config)
    return config.to_dict()


@router.post("/smtp/test")
def test_smtp(db: Session = Depends(get_db)) -> Dict[str, Any]:
    config = db.query(SmtpConfig).first()
    if not config or not config.smtp_server:
        return {"status": "error", "error": "SMTP not configured"}

    try:
        from email_service import send_email
        success = send_email(
            config, config.email_address,
            "CRM System - SMTP Test", "This is a test email from your CRM system."
        )
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@router.post("/email/send")
def send_email_to_contact(data: EmailSendRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    config = db.query(SmtpConfig).first()
    if not config or not config.smtp_server:
        return {"status": "error", "error": "SMTP not configured"}

    log = EmailLog(
        contact_id=data.contactId, to_email=data.toEmail,
        subject=data.subject, body=data.body, status="draft",
    )
    db.add(log)
    db.flush()

    try:
        from email_service import send_email
        success = send_email(config, data.toEmail, data.subject, data.body)
        if success:
            log.status = "sent"
            log.sent_at = datetime.utcnow()
        else:
            log.status = "failed"
            log.error_message = "SMTP send returned False"
    except Exception as e:
        log.status = "failed"
        log.error_message = str(e)

    db.commit()
    db.refresh(log)
    return log.to_dict()


@router.get("/email/logs")
def list_email_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(EmailLog).order_by(desc(EmailLog.created_at))
    result = paginate_query(query, page, per_page)
    return {
        "items": [l.to_dict() for l in result["items"]],
        "total": result["total"],
        "page": result["page"],
        "perPage": result["perPage"],
        "pages": result["pages"],
    }


@router.get("/email/logs/{contact_id}")
def get_contact_email_logs(contact_id: int, db: Session = Depends(get_db)) -> List[Dict]:
    logs = db.query(EmailLog).filter(EmailLog.contact_id == contact_id).order_by(
        desc(EmailLog.created_at)
    ).all()
    return [l.to_dict() for l in logs]


# ============================================================================
# Campaigns
# ============================================================================

@router.get("/campaigns")
def list_campaigns(db: Session = Depends(get_db)) -> List[Dict]:
    campaigns = db.query(Campaign).order_by(desc(Campaign.created_at)).all()
    result = []
    for c in campaigns:
        d = c.to_dict()
        d["contactCount"] = db.query(func.count(CampaignContact.id)).filter(
            CampaignContact.campaign_id == c.id
        ).scalar() or 0
        result.append(d)
    return result


@router.post("/campaigns")
def create_campaign(data: CampaignCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    campaign = Campaign(
        name=data.name, campaign_type=data.campaignType,
        subject=data.subject, body=data.body, template_id=safe_int(data.templateId),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign.to_dict()


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    result = campaign.to_dict()
    contacts = db.query(CampaignContact).filter(CampaignContact.campaign_id == campaign_id).all()
    result["contacts"] = [cc.to_dict() for cc in contacts]
    return result


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, data: CampaignUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if data.name is not None: campaign.name = data.name
    if data.status is not None: campaign.status = data.status
    if data.subject is not None: campaign.subject = data.subject
    if data.body is not None: campaign.body = data.body
    if data.templateId is not None: campaign.template_id = safe_int(data.templateId)
    if data.scheduledAt is not None: campaign.scheduled_at = parse_datetime(data.scheduledAt)
    db.commit()
    db.refresh(campaign)
    return campaign.to_dict()


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    db.query(CampaignContact).filter(CampaignContact.campaign_id == campaign_id).delete()
    db.delete(campaign)
    db.commit()
    return {"status": "deleted", "id": str(campaign_id)}


@router.post("/campaigns/{campaign_id}/send")
def send_campaign(campaign_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    smtp_config = db.query(SmtpConfig).first()
    contacts = db.query(CampaignContact).filter(
        CampaignContact.campaign_id == campaign_id,
        CampaignContact.status == "pending",
    ).all()

    sent_count = 0
    for cc in contacts:
        contact = db.query(Contact).filter(Contact.id == cc.contact_id).first()
        if not contact or not contact.email:
            cc.status = "bounced"
            continue

        if smtp_config and smtp_config.smtp_server:
            try:
                from email_service import send_email
                success = send_email(smtp_config, contact.email, campaign.subject or "", campaign.body or "")
                if success:
                    cc.status = "sent"
                    cc.sent_at = datetime.utcnow()
                    sent_count += 1
                else:
                    cc.status = "bounced"
            except Exception:
                cc.status = "bounced"
        else:
            # Simulate send
            cc.status = "sent"
            cc.sent_at = datetime.utcnow()
            sent_count += 1

    campaign.status = "completed"
    campaign.sent_at = datetime.utcnow()
    campaign.stats = {
        "sent": sent_count,
        "bounced": len([c for c in contacts if c.status == "bounced"]),
        "total": len(contacts),
    }
    db.commit()
    return campaign.to_dict()


@router.post("/campaigns/{campaign_id}/contacts")
def add_contacts_to_campaign(campaign_id: int, data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    data = data or {}
    contact_ids = data.get("contactIds", [])
    added = 0
    for cid in contact_ids:
        existing = db.query(CampaignContact).filter(
            CampaignContact.campaign_id == campaign_id,
            CampaignContact.contact_id == cid,
        ).first()
        if not existing:
            cc = CampaignContact(campaign_id=campaign_id, contact_id=cid)
            db.add(cc)
            added += 1
    db.commit()
    return {"status": "added", "count": added}


@router.get("/campaigns/{campaign_id}/analytics")
def get_campaign_analytics(campaign_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    total = db.query(func.count(CampaignContact.id)).filter(
        CampaignContact.campaign_id == campaign_id).scalar() or 0
    sent = db.query(func.count(CampaignContact.id)).filter(
        CampaignContact.campaign_id == campaign_id, CampaignContact.status == "sent").scalar() or 0
    opened = db.query(func.count(CampaignContact.id)).filter(
        CampaignContact.campaign_id == campaign_id, CampaignContact.status == "opened").scalar() or 0
    clicked = db.query(func.count(CampaignContact.id)).filter(
        CampaignContact.campaign_id == campaign_id, CampaignContact.status == "clicked").scalar() or 0
    replied = db.query(func.count(CampaignContact.id)).filter(
        CampaignContact.campaign_id == campaign_id, CampaignContact.status == "replied").scalar() or 0
    bounced = db.query(func.count(CampaignContact.id)).filter(
        CampaignContact.campaign_id == campaign_id, CampaignContact.status == "bounced").scalar() or 0

    return {
        "total": total,
        "sent": sent,
        "opened": opened,
        "clicked": clicked,
        "replied": replied,
        "bounced": bounced,
        "openRate": round(opened / sent * 100, 1) if sent > 0 else 0,
        "clickRate": round(clicked / sent * 100, 1) if sent > 0 else 0,
    }


# ============================================================================
# Lead Capture Forms
# ============================================================================

@router.get("/forms")
def list_forms(db: Session = Depends(get_db)) -> List[Dict]:
    forms = db.query(LeadCaptureForm).order_by(desc(LeadCaptureForm.created_at)).all()
    return [f.to_dict() for f in forms]


@router.post("/forms")
def create_form(data: FormCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    form = LeadCaptureForm(
        name=data.name, fields=safe_list(data.fields),
        submit_action=data.submitAction, tag_ids=safe_list(data.tagIds) or [],
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form.to_dict()


@router.get("/forms/{form_id}")
def get_form(form_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    form = db.query(LeadCaptureForm).filter(LeadCaptureForm.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return form.to_dict()


@router.put("/forms/{form_id}")
def update_form(form_id: int, data: FormUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    form = db.query(LeadCaptureForm).filter(LeadCaptureForm.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if data.name is not None: form.name = data.name
    if data.fields is not None: form.fields = safe_list(data.fields)
    if data.submitAction is not None: form.submit_action = data.submitAction
    if data.tagIds is not None: form.tag_ids = safe_list(data.tagIds)
    if data.active is not None: form.active = safe_bool(data.active)
    db.commit()
    db.refresh(form)
    return form.to_dict()


@router.delete("/forms/{form_id}")
def delete_form(form_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    form = db.query(LeadCaptureForm).filter(LeadCaptureForm.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    db.delete(form)
    db.commit()
    return {"status": "deleted", "id": str(form_id)}


@router.post("/forms/{form_id}/submit")
def submit_form(form_id: int, data: FormSubmission, db: Session = Depends(get_db)) -> Dict[str, Any]:
    form = db.query(LeadCaptureForm).filter(LeadCaptureForm.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if not form.active:
        raise HTTPException(status_code=400, detail="Form is inactive")

    submission_data = data.data
    contact = Contact(
        first_name=submission_data.get("firstName", ""),
        last_name=submission_data.get("lastName", ""),
        email=submission_data.get("email"),
        phone=submission_data.get("phone"),
        source="web_form",
        lead_status="new",
        avatar_color=generate_avatar_color(),
    )
    db.add(contact)
    db.flush()

    # Auto-tag
    if form.tag_ids:
        tags = db.query(Tag).filter(Tag.id.in_(form.tag_ids)).all()
        contact.tags = tags

    form.submissions_count = (form.submissions_count or 0) + 1
    db.commit()
    db.refresh(contact)
    return {"status": "submitted", "contact": contact.to_dict()}


# ============================================================================
# AI Endpoints
# ============================================================================

@router.post("/ai/score-lead/{contact_id}")
def ai_score_lead(contact_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contact = db.query(Contact).options(joinedload(Contact.company)).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    try:
        from ai_service import CRMAIService
        ai = CRMAIService()
        activity_count = db.query(func.count(Activity.id)).filter(
            Activity.entity_type == "contact", Activity.entity_id == contact_id
        ).scalar() or 0
        note_count = db.query(func.count(Note.id)).filter(
            Note.entity_type == "contact", Note.entity_id == contact_id
        ).scalar() or 0
        deal_count = len(contact.deals) if contact.deals else 0

        result = ai.score_lead(contact.to_dict(), activity_count, note_count, deal_count)

        # Persist score
        existing = db.query(LeadScore).filter(LeadScore.contact_id == contact_id).first()
        if existing:
            existing.score = result["score"]
            existing.factors = result["factors"]
            existing.reasoning = result.get("reasoning", "")
            existing.scored_at = datetime.utcnow()
        else:
            score = LeadScore(
                contact_id=contact_id, score=result["score"],
                factors=result["factors"], reasoning=result.get("reasoning", ""),
            )
            db.add(score)

        contact.lead_score = result["score"]
        db.commit()

        return result
    except ImportError:
        return {"status": "unavailable", "error": "AI service not available. Check LLM configuration."}
    except Exception as e:
        logger.error(f"AI lead scoring failed: {e}")
        return {"status": "error", "error": f"AI scoring failed: {str(e)}"}


@router.post("/ai/score-leads")
def ai_batch_score_leads(db: Session = Depends(get_db)) -> Dict[str, Any]:
    contacts = db.query(Contact).filter(Contact.lead_score.is_(None)).limit(50).all()
    scored = 0
    errors = 0
    for contact in contacts:
        try:
            ai_score_lead(contact.id, db)
            scored += 1
        except Exception:
            errors += 1
    return {"scored": scored, "errors": errors, "total": len(contacts)}


@router.post("/ai/generate-email")
def ai_generate_email(data: AIEmailRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contact = db.query(Contact).options(joinedload(Contact.company)).filter(
        Contact.id == data.contactId
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    try:
        from ai_service import CRMAIService
        ai = CRMAIService()

        recent_activities = db.query(Activity).filter(
            Activity.entity_type == "contact", Activity.entity_id == data.contactId
        ).order_by(desc(Activity.created_at)).limit(5).all()

        result = ai.generate_email(
            contact_data=contact.to_dict(),
            purpose=data.purpose,
            tone=data.tone,
            context=data.context,
            recent_activities=[a.to_dict() for a in recent_activities],
        )
        return result
    except ImportError:
        return {"status": "unavailable", "error": "AI service not available"}
    except Exception as e:
        logger.error(f"AI email generation failed: {e}")
        return {"status": "error", "error": f"AI email generation failed: {str(e)}"}


@router.post("/ai/forecast-deal/{deal_id}")
def ai_forecast_deal(deal_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    deal = db.query(Deal).options(
        joinedload(Deal.stage), joinedload(Deal.company)
    ).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    try:
        from ai_service import CRMAIService
        ai = CRMAIService()

        similar_deals = db.query(Deal).filter(
            Deal.id != deal_id, Deal.status.in_(["won", "lost"])
        ).limit(10).all()

        result = ai.forecast_deal(
            deal_data=deal.to_dict(),
            similar_deals=[d.to_dict_brief() for d in similar_deals],
        )

        # Persist forecast
        existing = db.query(SalesForecast).filter(SalesForecast.deal_id == deal_id).first()
        if existing:
            existing.close_probability = result["closeProbability"]
            existing.predicted_close_date = parse_date(result.get("predictedCloseDate"))
            existing.predicted_value = result.get("predictedValue")
            existing.reasoning = result.get("reasoning", "")
            existing.forecast_at = datetime.utcnow()
        else:
            forecast = SalesForecast(
                deal_id=deal_id,
                close_probability=result["closeProbability"],
                predicted_close_date=parse_date(result.get("predictedCloseDate")),
                predicted_value=result.get("predictedValue"),
                reasoning=result.get("reasoning", ""),
            )
            db.add(forecast)

        db.commit()
        return result
    except ImportError:
        return {"status": "unavailable", "error": "AI service not available"}
    except Exception as e:
        logger.error(f"AI deal forecasting failed: {e}")
        return {"status": "error", "error": f"AI forecasting failed: {str(e)}"}


@router.post("/ai/forecast-revenue")
def ai_forecast_revenue(db: Session = Depends(get_db)) -> Dict[str, Any]:
    open_deals = db.query(Deal).options(joinedload(Deal.stage)).filter(Deal.status == "open").all()
    total_weighted = sum((d.value or 0) * (d.probability or 0) / 100 for d in open_deals)
    total_pipeline = sum(d.value or 0 for d in open_deals)

    return {
        "totalPipeline": total_pipeline,
        "weightedForecast": round(total_weighted, 2),
        "dealCount": len(open_deals),
        "avgDealSize": round(total_pipeline / len(open_deals), 2) if open_deals else 0,
    }


@router.post("/ai/summarize-meeting/{activity_id}")
def ai_summarize_meeting(activity_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.activity_type != "meeting":
        raise HTTPException(status_code=400, detail="Activity is not a meeting")

    try:
        from ai_service import CRMAIService
        ai = CRMAIService()
        notes_text = activity.description or ""
        extra_notes = db.query(Note).filter(
            Note.entity_type == activity.entity_type,
            Note.entity_id == activity.entity_id,
        ).order_by(desc(Note.created_at)).limit(3).all()
        for n in extra_notes:
            notes_text += f"\n\n{n.content}"

        result = ai.summarize_meeting(notes_text)

        summary = MeetingSummary(
            activity_id=activity_id,
            summary=result["summary"],
            action_items=result.get("actionItems", []),
            key_topics=result.get("keyTopics", []),
        )
        db.add(summary)
        db.commit()
        return result
    except ImportError:
        return {"status": "unavailable", "error": "AI service not available"}
    except Exception as e:
        logger.error(f"AI meeting summary failed: {e}")
        return {"status": "error", "error": f"AI summary failed: {str(e)}"}


@router.post("/ai/analyze-sentiment")
def ai_analyze_sentiment(data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)) -> Dict[str, Any]:
    data = data or {}
    text = data.get("text", "")
    entity_type = data.get("entityType")
    entity_id = data.get("entityId")
    source_type = data.get("sourceType")
    source_id = data.get("sourceId")

    if not text:
        return {"status": "error", "error": "Text is required"}

    try:
        from ai_service import CRMAIService
        ai = CRMAIService()
        result = ai.analyze_sentiment(text)

        if entity_type and entity_id:
            record = SentimentRecord(
                entity_type=entity_type, entity_id=entity_id,
                score=result["score"], label=result["label"],
                source_type=source_type, source_id=source_id,
            )
            db.add(record)
            db.commit()

        return result
    except ImportError:
        return {"status": "unavailable", "error": "AI service not available"}
    except Exception as e:
        logger.error(f"AI sentiment analysis failed: {e}")
        return {"status": "error", "error": f"AI sentiment failed: {str(e)}"}


@router.post("/ai/enrich-contact/{contact_id}")
def ai_enrich_contact(contact_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    contact = db.query(Contact).options(joinedload(Contact.company)).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    try:
        from ai_service import CRMAIService
        ai = CRMAIService()
        result = ai.enrich_contact(contact.to_dict())
        return result
    except ImportError:
        return {"status": "unavailable", "error": "AI service not available"}
    except Exception as e:
        logger.error(f"AI contact enrichment failed: {e}")
        return {"status": "error", "error": f"AI enrichment failed: {str(e)}"}



@router.post("/ai/generate-demo-data")
def ai_generate_demo_data(db: Session = Depends(get_db)) -> Dict[str, Any]:
    try:
        from seed_data import seed_demo_data
        result = seed_demo_data(db)
        return result
    except ImportError:
        return {"status": "error", "error": "Seed data module not available"}
    except Exception as e:
        logger.error(f"Demo data generation failed: {e}")
        return {"status": "error", "error": f"Demo data generation failed: {str(e)}"}


# ============================================================================
# Seed / Reset
# ============================================================================

@router.post("/seed/demo-data")
def seed_demo(db: Session = Depends(get_db)) -> Dict[str, Any]:
    try:
        from seed_data import seed_demo_data
        result = seed_demo_data(db)
        return result
    except Exception as e:
        return {"status": "error", "error": f"Seeding failed: {str(e)}"}


@router.delete("/seed/reset")
def reset_all_data(db: Session = Depends(get_db)) -> Dict[str, str]:
    # Nullify self-referential FKs first to avoid circular dependency
    db.query(Company).update({"parent_id": None}, synchronize_session=False)
    db.flush()
    for model in [CampaignContact, Campaign, EmailLog, Attachment, ImportJob, CustomField,
                   LeadScore, SalesForecast, MeetingSummary, SentimentRecord, ChatMessage,
                   Note, Activity, Deal, Contact, Company, Tag, LeadCaptureForm, EmailTemplate]:
        db.query(model).delete(synchronize_session=False)
    db.commit()
    return {"status": "reset"}
