"""
Tasks + the My Work buckets (overdue / today / upcoming / no date / done).
"""

import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import get_record, log_activity, not_found_ok, record_brief
from database import get_db
from models import Task

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tasks"])


class TaskCreate(BaseModel):
    title: Optional[str] = "New task"
    description: Optional[str] = ""
    due_date: Optional[str] = Field(None, json_schema_extra={"format": "date"})
    record_type: Optional[Literal["person", "company", "deal"]] = None
    record_id: Optional[int] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = Field(None, json_schema_extra={"format": "date"})
    completed: Optional[bool] = None
    record_type: Optional[Literal["person", "company", "deal"]] = None
    record_id: Optional[int] = None


def _task_with_record(db: Session, task: Task) -> Dict[str, Any]:
    data = task.to_dict()
    if task.record_type and task.record_id:
        data["record"] = record_brief(get_record(db, task.record_type, task.record_id))
    else:
        data["record"] = None
    return data


@router.get("/tasks")
def list_tasks(
    record_type: str = "",
    record_id: int = 0,
    include_completed: bool = True,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Task)
    if record_type and record_id:
        query = query.filter(Task.record_type == record_type, Task.record_id == record_id)
    if not include_completed:
        query = query.filter(Task.completed_at.is_(None))
    tasks = query.order_by(Task.completed_at.isnot(None), Task.due_date == "", Task.due_date, Task.id.desc()).all()
    return [_task_with_record(db, t) for t in tasks]


@router.get("/tasks/my-work")
def my_work(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today().isoformat()
    week_out = (date.today() + timedelta(days=7)).isoformat()
    open_tasks = db.query(Task).filter(Task.completed_at.is_(None)).order_by(Task.due_date, Task.id).all()

    buckets: Dict[str, List[Dict[str, Any]]] = {"overdue": [], "today": [], "upcoming": [], "someday": []}
    for task in open_tasks:
        data = _task_with_record(db, task)
        if not task.due_date:
            buckets["someday"].append(data)
        elif task.due_date < today:
            buckets["overdue"].append(data)
        elif task.due_date == today:
            buckets["today"].append(data)
        else:
            buckets["upcoming"].append(data)

    recently_completed = (
        db.query(Task).filter(Task.completed_at.isnot(None))
        .order_by(Task.completed_at.desc()).limit(10).all()
    )
    buckets["completed"] = [_task_with_record(db, t) for t in recently_completed]
    buckets["counts"] = {
        "overdue": len(buckets["overdue"]),
        "today": len(buckets["today"]),
        "upcoming": len([t for t in buckets["upcoming"] if (t.get("dueDate") or "") <= week_out]),
        "open": len(open_tasks),
    }
    return buckets


@router.post("/tasks")
def create_task(
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = Task(
        title=(body.title or "New task").strip() or "New task",
        description=body.description or "",
        due_date=body.due_date or "",
        record_type=body.record_type,
        record_id=body.record_id,
        created_by=user.username,
    )
    db.add(task)
    db.flush()
    if task.record_type and task.record_id and get_record(db, task.record_type, task.record_id) is not None:
        log_activity(
            db, task.record_type, task.record_id, "task_created",
            f"Task: {task.title}",
            actor=user.username,
            extra={"taskId": task.id, "dueDate": task.due_date},
        )
    db.commit()
    db.refresh(task)
    return _task_with_record(db, task)


@router.put("/tasks/{task_id}")
def update_task(
    task_id: int,
    body: TaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        return not_found_ok("task")
    if body.title is not None:
        task.title = body.title
    if body.description is not None:
        task.description = body.description
    if body.due_date is not None:
        task.due_date = body.due_date
    if body.record_type is not None:
        task.record_type = body.record_type
    if body.record_id is not None:
        task.record_id = body.record_id or None
    if body.completed is not None:
        was_completed = task.completed_at is not None
        if body.completed and not was_completed:
            task.completed_at = datetime.utcnow()
            if task.record_type and task.record_id and get_record(db, task.record_type, task.record_id) is not None:
                log_activity(
                    db, task.record_type, task.record_id, "task_completed",
                    f"Completed: {task.title}",
                    actor=user.username,
                    extra={"taskId": task.id},
                )
        elif not body.completed:
            task.completed_at = None
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return _task_with_record(db, task)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        return not_found_ok("task")
    db.delete(task)
    db.commit()
    return {"status": "deleted", "id": task_id}
