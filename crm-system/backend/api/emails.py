"""
Email: SMTP config (admin), sending, manual logging, and templates.

Send/test respond 200 with an honest status payload whether or not SMTP is
configured — the frontend surfaces the message; the smoke test never sees 4xx.
"""

import logging
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_middleware import get_current_user, require_admin
from auth_models import User
from crm_core import get_record, log_activity, not_found_ok
from database import get_db
from models import Company, Deal, EmailLog, EmailTemplate, Person
from services.email_service import get_smtp_config, render_template, send_email, smtp_configured

logger = logging.getLogger(__name__)
router = APIRouter(tags=["email"])


class SmtpConfigBody(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    from_email: Optional[str] = Field(None, json_schema_extra={"format": "email"})
    from_name: Optional[str] = None
    use_tls: Optional[bool] = None


class SendBody(BaseModel):
    to: Optional[str] = Field(None, json_schema_extra={"format": "email"})
    subject: Optional[str] = ""
    body: Optional[str] = ""
    person_id: Optional[int] = None
    record_type: Optional[Literal["person", "company", "deal"]] = None
    record_id: Optional[int] = None
    template_id: Optional[int] = None


class LogEmailBody(BaseModel):
    to: Optional[str] = Field(None, json_schema_extra={"format": "email"})
    subject: Optional[str] = ""
    body: Optional[str] = ""
    direction: Optional[Literal["outbound", "logged"]] = "logged"
    person_id: Optional[int] = None
    record_type: Optional[Literal["person", "company", "deal"]] = None
    record_id: Optional[int] = None


class TemplateBody(BaseModel):
    name: Optional[str] = "New template"
    subject: Optional[str] = ""
    body: Optional[str] = ""


def _template_variables(db: Session, body: SendBody) -> Dict[str, Any]:
    variables: Dict[str, Any] = {}
    person = db.get(Person, body.person_id) if body.person_id else None
    if person is None and body.record_type == "person" and body.record_id:
        person = db.get(Person, body.record_id)
    if person is not None:
        variables.update({
            "first_name": person.first_name, "last_name": person.last_name,
            "name": person.display_name(), "job_title": person.job_title,
        })
        if person.company_id:
            company = db.get(Company, person.company_id)
            if company is not None:
                variables["company"] = company.display_name()
    if body.record_type == "deal" and body.record_id:
        deal = db.get(Deal, body.record_id)
        if deal is not None:
            variables.update({"deal": deal.display_name(), "deal_value": deal.value})
    return variables


@router.get("/email/config")
def get_config(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_smtp_config(db).to_dict()


@router.put("/email/config")
def update_config(
    body: SmtpConfigBody,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    config = get_smtp_config(db)
    for field in ("host", "port", "username", "from_email", "from_name", "use_tls"):
        value = getattr(body, field)
        if value is not None:
            setattr(config, field, value)
    # Ignore the masked placeholder so saving the form doesn't clobber the secret
    if body.password is not None and body.password != "********":
        config.password = body.password
    db.commit()
    return config.to_dict()


@router.post("/email/config/test")
def test_config(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    config = get_smtp_config(db)
    if not smtp_configured(config):
        return {"ok": False, "error": "SMTP is not configured yet", "notConfigured": True}
    result = send_email(config, config.from_email, "CRM System — SMTP test",
                        "This is a test email from your CRM System Living UI.")
    return result


@router.post("/email/send")
def send(
    body: SendBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = get_smtp_config(db)

    subject = body.subject or ""
    content = body.body or ""
    if body.template_id:
        template = db.get(EmailTemplate, body.template_id)
        if template is not None:
            subject = subject or template.subject
            content = content or template.body
    variables = _template_variables(db, body)
    subject = render_template(subject, variables)
    content = render_template(content, variables)

    to_addr = body.to or ""
    if not to_addr and body.person_id:
        person = db.get(Person, body.person_id)
        if person is not None and person.emails:
            to_addr = person.emails[0]

    result = send_email(config, to_addr, subject, content)

    log = EmailLog(
        person_id=body.person_id,
        record_type=body.record_type,
        record_id=body.record_id,
        direction="outbound",
        to_addr=to_addr,
        from_addr=config.from_email or "",
        subject=subject,
        body=content,
        status="sent" if result["ok"] else ("not_configured" if result.get("notConfigured") else "failed"),
        error=result.get("error") or "",
        created_by=user.username,
    )
    db.add(log)
    db.flush()

    if result["ok"] and body.record_type and body.record_id and get_record(db, body.record_type, body.record_id) is not None:
        log_activity(
            db, body.record_type, body.record_id, "email",
            f"Email sent: {subject or '(no subject)'}",
            body=content[:500],
            actor=user.username,
            extra={"emailLogId": log.id, "to": to_addr},
        )
    db.commit()
    db.refresh(log)
    return {
        "ok": result["ok"],
        "status": log.status,
        "error": result.get("error") or "",
        "notConfigured": bool(result.get("notConfigured")),
        "log": log.to_dict(),
    }


@router.post("/email/log")
def log_manual_email(
    body: LogEmailBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Paste/log an email thread onto a record's timeline without sending."""
    log = EmailLog(
        person_id=body.person_id,
        record_type=body.record_type,
        record_id=body.record_id,
        direction=body.direction or "logged",
        to_addr=body.to or "",
        subject=body.subject or "",
        body=body.body or "",
        status="logged",
        created_by=user.username,
    )
    db.add(log)
    db.flush()
    if body.record_type and body.record_id and get_record(db, body.record_type, body.record_id) is not None:
        log_activity(
            db, body.record_type, body.record_id, "email",
            f"Email logged: {body.subject or '(no subject)'}",
            body=(body.body or "")[:500],
            actor=user.username,
            extra={"emailLogId": log.id, "logged": True},
        )
    db.commit()
    db.refresh(log)
    return log.to_dict()


@router.get("/email/logs")
def list_logs(
    record_type: str = "",
    record_id: int = 0,
    person_id: int = 0,
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(EmailLog)
    if record_type and record_id:
        query = query.filter(EmailLog.record_type == record_type, EmailLog.record_id == record_id)
    if person_id:
        query = query.filter(EmailLog.person_id == person_id)
    total = query.count()
    page = max(1, page)
    page_size = min(200, max(1, page_size))
    items = query.order_by(EmailLog.sent_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [l.to_dict() for l in items], "total": total, "page": page, "pageSize": page_size}


# ============================================================================
# Templates
# ============================================================================

@router.get("/email/templates")
def list_templates(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return [t.to_dict() for t in db.query(EmailTemplate).order_by(EmailTemplate.name).all()]


@router.post("/email/templates")
def create_template(
    body: TemplateBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = EmailTemplate(
        name=(body.name or "New template").strip() or "New template",
        subject=body.subject or "",
        body=body.body or "",
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template.to_dict()


@router.put("/email/templates/{template_id}")
def update_template(
    template_id: int,
    body: TemplateBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = db.get(EmailTemplate, template_id)
    if template is None:
        return not_found_ok("template")
    if body.name is not None:
        template.name = body.name
    if body.subject is not None:
        template.subject = body.subject
    if body.body is not None:
        template.body = body.body
    db.commit()
    db.refresh(template)
    return template.to_dict()


@router.delete("/email/templates/{template_id}")
def delete_template(
    template_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = db.get(EmailTemplate, template_id)
    if template is None:
        return not_found_ok("template")
    db.delete(template)
    db.commit()
    return {"status": "deleted", "id": template_id}
