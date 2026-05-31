"""
Prompt templates for AI email generation.

A single LLM call returns a structured email: subject + preheader + ordered
list of blocks. The frontend renders the blocks in the drag-and-drop editor.
"""

from typing import Optional

SYSTEM_PROMPT = (
    "You are an expert newsletter copywriter. You write engaging, concise email "
    "newsletters in a structured JSON format. You always return valid JSON with "
    "no commentary, no markdown fences, and no extra keys. Keep paragraphs "
    "short (1-3 sentences). Match the requested tone exactly."
)


def email_generation_prompt(
    prompt: str,
    tone: str,
    audience: Optional[str] = None,
    include_cta: bool = True,
) -> str:
    audience_line = (
        f"\nAUDIENCE: {audience.strip()}" if audience and audience.strip() else ""
    )
    cta_block = (
        '    {"type": "button", "label": "<2-4 word call-to-action>", "url": "https://example.com"},\n'
        if include_cta else ""
    )
    return f"""Write a complete newsletter email based on the user prompt below.

USER PROMPT: {prompt.strip()}
TONE: {tone}{audience_line}

Return EXACTLY this JSON shape (no other keys, no markdown fences):
{{
  "subject": "<short subject line, max 70 chars>",
  "preheader": "<one-line preheader text, max 110 chars>",
  "blocks": [
    {{"type": "heading", "text": "<short headline>", "level": 1}},
    {{"type": "text", "text": "<opening paragraph, 1-3 sentences>"}},
    {{"type": "text", "text": "<body paragraph, 1-3 sentences>"}},
{cta_block}    {{"type": "text", "text": "<closing paragraph or sign-off>"}}
  ]
}}

Rules:
- Subject must be punchy and curiosity-inducing — no clickbait.
- Preheader must complement (not repeat) the subject.
- 3 to 6 blocks total. At least one heading and one body paragraph.
- Address the reader directly with "you".
- Never invent product names, prices, statistics, or quotes the user didn't supply.
- Match the {tone} tone consistently.
"""


def stub_email(prompt: str, tone: str) -> dict:
    """Deterministic fallback used when CraftBot's LLM is not reachable.

    Produces a well-formed email so the smoke test stays green and the user can
    still see the editor populated, with a clear note that the LLM was offline.
    """
    base = (prompt or "your latest update").strip().rstrip(".")
    short = base[:60] if base else "your latest update"
    return {
        "subject": f"{short[:60]} — a quick note",
        "preheader": "Configure the CraftBot LLM provider to get AI-generated copy.",
        "blocks": [
            {"type": "heading", "text": short[:80], "level": 1},
            {"type": "text", "text": (
                f"Hi {{firstName}}, here's a draft about {short[:120]}."
            )},
            {"type": "text", "text": (
                "This is a stub draft. Connect a Claude, OpenAI, or other LLM "
                "provider in CraftBot's settings to get real AI generation in "
                f"a {tone.lower()} tone."
            )},
            {"type": "button", "label": "Read more", "url": "https://example.com"},
            {"type": "text", "text": "Thanks for reading.\n— The team"},
        ],
    }
