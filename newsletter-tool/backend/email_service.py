"""
Email send service — production-grade Gmail send via CraftBot's integration bridge.

The send path:
1. Get the user's gmail integration status from CraftBot.
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


_AUTHENTICATED_EMAIL_CACHE: Optional[str] = None


async def authenticated_gmail_address() -> str:
    """Return the email address of the Gmail account connected via CraftBot.

    Gmail's ``users/me/messages/send`` always sends as the authenticated
    account on the wire — the ``From:`` header only controls the display
    address. If the configured ``from_email`` isn't that account (and isn't
    a verified Send-As alias), Gmail accepts the API call but SMTP delivery
    bounces with a mailer-daemon error. Looking up the real address lets us
    fall back to it instead of bouncing.
    """
    global _AUTHENTICATED_EMAIL_CACHE
    if _AUTHENTICATED_EMAIL_CACHE:
        return _AUTHENTICATED_EMAIL_CACHE
    if not integration.available:
        return ""
    try:
        result = await integration.request(
            integration="gmail",
            method="GET",
            url="https://gmail.googleapis.com/gmail/v1/users/me/profile",
        )
    except Exception as e:
        logger.warning("[Email] Could not look up Gmail profile: %s", e)
        return ""
    data = result.get("data") if isinstance(result, dict) else None
    addr = data.get("emailAddress") if isinstance(data, dict) else None
    if isinstance(addr, str) and addr:
        _AUTHENTICATED_EMAIL_CACHE = addr
        return addr
    return ""


def reset_authenticated_email_cache() -> None:
    """Tests / settings UI can call this to force a fresh lookup."""
    global _AUTHENTICATED_EMAIL_CACHE
    _AUTHENTICATED_EMAIL_CACHE = None


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

    # The Gmail account on the wire is whoever's authenticated. If the user
    # configured a different from_email and it's not a verified Send-As alias,
    # SMTP delivery bounces. Substitute the authenticated address so the send
    # actually lands. Reply-To still honors the configured address so replies
    # land where the user expects them.
    authenticated = await authenticated_gmail_address()
    if authenticated and from_email and from_email.lower() != authenticated.lower():
        logger.warning(
            "[Email] from_email=%s doesn't match authenticated Gmail %s; "
            "using authenticated address. Configure a verified Send-As alias in "
            "Gmail Settings if you want to send as %s.",
            from_email, authenticated, from_email,
        )
        if not reply_to:
            reply_to = from_email
        from_email = authenticated

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
        integration="gmail",
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
    status = {"bridge": integration.available, "connected": False}
    if not integration.available:
        return status
    try:
        integrations = await integration.get_integrations()
        for i in integrations or []:
            if i.get("id") == "gmail":
                status["connected"] = bool(i.get("connected"))
    except Exception as e:
        logger.warning("[Email] Could not fetch integrations: %s", e)
    return status
