"""
LLM Service for Word Improve

Wraps CraftBot's LLMInterface so the user gets variants from whichever LLM
provider they already configured in CraftBot. Mirrors the pattern in
``luolinglo/backend/llm_service.py``.

When CraftBot's LLM modules are not importable (e.g. local marketplace dev
without the parent repo on path) or no API key is configured, the service
returns ``None`` and callers fall back to mock variants so the app stays
functional and the marketplace smoke test passes.
"""

import sys
import json
import hashlib
import logging
import asyncio
from pathlib import Path
from typing import Any, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Add CraftBot root to path so we can import its modules.
# When installed by CraftBot the path is:
#   {CraftBot}/agent_file_system/workspace/living_ui/{project}/backend/llm_service.py
# Six .parent calls reach {CraftBot}.
_CRAFTBOT_ROOT_INSTALLED = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
# In the marketplace dev layout we sit at:
#   CraftBot_/living-ui-marketplace/{project}/backend/llm_service.py
# Sibling CraftBot lives at: CraftBot_/CraftBot
_CRAFTBOT_ROOT_DEV = Path(__file__).resolve().parent.parent.parent.parent / "CraftBot"

# Append (not insert at 0) so we never shadow the per-app backend's own modules
# (main, models, routes, etc.). The CraftBot root only contributes ``app.*`` and
# ``agent_core.*`` packages, which the backend doesn't have.
for _root in (_CRAFTBOT_ROOT_INSTALLED, _CRAFTBOT_ROOT_DEV):
    if _root.exists() and str(_root) not in sys.path:
        sys.path.append(str(_root))

_llm_instance = None
_llm_init_attempted = False


def _get_llm():
    """Lazy-initialize the LLM interface using CraftBot's settings.

    Returns ``None`` when CraftBot is not importable or no API key is set.
    """
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
            temperature=0.85,
            max_tokens=4000,
        )
        logger.info("[LLM] Initialized provider=%s model=%s", provider, model)
        return _llm_instance
    except Exception as e:
        logger.warning("[LLM] Falling back to mock variants — CraftBot LLM not available: %s", e)
        return None


def llm_available() -> bool:
    """Quick check used by routes to decide between real and mock variants."""
    return _get_llm() is not None


async def generate_text(system_prompt: str, user_prompt: str) -> Optional[str]:
    """Generate text from the configured LLM provider."""
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
    """Synchronous wrapper. Routes are sync; LLMInterface is async."""
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


def make_cache_key(*parts: Any) -> str:
    combined = "|".join(str(p) for p in parts)
    return hashlib.sha256(combined.encode()).hexdigest()[:32]


def check_cache(db, cache_key: str) -> Optional[Any]:
    from models import LLMCache

    cached = db.query(LLMCache).filter(LLMCache.cache_key == cache_key).first()
    if cached is None:
        return None
    if cached.expires_at and cached.expires_at < datetime.utcnow():
        db.delete(cached)
        db.commit()
        return None
    return cached.content


def store_cache(db, cache_key: str, content: Any, hours: int = 24) -> None:
    from models import LLMCache

    existing = db.query(LLMCache).filter(LLMCache.cache_key == cache_key).first()
    if existing:
        existing.content = content
        existing.expires_at = datetime.utcnow() + timedelta(hours=hours)
    else:
        db.add(LLMCache(
            cache_key=cache_key,
            content=content,
            expires_at=datetime.utcnow() + timedelta(hours=hours),
        ))
    db.commit()
