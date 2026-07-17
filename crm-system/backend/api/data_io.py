"""
CSV import/export (toolbar-level, F2.7) + demo data seeding (F10.1).
"""

import csv
import io
import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_middleware import get_current_user
from auth_models import User
from crm_core import (
    RECORD_MODELS,
    RecordType,
    get_values_for_records,
    log_activity,
    pick_color,
)
from database import get_db
from models import Attribute, AttributeValue, Company, Deal, ListEntry, Person, RecordList, Stage
from seed_data import clear_crm_data, seed_demo_data

logger = logging.getLogger(__name__)
router = APIRouter(tags=["data-io"])

# Importable fields per record type (CSV column -> system field)
IMPORT_FIELDS = {
    "person": ["first_name", "last_name", "email", "phone", "job_title", "company",
               "location", "linkedin", "description"],
    "company": ["name", "domain", "industry", "size", "location", "annual_revenue",
                "linkedin", "description"],
    "deal": ["name", "value", "currency", "status", "expected_close_date", "company",
             "owner", "description"],
}


class ImportBody(BaseModel):
    record_type: Optional[Literal["person", "company", "deal"]] = "person"
    csv_text: Optional[str] = ""
    mapping: Optional[Dict[str, str]] = None   # csv column -> field name
    dedupe: Optional[bool] = True
    list_id: Optional[int] = None


@router.get("/import/fields")
def import_fields(
    record_type: str = "person",
    user: User = Depends(get_current_user),
):
    return {"fields": IMPORT_FIELDS.get(record_type, IMPORT_FIELDS["person"])}


@router.post("/import/csv")
def import_csv(
    body: ImportBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_type = body.record_type or "person"
    text = (body.csv_text or "").strip()
    if not text:
        return {"created": 0, "skipped": 0, "errors": [], "message": "No CSV content provided"}

    try:
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
    except csv.Error as e:
        return {"created": 0, "skipped": 0, "errors": [f"CSV parse error: {e}"], "message": "Could not parse CSV"}

    mapping = body.mapping or {}
    if not mapping and reader.fieldnames:
        # Auto-map: exact/lower-case header matches
        known = set(IMPORT_FIELDS.get(record_type, []))
        for header in reader.fieldnames:
            key = (header or "").strip().lower().replace(" ", "_")
            if key in known:
                mapping[header] = key

    existing_emails = set()
    existing_domains = set()
    company_by_name: Dict[str, Company] = {}
    if record_type == "person":
        for person in db.query(Person).all():
            existing_emails.update(e.lower() for e in (person.emails or []))
    if record_type == "company":
        existing_domains = {c.domain.lower() for c in db.query(Company).all() if c.domain}
    for company in db.query(Company).all():
        company_by_name[(company.name or "").lower()] = company

    created = 0
    skipped = 0
    errors: List[str] = []
    created_ids: List[int] = []

    for line_number, row in enumerate(rows, start=2):
        data: Dict[str, str] = {}
        for column, field in mapping.items():
            if column in row and row[column] is not None:
                data[field] = str(row[column]).strip()
        if not any(data.values()):
            skipped += 1
            continue
        try:
            if record_type == "person":
                email = (data.get("email") or "").lower()
                if body.dedupe and email and email in existing_emails:
                    skipped += 1
                    continue
                company_id = None
                company_name = (data.get("company") or "").lower()
                if company_name:
                    company = company_by_name.get(company_name)
                    if company is None:
                        company = Company(name=data["company"], avatar_color=pick_color(data["company"]))
                        db.add(company)
                        db.flush()
                        company_by_name[company_name] = company
                    company_id = company.id
                record = Person(
                    first_name=data.get("first_name") or "",
                    last_name=data.get("last_name") or "",
                    emails=[data["email"]] if data.get("email") else [],
                    phones=[data["phone"]] if data.get("phone") else [],
                    job_title=data.get("job_title") or "",
                    company_id=company_id,
                    location=data.get("location") or "",
                    linkedin=data.get("linkedin") or "",
                    description=data.get("description") or "",
                    avatar_color=pick_color((data.get("first_name") or "") + (data.get("last_name") or "")),
                )
                if email:
                    existing_emails.add(email)
            elif record_type == "company":
                domain = (data.get("domain") or "").lower()
                if body.dedupe and domain and domain in existing_domains:
                    skipped += 1
                    continue
                revenue = None
                if data.get("annual_revenue"):
                    try:
                        revenue = float(str(data["annual_revenue"]).replace(",", "").replace("$", ""))
                    except ValueError:
                        revenue = None
                record = Company(
                    name=data.get("name") or "",
                    domain=data.get("domain") or "",
                    industry=data.get("industry") or "",
                    size=data.get("size") or "",
                    location=data.get("location") or "",
                    annual_revenue=revenue,
                    linkedin=data.get("linkedin") or "",
                    description=data.get("description") or "",
                    avatar_color=pick_color(data.get("name") or "company"),
                )
                if domain:
                    existing_domains.add(domain)
            else:
                value = 0.0
                if data.get("value"):
                    try:
                        value = float(str(data["value"]).replace(",", "").replace("$", ""))
                    except ValueError:
                        value = 0.0
                company_id = None
                company_name = (data.get("company") or "").lower()
                if company_name and company_name in company_by_name:
                    company_id = company_by_name[company_name].id
                status = data.get("status") or "open"
                record = Deal(
                    name=data.get("name") or "",
                    value=value,
                    currency=data.get("currency") or "USD",
                    status=status if status in ("open", "won", "lost") else "open",
                    expected_close_date=data.get("expected_close_date") or "",
                    company_id=company_id,
                    owner=data.get("owner") or user.username,
                    description=data.get("description") or "",
                )
            db.add(record)
            db.flush()
            created_ids.append(record.id)
            log_activity(db, record_type, record.id, "created",
                         f"{record.display_name()} imported from CSV", actor=user.username, touch=False)
            created += 1
        except Exception as e:  # keep importing remaining rows
            errors.append(f"Row {line_number}: {e}")
            skipped += 1

    # Optional: drop imported records into a list
    if body.list_id and created_ids:
        record_list = db.get(RecordList, body.list_id)
        if record_list is not None:
            first_stage = db.query(Stage).filter(Stage.list_id == body.list_id).order_by(Stage.position).first()
            for position, record_id in enumerate(created_ids):
                exists = db.query(ListEntry).filter_by(
                    list_id=body.list_id, record_type=record_type, record_id=record_id).first()
                if exists is None:
                    db.add(ListEntry(list_id=body.list_id, record_type=record_type,
                                     record_id=record_id, stage_id=first_stage.id if first_stage else None,
                                     position=float(position)))

    db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": errors[:20],
        "message": f"Imported {created} {record_type}(s), skipped {skipped}",
    }


@router.get("/export/csv")
def export_csv(
    record_type: RecordType = "person",
    list_id: int = 0,
    ids: str = "",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export records (optionally scoped to a list or an id set) as CSV."""
    model = RECORD_MODELS[record_type]
    query = db.query(model)
    if list_id:
        entry_ids = [e.record_id for e in db.query(ListEntry).filter_by(
            list_id=list_id, record_type=record_type).all()]
        query = query.filter(model.id.in_(entry_ids or [0]))
    if ids:
        try:
            id_list = [int(x) for x in ids.split(",") if x.strip()]
            if id_list:
                query = query.filter(model.id.in_(id_list))
        except ValueError:
            pass
    records = query.order_by(model.id).all()

    record_ids = [r.id for r in records]
    values_map = get_values_for_records(db, record_type, record_ids)
    custom_attrs = db.query(Attribute).filter(
        Attribute.object_type == record_type, Attribute.list_id.is_(None)
    ).order_by(Attribute.position).all()

    output = io.StringIO()
    writer = csv.writer(output)

    if record_type == "person":
        companies = {c.id: c for c in db.query(Company).all()}
        header = ["first_name", "last_name", "email", "phone", "job_title", "company",
                  "location", "linkedin", "description"]
        writer.writerow(header + [a.slug for a in custom_attrs])
        for r in records:
            values = values_map.get(r.id, {})
            company = companies.get(r.company_id)
            writer.writerow([
                r.first_name or "", r.last_name or "",
                (r.emails or [""])[0] if r.emails else "",
                (r.phones or [""])[0] if r.phones else "",
                r.job_title or "", company.display_name() if company else "",
                r.location or "", r.linkedin or "", r.description or "",
            ] + [values.get(a.slug, "") for a in custom_attrs])
    elif record_type == "company":
        header = ["name", "domain", "industry", "size", "location", "annual_revenue",
                  "linkedin", "description"]
        writer.writerow(header + [a.slug for a in custom_attrs])
        for r in records:
            values = values_map.get(r.id, {})
            writer.writerow([
                r.name or "", r.domain or "", r.industry or "", r.size or "",
                r.location or "", r.annual_revenue or "", r.linkedin or "", r.description or "",
            ] + [values.get(a.slug, "") for a in custom_attrs])
    else:
        companies = {c.id: c for c in db.query(Company).all()}
        header = ["name", "value", "currency", "status", "expected_close_date",
                  "company", "owner", "description"]
        writer.writerow(header + [a.slug for a in custom_attrs])
        for r in records:
            values = values_map.get(r.id, {})
            company = companies.get(r.company_id)
            writer.writerow([
                r.name or "", r.value or 0, r.currency or "USD", r.status or "open",
                r.expected_close_date or "", company.display_name() if company else "",
                r.owner or "", r.description or "",
            ] + [values.get(a.slug, "") for a in custom_attrs])

    return PlainTextResponse(output.getvalue(), media_type="text/csv")


@router.post("/seed/demo")
def seed_demo(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace CRM data with the rich demo dataset."""
    stats = seed_demo_data(db, actor=user.username)
    return {"status": "seeded", **stats}


@router.post("/seed/clear")
def seed_clear(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start clean: wipe CRM data (keeps user accounts and SMTP settings)."""
    clear_crm_data(db)
    from bootstrap import ensure_defaults
    ensure_defaults(db)
    return {"status": "cleared"}
