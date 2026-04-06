"""
LLM Service for Luolinglo

Wraps CraftBot's LLMInterface to provide language learning AI features.
Reuses the user's configured API key and LLM provider.
"""

import sys
import json
import hashlib
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Add CraftBot root to path so we can import its modules
_CRAFTBOT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_CRAFTBOT_ROOT))

_llm_instance = None


def _get_llm():
    """Lazy-initialize the LLM interface using CraftBot's settings."""
    global _llm_instance
    if _llm_instance is not None:
        return _llm_instance

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
            max_tokens=4000,
        )
        logger.info("[LLM] Initialized with provider=%s, model=%s", provider, model)
        return _llm_instance
    except Exception as e:
        logger.error("[LLM] Failed to initialize: %s", e)
        return None


async def generate_text(system_prompt: str, user_prompt: str) -> Optional[str]:
    """Generate text using the LLM."""
    llm = _get_llm()
    if llm is None:
        return None

    try:
        response = await llm.generate_response_async(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
        return response
    except Exception as e:
        logger.error("[LLM] Generation failed: %s", e)
        return None


def parse_json_response(text: str) -> Optional[Any]:
    """Parse a JSON response from LLM output, handling markdown code blocks."""
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
        logger.error("[LLM] Failed to parse JSON response: %s...", cleaned[:200])
        return None


def make_cache_key(*parts: str) -> str:
    """Create a deterministic cache key from parts."""
    combined = "|".join(str(p) for p in parts)
    return hashlib.sha256(combined.encode()).hexdigest()[:32]


def check_cache(db, cache_key: str) -> Optional[Any]:
    """Check LLM cache for a cached response."""
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
    """Store a response in the LLM cache."""
    from models import LLMCache

    existing = db.query(LLMCache).filter(LLMCache.cache_key == cache_key).first()
    if existing:
        existing.content = content
        existing.expires_at = datetime.utcnow() + timedelta(hours=hours)
    else:
        entry = LLMCache(
            cache_key=cache_key,
            content=content,
            expires_at=datetime.utcnow() + timedelta(hours=hours),
        )
        db.add(entry)
    db.commit()
