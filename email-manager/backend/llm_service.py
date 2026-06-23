"""
LLM Service for Email Manager

Wraps CraftBot's LLMInterface for per-column AI email summaries.
Falls back gracefully to stub output when LLM is unavailable.
"""

import sys
import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Locate CraftBot root: installed path is 6 levels up, dev path is a sibling folder
_CRAFTBOT_ROOT_INSTALLED = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
_CRAFTBOT_ROOT_DEV = Path(__file__).resolve().parent.parent.parent.parent / "CraftBot"

for _root in (_CRAFTBOT_ROOT_INSTALLED, _CRAFTBOT_ROOT_DEV):
    if _root.exists() and str(_root) not in sys.path:
        sys.path.append(str(_root))

_llm_instance = None
_llm_init_attempted = False


def _get_llm():
    global _llm_instance, _llm_init_attempted
    if _llm_instance is not None or _llm_init_attempted:
        return _llm_instance
    _llm_init_attempted = True
    try:
        from app.config import get_api_key, get_llm_provider, get_llm_model
        from agent_core.core.impl.llm.interface import LLMInterface

        provider = get_llm_provider()
        model = get_llm_model()
        api_key = get_api_key(provider)

        if not api_key:
            logger.warning("[LLM] No API key configured for provider: %s", provider)
            return None

        _llm_instance = LLMInterface(
            provider=provider,
            model=model,
            api_key=api_key,
            temperature=0.7,
            max_tokens=1000,
        )
        logger.info("[LLM] Initialized provider=%s model=%s", provider, model)
        return _llm_instance
    except Exception as e:
        logger.warning("[LLM] Not available: %s", e)
        return None


def llm_available() -> bool:
    return _get_llm() is not None


async def generate_insights(column_title: str, ai_instructions: str, emails: list) -> Optional[dict]:
    """
    Generate per-column email insights via LLM.
    Returns {"summary": str, "points": [str, ...]} or None if unavailable.
    """
    llm = _get_llm()
    if llm is None:
        return None

    email_lines = []
    for i, e in enumerate(emails[:10], 1):
        email_lines.append(f"{i}. From: {e.get('fromName', e.get('fromEmail', 'Unknown'))} — Subject: {e.get('subject', '(no subject)')}")
        snippet = e.get("snippet", "").strip()
        if snippet:
            email_lines.append(f"   Preview: {snippet[:120]}")

    emails_text = "\n".join(email_lines) if email_lines else "No emails to analyze."

    system_prompt = (
        "You are an email intelligence assistant. Analyze the provided email subjects and snippets "
        "and produce a concise summary for the inbox column.\n\n"
        "Return ONLY valid JSON in this exact format:\n"
        '{"summary": "One sentence overview", "points": ["Point 1", "Point 2", "Point 3"]}\n\n'
        "Keep points to 3-5 items. Be concise and actionable. No markdown, no explanation — only the JSON object."
    )

    user_prompt = f"Column: {column_title}\n\nRecent emails:\n{emails_text}"
    if ai_instructions and ai_instructions.strip():
        user_prompt += f"\n\nFocus on: {ai_instructions.strip()}"

    try:
        raw = await llm.generate_response_async(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
        if not raw:
            return None

        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[-1] if "```" in cleaned[3:] else cleaned[3:]
            cleaned = cleaned.lstrip("json").strip()
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].strip()

        parsed = json.loads(cleaned)
        summary = str(parsed.get("summary", ""))
        points = [str(p) for p in parsed.get("points", []) if p]
        if summary or points:
            return {"summary": summary, "points": points}
        return None
    except Exception as e:
        logger.error("[LLM] Insights generation failed: %s", e)
        return None
