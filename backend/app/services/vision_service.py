"""
AEGIS — Gemini Vision weapon-detection service.

Uses Gemini's multimodal API to scan frames for weapons.  This runs in
parallel with YOLO and catches weapons the COCO-trained YOLOv8n model
cannot (guns, rifles, blades, improvised weapons, etc.).

Gracefully disabled when LLM_ENABLED=false or GEMINI_API_KEY is absent.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.schemas import Detection

logger = get_logger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="gemini_vision")

# Gemini model — flash is fast enough for per-frame analysis
_VISION_MODEL = "gemini-1.5-flash"

_WEAPON_PROMPT = """You are a security AI analyzing a surveillance camera frame.

Carefully examine this image for ANY of the following:
- Firearms: guns, pistols, handguns, rifles, shotguns, revolvers (real or realistic-looking)
- Bladed weapons: knives, machetes, swords, daggers, blades
- Improvised weapons: forks, tools, bottles, bats, or any object being held in a threatening manner
- Any other object that could be used to cause harm

Respond ONLY with a valid JSON object — no markdown, no explanation, nothing else:
{
  "has_weapon": true or false,
  "weapons": [
    {
      "name": "descriptive name of the object",
      "confidence": 0.0 to 1.0,
      "threatening": true or false
    }
  ],
  "notes": "brief observation about the scene"
}

If nothing threatening is visible, return: {"has_weapon": false, "weapons": [], "notes": "clear"}
"""


def _call_gemini(image_bytes: bytes) -> List[Detection]:
    """Synchronous Gemini call — runs inside a ThreadPoolExecutor."""
    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(_VISION_MODEL)

        b64 = base64.b64encode(image_bytes).decode("utf-8")
        image_part = {"mime_type": "image/jpeg", "data": b64}

        response = model.generate_content([_WEAPON_PROMPT, image_part])
        text = response.text.strip()

        # Strip markdown code fences if Gemini wraps the JSON
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
        text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
        text = text.strip()

        data = json.loads(text)

        if not data.get("has_weapon"):
            logger.info(
                "Gemini vision: no weapons detected",
                notes=data.get("notes", ""),
            )
            return []

        dets: List[Detection] = []
        for w in data.get("weapons", []):
            name = w.get("name", "weapon")
            conf = float(w.get("confidence", 0.7))
            threatening = w.get("threatening", True)

            if conf < 0.25 or not threatening:
                continue

            dets.append(Detection(label="weapon", confidence=round(conf, 3)))
            logger.info(
                "Gemini vision: weapon detected",
                weapon=name,
                confidence=round(conf, 3),
            )

        if not dets:
            logger.info("Gemini vision: objects found but none threatening")

        return dets

    except json.JSONDecodeError as exc:
        logger.warning("Gemini vision: JSON parse failed", error=str(exc))
        return []
    except Exception as exc:
        logger.warning("Gemini vision: call failed", error=str(exc))
        return []


async def detect_weapons_with_gemini(image_bytes: bytes) -> List[Detection]:
    """
    Async wrapper — offloads the blocking Gemini HTTP call to a thread pool
    so it can run in parallel with YOLO and MediaPipe without blocking the loop.

    Returns [] when LLM is disabled, key is missing, or the call fails.
    """
    if not settings.llm_enabled or not settings.gemini_api_key:
        logger.debug("Gemini vision: skipped (LLM_ENABLED=false or no API key)")
        return []

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _call_gemini, image_bytes)
