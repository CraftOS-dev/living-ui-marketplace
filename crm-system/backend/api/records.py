"""
Records API - People, Companies, Deals.

One polymorphic router: /records/{record_type}/... plus deal-people links and
global search. Table data comes from POST /records/{record_type}/query which
resolves custom attribute values, tags, and company chips in bulk.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import (
    RECORD_MODELS,
    RecordType,
    delete_record_cascade,
    get_record,
    get_tags_for_records,
    get_values_for_records,
    log_activity,
    not_found_ok,
    pick_color,
    record_brief,
    serialize_record_row,
    upsert_attribute_value,
)
from database import get_db
from models import (
    Attribute,
    Company,
    Deal,
    DealPerson,
    ListEntry,
    Person,
    RecordList,
    Stage,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["records"])

# Human labels for field-change timeline entries.
FIELD_LABELS = {
    "first_name": "First name", "last_name": "Last name", "emails": "Emails",
    "phones": "Phones", "job_title": "Job title", "company_id": "Company",
    "linkedin": "LinkedIn", "location": "Location", "description": "Description",
    "name": "Name", "domain": "Domain", "industry": "Industry", "size": "Size",
    "annual_revenue": "Annual revenue", "value": "Value", "currency": "Currency",
    "primary_person_id": "Primary contact", "owner": "Owner", "status": "Status",
    "expected_close_date": "Expected close date",
}


class RecordBody(BaseModel):
    """Unified create/update body - only fields relevant to the type are used."""
    # person
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    emails: Optional[List[str]] = None
    phones: Optional[List[str]] = None
    job_title: Optional[str] = None
    linkedin: Optional[str] = None
    location: Optional[str] = None
    # company
    name: Optional[str] = None
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    annual_revenue: Optional[float] = None
    # deal
    value: Optional[float] = None
    currency: Optional[str] = None
    company_id: Optional[int] = None
    primary_person_id: Optional[int] = None
    owner: Optional[str] = None
    status: Optional[str] = None  # open | won | lost (validated in code - partial updates)
    expected_close_date: Optional[str] = Field(None, json_schema_extra={"format": "date"})
    # shared
    description: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    # optional list placement on create
    list_id: Optional[int] = None
    stage_id: Optional[int] = None


class QueryBody(BaseModel):
    filters: Optional[List[Dict[str, Any]]] = None   # [{field, operator, value}]
    sorts: Optional[List[Dict[str, Any]]] = None     # [{field, dir}]
    search: Optional[str] = None
    page: Optional[int] = 1
    page_size: Optional[int] = 50
    list_id: Optional[int] = None


class PersonLinkBody(BaseModel):
    person_id: Optional[int] = 0


PERSON_FIELDS = ("first_name", "last_name", "emails", "phones", "job_title",
                 "company_id", "linkedin", "location", "description")
COMPANY_FIELDS = ("name", "domain", "industry", "size", "location",
                  "annual_revenue", "linkedin", "description")
DEAL_FIELDS = ("name", "value", "currency", "company_id", "primary_person_id",
               "owner", "status", "expected_close_date", "description")
FIELDS_BY_TYPE = {"person": PERSON_FIELDS, "company": COMPANY_FIELDS, "deal": DEAL_FIELDS}


def _apply_fields(db: Session, record, record_type: str, body: RecordBody, actor: str, is_create: bool) -> List[str]:
    """Set provided fields; log field_change activities on update. Returns changed field names."""
    changed = []
    for field in FIELDS_BY_TYPE[record_type]:
        new_value = getattr(body, field)
        if new_value is None:
            continue
        if field == "status" and new_value not in ("open", "won", "lost"):
            continue
        old_value = getattr(record, field)
        if old_value == new_value:
            continue
        setattr(record, field, new_value)
        changed.append(field)
        if field == "status" and record_type == "deal":
            record.closed_at = datetime.utcnow() if new_value in ("won", "lost") else None
        if not is_create:
            log_activity(
                db, record_type, record.id, "field_change",
                f"{FIELD_LABELS.get(field, field)} updated",
                actor=actor,
                extra={"field": field, "from": _plain(old_value), "to": _plain(new_value)},
                touch=False,
            )
    return changed


def _plain(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _apply_attribute_values(db: Session, record, record_type: str, body: RecordBody, actor: str, is_create: bool) -> None:
    if not body.attributes:
        return
    attrs = {
        a.slug: a
        for a in db.query(Attribute).filter(
            Attribute.object_type == record_type, Attribute.list_id.is_(None)
        ).all()
    }
    for slug, value in body.attributes.items():
        attribute = attrs.get(slug)
        if attribute is None:
            continue
        upsert_attribute_value(db, attribute, record_type, record.id, value)
        if not is_create:
            log_activity(
                db, record_type, record.id, "field_change",
                f"{attribute.name} updated",
                actor=actor,
                extra={"field": slug, "to": _plain(value)},
                touch=False,
            )


def _find_duplicates(db: Session, record_type: str, email: str = "", domain: str = "", name: str = "", exclude_id: int = 0) -> List[Dict]:
    briefs: List[Dict] = []
    if record_type == "person" and email:
        for person in db.query(Person).all():
            if person.id != exclude_id and email.lower() in [e.lower() for e in (person.emails or [])]:
                briefs.append(record_brief(person))
    elif record_type == "company" and domain:
        rows = db.query(Company).filter(Company.domain.ilike(domain), Company.id != exclude_id).all()
        briefs.extend(record_brief(c) for c in rows)
    elif name:
        model = RECORD_MODELS[record_type]
        rows = db.query(model).filter(model.name.ilike(name), model.id != exclude_id).limit(5).all() if record_type != "person" else []
        briefs.extend(record_brief(r) for r in rows)
    return [b for b in briefs if b]


# ============================================================================
# CRUD
# ============================================================================

@router.post("/records/{record_type}")
def create_record(
    record_type: RecordType,
    body: RecordBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = RECORD_MODELS[record_type]
    record = model()
    _apply_fields(db, record, record_type, body, user.username, is_create=True)
    if hasattr(record, "avatar_color") and not record.avatar_color:
        record.avatar_color = pick_color(record.display_name() + str(datetime.utcnow().microsecond))
    if record_type == "deal" and not record.owner:
        record.owner = user.username
    db.add(record)
    db.flush()
    _apply_attribute_values(db, record, record_type, body, user.username, is_create=True)

    # Optional list placement on create
    if body.list_id:
        record_list = db.query(RecordList).filter(RecordList.id == body.list_id).first()
        if record_list is not None:
            stage_id = body.stage_id
            if not stage_id:
                first_stage = (
                    db.query(Stage).filter(Stage.list_id == record_list.id)
                    .order_by(Stage.position).first()
                )
                stage_id = first_stage.id if first_stage else None
            db.add(ListEntry(
                list_id=record_list.id, record_type=record_type, record_id=record.id,
                stage_id=stage_id, position=0,
            ))

    log_activity(db, record_type, record.id, "created",
                 f"{record.display_name()} created", actor=user.username)
    db.commit()
    db.refresh(record)

    email = (body.emails or [""])[0] if body.emails else ""
    duplicates = _find_duplicates(db, record_type, email=email, domain=body.domain or "", exclude_id=record.id)
    result = serialize_record_row(db, record, record_type)
    result["duplicates"] = duplicates
    return result


@router.get("/records/{record_type}")
def list_records(
    record_type: RecordType,
    page: int = 1,
    page_size: int = 50,
    search: str = "",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    body = QueryBody(search=search, page=page, page_size=page_size)
    return _run_query(db, record_type, body)


@router.post("/records/{record_type}/query")
def query_records(
    record_type: RecordType,
    body: QueryBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _run_query(db, record_type, body)


def _search_haystack(record, record_type: str) -> str:
    parts = [record.display_name()]
    if record_type == "person":
        parts += (record.emails or []) + [record.job_title or "", record.location or ""]
    elif record_type == "company":
        parts += [record.domain or "", record.industry or "", record.location or ""]
    else:
        parts += [record.owner or "", record.status or ""]
    return " ".join(str(p) for p in parts).lower()


def _filter_match(row: Dict[str, Any], flt: Dict[str, Any]) -> bool:
    field = flt.get("field") or ""
    operator = flt.get("operator") or "eq"
    expected = flt.get("value")
    actual = row.get(field, row.get("attributes", {}).get(field))

    if operator == "is_empty":
        return actual in (None, "", [], {})
    if operator == "not_empty":
        return actual not in (None, "", [], {})
    if actual is None:
        return False
    if operator == "eq":
        if isinstance(actual, (int, float)) and not isinstance(actual, bool):
            try:
                return float(actual) == float(expected)
            except (TypeError, ValueError):
                return False
        return str(actual).lower() == str(expected).lower()
    if operator == "neq":
        return not _filter_match(row, {**flt, "operator": "eq"})
    if operator == "contains":
        if isinstance(actual, list):
            return any(str(expected).lower() in str(item).lower() for item in actual)
        return str(expected).lower() in str(actual).lower()
    if operator == "not_contains":
        return not _filter_match(row, {**flt, "operator": "contains"})
    if operator == "has":
        if isinstance(actual, list):
            return expected in actual or str(expected) in [str(a) for a in actual]
        return actual == expected
    try:
        actual_num = float(actual)
        expected_num = float(expected)
        if operator in ("gt", "after"):
            return actual_num > expected_num
        if operator in ("lt", "before"):
            return actual_num < expected_num
        if operator == "gte":
            return actual_num >= expected_num
        if operator == "lte":
            return actual_num <= expected_num
    except (TypeError, ValueError):
        # String comparison (ISO dates compare correctly as strings)
        if operator in ("gt", "after"):
            return str(actual) > str(expected)
        if operator in ("lt", "before"):
            return str(actual) < str(expected)
        if operator == "gte":
            return str(actual) >= str(expected)
        if operator == "lte":
            return str(actual) <= str(expected)
    return False


def _run_query(db: Session, record_type: str, body: QueryBody) -> Dict[str, Any]:
    model = RECORD_MODELS[record_type]
    query = db.query(model)

    # Restrict to a list's members when list_id is set
    entry_by_record: Dict[int, ListEntry] = {}
    if body.list_id:
        entries = db.query(ListEntry).filter(
            ListEntry.list_id == body.list_id, ListEntry.record_type == record_type
        ).all()
        entry_by_record = {e.record_id: e for e in entries}
        query = query.filter(model.id.in_(list(entry_by_record.keys()) or [0]))

    records = query.all()

    search = (body.search or "").strip().lower()
    if search:
        records = [r for r in records if search in _search_haystack(r, record_type)]

    ids = [r.id for r in records]
    values_map = get_values_for_records(db, record_type, ids)
    tags_map = get_tags_for_records(db, record_type, ids)

    company_ids = {getattr(r, "company_id", None) for r in records} - {None}
    company_briefs = {
        c.id: record_brief(c)
        for c in db.query(Company).filter(Company.id.in_(company_ids)).all()
    } if company_ids else {}

    rows = [
        serialize_record_row(db, r, record_type, values_map.get(r.id), tags_map.get(r.id), company_briefs)
        for r in records
    ]
    if entry_by_record:
        stage_dicts = {s.id: s.to_dict() for s in db.query(Stage).filter(
            Stage.list_id == body.list_id).all()}
        for row in rows:
            entry = entry_by_record.get(row["id"])
            if entry:
                row["entry"] = entry.to_dict()
                row["stage"] = stage_dicts.get(entry.stage_id)

    for flt in body.filters or []:
        rows = [row for row in rows if _filter_match(row, flt)]

    sorts = body.sorts or [{"field": "createdAt", "dir": "desc"}]
    for sort in reversed(sorts):
        field = sort.get("field") or "createdAt"
        reverse = (sort.get("dir") or "asc") == "desc"

        def sort_key(row, f=field):
            value = row.get(f, row.get("attributes", {}).get(f))
            if value in (None, "", []):
                # Missing values always sort last regardless of direction
                return (1, 0, "")
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return (0, 0, float(value))
            if isinstance(value, list):
                return (0, 1, str(value[0]).lower())
            return (0, 1, str(value).lower())

        # Two-pass: numeric bucket sorts before string bucket; stable within
        keyed = [(sort_key(row), row) for row in rows]
        normalized = [
            ((k[0], k[1], str(k[2]) if k[1] == 1 else k[2]), row) for k, row in keyed
        ]
        # If buckets are mixed, compare as strings to avoid type errors
        buckets = {k[1] for k, _ in normalized if k[0] == 0}
        if len(buckets) > 1:
            normalized = [((k[0], 1, str(k[2]).lower()), row) for k, row in normalized]
        rows = [row for _, row in sorted(normalized, key=lambda pair: pair[0], reverse=reverse)]

    total = len(rows)
    page = max(1, body.page or 1)
    page_size = min(200, max(1, body.page_size or 50))
    start = (page - 1) * page_size
    return {
        "items": rows[start:start + page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/records/{record_type}/check-duplicates")
def check_duplicates(
    record_type: RecordType,
    email: str = "",
    domain: str = "",
    name: str = "",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"duplicates": _find_duplicates(db, record_type, email=email, domain=domain, name=name)}


@router.get("/records/{record_type}/{record_id}")
def get_record_detail(
    record_type: RecordType,
    record_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = get_record(db, record_type, record_id)
    if record is None:
        return {"status": "not_found", "record": None}

    row = serialize_record_row(db, record, record_type,
                               get_values_for_records(db, record_type, [record_id]).get(record_id),
                               get_tags_for_records(db, record_type, [record_id]).get(record_id))

    # List memberships with stage info
    entries = db.query(ListEntry).filter_by(record_type=record_type, record_id=record_id).all()
    list_map = {l.id: l for l in db.query(RecordList).all()}
    stage_ids = {e.stage_id for e in entries} - {None}
    stages = {s.id: s for s in db.query(Stage).filter(Stage.id.in_(stage_ids)).all()} if stage_ids else {}
    memberships = []
    for entry in entries:
        record_list = list_map.get(entry.list_id)
        if record_list is None:
            continue
        memberships.append({
            "entry": entry.to_dict(),
            "list": record_list.to_dict(),
            "stage": stages[entry.stage_id].to_dict() if entry.stage_id in stages else None,
        })

    # Related records
    related: Dict[str, List[Dict]] = {"people": [], "companies": [], "deals": []}
    if record_type == "person":
        if record.company_id:
            related["companies"] = [b for b in [record_brief(db.get(Company, record.company_id))] if b]
        deal_ids = [dp.deal_id for dp in db.query(DealPerson).filter_by(person_id=record_id).all()]
        deals = db.query(Deal).filter(or_(Deal.id.in_(deal_ids or [0]), Deal.primary_person_id == record_id)).all()
        related["deals"] = [record_brief(d) for d in deals]
    elif record_type == "company":
        related["people"] = [record_brief(p) for p in db.query(Person).filter_by(company_id=record_id).all()]
        related["deals"] = [record_brief(d) for d in db.query(Deal).filter_by(company_id=record_id).all()]
    else:
        if record.company_id:
            related["companies"] = [b for b in [record_brief(db.get(Company, record.company_id))] if b]
        person_ids = [dp.person_id for dp in db.query(DealPerson).filter_by(deal_id=record_id).all()]
        if record.primary_person_id:
            person_ids.append(record.primary_person_id)
        people = db.query(Person).filter(Person.id.in_(person_ids or [0])).all()
        related["people"] = [record_brief(p) for p in people]

    row["memberships"] = memberships
    row["related"] = related
    return {"status": "ok", "record": row}


@router.put("/records/{record_type}/{record_id}")
def update_record(
    record_type: RecordType,
    record_id: int,
    body: RecordBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = get_record(db, record_type, record_id)
    if record is None:
        return not_found_ok(record_type)
    changed = _apply_fields(db, record, record_type, body, user.username, is_create=False)
    _apply_attribute_values(db, record, record_type, body, user.username, is_create=False)
    if changed or body.attributes:
        record.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    return serialize_record_row(
        db, record, record_type,
        get_values_for_records(db, record_type, [record_id]).get(record_id),
        get_tags_for_records(db, record_type, [record_id]).get(record_id),
    )


@router.delete("/records/{record_type}/{record_id}")
def delete_record(
    record_type: RecordType,
    record_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = get_record(db, record_type, record_id)
    if record is None:
        return not_found_ok(record_type)
    delete_record_cascade(db, record_type, record)
    db.commit()
    return {"status": "deleted", "id": record_id}


# ============================================================================
# Deal - people links
# ============================================================================

@router.post("/deals/{deal_id}/people")
def link_deal_person(
    deal_id: int,
    body: PersonLinkBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.person_id:
        return {"status": "noop"}
    existing = db.query(DealPerson).filter_by(deal_id=deal_id, person_id=body.person_id).first()
    if existing:
        return existing.to_dict()
    link = DealPerson(deal_id=deal_id, person_id=body.person_id)
    db.add(link)
    person = db.get(Person, body.person_id)
    deal = db.get(Deal, deal_id)
    if person is not None and deal is not None:
        log_activity(db, "deal", deal_id, "field_change",
                     f"{person.display_name()} linked", actor=user.username,
                     extra={"field": "people", "to": person.display_name()}, touch=False)
    db.commit()
    db.refresh(link)
    return link.to_dict()


@router.delete("/deals/{deal_id}/people/{person_id}")
def unlink_deal_person(
    deal_id: int,
    person_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    link = db.query(DealPerson).filter_by(deal_id=deal_id, person_id=person_id).first()
    if link is None:
        return not_found_ok("link")
    db.delete(link)
    db.commit()
    return {"status": "deleted"}


# ============================================================================
# Global search (command palette)
# ============================================================================

@router.get("/search")
def global_search(
    q: str = "",
    limit: int = 8,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    term = (q or "").strip().lower()
    results: Dict[str, List[Dict]] = {"people": [], "companies": [], "deals": []}
    if not term:
        return results
    limit = min(25, max(1, limit))

    def score(name: str) -> int:
        lower = name.lower()
        if lower.startswith(term):
            return 0
        if term in lower:
            return 1
        return 2

    for key, record_type in (("people", "person"), ("companies", "company"), ("deals", "deal")):
        model = RECORD_MODELS[record_type]
        matched = [
            r for r in db.query(model).all()
            if term in _search_haystack(r, record_type)
        ]
        matched.sort(key=lambda r: (score(r.display_name()), r.display_name().lower()))
        results[key] = [record_brief(r) for r in matched[:limit]]
    return results
