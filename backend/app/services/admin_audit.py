"""
AEGIS — Admin Audit Service

Writes a structured log entry whenever a privileged admin action is performed.

This is a legal requirement under the Jamaica Data Protection Act 2020:
administrators who access, modify, or disable processing of sensitive/biometric
data must leave an auditable trail (who, what, when, from where).

Usage:
    await write_admin_audit(
        admin=user_dict,        # the Depends(require_admin) payload
        action="toggle_fr",     # short machine-readable action name
        detail={"enabled": True},  # any extra context
        request=request,        # FastAPI Request for IP capture
    )
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import Request

from app.core.logging import get_logger
from app.db.mongodb import admin_audit_col

logger = get_logger(__name__)


async def write_admin_audit(
    admin: Dict[str, Any],
    action: str,
    detail: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> None:
    """
    Persist one admin audit entry to the admin_audit collection.

    Fields stored:
      - log_id      : unique identifier for this entry
      - admin_id    : user_id of the admin who performed the action
      - admin_email : email for human-readable lookup
      - action      : machine-readable action name (e.g. "toggle_fr", "set_flag")
      - detail      : arbitrary dict with action-specific context
      - ip          : client IP address
      - timestamp   : UTC time of the action
    """
    entry = {
        "log_id": str(uuid.uuid4()),
        "admin_id": admin.get("sub", "unknown"),
        "admin_email": admin.get("email", "unknown"),
        "action": action,
        "detail": detail or {},
        "ip": (request.client.host if request and request.client else "unknown"),
        "timestamp": datetime.now(timezone.utc),
    }

    try:
        await admin_audit_col().insert_one(entry)
        logger.info(
            "Admin action logged",
            action=action,
            admin=entry["admin_email"],
            ip=entry["ip"],
        )
    except Exception as exc:
        # Log the failure but do not block the action — audit write errors
        # should be monitored and alerted on separately.
        logger.error("Failed to write admin audit entry", action=action, error=str(exc))
