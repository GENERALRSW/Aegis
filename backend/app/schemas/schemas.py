"""
AEGIS — Pydantic v2 schemas for Cameras, Events, Users, Alerts, CV.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import (
    CameraStatus,
    CameraType,
    EventType,
    MatchType,
    PersonCategory,
    PersonStatus,
    SecurityAlertType,
    Severity,
    UserRole,
)


# ─── Shared ───────────────────────────────────────────────────────────────────

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    width: float
    height: float


class Detection(BaseModel):
    label: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    bounding_box: Optional[BoundingBox] = None
    track_id: Optional[int] = None


# ─── Camera ───────────────────────────────────────────────────────────────────

class CameraRegisterRequest(BaseModel):
    camera_id: str = Field(..., min_length=3, max_length=64)
    name: str = Field(..., max_length=128)
    camera_type: CameraType
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class CameraResponse(BaseModel):
    camera_id: str
    name: str
    camera_type: CameraType
    location: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    status: CameraStatus
    registered_at: datetime
    metadata: Optional[Dict[str, Any]]


class CameraUpdateRequest(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[CameraStatus] = None
    metadata: Optional[Dict[str, Any]] = None


# ─── Events ───────────────────────────────────────────────────────────────────

class EventIngestRequest(BaseModel):
    camera_id: str
    event_type: EventType
    detections: List[Detection]
    frame_timestamp: Optional[datetime] = None
    raw_metadata: Optional[Dict[str, Any]] = None


class EventResponse(BaseModel):
    event_id: str
    camera_id: str
    event_type: EventType
    severity: Severity
    detections: List[Detection]
    risk_score: float
    summary: Optional[str] = None
    timestamp: datetime
    raw_metadata: Optional[Dict[str, Any]] = None


class EventQueryParams(BaseModel):
    camera_id: Optional[str] = None
    event_type: Optional[EventType] = None
    severity: Optional[Severity] = None
    from_ts: Optional[datetime] = None
    to_ts: Optional[datetime] = None
    limit: int = Field(50, ge=1, le=500)
    skip: int = Field(0, ge=0)


# ─── Users ────────────────────────────────────────────────────────────────────

class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(..., min_length=12)
    role: UserRole = UserRole.viewer
    full_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        """
        Enforce a minimum password policy:
        - 12+ characters (NIST recommends length over complexity, but both is better)
        - At least one uppercase letter
        - At least one lowercase letter
        - At least one digit
        - At least one special character

        This runs at the schema layer so it applies to every registration path.
        """
        errors = []
        if not any(c.isupper() for c in v):
            errors.append("one uppercase letter")
        if not any(c.islower() for c in v):
            errors.append("one lowercase letter")
        if not any(c.isdigit() for c in v):
            errors.append("one digit")
        if not any(c in r"!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in v):
            errors.append("one special character (!@#$%^&* etc.)")
        if errors:
            raise ValueError(f"Password must contain at least: {', '.join(errors)}")
        return v


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    user_id: str
    username: str
    email: str
    role: UserRole
    full_name: Optional[str]
    created_at: datetime
    is_active: bool


# ─── Alerts ───────────────────────────────────────────────────────────────────

class AlertSendRequest(BaseModel):
    event_id: str
    title: str
    body: str
    target_tokens: Optional[List[str]] = None   # specific FCM tokens; None = broadcast
    topic: Optional[str] = None                 # FCM topic (e.g. "high_alerts")
    data: Optional[Dict[str, str]] = None


class AlertResponse(BaseModel):
    alert_id: str
    event_id: str
    title: str
    body: str
    sent_at: datetime
    success_count: int
    failure_count: int


# ─── CV Detect ────────────────────────────────────────────────────────────────

class SecurityAlertSummary(BaseModel):
    """Compact security alert embedded in every CVDetectResponse."""
    alert_type: str           # "missing_person" | "restricted_person"
    person_name: str
    confidence: float
    match_type: str           # "face" | "gait"
    category: Optional[str] = None   # "missing" | "criminal"
    reason: Optional[str] = None     # for restricted persons


class CVDetectResponse(BaseModel):
    camera_id: str
    detections: List[Detection]
    event_id: Optional[str]
    severity: Optional[Severity]
    risk_score: float
    summary: Optional[str]
    processing_time_ms: float
    security_alerts: List[SecurityAlertSummary] = []


# ─── Security — Restricted Persons ───────────────────────────────────────────

class RestrictedPersonRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    reason: str = Field(..., min_length=1, max_length=512)
    face_image_b64: str = Field(..., description="Base64-encoded enrollment image")
    metadata: Optional[Dict[str, Any]] = None


class RestrictedPersonResponse(BaseModel):
    person_id: str
    name: str
    reason: str
    registered_by: str
    registered_at: datetime
    active: bool
    has_face_encoding: bool
    metadata: Optional[Dict[str, Any]]


# ─── Security — Missing / Criminal Persons ────────────────────────────────────

class MissingPersonRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(..., max_length=1024)
    category: PersonCategory
    face_image_b64: Optional[str] = Field(None, description="Base64-encoded face image")
    missing_since: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class MissingPersonResponse(BaseModel):
    person_id: str
    name: str
    description: str
    category: PersonCategory
    status: PersonStatus
    missing_since: Optional[datetime]
    registered_by: str
    registered_at: datetime
    has_face_encoding: bool
    has_gait_signature: bool
    metadata: Optional[Dict[str, Any]]


class GaitEnrollRequest(BaseModel):
    """Submit a frame so the system can extract and store a gait signature."""
    person_id: str
    frame_b64: str = Field(..., description="Base64-encoded image with full body visible")


# ─── Security — Detection Alerts ─────────────────────────────────────────────

class SecurityDetectionAlert(BaseModel):
    alert_id: str
    alert_type: SecurityAlertType
    person_id: str
    person_name: str
    camera_id: str
    confidence: float
    match_type: MatchType
    detected_at: str          # ISO datetime string
    location: Optional[str]
    reason: Optional[str]     # for restricted persons
    category: Optional[str]   # for missing persons


# ─── Security — Audit Log ────────────────────────────────────────────────────

class SecurityAuditEntry(BaseModel):
    log_id: str
    event_type: str
    person_id: str
    person_name: str
    camera_id: str
    confidence: float
    match_type: str
    location: Optional[str]
    detected_at: datetime
    acknowledged: bool


# ─── Facial Recognition Status ───────────────────────────────────────────────

class FRStatusResponse(BaseModel):
    enabled: bool
    region_allowed: bool
    system_region: str
    allowed_regions: List[str]
    deepface_available: bool
    model: str
    admin_override_permitted: bool


# ─── Health ───────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    db: str
    broker: str
    cv_engine: str
