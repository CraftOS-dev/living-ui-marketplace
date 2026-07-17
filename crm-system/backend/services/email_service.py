"""
SMTP email sending for CRM System.

Reads the singleton SmtpConfig row; sends via smtplib. Returns a result dict
instead of raising so routes can respond 200 with an honest status whether or
not SMTP is configured (required by the marketplace smoke test).
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from models import SmtpConfig

logger = logging.getLogger(__name__)


def get_smtp_config(db: Session) -> SmtpConfig:
    config = db.query(SmtpConfig).first()
    if config is None:
        config = SmtpConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def smtp_configured(config: SmtpConfig) -> bool:
    return bool(config.host and config.from_email)


def render_template(text: str, variables: Dict[str, Any]) -> str:
    """Render {{variable}} placeholders; unknown variables render empty."""
    out = text or ""
    for key, value in variables.items():
        out = out.replace("{{" + key + "}}", str(value if value is not None else ""))
    import re
    return re.sub(r"\{\{\s*[\w.]+\s*\}\}", "", out)


def send_email(
    config: SmtpConfig,
    to_addr: str,
    subject: str,
    body: str,
    html: bool = False,
    timeout: float = 15,
) -> Dict[str, Any]:
    """Send one email. Returns {"ok": bool, "error": str}."""
    if not smtp_configured(config):
        return {"ok": False, "error": "SMTP is not configured", "notConfigured": True}
    if not to_addr:
        return {"ok": False, "error": "No recipient address"}

    try:
        msg = MIMEMultipart("alternative")
        from_display = f"{config.from_name} <{config.from_email}>" if config.from_name else config.from_email
        msg["From"] = from_display
        msg["To"] = to_addr
        msg["Subject"] = subject or ""
        msg.attach(MIMEText(body or "", "html" if html else "plain", "utf-8"))

        if config.use_tls and (config.port or 587) == 465:
            server: Optional[smtplib.SMTP] = smtplib.SMTP_SSL(config.host, config.port or 465, timeout=timeout)
        else:
            server = smtplib.SMTP(config.host, config.port or 587, timeout=timeout)
            if config.use_tls:
                server.starttls()
        try:
            if config.username:
                server.login(config.username, config.password or "")
            server.sendmail(config.from_email, [to_addr], msg.as_string())
        finally:
            server.quit()
        logger.info("[Email] Sent to %s: %s", to_addr, subject)
        return {"ok": True, "error": ""}
    except Exception as e:
        logger.error("[Email] Send failed: %s", e)
        return {"ok": False, "error": str(e)}
