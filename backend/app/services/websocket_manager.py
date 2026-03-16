"""
AEGIS — WebSocket connection manager for the live dashboard stream.
Maintains a registry of active connections and broadcasts events to them.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.services.broker import subscribe_local, unsubscribe_local

logger = get_logger(__name__)


_SECURITY_ROLES: Set[str] = {"admin", "jdf_member"}


class ConnectionManager:
    def __init__(self) -> None:
        self._active: Dict[str, WebSocket] = {}   # session_id → WebSocket
        self._filters: Dict[str, Dict] = {}        # session_id → filter config
        self._roles: Dict[str, str] = {}            # session_id → user role
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        session_id: str,
        filters: Optional[Dict] = None,
        role: str = "viewer",
    ) -> None:
        await websocket.accept()
        async with self._lock:
            self._active[session_id] = websocket
            self._filters[session_id] = filters or {}
            self._roles[session_id] = role
        logger.info("WebSocket client connected", session_id=session_id, role=role, total=len(self._active))

    async def disconnect(self, session_id: str) -> None:
        async with self._lock:
            self._active.pop(session_id, None)
            self._filters.pop(session_id, None)
            self._roles.pop(session_id, None)
        logger.info("WebSocket client disconnected", session_id=session_id, total=len(self._active))

    async def send_personal(self, session_id: str, message: Dict[str, Any]) -> None:
        ws = self._active.get(session_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                await self.disconnect(session_id)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast to all connected clients, respecting per-client filters."""
        dead: List[str] = []
        async with self._lock:
            sessions = list(self._active.items())

        for sid, ws in sessions:
            if not self._matches_filter(message, self._filters.get(sid, {})):
                continue
            try:
                await ws.send_text(json.dumps(message, default=str))
            except (WebSocketDisconnect, RuntimeError):
                dead.append(sid)
            except Exception as exc:
                logger.warning("WS broadcast error", session_id=sid, error=str(exc))
                dead.append(sid)

        for sid in dead:
            await self.disconnect(sid)

    def _matches_filter(self, message: Dict, filters: Dict) -> bool:
        """Optional per-client filtering by camera_id, severity, event_type."""
        if not filters:
            return True
        if "camera_id" in filters and message.get("camera_id") != filters["camera_id"]:
            return False
        if "severity" in filters and message.get("severity") != filters["severity"]:
            return False
        if "event_type" in filters and message.get("event_type") != filters["event_type"]:
            return False
        return True

    async def broadcast_security_alert(self, alert: Dict[str, Any]) -> None:
        """
        Broadcast a security alert ONLY to sessions whose role is in the
        security team (admin, jdf_member).  Never published to the external
        broker — local-network only.
        """
        dead: List[str] = []
        async with self._lock:
            sessions = list(self._active.items())
            roles = dict(self._roles)

        for sid, ws in sessions:
            if roles.get(sid) not in _SECURITY_ROLES:
                continue
            try:
                await ws.send_text(json.dumps({"type": "security_alert", **alert}, default=str))
            except (WebSocketDisconnect, RuntimeError):
                dead.append(sid)
            except Exception as exc:
                logger.warning("Security alert WS error", session_id=sid, error=str(exc))
                dead.append(sid)

        for sid in dead:
            await self.disconnect(sid)

    @property
    def connection_count(self) -> int:
        return len(self._active)


# Singleton
ws_manager = ConnectionManager()


async def broker_to_ws_relay(payload: Dict[str, Any]) -> None:
    """Called by local broker subscriber to forward events to WebSocket clients."""
    await ws_manager.broadcast(payload)
