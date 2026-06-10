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
    """Allow hex (#fff, #ff4f18) or rgb(...); fall back otherwise.

    rgb() is normalized to uppercase hex so the rest of the renderer only
    deals with one color format. execCommand('foreColor') with styleWithCSS
    emits rgb() in most browsers — without this, that output would round-trip
    to the fallback color and silently lose the user's choice.
    """
    if not isinstance(value, str):
        return fallback
    v = value.strip()
    if v.startswith("#") and len(v) in (4, 7) and all(
        c in "0123456789abcdefABCDEF" for c in v[1:]
    ):
        return v
    m = re.match(r"rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)", v)
    if m:
        r, g, b = (max(0, min(255, int(x))) for x in m.groups())
        return f"#{r:02X}{g:02X}{b:02X}"
    return fallback


# ----------------------------------------------------------------------
# Inline-HTML sanitizer (for rich-text heading & text blocks)
# ----------------------------------------------------------------------

# Whitelist: only inline formatting that's safe across email clients.
# Block-level tags (p, div, h1…) are stripped — the renderer wraps the
# sanitized fragment in <p> / <h{n}> with the right inline styles.
_ALLOWED_INLINE_TAGS = {"b", "strong", "i", "em", "u", "br", "span", "a"}
_LINK_PROTOCOLS = ("http://", "https://", "mailto:")


def _extract_color_from_style(style: Any) -> str:
    if not isinstance(style, str):
        return ""
    m = re.search(r"color\s*:\s*([^;]+)", style, re.IGNORECASE)
    if not m:
        return ""
    return _safe_color(m.group(1).strip(), "")


def _extract_safe_styles(style: Any) -> str:
    """Pick out the inline-formatting CSS properties we trust for emails.

    Some browsers / older editor configs emit ``<span style="font-weight:
    bold">`` for bold instead of ``<b>``. Keeping the whitelisted properties
    means that content still bolds correctly after a round-trip through the
    sanitizer. Anything not on this list is dropped.
    """
    if not isinstance(style, str) or not style:
        return ""
    parts: List[str] = []
    color = _extract_color_from_style(style)
    if color:
        parts.append(f"color:{color}")
    m = re.search(r"font-weight\s*:\s*([^;]+)", style, re.IGNORECASE)
    if m and m.group(1).strip().lower() in ("bold", "bolder", "600", "700", "800", "900"):
        parts.append("font-weight:bold")
    m = re.search(r"font-style\s*:\s*([^;]+)", style, re.IGNORECASE)
    if m and m.group(1).strip().lower() in ("italic", "oblique"):
        parts.append("font-style:italic")
    m = re.search(r"text-decoration(?:-line)?\s*:\s*([^;]+)", style, re.IGNORECASE)
    if m:
        val = m.group(1).strip().lower()
        if "underline" in val:
            parts.append("text-decoration:underline")
        elif "line-through" in val:
            parts.append("text-decoration:line-through")
    return ";".join(parts)


_BLANK_DIV_RE = re.compile(
    r"<\s*div\b[^>]*>\s*<\s*br\s*/?\s*>\s*<\s*/\s*div\s*>",
    re.IGNORECASE,
)
_BLOCK_OPEN_RE = re.compile(r"<\s*(?:div|p)\b[^>]*>", re.IGNORECASE)
_BLOCK_CLOSE_RE = re.compile(r"<\s*/\s*(?:div|p)\s*>", re.IGNORECASE)


def _normalize_block_breaks(html: str) -> str:
    """ContentEditable produces ``<div>line</div>`` per new line in Chromium.

    Convert each block wrapper to a single ``<br>`` so the rendered email
    matches the editor visually: line-height spacing between lines, *no*
    extra paragraph-margin between them. The whole text block ends up inside
    one ``<p>`` (which still has the block-level margin below it, so the gap
    between separate text BLOCKS is preserved).

    Soft breaks (``<br>``) pass through unchanged.
    """
    if not html:
        return ""
    # Collapse "press Enter twice" -> single <br> (one blank line).
    s = _BLANK_DIV_RE.sub("<br>", html)
    # Remaining <div>/<p> opens are line breaks before their content.
    s = _BLOCK_OPEN_RE.sub("<br>", s)
    s = _BLOCK_CLOSE_RE.sub("", s)
    # Bare newlines (from pastes / AI generations) are also line breaks; fold
    # them into the same form so the collapse step sees one consistent token.
    s = s.replace("\r\n", "\n").replace("\n", "<br>")
    # Cap runs of <br>s at 2 (one visible blank line). Nested wrapper <div>s
    # from pasted content can stack 3-4 <br>s on top of each other that the
    # editor doesn't render — without this cap, the email shows huge gaps.
    s = re.sub(r"(?:<br\s*/?>\s*){3,}", "<br><br>", s, flags=re.IGNORECASE)
    # When the original innerHTML already starts/ends with a block wrapper, the
    # substitution leaves stray <br>s at the edges that the editor doesn't show.
    s = re.sub(r"^(?:\s*<br\s*/?>)+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:<br\s*/?>\s*)+$", "", s, flags=re.IGNORECASE)
    return s


def _sanitize_inline_html(raw: str) -> str:
    """Keep only whitelisted inline tags/attrs; escape everything else.

    Notably:
      - <span> keeps only ``style="color: …"`` and a few weight/style/decoration
        properties (any other style is dropped).
      - <font color="…"> is rewritten to <span style="color:…">.
      - <a> requires a safe protocol; href is HTML-escaped; target/rel are
        forced so links open in a new tab without leaking the opener.
      - Stray text and entities pass through HTML-escaped.
    """
    from html.parser import HTMLParser

    class _Sanitizer(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.out: List[str] = []
            self._open_font = 0

        def _attrs(self, attrs: List) -> Dict[str, str]:
            return {k.lower(): (v or "") for k, v in attrs}

        def handle_starttag(self, tag: str, attrs: List) -> None:
            tag = tag.lower()
            if tag == "font":
                # Legacy execCommand fallback — emit as <span style="color:…">.
                color = _safe_color(self._attrs(attrs).get("color", ""), "")
                if color:
                    self.out.append(f'<span style="color:{color};">')
                    self._open_font += 1
                else:
                    self._open_font += 1  # still track so end-tag balances
                return
            if tag not in _ALLOWED_INLINE_TAGS:
                return
            a = self._attrs(attrs)
            if tag == "a":
                href = a.get("href", "").strip()
                if not (href.startswith(_LINK_PROTOCOLS) or href.startswith("{")):
                    return  # drop unsafe links — children still render
                escaped_href = html_module.escape(href, quote=True)
                self.out.append(
                    f'<a href="{escaped_href}" target="_blank" rel="noopener noreferrer">'
                )
                return
            if tag == "span":
                safe_style = _extract_safe_styles(a.get("style"))
                if safe_style:
                    self.out.append(f'<span style="{safe_style};">')
                else:
                    # No usable style — emit a bare span (still balances end-tag).
                    self.out.append("<span>")
                return
            self.out.append(f"<{tag}>")

        def handle_endtag(self, tag: str) -> None:
            tag = tag.lower()
            if tag == "font":
                if self._open_font > 0:
                    self._open_font -= 1
                    self.out.append("</span>")
                return
            if tag in _ALLOWED_INLINE_TAGS:
                self.out.append(f"</{tag}>")

        def handle_startendtag(self, tag: str, attrs: List) -> None:
            if tag.lower() == "br":
                self.out.append("<br>")

        def handle_data(self, data: str) -> None:
            self.out.append(html_module.escape(data))

        def handle_entityref(self, name: str) -> None:
            self.out.append(f"&{name};")

        def handle_charref(self, name: str) -> None:
            self.out.append(f"&#{name};")

    s = _Sanitizer()
    s.feed(raw or "")
    s.close()
    # Balance any unclosed <font> tracking.
    while s._open_font > 0:
        s.out.append("</span>")
        s._open_font -= 1
    return "".join(s.out)


def _strip_tags(raw: str) -> str:
    """Plain-text version of a rich-text field for the text/plain MIME part."""
    if not raw:
        return ""
    # <br> → newline so paragraphs survive in the plain-text alternative.
    s = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    return re.sub(r"<[^>]+>", "", s)


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
        # Heading text may contain inline rich-text HTML (b/i/u/span color/a)
        # from the editor. Substitute placeholders, normalize block wrappers
        # (the editor's Enter key produces <div>line</div> in Chromium), then
        # sanitize.
        raw = _normalize_block_breaks(block.get("text") or "")
        text = _sanitize_inline_html(_substitute(raw, context))
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
        raw = _normalize_block_breaks(block.get("text") or "")
        text = _sanitize_inline_html(_substitute(raw, context))
        size_key = block.get("size") if block.get("size") in _TEXT_SIZE_PX else "normal"
        font_px = _TEXT_SIZE_PX[size_key]
        align = _align(block.get("align"))
        color = _safe_color(
            block.get("color"),
            _design_color(design, "textColor", "#262626"),
        )
        # One <p> per text block. Every break (whether <br>, <div>-derived, or
        # legacy \n / \n\n) is a soft break inside this paragraph. The 16px
        # margin then sits ONLY between blocks — never between lines inside a
        # block — so the rendered email matches the editor's WYSIWYG spacing
        # instead of stacking per-paragraph margins the editor doesn't show.
        body = text.replace("\n", "<br>")
        if not body.strip():
            return '<p style="margin:0 0 16px 0;">&nbsp;</p>'
        return (
            f'<p style="margin:0 0 16px 0;font-size:{font_px}px;line-height:1.6;'
            f'color:{color};text-align:{align};">{body}</p>'
        )

    if bt == "image":
        url = block.get("url") or ""
        alt = _esc(block.get("alt") or "")
        # Accept http(s) URLs and inline data: image URIs from the uploader.
        # data: URIs render inline in most modern clients (Gmail, Apple Mail,
        # Outlook 365); the editor caps uploads at 5 MB, so we don't recheck
        # size here.
        if not url or not (
            url.startswith(("http://", "https://"))
            or url.startswith("data:image/")
        ):
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
            out.append(_strip_tags(_substitute(block.get("text") or "", context)).upper())
            out.append("")
        elif bt == "text":
            out.append(_strip_tags(_substitute(block.get("text") or "", context)))
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
        f"<div>Created by Newsletter Tool livingUI</div>"
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
    text += "Created by Newsletter Tool livingUI\n"

    return {"html": html, "text": text}
