"""
Email send service — production-grade Gmail send via CraftBot's integration bridge.

The send path:
1. Get the user's google_workspace integration status from CraftBot.
2. Build a complete MIME message (HTML + plain-text alternative).
3. Base64url-encode the message.
4. POST it to https://gmail.googleapis.com/gmail/v1/users/me/messages/send
   through the CraftBot proxy. Credentials are injected by CraftBot — we never
   touch them.

If the integration bridge is unavailable the service raises ``IntegrationUnavailable``
so the route can surface a user-facing error rather than silently dropping the
send. This is intentional — the user explicitly asked for production behavior
with no simulation.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Optional

from services.integration_client import integration

logger = logging.getLogger(__name__)


class IntegrationUnavailable(RuntimeError):
    """Raised when CraftBot's Gmail integration isn't connected."""


class SendFailed(RuntimeError):
    """Raised when Gmail rejected the send."""

    def __init__(self, message: str, *, status: int = 0):
        super().__init__(message)
        self.status = status


def _build_mime(
    *,
    from_name: str,
    from_email: str,
    reply_to: Optional[str],
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
    text: str,
    unsubscribe_url: str,
) -> str:
    """Construct a multipart/alternative MIME message and return as raw string."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject or "(no subject)"
    msg["From"] = formataddr((from_name or "", from_email))
    msg["To"] = formataddr((to_name or "", to_email))
    if reply_to:
        msg["Reply-To"] = reply_to
    if unsubscribe_url:
        # RFC 8058 — one-click unsubscribe header (improves deliverability).
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    msg.attach(MIMEText(text or "", "plain", "utf-8"))
    msg.attach(MIMEText(html or "", "html", "utf-8"))
    return msg.as_string()


async def send_via_gmail(
    *,
    from_name: str,
    from_email: str,
    reply_to: Optional[str],
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
    text: str,
    unsubscribe_url: str,
) -> str:
    """Send one email via Gmail API. Returns the Gmail message id on success."""

    if not integration.available:
        raise IntegrationUnavailable(
            "CraftBot integration bridge is unavailable. Connect Google "
            "Workspace in CraftBot settings to enable sending."
        )

    raw = _build_mime(
        from_name=from_name,
        from_email=from_email,
        reply_to=reply_to,
        to_email=to_email,
        to_name=to_name,
        subject=subject,
        html=html,
        text=text,
        unsubscribe_url=unsubscribe_url,
    )
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")

    result = await integration.request(
        integration="google_workspace",
        method="POST",
        url="https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={"Content-Type": "application/json"},
        body={"raw": encoded},
    )

    if "error" in result and "status" not in result:
        raise SendFailed(str(result["error"]))

    status = int(result.get("status", 0))
    if status >= 400 or status == 0:
        data = result.get("data")
        detail = data.get("error", {}).get("message") if isinstance(data, dict) else str(data)
        raise SendFailed(f"Gmail API returned {status}: {detail}", status=status)

    data = result.get("data") or {}
    return str(data.get("id", "")) if isinstance(data, dict) else ""


def send_via_gmail_sync(**kwargs) -> str:
    """Synchronous wrapper for ``send_via_gmail`` — used by the scheduler."""
    try:
        return asyncio.run(send_via_gmail(**kwargs))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(send_via_gmail(**kwargs))
        finally:
            loop.close()


async def integrations_status() -> dict:
    """Return the connection status of integrations we care about."""
    status = {"bridge": integration.available, "google_workspace": False}
    if not integration.available:
        return status
    try:
        integrations = await integration.get_integrations()
        for i in integrations or []:
            if i.get("id") == "google_workspace":
                status["google_workspace"] = bool(i.get("connected"))
    except Exception as e:
        logger.warning("[Email] Could not fetch integrations: %s", e)
    return status
