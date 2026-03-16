"""
AEGIS — Unit tests for CV risk scorer (no model loading required).
"""

import pytest

from app.cv.risk_scorer import compute_risk
from app.models.enums import EventType, Severity
from app.schemas.schemas import Detection


def det(label: str, confidence: float = 0.9) -> Detection:
    return Detection(label=label, confidence=confidence)


class TestRiskScorer:
    def test_no_detections(self):
        risk, etype, severity = compute_risk([])
        assert severity == Severity.low
        assert etype == EventType.motion
        assert risk < 0.2

    def test_intruder_only(self):
        risk, etype, severity = compute_risk([det("intruder", 0.9)])
        assert severity == Severity.low
        assert etype == EventType.intruder
        assert 0.2 <= risk <= 0.6

    def test_weapon_only(self):
        risk, etype, severity = compute_risk([det("weapon", 0.9)])
        assert severity == Severity.medium
        assert etype == EventType.weapon
        assert risk > 0.5

    def test_conflict_only(self):
        risk, etype, severity = compute_risk([det("conflict", 0.9)])
        assert severity == Severity.medium
        assert etype == EventType.conflict

    def test_weapon_plus_conflict(self):
        risk, etype, severity = compute_risk([det("weapon", 0.85), det("conflict", 0.75)])
        assert severity == Severity.high
        assert risk > 0.75

    def test_all_three_is_critical(self):
        risk, etype, severity = compute_risk([
            det("intruder", 0.9),
            det("weapon", 0.88),
            det("conflict", 0.82),
        ])
        assert severity == Severity.critical
        assert risk >= 0.9

    def test_risk_clamped_to_one(self):
        risk, _, _ = compute_risk([
            det("intruder", 1.0),
            det("weapon", 1.0),
            det("conflict", 1.0),
        ])
        assert risk <= 1.0

    def test_intruder_weapon_high(self):
        risk, etype, severity = compute_risk([det("intruder"), det("weapon")])
        assert severity == Severity.high
        assert risk >= 0.75
