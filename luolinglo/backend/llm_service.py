"""
LLM Service for Luolinglo

Calls CraftBot's LLM bridge (via services.integration_client) to provide
language learning AI features. CraftBot resolves the provider/model/API key
centrally, server-side — this module no longer duplicates that logic.
"""

import json
import re
import hashlib
import logging
from typing import Any, Optional
from datetime import datetime, timedelta

from services.integration_client import integration

logger = logging.getLogger(__name__)


async def generate_text(system_prompt: str, user_prompt: str) -> Optional[str]:
    """Generate text using CraftBot's LLM bridge."""
    if not integration.available:
        logger.warning("[LLM] CraftBot bridge not configured (CRAFTBOT_BRIDGE_URL/TOKEN unset)")
        return None

    try:
        response = await integration.llm_complete(user_prompt, system_prompt)
    except Exception as e:
        logger.error("[LLM] Generation failed: %s", e)
        return None

    if not response:
        logger.error("[LLM] Bridge call returned empty response")
        return None

    return response


def parse_json_response(text: str) -> Optional[Any]:
    """Parse a JSON response from LLM output, stripping markdown code fences anywhere in the string."""
    if not text:
        return None

    cleaned = re.sub(r"```(?:json)?", "", text).strip()

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
