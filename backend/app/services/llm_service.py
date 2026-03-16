"""
AEGIS — LLM Service (Gemini)
Generates human-readable incident summaries from structured CV outputs.
Gracefully disabled when GEMINI_API_KEY is not set or LLM_ENABLED=false.
"""

from __future__ import annotations

import json
from typing import List, Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.models.enums import EventType, Severity
from app.schemas.schemas import Detection

logger = get_logger(__name__)

_gemini_model = None


def _get_model():
    global _gemini_model
    if _gemini_model is None:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=settings.gemini_api_key)
        _gemini_model = genai.GenerativeModel(settings.gemini_model)
    return _gemini_model


async def generate_incident_summary(
    camera_id: str,
    event_type: EventType,
    severity: Severity,
    risk_score: float,
    detections: List[Detection],
    location: Optional[str] = None,
) -> Optional[str]:
    """
    Use Gemini to produce a concise, actionable incident summary.
    Returns None if LLM is disabled or fails.
    """
    if not settings.llm_enabled or not settings.gemini_api_key:
        return _fallback_summary(event_type, severity, detections)

    try:
        import asyncio

        det_data = [
            {"label": d.label, "confidence": round(d.confidence, 3)}
            for d in detections
        ]

        prompt = f"""You are an AI security analyst for AEGIS Surveillance.
Generate a concise (2–3 sentence) actionable incident alert for security operators.

Input data:
- Camera: {camera_id}
- Location: {location or "unknown"}
- Event type: {event_type.value}
- Severity: {severity.value}
- Risk score: {risk_score:.2%}
- Detections: {json.dumps(det_data)}

Rules:
1. Be specific about what was detected and the confidence.
2. State the risk level clearly.
3. End with a recommended immediate action (e.g., "Dispatch security to Zone A immediately.").
4. Do NOT use markdown or bullet points — plain prose only.
5. Keep it under 80 words."""

        model = _get_model()
        response = await asyncio.get_event_loop().run_in_executor(
            None, lambda: model.generate_content(prompt)
        )
        summary = response.text.strip()
        logger.debug("LLM summary generated", camera_id=camera_id)
        return summary

    except Exception as exc:
        logger.warning("LLM summary generation failed", error=str(exc))
        return _fallback_summary(event_type, severity, detections)


def _fallback_summary(
    event_type: EventType,
    severity: Severity,
    detections: List[Detection],
) -> str:
    labels = ", ".join({d.label for d in detections}) or "unknown"
    max_conf = max((d.confidence for d in detections), default=0.0)
    return (
        f"[{severity.value.upper()}] {event_type.value.capitalize()} detected "
        f"({labels}) with {max_conf:.0%} confidence. "
        f"Immediate review recommended."
    )


async def answer_natural_language_query(question: str) -> str:
    """
    Allow operators to query the system in natural language.
    Returns a MongoDB query plan description + formatted answer.
    (Full implementation would parse the NL into a Mongo aggregation.)
    """
    if not settings.llm_enabled or not settings.gemini_api_key:
        return "LLM not enabled. Please use the structured query API at GET /api/events."

    try:
        import asyncio

        prompt = f"""You are an AI assistant for AEGIS, an AI surveillance system.
A security operator has asked: "{question}"

The system stores events in MongoDB with fields:
  camera_id, event_type (intruder|weapon|conflict|motion), severity (low|medium|high|critical),
  risk_score (0–1), timestamp, detections (array of {{label, confidence, bounding_box}}).

Provide a helpful, concise response explaining what data would be returned and any key insights.
If the question is about a specific time range or zone, acknowledge that you would filter accordingly.
Keep the response under 100 words. Plain prose only."""

        model = _get_model()
        response = await asyncio.get_event_loop().run_in_executor(
            None, lambda: model.generate_content(prompt)
        )
        return response.text.strip()

    except Exception as exc:
        logger.error("NL query failed", error=str(exc))
        return "Unable to process query. Please use GET /api/events with filter parameters."
