"""
Custom attribute definitions + standalone value writes (inline cell edits).
"""

import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import get_record, log_activity, not_found_ok, pick_color, slugify, upsert_attribute_value
from database import get_db
from models import Attribute, AttributeValue

logger = logging.getLogger(__name__)
router = APIRouter(tags=["attributes"])

AttributeType = Literal[
    "text", "number", "currency", "date", "datetime", "select", "multiselect",
    "status", "checkbox", "url", "email", "phone", "rating", "record-reference",
    "ai-generated",
]


class AttributeCreate(BaseModel):
    name: Optional[str] = "New field"
    object_type: Optional[Literal["person", "company", "deal"]] = "person"
    list_id: Optional[int] = None
    type: Optional[AttributeType] = "text"
    options: Optional[List[Dict[str, Any]]] = None
    ai_prompt: Optional[str] = None


class AttributeUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[AttributeType] = None
    options: Optional[List[Dict[str, Any]]] = None
    ai_prompt: Optional[str] = None
    position: Optional[int] = None


class ValueWrite(BaseModel):
    attribute_id: Optional[int] = 0
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = 0
    list_entry_id: Optional[int] = 0
    value: Optional[Any] = None


def _normalize_options(options: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    normalized = []
    for index, option in enumerate(options or []):
        label = str(option.get("label") or option.get("id") or f"Option {index + 1}")
        normalized.append({
            "id": str(option.get("id") or slugify(label)),
            "label": label,
            "color": option.get("color") or pick_color(label),
        })
    return normalized


@router.get("/attributes")
def list_attributes(
    object_type: str = "",
    list_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Attribute)
    if list_id:
        query = query.filter(Attribute.list_id == list_id)
    elif object_type:
        query = query.filter(Attribute.object_type == object_type, Attribute.list_id.is_(None))
    return [a.to_dict() for a in query.order_by(Attribute.position, Attribute.id).all()]


@router.post("/attributes")
def create_attribute(
    body: AttributeCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = (body.name or "New field").strip() or "New field"
    scope_query = db.query(Attribute)
    if body.list_id:
        scope_query = scope_query.filter(Attribute.list_id == body.list_id)
    else:
        scope_query = scope_query.filter(Attribute.object_type == body.object_type, Attribute.list_id.is_(None))

    # Unique slug within scope
    base_slug = slugify(name)
    slug = base_slug
    existing_slugs = {a.slug for a in scope_query.all()}
    suffix = 2
    while slug in existing_slugs:
        slug = f"{base_slug}_{suffix}"
        suffix += 1

    attribute = Attribute(
        name=name,
        slug=slug,
        object_type=None if body.list_id else (body.object_type or "person"),
        list_id=body.list_id,
        type=body.type or "text",
        options=_normalize_options(body.options),
        ai_prompt=body.ai_prompt or "",
        position=len(existing_slugs),
    )
    db.add(attribute)
    db.commit()
    db.refresh(attribute)
    return attribute.to_dict()


@router.put("/attributes/{attribute_id}")
def update_attribute(
    attribute_id: int,
    body: AttributeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attribute = db.get(Attribute, attribute_id)
    if attribute is None:
        return not_found_ok("attribute")
    if body.name is not None and body.name.strip():
        attribute.name = body.name.strip()
    if body.type is not None:
        attribute.type = body.type
    if body.options is not None:
        attribute.options = _normalize_options(body.options)
    if body.ai_prompt is not None:
        attribute.ai_prompt = body.ai_prompt
    if body.position is not None:
        attribute.position = body.position
    db.commit()
    db.refresh(attribute)
    return attribute.to_dict()


@router.delete("/attributes/{attribute_id}")
def delete_attribute(
    attribute_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attribute = db.get(Attribute, attribute_id)
    if attribute is None:
        return not_found_ok("attribute")
    db.query(AttributeValue).filter(AttributeValue.attribute_id == attribute_id).delete()
    db.delete(attribute)
    db.commit()
    return {"status": "deleted", "id": attribute_id}


@router.post("/attribute-values")
def write_value(
    body: ValueWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Single-cell write used by inline table editing for custom attributes."""
    attribute = db.get(Attribute, body.attribute_id or 0)
    if attribute is None or not body.record_id:
        return {"status": "noop"}
    row = upsert_attribute_value(
        db, attribute, body.record_type or "person", body.record_id,
        body.value, body.list_entry_id or 0,
    )
    record = get_record(db, body.record_type or "person", body.record_id)
    if record is not None:
        log_activity(
            db, body.record_type or "person", body.record_id, "field_change",
            f"{attribute.name} updated", actor=user.username,
            extra={"field": attribute.slug, "to": body.value if isinstance(body.value, (str, int, float, bool)) else str(body.value)},
            touch=False,
        )
    db.commit()
    db.refresh(row)
    return row.to_dict()
