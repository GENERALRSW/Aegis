"""
AEGIS — Shared enumerations used across models and schemas.
"""

from enum import Enum


class CameraType(str, Enum):
    phone = "phone"
    laptop = "laptop"
    usb = "usb"
    ip = "ip"
    cctv = "cctv"


class CameraStatus(str, Enum):
    active = "active"
    inactive = "inactive"
    error = "error"


class EventType(str, Enum):
    intruder = "intruder"
    weapon = "weapon"
    conflict = "conflict"
    motion = "motion"
    unknown = "unknown"


class Severity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class UserRole(str, Enum):
    admin = "admin"
    operator = "operator"
    viewer = "viewer"
    jdf_member = "jdf_member"


class PersonCategory(str, Enum):
    missing = "missing"
    criminal = "criminal"


class PersonStatus(str, Enum):
    active = "active"
    found = "found"
    inactive = "inactive"


class SecurityAlertType(str, Enum):
    restricted_person = "restricted_person"
    missing_person = "missing_person"
    criminal = "criminal"


class MatchType(str, Enum):
    face = "face"
    gait = "gait"
    combined = "combined"
