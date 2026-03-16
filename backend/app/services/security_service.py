"""
AEGIS — Security service.

Handles:
  - Face & gait matching against restricted / missing persons lists.
  - Each check is individually gated by a feature flag.
  - Local-only alert dispatch to security WebSocket sessions.
  - Audit logging of every detection event.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.logging import get_logger
from app.cv.face_engine import face_engine
from app.cv.gait_analyzer import gait_analyzer
from app.db.mongodb import (
    missing_persons_col,
    restricted_persons_col,
    security_audit_col,
)
from app.services.feature_flags import feature_flags
from app.services.websocket_manager import ws_manager

logger = get_logger(__name__)

# DB projections — never return raw embeddings to callers
_RESTRICTED_PROJ = {
    "person_id": 1, "name": 1, "reason": 1, "face_encoding": 1, "_id": 0,
}
_MISSING_PROJ = {
    "person_id": 1, "name": 1, "category": 1,
    "face_encoding": 1, "gait_signature": 1, "_id": 0,
}


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _audit(
    event_type: str,
    person_id: str,
    person_name: str,
    camera_id: str,
    confidence: float,
    match_type: str,
    location: Optional[str],
) -> None:
    doc = {
        "log_id": str(uuid.uuid4()),
        "event_type": event_type,
        "person_id": person_id,
        "person_name": person_name,
        "camera_id": camera_id,
        "confidence": confidence,
        "match_type": match_type,
        "location": location,
        "detected_at": datetime.now(timezone.utc),
        "acknowledged": False,
    }
    await security_audit_col().insert_one(doc)
    logger.info(
        "Security detection logged",
        event_type=event_type,
        person_id=person_id,
        camera_id=camera_id,
        confidence=confidence,
    )


def _build_alert(
    alert_type: str,
    person_id: str,
    person_name: str,
    camera_id: str,
    confidence: float,
    match_type: str,
    location: Optional[str],
    extra: Optional[Dict] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "alert_id": str(uuid.uuid4()),
        "alert_type": alert_type,
        "person_id": person_id,
        "person_name": person_name,
        "camera_id": camera_id,
        "confidence": confidence,
        "match_type": match_type,
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "location": location,
    }
    if extra:
        payload.update(extra)
    return payload


# ── Public API ────────────────────────────────────────────────────────────────

async def check_frame_for_security_threats(
    frame_bytes: bytes,
    camera_id: str,
    location: Optional[str],
    pose_landmarks: Any = None,
) -> List[Dict[str, Any]]:
    """
    Run enabled security checks against the frame.

    Checks performed (each individually gated):
      1. Restricted persons — face match (requires: facial_recognition + restricted_persons)
      2. Missing persons   — face match (requires: facial_recognition + missing_persons)
      3. Criminal search   — face match, criminal category only
                            (requires: facial_recognition + missing_persons + criminal_search)
      4. Gait analysis     — gait match against missing/criminal persons
                            (requires: gait_analysis + missing_persons)

    Alerts broadcast over WebSocket to security-tier sessions only.
    Nothing published to Kafka/RabbitMQ (local-network policy).
    """
    alerts: List[Dict[str, Any]] = []

    # Read all relevant flags in one pass
    fr_on          = await feature_flags.get("facial_recognition")
    restricted_on  = await feature_flags.get("restricted_persons")
    missing_on     = await feature_flags.get("missing_persons")
    criminal_on    = await feature_flags.get("criminal_search")
    gait_on        = await feature_flags.get("gait_analysis")

    # ── 1. Load lists (only what's needed) ───────────────────────────────────
    restricted_list: List[Dict] = []
    if fr_on and restricted_on and face_engine.is_operational:
        restricted_list = await restricted_persons_col().find(
            {"active": True}, _RESTRICTED_PROJ
        ).to_list(length=1000)

    missing_list: List[Dict] = []
    if missing_on and (fr_on and face_engine.is_operational or gait_on):
        query: Dict = {"status": "active"}
        if not criminal_on:
            query["category"] = "missing"   # exclude criminals if flag off
        missing_list = await missing_persons_col().find(
            query, _MISSING_PROJ
        ).to_list(length=1000)

    # ── 2. Face recognition ───────────────────────────────────────────────────
    if fr_on and face_engine.is_operational and (restricted_list or missing_list):
        face_results = await face_engine.detect_faces_in_frame(frame_bytes)

        for face_data in face_results:
            embedding = face_data.get("embedding")
            if not embedding:
                continue

            # 2a. Restricted persons check
            if restricted_on and restricted_list:
                match = await face_engine.match_face(embedding, restricted_list)
                if match:
                    pid, name, conf = match
                    extra_doc = next(
                        (r for r in restricted_list if r["person_id"] == pid), {}
                    )
                    alert = _build_alert(
                        "restricted_person", pid, name, camera_id, conf,
                        "face", location, {"reason": extra_doc.get("reason", "")}
                    )
                    alerts.append(alert)
                    await _audit(
                        "restricted_person_detected", pid, name,
                        camera_id, conf, "face", location,
                    )

            # 2b. Missing / criminal persons face check
            if missing_on and missing_list:
                # Filter to criminal sub-list if criminal_search is off
                face_candidates = (
                    missing_list if criminal_on
                    else [m for m in missing_list if m.get("category") != "criminal"]
                )
                if face_candidates:
                    match = await face_engine.match_face(embedding, face_candidates)
                    if match:
                        pid, name, conf = match
                        extra_doc = next(
                            (m for m in face_candidates if m["person_id"] == pid), {}
                        )
                        alert = _build_alert(
                            "missing_person", pid, name, camera_id, conf,
                            "face", location,
                            {"category": extra_doc.get("category", "missing")},
                        )
                        alerts.append(alert)
                        await _audit(
                            "missing_person_detected", pid, name,
                            camera_id, conf, "face", location,
                        )

    # ── 3. Gait analysis ──────────────────────────────────────────────────────
    if gait_on and missing_on and missing_list:
        gait_candidates = [m for m in missing_list if m.get("gait_signature")]
        if not criminal_on:
            gait_candidates = [m for m in gait_candidates if m.get("category") != "criminal"]

        if gait_candidates:
            gait_sig: Optional[List[float]] = None
            if pose_landmarks is not None:
                gait_sig = gait_analyzer.extract_from_landmarks(pose_landmarks)
            else:
                gait_sig = await gait_analyzer.extract_from_frame(frame_bytes)

            if gait_sig:
                match = gait_analyzer.match(gait_sig, gait_candidates)
                if match:
                    pid, name, conf = match
                    already_alerted = any(
                        a["person_id"] == pid and a["match_type"] == "face"
                        for a in alerts
                    )
                    if not already_alerted:
                        extra_doc = next(
                            (m for m in gait_candidates if m["person_id"] == pid), {}
                        )
                        alert = _build_alert(
                            "missing_person", pid, name, camera_id, conf,
                            "gait", location,
                            {"category": extra_doc.get("category", "missing")},
                        )
                        alerts.append(alert)
                        await _audit(
                            "missing_person_gait_detected", pid, name,
                            camera_id, conf, "gait", location,
                        )

    # ── 4. Broadcast (local WebSocket only) ───────────────────────────────────
    for alert in alerts:
        await ws_manager.broadcast_security_alert(alert)

    return alerts
