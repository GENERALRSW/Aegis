"""
AEGIS — Risk scoring and event type classification.

Rules (combinatorial):
  intruder only          → low   (0.30)
  weapon only            → medium (0.60)
  conflict only          → medium (0.55)
  intruder + weapon      → high  (0.80)
  intruder + conflict    → high  (0.75)
  weapon + conflict      → high  (0.85)
  intruder+weapon+conflict → critical (0.95)
"""

from __future__ import annotations

from typing import List, Tuple

from app.models.enums import EventType, Severity
from app.schemas.schemas import Detection


def compute_risk(detections: List[Detection]) -> Tuple[float, EventType, Severity]:
    """
    Given a list of detections from the CV engine, return:
        (risk_score: 0–1, dominant_event_type, severity)
    """
    labels = {d.label.lower() for d in detections}

    has_intruder = "intruder" in labels
    has_weapon = "weapon" in labels
    has_conflict = "conflict" in labels

    # Weighted base confidence from detections
    def _max_conf(label: str) -> float:
        confs = [d.confidence for d in detections if d.label.lower() == label]
        return max(confs) if confs else 0.0

    i_conf = _max_conf("intruder")
    w_conf = _max_conf("weapon")
    c_conf = _max_conf("conflict")

    # ── Combination rules ─────────────────────────────────────────────────────
    if has_intruder and has_weapon and has_conflict:
        risk = min(0.95 + 0.05 * max(i_conf, w_conf, c_conf), 1.0)
        severity = Severity.critical
        event_type = EventType.conflict

    elif has_weapon and has_conflict:
        risk = 0.80 + 0.15 * max(w_conf, c_conf)
        severity = Severity.high
        event_type = EventType.conflict

    elif has_intruder and has_weapon:
        risk = 0.75 + 0.20 * max(i_conf, w_conf)
        severity = Severity.high
        event_type = EventType.weapon

    elif has_intruder and has_conflict:
        risk = 0.70 + 0.20 * max(i_conf, c_conf)
        severity = Severity.high
        event_type = EventType.conflict

    elif has_weapon:
        risk = 0.50 + 0.35 * w_conf
        severity = Severity.medium
        event_type = EventType.weapon

    elif has_conflict:
        risk = 0.40 + 0.30 * c_conf
        severity = Severity.medium
        event_type = EventType.conflict

    elif has_intruder:
        risk = 0.20 + 0.35 * i_conf
        severity = Severity.low
        event_type = EventType.intruder

    else:
        risk = 0.05
        severity = Severity.low
        event_type = EventType.motion

    # Clamp
    risk = round(min(max(risk, 0.0), 1.0), 4)
    return risk, event_type, severity
