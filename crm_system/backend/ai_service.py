"""
CRM AI Service - wraps CraftBot's LLMInterface to provide CRM-specific AI capabilities.

Provides lead scoring, email generation, deal forecasting, meeting summarisation,
sentiment analysis, contact enrichment, and a conversational chat assistant.
"""

import sys
import json
import re
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Add CraftBot root to path for LLM access
CRAFTBOT_ROOT = "c:/Users/zfoong/Desktop/agent/code/git/CraftBot"
if CRAFTBOT_ROOT not in sys.path:
    sys.path.insert(0, CRAFTBOT_ROOT)

from ai_prompts import (
    LEAD_SCORING_SYSTEM,
    LEAD_SCORING_USER,
    EMAIL_GENERATION_SYSTEM,
    EMAIL_GENERATION_USER,
    DEAL_FORECAST_SYSTEM,
    DEAL_FORECAST_USER,
    MEETING_SUMMARY_SYSTEM,
    MEETING_SUMMARY_USER,
    SENTIMENT_ANALYSIS_SYSTEM,
    SENTIMENT_ANALYSIS_USER,
    CONTACT_ENRICHMENT_SYSTEM,
    CONTACT_ENRICHMENT_USER,
)


class CRMAIService:
    """High-level AI service for CRM operations, backed by CraftBot's LLMInterface."""

    def __init__(self):
        from app.config import get_api_key, get_llm_provider, get_llm_model
        from app.llm_interface import LLMInterface

        self.provider = get_llm_provider()
        self.api_key = get_api_key(self.provider)
        self.model = get_llm_model()

        if not self.api_key:
            raise RuntimeError(f"No API key configured for provider: {self.provider}")

        self.llm = LLMInterface()
        logger.info(
            "CRMAIService initialised (provider=%s, model=%s)", self.provider, self.model
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        """Call the LLM and return the raw response text."""
        try:
            response = self.llm.generate_response(system_prompt, user_prompt)
            return response
        except Exception as exc:
            logger.error("LLM call failed: %s", exc)
            raise RuntimeError(f"LLM call failed: {exc}") from exc

    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """Parse JSON from an LLM response, tolerating markdown code fences."""
        text = response.strip()

        # Strip markdown code block wrapper if present
        if text.startswith("```"):
            lines = text.split("\n")
            # Remove first line (```json or ```) and last line (```)
            if len(lines) > 2:
                text = "\n".join(lines[1:-1]).strip()
            else:
                text = text.strip("`").strip()

        # First attempt: direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Second attempt: find the outermost JSON object in the text
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        # Give up
        logger.error("Failed to parse JSON from LLM response: %s", text[:500])
        raise ValueError("LLM response could not be parsed as JSON")

    def _safe_call(
        self, system_prompt: str, user_prompt: str, fallback: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call the LLM, parse the JSON response, and return *fallback* on any error."""
        try:
            raw = self._call_llm(system_prompt, user_prompt)
            return self._parse_json_response(raw)
        except Exception as exc:
            logger.warning("AI call failed, returning fallback. Error: %s", exc)
            return fallback

    @staticmethod
    def _to_json_str(obj: Any) -> str:
        """Serialise an object to a compact JSON string for prompt injection."""
        if isinstance(obj, str):
            return obj
        return json.dumps(obj, indent=2, default=str)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def score_lead(
        self,
        contact_data: Dict[str, Any],
        activity_count: int = 0,
        note_count: int = 0,
        deal_count: int = 0,
    ) -> Dict[str, Any]:
        """Score a lead on a 0-100 scale with contributing factor breakdown.

        Returns dict with keys: score, factors, reasoning.
        """
        user_prompt = LEAD_SCORING_USER.format(
            contact_data=self._to_json_str(contact_data),
            activity_count=activity_count,
            note_count=note_count,
            deal_count=deal_count,
        )

        fallback: Dict[str, Any] = {
            "score": 50,
            "factors": {
                "profileCompleteness": 50,
                "companyFit": 50,
                "engagement": 50,
                "recency": 50,
            },
            "reasoning": "Unable to score lead automatically. Default score assigned.",
        }

        result = self._safe_call(LEAD_SCORING_SYSTEM, user_prompt, fallback)

        # Clamp the top-level score
        if "score" in result:
            result["score"] = max(0, min(100, int(result["score"])))

        return result

    def generate_email(
        self,
        contact_data: Dict[str, Any],
        purpose: str,
        tone: str = "professional",
        context: Optional[str] = None,
        recent_activities: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate a personalised email draft.

        Returns dict with keys: subject, body, suggestedFollowUp.
        """
        user_prompt = EMAIL_GENERATION_USER.format(
            contact_data=self._to_json_str(contact_data),
            purpose=purpose,
            tone=tone,
            context=context or "No additional context provided.",
            recent_activities=self._to_json_str(recent_activities or []),
        )

        fallback: Dict[str, Any] = {
            "subject": f"Regarding: {purpose}",
            "body": "Unable to generate email content automatically. Please draft manually.",
            "suggestedFollowUp": "Follow up within 3 business days.",
        }

        return self._safe_call(EMAIL_GENERATION_SYSTEM, user_prompt, fallback)

    def forecast_deal(
        self,
        deal_data: Dict[str, Any],
        similar_deals: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Forecast deal outcome based on current data and historical patterns.

        Returns dict with keys: closeProbability, predictedCloseDate,
        predictedValue, riskFactors, recommendations, reasoning.
        """
        user_prompt = DEAL_FORECAST_USER.format(
            deal_data=self._to_json_str(deal_data),
            similar_deals=self._to_json_str(similar_deals or []),
        )

        fallback: Dict[str, Any] = {
            "closeProbability": 50,
            "predictedCloseDate": "unknown",
            "predictedValue": deal_data.get("value", 0),
            "riskFactors": ["Insufficient data for accurate forecast"],
            "recommendations": ["Gather more information before relying on this forecast"],
            "reasoning": "Unable to generate forecast automatically.",
        }

        result = self._safe_call(DEAL_FORECAST_SYSTEM, user_prompt, fallback)

        if "closeProbability" in result:
            result["closeProbability"] = max(0, min(100, int(result["closeProbability"])))

        return result

    def summarize_meeting(self, notes_text: str) -> Dict[str, Any]:
        """Summarise meeting notes into structured output.

        Returns dict with keys: summary, keyTopics, decisions,
        actionItems, sentiment, nextSteps.
        """
        if not notes_text or not notes_text.strip():
            return {
                "summary": "No meeting notes provided.",
                "keyTopics": [],
                "decisions": [],
                "actionItems": [],
                "sentiment": "neutral",
                "nextSteps": "Provide meeting notes to generate a summary.",
            }

        user_prompt = MEETING_SUMMARY_USER.format(notes_text=notes_text)

        fallback: Dict[str, Any] = {
            "summary": "Unable to summarise meeting notes automatically.",
            "keyTopics": [],
            "decisions": [],
            "actionItems": [],
            "sentiment": "neutral",
            "nextSteps": "Review the meeting notes manually.",
        }

        return self._safe_call(MEETING_SUMMARY_SYSTEM, user_prompt, fallback)

    def analyze_sentiment(self, text: str) -> Dict[str, Any]:
        """Analyse the sentiment of CRM text (email, note, chat message).

        Returns dict with keys: score, label, urgency, redFlags,
        highlights, confidence.
        """
        if not text or not text.strip():
            return {
                "score": 0.0,
                "label": "neutral",
                "urgency": "low",
                "redFlags": [],
                "highlights": [],
                "confidence": 0.0,
            }

        user_prompt = SENTIMENT_ANALYSIS_USER.format(text=text)

        fallback: Dict[str, Any] = {
            "score": 0.0,
            "label": "neutral",
            "urgency": "low",
            "redFlags": [],
            "highlights": [],
            "confidence": 0.0,
        }

        result = self._safe_call(SENTIMENT_ANALYSIS_SYSTEM, user_prompt, fallback)

        # Clamp sentiment score
        if "score" in result:
            try:
                result["score"] = max(-1.0, min(1.0, float(result["score"])))
            except (TypeError, ValueError):
                result["score"] = 0.0

        return result

    def enrich_contact(self, contact_data: Dict[str, Any]) -> Dict[str, Any]:
        """Suggest additional field values for a contact record.

        Returns dict with keys: suggestions (list of field/value/confidence/reasoning),
        overallConfidence.
        """
        user_prompt = CONTACT_ENRICHMENT_USER.format(
            contact_data=self._to_json_str(contact_data),
        )

        fallback: Dict[str, Any] = {
            "suggestions": [],
            "overallConfidence": 0.0,
        }

        return self._safe_call(CONTACT_ENRICHMENT_SYSTEM, user_prompt, fallback)

