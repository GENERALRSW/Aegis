"""
AEGIS — JWT creation/verification, password hashing, RBAC helpers.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Password hashing ──────────────────────────────────────────────────────────
bearer_scheme = HTTPBearer()


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── Token helpers ─────────────────────────────────────────────────────────────

def _encode(payload: Dict[str, Any]) -> str:
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(subject: str, role: str, extra: Optional[Dict] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload: Dict[str, Any] = {
        "sub": subject,
        "role": role,
        "type": "access",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    if extra:
        payload.update(extra)
    return _encode(payload)


def create_phone_stream_token(camera_id: str, expires_days: int = 30) -> str:
    """Long-lived token scoped to one camera for phone streaming (no login required)."""
    expire = datetime.now(timezone.utc) + timedelta(days=expires_days)
    return _encode({
        "sub": camera_id,
        "type": "phone_stream",
        "camera_id": camera_id,
        "exp": expire,
    })


def verify_phone_stream_token(token: str, camera_id: str) -> bool:
    """Returns True if the token is valid and scoped to camera_id."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return (
            payload.get("type") == "phone_stream"
            and payload.get("camera_id") == camera_id
        )
    except JWTError:
        return False


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    return _encode({"sub": subject, "type": "refresh", "exp": expire})


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ── Dependency: current user ──────────────────────────────────────────────────

def get_current_user(
    cookie_token: Optional[str] = Cookie(default=None, alias="access_token"),
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(
        HTTPBearer(auto_error=False)
    ),
) -> Dict[str, Any]:
    """
    Resolve the caller's identity from either:
      1. The HttpOnly 'access_token' cookie (set by /login — preferred, JS-inaccessible)
      2. An Authorization: Bearer header (kept for WebSocket & phone-stream clients
         that cannot use cookies)
    Cookie takes priority when both are present.
    """
    raw = cookie_token or (bearer.credentials if bearer else None)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(raw)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload


def require_roles(*roles: str):
    """Factory — returns a FastAPI dependency that enforces role membership."""

    def _check(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of roles: {roles}",
            )
        return user

    return _check


# Convenience role guards
require_admin = require_roles("admin")
require_operator_or_above = require_roles("admin", "operator")
require_any_role = require_roles("admin", "operator", "viewer", "jdf_member")
require_jdf_or_admin = require_roles("admin", "jdf_member")
require_security_team = require_roles("admin", "operator", "jdf_member")
