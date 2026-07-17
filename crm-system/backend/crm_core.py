"""
Shared CRM helpers used by every API router.

Absolute imports only (repo rule). Keeps the record-type polymorphism in one
place: resolving records, writing timeline activities, serializing rows for
the data table, and the smoke-test-safe "200 on missing" response contract.
"""

import re
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from sqlalchemy.orm import Session

from models import (
    Activity,
    Attribute,
    AttributeValue,
    Company,
    Deal,
    DealPerson,
    ListEntry,
    Person,
    RecordTag,
    Stage,
    Tag,
)

RecordType = Literal["person", "company", "deal"]

RECORD_MODELS = {"person": Person, "company": Company, "deal": Deal}

# Deterministic pastel palette for avatars / new select options / stages.
PASTEL_COLORS = [
    "#7c9ce8", "#8fbf8f", "#d9a662", "#c98bc9", "#6fbfbf",
    "#e08e8e", "#a3a3e0", "#b5a642", "#7fb3d9", "#c4967a",
]


def pick_color(seed: str) -> str:
    return PASTEL_COLORS[sum(ord(c) for c in (seed or "x")) % len(PASTEL_COLORS)]


def slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text or "field"


def get_record(db: Session, record_type: str, record_id: int):
    model = RECORD_MODELS.get(record_type)
    if not model or not record_id:
        return None
    return db.query(model).filter(model.id == record_id).first()


def record_brief(record) -> Optional[Dict[str, Any]]:
    """Small chip payload: enough to render an avatar + name + link."""
    if record is None:
        return None
    record_type = (
        "person" if isinstance(record, Person)
        else "company" if isinstance(record, Company)
        else "deal"
    )
    brief: Dict[str, Any] = {
        "id": record.id,
        "recordType": record_type,
        "name": record.display_name(),
        "avatarColor": getattr(record, "avatar_color", "") or pick_color(record.display_name()),
    }
    if record_type == "company":
        brief["domain"] = record.domain or ""
    if record_type == "person":
        brief["email"] = (record.emails or [""])[0] if record.emails else ""
    if record_type == "deal":
        brief["value"] = record.value or 0
        brief["currency"] = record.currency or "USD"
        brief["status"] = record.status or "open"
    return brief


def log_activity(
    db: Session,
    record_type: str,
    record_id: int,
    type: str,
    title: str,
    body: str = "",
    actor: str = "",
    extra: Optional[Dict[str, Any]] = None,
    occurred_at: Optional[datetime] = None,
    touch: bool = True,
) -> Activity:
    """Write a timeline activity and stamp last_interaction_at on the record."""
    activity = Activity(
        record_type=record_type,
        record_id=record_id,
        type=type,
        title=title,
        body=body or "",
        actor=actor or "",
        extra=extra or {},
        occurred_at=occurred_at or datetime.utcnow(),
    )
    db.add(activity)
    if touch:
        record = get_record(db, record_type, record_id)
        if record is not None and hasattr(record, "last_interaction_at"):
            record.last_interaction_at = activity.occurred_at
    return activity


def not_found_ok(kind: str = "resource") -> Dict[str, Any]:
    """
    Smoke-test-safe response for PUT/DELETE on a missing row. The marketplace
    external test can wipe data mid-run (seed/clear), so mutating a missing
    resource must be a 200 no-op, never a 4xx.
    """
    return {"status": "not_found", "resource": kind}


def get_tags_for_records(db: Session, record_type: str, record_ids: List[int]) -> Dict[int, List[Dict]]:
    """record_id -> [tag dicts]"""
    if not record_ids:
        return {}
    rows = (
        db.query(RecordTag, Tag)
        .join(Tag, Tag.id == RecordTag.tag_id)
        .filter(RecordTag.record_type == record_type, RecordTag.record_id.in_(record_ids))
        .all()
    )
    out: Dict[int, List[Dict]] = {}
    for link, tag in rows:
        out.setdefault(link.record_id, []).append(tag.to_dict())
    return out


def get_values_for_records(db: Session, record_type: str, record_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    """record_id -> {slug: value} for record-scoped custom attribute values."""
    if not record_ids:
        return {}
    rows = (
        db.query(AttributeValue, Attribute)
        .join(Attribute, Attribute.id == AttributeValue.attribute_id)
        .filter(
            AttributeValue.record_type == record_type,
            AttributeValue.record_id.in_(record_ids),
            AttributeValue.list_entry_id == 0,
        )
        .all()
    )
    out: Dict[int, Dict[str, Any]] = {}
    for value_row, attribute in rows:
        out.setdefault(value_row.record_id, {})[attribute.slug] = value_row.value
    return out


def upsert_attribute_value(
    db: Session,
    attribute: Attribute,
    record_type: str,
    record_id: int,
    value: Any,
    list_entry_id: int = 0,
) -> AttributeValue:
    row = (
        db.query(AttributeValue)
        .filter(
            AttributeValue.attribute_id == attribute.id,
            AttributeValue.record_type == record_type,
            AttributeValue.record_id == record_id,
            AttributeValue.list_entry_id == (list_entry_id or 0),
        )
        .first()
    )
    if row is None:
        row = AttributeValue(
            attribute_id=attribute.id,
            record_type=record_type,
            record_id=record_id,
            list_entry_id=list_entry_id or 0,
            value=value,
        )
        db.add(row)
    else:
        row.value = value
    return row


def serialize_record_row(
    db: Session,
    record,
    record_type: str,
    values: Optional[Dict[str, Any]] = None,
    tags: Optional[List[Dict]] = None,
    company_briefs: Optional[Dict[int, Dict]] = None,
) -> Dict[str, Any]:
    """Full table-row payload: system fields + custom values + tags + company chip."""
    row = record.to_dict()
    row["attributes"] = values or {}
    row["tags"] = tags or []
    company_id = getattr(record, "company_id", None)
    if company_id:
        if company_briefs is not None and company_id in company_briefs:
            row["company"] = company_briefs[company_id]
        else:
            row["company"] = record_brief(db.query(Company).filter(Company.id == company_id).first())
    return row


def delete_record_cascade(db: Session, record_type: str, record) -> None:
    """D-2: deleting a record cascades to everything that references it."""
    from models import Attachment, EmailLog, Note, Task  # local import to avoid cycles

    record_id = record.id
    db.query(Activity).filter_by(record_type=record_type, record_id=record_id).delete()
    db.query(Note).filter_by(record_type=record_type, record_id=record_id).delete()
    db.query(AttributeValue).filter_by(record_type=record_type, record_id=record_id).delete()
    db.query(ListEntry).filter_by(record_type=record_type, record_id=record_id).delete()
    db.query(RecordTag).filter_by(record_type=record_type, record_id=record_id).delete()
    db.query(Attachment).filter_by(record_type=record_type, record_id=record_id).delete()
    db.query(Task).filter_by(record_type=record_type, record_id=record_id).update(
        {"record_type": None, "record_id": None}
    )
    if record_type == "person":
        db.query(DealPerson).filter_by(person_id=record_id).delete()
        db.query(Deal).filter_by(primary_person_id=record_id).update({"primary_person_id": None})
        db.query(EmailLog).filter_by(person_id=record_id).update({"person_id": None})
    if record_type == "company":
        db.query(Person).filter_by(company_id=record_id).update({"company_id": None})
        db.query(Deal).filter_by(company_id=record_id).update({"company_id": None})
    if record_type == "deal":
        db.query(DealPerson).filter_by(deal_id=record_id).delete()
    db.delete(record)


def stage_map_for_list(db: Session, list_id: int) -> Dict[int, Stage]:
    stages = db.query(Stage).filter(Stage.list_id == list_id).order_by(Stage.position).all()
    return {s.id: s for s in stages}
