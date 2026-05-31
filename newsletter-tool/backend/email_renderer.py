"""
Email rendering — turn a list of blocks into a complete HTML + plain-text email.

Blocks are flexible JSON dicts produced by the drag-and-drop editor and AI
generator. Supported block types: heading, text, image, button, divider, html,
spacer.

The renderer:
- Escapes user-supplied text by default (HTML blocks are an explicit opt-in).
- Inlines all CSS (most email clients strip <style> tags).
- Substitutes {firstName}, {lastName}, {email}, {unsubscribeUrl} placeholders
  with per-recipient values.
- Adds a tracking pixel + click-tracking redirects when a tracking_base_url is
  set.
- Always appends a CAN-SPAM / GDPR compliant footer with an unsubscribe link.
"""

from __future__ import annotations

import html as html_module
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote


# ----------------------------------------------------------------------
# Wrapper template
# ----------------------------------------------------------------------

_WRAPPER = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:{email_bg};font-family:{font_family};color:{text_color};">
<div style="display:none;font-size:1px;color:{email_bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{email_bg};padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:{card_bg};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<tr><td style="padding:32px 32px 8px 32px;">
{body}
</td></tr>
<tr><td style="padding:24px 32px 32px 32px;border-top:1px solid #EAEAEA;font-size:12px;color:#737373;line-height:1.5;">
{footer}
</td></tr>
</table>
</td></tr>
</table>
{tracking_pixel}
</body>
</html>"""


# ----------------------------------------------------------------------
# Global design defaults (used as fallbacks for per-block properties)
# ----------------------------------------------------------------------

_FONT_FAMILIES = {
    "system": "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "serif": "Georgia,'Times New Roman',Times,serif",
    "mono": "'JetBrains Mono','Fira Code',Consolas,monospace",
}


def _design(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _design_color(design: Dict[str, Any], key: str, fallback: str) -> str:
    return _safe_color(design.get(key), fallback)


def _design_font(design: Dict[str, Any]) -> str:
    family = design.get("fontFamily")
    if isinstance(family, str) and family in _FONT_FAMILIES:
        return _FONT_FAMILIES[family]
    return _FONT_FAMILIES["system"]


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _esc(s: Any) -> str:
    return html_module.escape("" if s is None else str(s))


def _substitute(text: str, context: Dict[str, str]) -> str:
    if not text:
        return ""
    out = text
    for key, value in context.items():
        out = out.replace("{" + key + "}", value or "")
    return out


def _wrap_links_for_click_tracking(html: str, base_url: str, click_token: str) -> str:
    """Rewrite every <a href="..."> to go through /api/track/click/{token}?url=..."""
    if not base_url or not click_token:
        return html
    pattern = re.compile(r'href=(["\'])(https?://[^"\']+)\1', re.IGNORECASE)

    def repl(m: re.Match) -> str:
        quote_char = m.group(1)
        original = m.group(2)
        # Skip if it's already a tracking URL (idempotent).
        if "/api/track/click/" in original or "/api/unsubscribe/" in original:
            return f'href={quote_char}{original}{quote_char}'
        encoded = quote(original, safe="")
        tracked = f"{base_url.rstrip('/')}/api/track/click/{click_token}?url={encoded}"
        return f'href={quote_char}{tracked}{quote_char}'

    return pattern.sub(repl, html)


# ----------------------------------------------------------------------
# Block renderers
# ----------------------------------------------------------------------

_TEXT_SIZE_PX = {"small": 14, "normal": 16, "large": 18}
_IMAGE_WIDTH_VAL = {"small": "240px", "medium": "400px", "full": "100%"}
_VALID_ALIGN = {"left", "center", "right"}


def _safe_color(value: Any, fallback: str) -> str:
    """Allow hex (#fff, #ff4f18) or short named tokens; fall back otherwise."""
    if not isinstance(value, str):
        return fallback
    v = value.strip()
    if v.startswith("#") and len(v) in (4, 7) and all(
        c in "0123456789abcdefABCDEF" for c in v[1:]
    ):
        return v
    return fallback


def _align(value: Any, fallback: str = "left") -> str:
    if isinstance(value, str) and value.lower() in _VALID_ALIGN:
        return value.lower()
    return fallback


def _render_block(
    block: Dict[str, Any],
    context: Dict[str, str],
    design: Dict[str, Any],
) -> str:
    bt = (block.get("type") or "text").lower()

    if bt == "heading":
        level = max(1, min(int(block.get("level") or 1), 3))
        text = _esc(_substitute(block.get("text") or "", context))
        size = {1: "28px", 2: "22px", 3: "18px"}[level]
        align = _align(block.get("align"))
        color = _safe_color(
            block.get("color"),
            _design_color(design, "headingColor", "#171717"),
        )
        return (
            f'<h{level} style="margin:0 0 16px 0;font-size:{size};'
            f'line-height:1.3;font-weight:700;color:{color};text-align:{align};">'
            f'{text}</h{level}>'
        )

    if bt == "text":
        text = _esc(_substitute(block.get("text") or "", context))
        size_key = block.get("size") if block.get("size") in _TEXT_SIZE_PX else "normal"
        font_px = _TEXT_SIZE_PX[size_key]
        align = _align(block.get("align"))
        color = _safe_color(
            block.get("color"),
            _design_color(design, "textColor", "#262626"),
        )
        paragraphs = text.split("\n\n")
        rendered = []
        for p in paragraphs:
            if not p.strip():
                continue
            p_html = p.replace("\n", "<br>")
            rendered.append(
                f'<p style="margin:0 0 16px 0;font-size:{font_px}px;line-height:1.6;'
                f'color:{color};text-align:{align};">{p_html}</p>'
            )
        return "".join(rendered) or '<p style="margin:0 0 16px 0;">&nbsp;</p>'

    if bt == "image":
        url = block.get("url") or ""
        alt = _esc(block.get("alt") or "")
        if not url or not url.startswith(("http://", "https://")):
            return ""
        align = _align(block.get("align"), "center")
        width_key = block.get("width") if block.get("width") in _IMAGE_WIDTH_VAL else "full"
        width_css = _IMAGE_WIDTH_VAL[width_key]
        return (
            f'<div style="margin:0 0 16px 0;text-align:{align};">'
            f'<img src="{_esc(url)}" alt="{alt}" '
            f'style="max-width:100%;width:{width_css};height:auto;border-radius:8px;display:inline-block;" />'
            f'</div>'
        )

    if bt == "button":
        label = _esc(_substitute(block.get("label") or "Click here", context))
        url = block.get("url") or "#"
        if not url.startswith(("http://", "https://", "mailto:", "{")):
            url = "#"
        align = _align(block.get("align"), "center")
        bg = _safe_color(
            block.get("backgroundColor"),
            _design_color(design, "buttonBg", "#FF4F18"),
        )
        fg = _safe_color(
            block.get("textColor"),
            _design_color(design, "buttonTextColor", "#FFFFFF"),
        )
        return (
            f'<div style="margin:24px 0;text-align:{align};">'
            f'<a href="{_esc(url)}" style="display:inline-block;background:{bg};'
            f'color:{fg};padding:12px 28px;border-radius:8px;font-size:16px;'
            f'font-weight:600;text-decoration:none;">{label}</a>'
            f'</div>'
        )

    if bt == "divider":
        color = _safe_color(block.get("color"), "#EAEAEA")
        return f'<hr style="border:none;border-top:1px solid {color};margin:24px 0;" />'

    if bt == "spacer":
        height = max(4, min(int(block.get("height") or 16), 128))
        return f'<div style="height:{height}px;line-height:1px;">&nbsp;</div>'

    if bt == "html":
        return _substitute(block.get("html") or "", context)

    return ""


def _render_blocks_text(blocks: List[Dict[str, Any]], context: Dict[str, str]) -> str:
    """Plain-text fallback so spam filters don't penalize us."""
    out: List[str] = []
    for block in blocks:
        bt = (block.get("type") or "text").lower()
        if bt == "heading":
            out.append(_substitute(block.get("text") or "", context).upper())
            out.append("")
        elif bt == "text":
            out.append(_substitute(block.get("text") or "", context))
            out.append("")
        elif bt == "button":
            label = _substitute(block.get("label") or "Click here", context)
            url = block.get("url") or ""
            out.append(f"{label}: {url}")
            out.append("")
        elif bt == "image":
            alt = block.get("alt") or "image"
            out.append(f"[{alt}]")
            out.append("")
        elif bt == "divider":
            out.append("---")
            out.append("")
        elif bt == "html":
            # Strip tags from raw HTML for plain-text version.
            stripped = re.sub(r"<[^>]+>", "", block.get("html") or "")
            out.append(_substitute(stripped, context))
            out.append("")
    return "\n".join(out).strip()


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------

def build_substitution_context(
    *,
    first_name: Optional[str],
    last_name: Optional[str],
    email: str,
    unsubscribe_url: str,
) -> Dict[str, str]:
    safe_first = (first_name or "").strip() or "there"
    return {
        "firstName": _esc(safe_first),
        "lastName": _esc(last_name or ""),
        "email": _esc(email),
        "unsubscribeUrl": unsubscribe_url,
    }


def render_email(
    *,
    subject: str,
    preheader: str,
    blocks: List[Dict[str, Any]],
    context: Dict[str, str],
    unsubscribe_url: str,
    organization_name: str = "",
    organization_address: str = "",
    tracking_base_url: str = "",
    open_token: str = "",
    click_token: str = "",
    design: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    """Return {"html": ..., "text": ...} — fully rendered for a single recipient."""

    design_d = _design(design)
    email_bg = _design_color(design_d, "emailBg", "#F5F5F5")
    card_bg = _design_color(design_d, "cardBg", "#FFFFFF")
    text_color = _design_color(design_d, "textColor", "#262626")
    font_family = _design_font(design_d)

    body_parts = [_render_block(b or {}, context, design_d) for b in (blocks or [])]
    body = "".join(p for p in body_parts if p)

    org_line = ""
    if organization_name or organization_address:
        org_line = (
            f"<div style=\"margin-bottom:6px;\">"
            f"{_esc(organization_name)}"
            f"{' · ' if organization_name and organization_address else ''}"
            f"{_esc(organization_address)}"
            f"</div>"
        )

    footer = (
        f"{org_line}"
        f"<div>You're receiving this because you subscribed.</div>"
        f"<div style=\"margin-top:8px;\">"
        f"<a href=\"{_esc(unsubscribe_url)}\" "
        f"style=\"color:#737373;text-decoration:underline;\">Unsubscribe</a>"
        f"</div>"
    )

    tracking_pixel = ""
    if tracking_base_url and open_token:
        tracking_pixel = (
            f'<img src="{tracking_base_url.rstrip("/")}'
            f'/api/track/open/{open_token}" width="1" height="1" '
            f'style="display:block;border:0;outline:none;" alt="" />'
        )

    html = _WRAPPER.format(
        subject=_esc(subject or ""),
        preheader=_esc(_substitute(preheader or "", context)),
        body=body or '<p style="margin:0;">(Empty email)</p>',
        footer=footer,
        tracking_pixel=tracking_pixel,
        email_bg=email_bg,
        card_bg=card_bg,
        text_color=text_color,
        font_family=font_family,
    )

    # Click tracking — only after the wrapper is assembled so the unsubscribe
    # link is not rewritten (it's a special path).
    if tracking_base_url and click_token:
        html = _wrap_links_for_click_tracking(html, tracking_base_url, click_token)

    text = _render_blocks_text(blocks or [], context)
    text += (
        f"\n\n---\n"
        f"{(organization_name + ' · ' + organization_address).strip(' ·')}\n"
        if (organization_name or organization_address) else "\n\n---\n"
    )
    text += f"Unsubscribe: {unsubscribe_url}\n"

    return {"html": html, "text": text}
