"""
On-demand AI via CraftBot's LLM provider (F9). Every route responds 200 with
{"configured": false} when no LLM is available — honest degradation, no 4xx.
Every invocation is audited as an AiRun.
"""

import json
import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import (
    RECORD_MODELS,
    get_record,
    get_values_for_records,
    record_brief,
    upsert_attribute_value,
)
from database import get_db
from models import Activity, AiRun, Attribute, Company, Deal, ListEntry, Note, Person, RecordList, Stage, Task
from services.llm_service import generate_text_sync, llm_available, llm_model_name, parse_json_response

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ai"])

AI_SCORE_SLUG = "ai_lead_score"


class SummaryBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = 0
    save_as_note: Optional[bool] = False


class EmailDraftBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = None
    record_id: Optional[int] = None
    instruction: Optional[str] = ""
    tone: Optional[Literal["professional", "friendly", "concise", "warm", "direct"]] = "professional"
    current_draft: Optional[str] = ""
    subject: Optional[str] = ""


class ScoreBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    record_id: Optional[int] = None
    record_ids: Optional[List[int]] = None


class ChatBody(BaseModel):
    question: Optional[str] = ""


def _not_configured() -> Dict[str, Any]:
    return {
        "configured": False,
        "message": "No LLM provider is configured in CraftBot. Connect one in CraftBot settings to enable AI features.",
    }


def _record_context(db: Session, record_type: str, record_id: int, max_activities: int = 25) -> str:
    """Build a text context bundle for a record: fields, values, timeline, related."""
    record = get_record(db, record_type, record_id)
    if record is None:
        return ""
    lines: List[str] = [f"== {record_type.upper()}: {record.display_name()} =="]
    data = record.to_dict()
    for key, value in data.items():
        if key in ("recordType", "avatarColor", "id") or value in (None, "", []):
            continue
        lines.append(f"{key}: {value}")

    values = get_values_for_records(db, record_type, [record_id]).get(record_id) or {}
    if values:
        lines.append("-- Custom attributes --")
        for slug, value in values.items():
            lines.append(f"{slug}: {value}")

    if record_type == "person" and record.company_id:
        company = db.get(Company, record.company_id)
        if company is not None:
            lines.append(f"Company: {company.display_name()} ({company.industry or 'unknown industry'})")

    entries = db.query(ListEntry).filter_by(record_type=record_type, record_id=record_id).all()
    for entry in entries:
        record_list = db.get(RecordList, entry.list_id)
        stage = db.get(Stage, entry.stage_id) if entry.stage_id else None
        if record_list is not None:
            lines.append(f"List: {record_list.name}" + (f" — stage: {stage.name}" if stage else ""))

    tasks = db.query(Task).filter_by(record_type=record_type, record_id=record_id, completed_at=None).all()
    if tasks:
        lines.append("-- Open tasks --")
        for task in tasks[:10]:
            lines.append(f"* {task.title} (due {task.due_date or 'no date'})")

    notes = db.query(Note).filter_by(record_type=record_type, record_id=record_id).order_by(Note.pinned.desc()).limit(5).all()
    if notes:
        lines.append("-- Notes --")
        for note in notes:
            lines.append(f"* {note.title or 'Note'}: {(note.content or '')[:300]}")

    activities = (
        db.query(Activity).filter_by(record_type=record_type, record_id=record_id)
        .order_by(Activity.occurred_at.desc()).limit(max_activities).all()
    )
    if activities:
        lines.append("-- Recent timeline (newest first) --")
        for activity in activities:
            when = activity.occurred_at.strftime("%Y-%m-%d") if activity.occurred_at else "?"
            lines.append(f"[{when}] {activity.type}: {activity.title} {(activity.body or '')[:150]}")
    return "\n".join(lines)


def _audit(db: Session, kind: str, user: User, input_text: str, output_text: str,
           record_type: Optional[str] = None, record_id: Optional[int] = None) -> AiRun:
    run = AiRun(
        kind=kind,
        record_type=record_type,
        record_id=record_id,
        input=input_text[:8000],
        output=output_text[:16000],
        model=llm_model_name(),
        created_by=user.username,
    )
    db.add(run)
    return run


@router.get("/ai/status")
def ai_status(user: User = Depends(get_current_user)):
    available = llm_available()
    return {"configured": available, "model": llm_model_name() if available else ""}


@router.post("/ai/summary")
def ai_summary(
    body: SummaryBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not llm_available():
        return _not_configured()
    context = _record_context(db, body.record_type or "person", body.record_id or 0)
    if not context:
        return {"configured": True, "ok": False, "error": "Record not found"}

    system = (
        "You are a CRM assistant. Summarize the state of this relationship in crisp "
        "markdown: 2-3 sentence overview, then bullets for key facts, open threads, "
        "and a suggested next step. Be specific; use only the provided data."
    )
    output = generate_text_sync(system, context)
    if not output:
        return {"configured": True, "ok": False, "error": "The LLM request failed. Try again."}

    _audit(db, "summary", user, context, output, body.record_type, body.record_id)
    note_dict = None
    if body.save_as_note and body.record_id:
        note = Note(
            record_type=body.record_type or "person",
            record_id=body.record_id,
            title="AI summary",
            content=output,
            pinned=True,
            created_by=user.username,
        )
        db.add(note)
        db.flush()
        note_dict = note.to_dict()
    db.commit()
    return {"configured": True, "ok": True, "summary": output, "note": note_dict}


@router.post("/ai/email-draft")
def ai_email_draft(
    body: EmailDraftBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not llm_available():
        return _not_configured()
    context = ""
    if body.record_type and body.record_id:
        context = _record_context(db, body.record_type, body.record_id, max_activities=10)

    system = (
        "You draft CRM emails. Respond ONLY with JSON: {\"subject\": string, \"body\": string}. "
        f"Tone: {body.tone or 'professional'}. The body is plain text with paragraphs; "
        "no placeholders like [Name] — use real names from the context, sign off as the sender naturally."
    )
    parts = []
    if context:
        parts.append(f"Recipient context:\n{context}")
    if body.current_draft:
        parts.append(f"Current draft to refine:\n{body.current_draft}")
    if body.subject:
        parts.append(f"Current subject: {body.subject}")
    parts.append(f"Instruction: {body.instruction or 'Write a helpful follow-up email.'}")
    prompt = "\n\n".join(parts)

    output = generate_text_sync(system, prompt)
    if not output:
        return {"configured": True, "ok": False, "error": "The LLM request failed. Try again."}
    parsed = parse_json_response(output) or {}
    subject = parsed.get("subject") if isinstance(parsed, dict) else None
    content = parsed.get("body") if isinstance(parsed, dict) else None
    if not content:
        content = output
        subject = subject or (body.subject or "Follow-up")
    _audit(db, "email_draft", user, prompt, output, body.record_type, body.record_id)
    db.commit()
    return {"configured": True, "ok": True, "subject": subject or "", "body": content}


def _ensure_score_attribute(db: Session, record_type: str) -> Attribute:
    attribute = (
        db.query(Attribute)
        .filter(Attribute.object_type == record_type, Attribute.slug == AI_SCORE_SLUG)
        .first()
    )
    if attribute is None:
        attribute = Attribute(
            object_type=record_type,
            slug=AI_SCORE_SLUG,
            name="AI Lead Score",
            type="number",
            is_system=True,
            position=999,
        )
        db.add(attribute)
        db.flush()
    return attribute


@router.post("/ai/score")
def ai_score(
    body: ScoreBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not llm_available():
        return _not_configured()
    record_type = body.record_type or "person"
    ids = list(body.record_ids or [])
    if body.record_id:
        ids.append(body.record_id)
    ids = [i for i in dict.fromkeys(ids) if i][:20]  # bulk cap
    if not ids:
        return {"configured": True, "ok": False, "error": "No records provided"}

    attribute = _ensure_score_attribute(db, record_type)
    results = []
    for record_id in ids:
        context = _record_context(db, record_type, record_id, max_activities=15)
        if not context:
            continue
        system = (
            "You are a lead-scoring engine for an AI-agent startup's CRM. Score this "
            "record 0-100 for how promising it is to pursue now. Respond ONLY with JSON: "
            "{\"score\": number, \"reasoning\": string (2-3 sentences, specific)}."
        )
        output = generate_text_sync(system, context)
        parsed = parse_json_response(output or "") or {}
        score = parsed.get("score") if isinstance(parsed, dict) else None
        reasoning = parsed.get("reasoning") if isinstance(parsed, dict) else ""
        if not isinstance(score, (int, float)):
            continue
        score = max(0, min(100, round(float(score))))
        upsert_attribute_value(db, attribute, record_type, record_id, score)
        _audit(db, "score", user, context, json.dumps(parsed), record_type, record_id)
        record = get_record(db, record_type, record_id)
        results.append({
            "recordId": record_id,
            "record": record_brief(record),
            "score": score,
            "reasoning": reasoning or "",
        })
    db.commit()
    return {"configured": True, "ok": True, "results": results, "attributeSlug": AI_SCORE_SLUG}


def _crm_snapshot(db: Session) -> str:
    """Compact CRM-wide context for 'ask your CRM' chat."""
    lines: List[str] = []
    lines.append(f"People: {db.query(Person).count()}, Companies: {db.query(Company).count()}, Deals: {db.query(Deal).count()}")
    deal_lists = db.query(RecordList).order_by(RecordList.position).all()
    for record_list in deal_lists:
        stages = db.query(Stage).filter(Stage.list_id == record_list.id).order_by(Stage.position).all()
        entries = db.query(ListEntry).filter(ListEntry.list_id == record_list.id).all()
        by_stage: Dict[int, int] = {}
        for entry in entries:
            by_stage[entry.stage_id] = by_stage.get(entry.stage_id, 0) + 1
        stage_bits = ", ".join(f"{s.name}: {by_stage.get(s.id, 0)}" for s in stages)
        lines.append(f"List '{record_list.name}' ({record_list.parent_object}): {stage_bits}")
    deals = db.query(Deal).order_by(Deal.value.desc()).limit(40).all()
    lines.append("-- Deals (id | name | value | status | stage-entered) --")
    entry_map: Dict[int, ListEntry] = {}
    for entry in db.query(ListEntry).filter(ListEntry.record_type == "deal").all():
        entry_map.setdefault(entry.record_id, entry)
    for deal in deals:
        entry = entry_map.get(deal.id)
        entered = entry.stage_entered_at.strftime("%Y-%m-%d") if entry and entry.stage_entered_at else "?"
        lines.append(f"deal#{deal.id} | {deal.display_name()} | {deal.currency} {deal.value or 0:,.0f} | {deal.status} | in stage since {entered}")
    people = db.query(Person).limit(60).all()
    lines.append("-- People (id | name | title | last interaction) --")
    for person in people:
        last = person.last_interaction_at.strftime("%Y-%m-%d") if person.last_interaction_at else "never"
        lines.append(f"person#{person.id} | {person.display_name()} | {person.job_title or '-'} | {last}")
    companies = db.query(Company).limit(40).all()
    lines.append("-- Companies (id | name | industry) --")
    for company in companies:
        lines.append(f"company#{company.id} | {company.display_name()} | {company.industry or '-'}")
    open_tasks = db.query(Task).filter(Task.completed_at.is_(None)).limit(30).all()
    lines.append("-- Open tasks --")
    for task in open_tasks:
        lines.append(f"task#{task.id} | {task.title} | due {task.due_date or 'no date'}")
    return "\n".join(lines)


@router.post("/ai/chat")
def ai_chat(
    body: ChatBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not llm_available():
        return _not_configured()
    question = (body.question or "").strip()
    if not question:
        return {"configured": True, "ok": False, "error": "Ask a question about your CRM."}

    snapshot = _crm_snapshot(db)
    system = (
        "You are 'Ask your CRM' — answer questions grounded ONLY in the CRM snapshot provided. "
        "Today's date context is in the snapshot timestamps. Respond with JSON: "
        "{\"answer\": string (markdown), \"records\": [{\"type\": \"person\"|\"company\"|\"deal\", \"id\": number}]}. "
        "Reference specific records by the ids shown (e.g. deal#12 -> {type: 'deal', id: 12}). "
        "If the data can't answer the question, say so honestly."
    )
    output = generate_text_sync(system, f"CRM snapshot:\n{snapshot}\n\nQuestion: {question}")
    if not output:
        return {"configured": True, "ok": False, "error": "The LLM request failed. Try again."}
    parsed = parse_json_response(output) or {}
    answer = parsed.get("answer") if isinstance(parsed, dict) else None
    chips_raw = parsed.get("records") if isinstance(parsed, dict) else []
    if not answer:
        answer = output
        chips_raw = []

    chips = []
    for chip in chips_raw or []:
        try:
            record = get_record(db, chip.get("type"), int(chip.get("id")))
        except (TypeError, ValueError):
            record = None
        brief = record_brief(record)
        if brief:
            chips.append(brief)

    _audit(db, "chat", user, question, output)
    db.commit()
    return {"configured": True, "ok": True, "answer": answer, "records": chips}


@router.get("/ai/runs")
def ai_runs(
    record_type: str = "",
    record_id: int = 0,
    kind: str = "",
    limit: int = 30,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(AiRun)
    if record_type and record_id:
        query = query.filter(AiRun.record_type == record_type, AiRun.record_id == record_id)
    if kind:
        query = query.filter(AiRun.kind == kind)
    runs = query.order_by(AiRun.created_at.desc()).limit(min(100, max(1, limit))).all()
    return [r.to_dict() for r in runs]
