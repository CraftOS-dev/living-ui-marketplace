"""
Tags: cross-object quick labels + record assignments.
"""

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import not_found_ok, pick_color
from database import get_db
from models import RecordTag, Tag

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tags"])


class TagBody(BaseModel):
    name: Optional[str] = "New tag"
    color: Optional[str] = None


class TagAssignBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = 0


@router.get("/tags")
def list_tags(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return [t.to_dict() for t in db.query(Tag).order_by(Tag.name).all()]


@router.post("/tags")
def create_tag(
    body: TagBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = (body.name or "New tag").strip() or "New tag"
    existing = db.query(Tag).filter(Tag.name.ilike(name)).first()
    if existing:
        return existing.to_dict()
    tag = Tag(name=name, color=body.color or pick_color(name))
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag.to_dict()


@router.put("/tags/{tag_id}")
def update_tag(
    tag_id: int,
    body: TagBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if tag is None:
        return not_found_ok("tag")
    if body.name is not None and body.name.strip():
        tag.name = body.name.strip()
    if body.color is not None:
        tag.color = body.color
    db.commit()
    db.refresh(tag)
    return tag.to_dict()


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if tag is None:
        return not_found_ok("tag")
    db.query(RecordTag).filter(RecordTag.tag_id == tag_id).delete()
    db.delete(tag)
    db.commit()
    return {"status": "deleted", "id": tag_id}


@router.post("/tags/{tag_id}/records")
def assign_tag(
    tag_id: int,
    body: TagAssignBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if tag is None or not body.record_id:
        return {"status": "noop"}
    existing = db.query(RecordTag).filter_by(
        tag_id=tag_id, record_type=body.record_type or "person", record_id=body.record_id
    ).first()
    if existing:
        return existing.to_dict()
    link = RecordTag(tag_id=tag_id, record_type=body.record_type or "person", record_id=body.record_id)
    db.add(link)
    db.commit()
    db.refresh(link)
    return link.to_dict()


@router.delete("/tags/{tag_id}/records/{record_type}/{record_id}")
def unassign_tag(
    tag_id: int,
    record_type: str,
    record_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    link = db.query(RecordTag).filter_by(
        tag_id=tag_id, record_type=record_type, record_id=record_id
    ).first()
    if link is None:
        return not_found_ok("tag assignment")
    db.delete(link)
    db.commit()
    return {"status": "deleted"}
