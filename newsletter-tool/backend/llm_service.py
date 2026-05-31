"""
LLM Service for Newsletter Tool.

Wraps CraftBot's LLMInterface so the user gets AI-generated email copy from
whichever LLM provider they already configured in CraftBot. Same pattern as
``word-improve/backend/llm_service.py``.

When CraftBot's LLM modules are not importable (e.g. local marketplace dev
without the parent repo on path) or no API key is configured, the service
returns ``None`` and callers fall back to a deterministic template-based
generator so the app stays functional and the smoke test passes.
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
# Installed layout: {CraftBot}/agent_file_system/workspace/living_ui/{project}/backend/llm_service.py
_CRAFTBOT_ROOT_INSTALLED = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
# Marketplace-dev layout: CraftBot_/living-ui-marketplace/{project}/backend/llm_service.py
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
            temperature=0.8,
            max_tokens=4000,
        )
        logger.info("[LLM] Initialized provider=%s model=%s", provider, model)
        return _llm_instance
    except Exception as e:
        logger.warning("[LLM] Falling back to stub generation — CraftBot LLM unavailable: %s", e)
        return None


def llm_available() -> bool:
    return _get_llm() is not None


async def generate_text(
    system_prompt: str, user_prompt: str, timeout: float = 6.0,
) -> Optional[str]:
    llm = _get_llm()
    if llm is None:
        return None
    try:
        return await asyncio.wait_for(
            llm.generate_response_async(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            ),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        logger.warning("[LLM] Generation timed out after %.1fs — falling back to stub", timeout)
        return None
    except Exception as e:
        logger.error("[LLM] Generation failed: %s", e)
        return None


def generate_text_sync(
    system_prompt: str, user_prompt: str, timeout: float = 6.0,
) -> Optional[str]:
    try:
        return asyncio.run(generate_text(system_prompt, user_prompt, timeout=timeout))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                generate_text(system_prompt, user_prompt, timeout=timeout),
            )
        finally:
            loop.close()


def parse_json_response(text: str) -> Optional[Any]:
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


def store_cache(db, cache_key: str, content: Any, hours: int = 12) -> None:
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
