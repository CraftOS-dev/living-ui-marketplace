"""
Saved views: layout + filters + sorts + visible columns, per object or list.
"""

import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import not_found_ok
from database import get_db
from models import SavedView

logger = logging.getLogger(__name__)
router = APIRouter(tags=["views"])


class ViewCreate(BaseModel):
    name: Optional[str] = "New view"
    object_type: Optional[Literal["person", "company", "deal"]] = None
    list_id: Optional[int] = None
    layout: Optional[Literal["table", "kanban"]] = "table"
    filters: Optional[List[Dict[str, Any]]] = None
    sorts: Optional[List[Dict[str, Any]]] = None
    visible_columns: Optional[List[str]] = None
    group_by: Optional[str] = None


class ViewUpdate(BaseModel):
    name: Optional[str] = None
    layout: Optional[Literal["table", "kanban"]] = None
    filters: Optional[List[Dict[str, Any]]] = None
    sorts: Optional[List[Dict[str, Any]]] = None
    visible_columns: Optional[List[str]] = None
    group_by: Optional[str] = None
    is_default: Optional[bool] = None
    position: Optional[int] = None


@router.get("/views")
def list_views(
    object_type: str = "",
    list_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from bootstrap import ensure_defaults
    ensure_defaults(db)
    query = db.query(SavedView)
    if list_id:
        query = query.filter(SavedView.list_id == list_id)
    elif object_type:
        query = query.filter(SavedView.object_type == object_type)
    return [v.to_dict() for v in query.order_by(SavedView.position, SavedView.id).all()]


@router.post("/views")
def create_view(
    body: ViewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = SavedView(
        name=(body.name or "New view").strip() or "New view",
        object_type=body.object_type if not body.list_id else None,
        list_id=body.list_id,
        layout=body.layout or "table",
        filters=body.filters or [],
        sorts=body.sorts or [],
        visible_columns=body.visible_columns or [],
        group_by=body.group_by or "",
        position=db.query(SavedView).count(),
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return view.to_dict()


@router.put("/views/{view_id}")
def update_view(
    view_id: int,
    body: ViewUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = db.get(SavedView, view_id)
    if view is None:
        return not_found_ok("view")
    for field in ("name", "layout", "filters", "sorts", "visible_columns", "group_by", "is_default", "position"):
        value = getattr(body, field)
        if value is not None:
            setattr(view, field, value)
    if body.is_default:
        # Only one default per scope
        siblings = db.query(SavedView).filter(SavedView.id != view_id)
        if view.list_id:
            siblings = siblings.filter(SavedView.list_id == view.list_id)
        else:
            siblings = siblings.filter(SavedView.object_type == view.object_type)
        for sibling in siblings.all():
            sibling.is_default = False
    db.commit()
    db.refresh(view)
    return view.to_dict()


@router.delete("/views/{view_id}")
def delete_view(
    view_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = db.get(SavedView, view_id)
    if view is None:
        return not_found_ok("view")
    db.delete(view)
    db.commit()
    return {"status": "deleted", "id": view_id}
