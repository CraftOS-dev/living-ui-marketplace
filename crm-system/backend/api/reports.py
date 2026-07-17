"""
Dashboard + reports: pipeline funnel, win rate, velocity, activity volume.
All GET endpoints tolerate an empty database (first run before seeding).
"""

import csv
import io
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import get_record, record_brief
from database import get_db
from models import (
    Activity,
    AppState,
    Company,
    Deal,
    ListEntry,
    Note,
    Person,
    RecordList,
    Stage,
    Task,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["reports"])


def _first_deal_list(db: Session, list_id: int = 0) -> Optional[RecordList]:
    if list_id:
        return db.get(RecordList, list_id)
    return (
        db.query(RecordList)
        .filter(RecordList.parent_object == "deal")
        .order_by(RecordList.position, RecordList.id)
        .first()
    )


def _month_bounds(offset: int) -> (datetime, datetime):
    """offset=0 -> current month, 1 -> last month."""
    today = date.today()
    year = today.year
    month = today.month - offset
    while month <= 0:
        month += 12
        year -= 1
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return start, end


def _pipeline_summary(db: Session, record_list: Optional[RecordList]) -> Dict[str, Any]:
    if record_list is None:
        return {"list": None, "stages": [], "totalValue": 0, "openCount": 0}
    stages = db.query(Stage).filter(Stage.list_id == record_list.id).order_by(Stage.position, Stage.id).all()
    entries = db.query(ListEntry).filter(ListEntry.list_id == record_list.id, ListEntry.record_type == "deal").all()
    deal_ids = [e.record_id for e in entries]
    deals = {d.id: d for d in db.query(Deal).filter(Deal.id.in_(deal_ids or [0])).all()}

    per_stage: Dict[int, Dict[str, Any]] = {
        s.id: {"stage": s.to_dict(), "count": 0, "value": 0.0} for s in stages
    }
    total_value = 0.0
    open_count = 0
    for entry in entries:
        deal = deals.get(entry.record_id)
        if deal is None or entry.stage_id not in per_stage:
            continue
        per_stage[entry.stage_id]["count"] += 1
        per_stage[entry.stage_id]["value"] += deal.value or 0
        stage = per_stage[entry.stage_id]["stage"]
        if not stage["isWon"] and not stage["isLost"]:
            total_value += deal.value or 0
            open_count += 1
    return {
        "list": record_list.to_dict(),
        "stages": [per_stage[s.id] for s in stages],
        "totalValue": total_value,
        "openCount": open_count,
    }


@router.get("/dashboard")
def dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from bootstrap import ensure_defaults
    ensure_defaults(db)
    pipeline = _pipeline_summary(db, _first_deal_list(db))

    # Deals won: this month vs last
    this_start, this_end = _month_bounds(0)
    last_start, last_end = _month_bounds(1)

    def won_between(start: datetime, end: datetime) -> Dict[str, Any]:
        deals = db.query(Deal).filter(
            Deal.status == "won", Deal.closed_at >= start, Deal.closed_at < end
        ).all()
        return {"count": len(deals), "value": sum(d.value or 0 for d in deals)}

    # Tasks due today / overdue
    today_iso = date.today().isoformat()
    open_tasks = db.query(Task).filter(Task.completed_at.is_(None), Task.due_date != "").all()
    due_today = [t for t in open_tasks if t.due_date == today_iso]
    overdue = [t for t in open_tasks if t.due_date < today_iso]

    def task_payload(task: Task) -> Dict[str, Any]:
        data = task.to_dict()
        if task.record_type and task.record_id:
            data["record"] = record_brief(get_record(db, task.record_type, task.record_id))
        return data

    # Recent activity across all records
    recent = db.query(Activity).order_by(Activity.occurred_at.desc(), Activity.id.desc()).limit(15).all()
    recent_payload = []
    for activity in recent:
        item = activity.to_dict()
        item["record"] = record_brief(get_record(db, activity.record_type, activity.record_id))
        if item["record"] is not None:
            recent_payload.append(item)

    # Reconnect: people not touched in 30+ days (or never)
    cutoff = datetime.utcnow() - timedelta(days=30)
    stale_people = (
        db.query(Person)
        .filter((Person.last_interaction_at.is_(None)) | (Person.last_interaction_at < cutoff))
        .order_by(Person.last_interaction_at.asc().nullsfirst())
        .limit(6)
        .all()
    )
    reconnect = []
    for person in stale_people:
        brief = record_brief(person)
        brief["lastInteractionAt"] = person.last_interaction_at.isoformat() if person.last_interaction_at else None
        reconnect.append(brief)

    # Getting-started checklist (dismissable via /api/state)
    state = db.query(AppState).first()
    state_data = (state.data if state else {}) or {}
    checklist = {
        "dismissed": bool(state_data.get("checklistDismissed")),
        "steps": {
            "hasRecords": db.query(Person).count() > 0 or db.query(Company).count() > 0,
            "hasDealMoved": db.query(Activity).filter(Activity.type == "stage_change").count() > 0,
            "hasNote": db.query(Note).count() > 0,
            "hasTask": db.query(Task).count() > 0,
        },
    }

    return {
        "counts": {
            "people": db.query(Person).count(),
            "companies": db.query(Company).count(),
            "deals": db.query(Deal).count(),
            "openTasks": db.query(Task).filter(Task.completed_at.is_(None)).count(),
        },
        "pipeline": pipeline,
        "wonThisMonth": won_between(this_start, this_end),
        "wonLastMonth": won_between(last_start, last_end),
        "tasksDueToday": [task_payload(t) for t in due_today[:8]],
        "tasksOverdue": [task_payload(t) for t in overdue[:8]],
        "recentActivity": recent_payload,
        "reconnect": reconnect,
        "checklist": checklist,
        "seeded": bool(state_data.get("demoSeeded")),
    }


@router.get("/reports/funnel")
def funnel_report(
    list_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_list = _first_deal_list(db, list_id)
    if record_list is None:
        return {"list": None, "stages": []}
    stages = db.query(Stage).filter(Stage.list_id == record_list.id).order_by(Stage.position, Stage.id).all()
    entries = db.query(ListEntry).filter(ListEntry.list_id == record_list.id).all()
    deals = {
        d.id: d for d in db.query(Deal).filter(
            Deal.id.in_([e.record_id for e in entries if e.record_type == "deal"] or [0])
        ).all()
    }

    ordered = [s for s in stages if not s.is_lost]
    position_of = {s.id: index for index, s in enumerate(ordered)}
    max_index = len(ordered) - 1 if ordered else 0

    # A record "reached" stage i if its current stage position >= i (won = end)
    reached = [0] * len(ordered)
    value_at = [0.0] * len(ordered)
    for entry in entries:
        stage_index = position_of.get(entry.stage_id)
        if stage_index is None:
            continue
        deal = deals.get(entry.record_id)
        for i in range(0, stage_index + 1):
            reached[i] += 1
        if deal is not None:
            value_at[stage_index] += deal.value or 0

    base = reached[0] if ordered and reached[0] else 0
    rows = []
    for index, stage in enumerate(ordered):
        rows.append({
            "stage": stage.to_dict(),
            "reached": reached[index] if ordered else 0,
            "currentValue": value_at[index],
            "conversion": round(reached[index] / base * 100, 1) if base else 0.0,
        })
    lost = [s for s in stages if s.is_lost]
    lost_count = 0
    if lost:
        lost_ids = {s.id for s in lost}
        lost_count = sum(1 for e in entries if e.stage_id in lost_ids)
    return {"list": record_list.to_dict(), "stages": rows, "lostCount": lost_count, "maxIndex": max_index}


@router.get("/reports/win-rate")
def win_rate_report(
    months: int = 6,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    months = min(24, max(1, months))
    rows: List[Dict[str, Any]] = []
    for offset in range(months - 1, -1, -1):
        start, end = _month_bounds(offset)
        closed = db.query(Deal).filter(
            Deal.status.in_(("won", "lost")), Deal.closed_at >= start, Deal.closed_at < end
        ).all()
        won = [d for d in closed if d.status == "won"]
        lost = [d for d in closed if d.status == "lost"]
        won_value = sum(d.value or 0 for d in won)
        rows.append({
            "month": start.strftime("%Y-%m"),
            "label": start.strftime("%b"),
            "won": len(won),
            "lost": len(lost),
            "winRate": round(len(won) / len(closed) * 100, 1) if closed else None,
            "wonValue": won_value,
            "avgDealSize": round(won_value / len(won), 2) if won else 0,
        })
    closed_all = db.query(Deal).filter(Deal.status.in_(("won", "lost"))).all()
    won_all = [d for d in closed_all if d.status == "won"]
    return {
        "months": rows,
        "overall": {
            "winRate": round(len(won_all) / len(closed_all) * 100, 1) if closed_all else None,
            "avgDealSize": round(sum(d.value or 0 for d in won_all) / len(won_all), 2) if won_all else 0,
            "totalWonValue": sum(d.value or 0 for d in won_all),
        },
    }


@router.get("/reports/velocity")
def velocity_report(
    list_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Average days spent per stage, from stage_change history + current ages."""
    record_list = _first_deal_list(db, list_id)
    if record_list is None:
        return {"list": None, "stages": []}
    stages = db.query(Stage).filter(Stage.list_id == record_list.id).order_by(Stage.position, Stage.id).all()
    stage_by_name = {s.name: s for s in stages}
    durations: Dict[int, List[float]] = {s.id: [] for s in stages}

    entries = db.query(ListEntry).filter(ListEntry.list_id == record_list.id).all()
    now = datetime.utcnow()
    for entry in entries:
        # Completed stints from the activity history
        history = (
            db.query(Activity)
            .filter(
                Activity.record_type == entry.record_type,
                Activity.record_id == entry.record_id,
                Activity.type == "stage_change",
            )
            .order_by(Activity.occurred_at)
            .all()
        )
        history = [h for h in history if (h.extra or {}).get("listId") == record_list.id]
        previous_time: Optional[datetime] = entry.created_at
        for change in history:
            from_name = (change.extra or {}).get("from")
            stage = stage_by_name.get(from_name) if from_name else None
            if stage is not None and previous_time is not None and change.occurred_at:
                durations[stage.id].append((change.occurred_at - previous_time).total_seconds() / 86400)
            previous_time = change.occurred_at
        # Ongoing stint in the current stage
        if entry.stage_id in durations:
            entered = entry.stage_entered_at or entry.created_at or now
            durations[entry.stage_id].append((now - entered).total_seconds() / 86400)

    rows = []
    for stage in stages:
        stints = durations.get(stage.id) or []
        rows.append({
            "stage": stage.to_dict(),
            "avgDays": round(sum(stints) / len(stints), 1) if stints else 0,
            "samples": len(stints),
        })
    return {"list": record_list.to_dict(), "stages": rows}


@router.get("/reports/activity-volume")
def activity_volume_report(
    weeks: int = 8,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    weeks = min(26, max(1, weeks))
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    rows: List[Dict[str, Any]] = []
    group_map = {
        "email": "emails", "note_created": "notes", "note": "notes",
        "task_created": "tasks", "task_completed": "tasks",
        "call": "meetings", "meeting": "meetings",
        "stage_change": "changes", "field_change": "changes",
        "created": "changes", "list_added": "changes",
    }
    for offset in range(weeks - 1, -1, -1):
        week_start = start_of_week - timedelta(weeks=offset)
        week_end = week_start + timedelta(days=7)
        activities = db.query(Activity).filter(
            Activity.occurred_at >= datetime.combine(week_start, datetime.min.time()),
            Activity.occurred_at < datetime.combine(week_end, datetime.min.time()),
        ).all()
        counts = {"emails": 0, "notes": 0, "tasks": 0, "meetings": 0, "changes": 0}
        for activity in activities:
            group = group_map.get(activity.type, "changes")
            counts[group] += 1
        rows.append({
            "week": week_start.isoformat(),
            "label": week_start.strftime("%b %d"),
            "total": len(activities),
            **counts,
        })
    return {"weeks": rows}


@router.get("/reports/export")
def export_report(
    report: str = "funnel",
    list_id: int = 0,
    months: int = 6,
    weeks: int = 8,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """CSV export of any report."""
    output = io.StringIO()
    writer = csv.writer(output)
    if report == "win-rate":
        data = win_rate_report(months=months, user=user, db=db)
        writer.writerow(["Month", "Won", "Lost", "Win rate %", "Won value", "Avg deal size"])
        for row in data["months"]:
            writer.writerow([row["month"], row["won"], row["lost"], row["winRate"], row["wonValue"], row["avgDealSize"]])
    elif report == "velocity":
        data = velocity_report(list_id=list_id, user=user, db=db)
        writer.writerow(["Stage", "Avg days", "Samples"])
        for row in data["stages"]:
            writer.writerow([row["stage"]["name"], row["avgDays"], row["samples"]])
    elif report == "activity-volume":
        data = activity_volume_report(weeks=weeks, user=user, db=db)
        writer.writerow(["Week", "Total", "Emails", "Notes", "Tasks", "Meetings", "Changes"])
        for row in data["weeks"]:
            writer.writerow([row["week"], row["total"], row["emails"], row["notes"], row["tasks"], row["meetings"], row["changes"]])
    else:
        data = funnel_report(list_id=list_id, user=user, db=db)
        writer.writerow(["Stage", "Reached", "Conversion %", "Current value"])
        for row in data["stages"]:
            writer.writerow([row["stage"]["name"], row["reached"], row["conversion"], row["currentValue"]])
    return PlainTextResponse(output.getvalue(), media_type="text/csv")
