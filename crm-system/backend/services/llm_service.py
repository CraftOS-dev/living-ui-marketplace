"""
LLM Service for CRM System

Wraps CraftBot's LLMInterface so AI features (record summary, email drafting,
lead scoring, "ask your CRM") use whichever LLM provider the user already
configured in CraftBot. Mirrors the pattern used by word-improve/luolinglo.

When CraftBot's LLM modules are not importable (local marketplace dev without
the parent repo) or no API key is configured, ``llm_available()`` returns
False and every AI route responds 200 with ``{"configured": false}`` so the
frontend can render an honest empty state and the smoke test passes.
"""

import sys
import json
import logging
import asyncio
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Add CraftBot root to path so we can import its modules.
# Installed layout: {CraftBot}/agent_file_system/workspace/living_ui/{project}/backend/services/llm_service.py
_CRAFTBOT_ROOT_INSTALLED = Path(__file__).resolve().parents[6] if len(Path(__file__).resolve().parents) > 6 else None
# Marketplace dev layout: CraftBot_/living-ui-marketplace/{project}/backend/services/llm_service.py
_CRAFTBOT_ROOT_DEV = Path(__file__).resolve().parents[4] / "CraftBot"

for _root in (_CRAFTBOT_ROOT_INSTALLED, _CRAFTBOT_ROOT_DEV):
    # Append (not insert) so we never shadow the per-app backend's own modules.
    if _root and _root.exists() and str(_root) not in sys.path:
        sys.path.append(str(_root))

_llm_instance = None
_llm_init_attempted = False
_llm_model_name = ""


def _get_llm():
    """Lazy-initialize the LLM interface using CraftBot's settings."""
    global _llm_instance, _llm_init_attempted, _llm_model_name
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
            temperature=0.4,
            max_tokens=4000,
        )
        _llm_model_name = f"{provider}/{model}"
        logger.info("[LLM] Initialized provider=%s model=%s", provider, model)
        return _llm_instance
    except Exception as e:
        logger.warning("[LLM] Not available (AI features disabled): %s", e)
        return None


def llm_available() -> bool:
    return _get_llm() is not None


def llm_model_name() -> str:
    _get_llm()
    return _llm_model_name


async def generate_text(system_prompt: str, user_prompt: str) -> Optional[str]:
    """Generate text from the configured LLM provider. None when unavailable."""
    llm = _get_llm()
    if llm is None:
        return None
    try:
        return await llm.generate_response_async(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
    except Exception as e:
        logger.error("[LLM] Generation failed: %s", e)
        return None


def generate_text_sync(system_prompt: str, user_prompt: str) -> Optional[str]:
    """Synchronous wrapper for sync FastAPI routes."""
    try:
        return asyncio.run(generate_text(system_prompt, user_prompt))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(generate_text(system_prompt, user_prompt))
        finally:
            loop.close()


def parse_json_response(text: str) -> Optional[Any]:
    """Strip markdown fences and parse a JSON response from LLM output."""
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.error("[LLM] JSON parse failed: %s ...", cleaned[:200])
        return None
