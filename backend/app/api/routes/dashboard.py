"""
AEGIS — Dashboard WebSocket stream + analytics REST endpoints.

WS  /api/dashboard/stream      → live event feed
GET /api/dashboard/stats        → aggregate stats
GET /api/dashboard/heatmap      → event density by camera
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.core.security import decode_token, require_any_role
from app.db.mongodb import cameras_col, events_col
from app.services.websocket_manager import ws_manager

logger = get_logger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ── WebSocket live stream ─────────────────────────────────────────────────────

@router.websocket("/stream")
async def dashboard_stream(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    camera_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
) -> None:
    """
    WebSocket endpoint for live event streaming.

    Authentication: Pass JWT as ?token=<access_token> query parameter.
    Filtering:      ?camera_id=cam01&severity=high

    Messages sent by server:
      { "type": "event"|"alert"|"ping", ...payload }

    Messages accepted from client:
      { "type": "ping" }  → server responds { "type": "pong" }
      { "type": "subscribe", "camera_id": "..." }  → update filter
    """
    # Authenticate via query token
    if not token:
        await websocket.close(code=1008, reason="Missing token")
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=1008, reason="Invalid token")
            return
    except Exception:
        await websocket.close(code=1008, reason="Invalid token")
        return

    session_id = str(uuid.uuid4())
    filters = {}
    if camera_id:
        filters["camera_id"] = camera_id
    if severity:
        filters["severity"] = severity

    user_role = payload.get("role", "viewer")
    await ws_manager.connect(websocket, session_id, filters, role=user_role)

    # Send welcome frame
    await ws_manager.send_personal(session_id, {
        "type": "connected",
        "session_id": session_id,
        "user": payload.get("sub"),
        "filters": filters,
        "message": "AEGIS live stream connected",
    })

    try:
        while True:
            try:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "ping":
                    await ws_manager.send_personal(session_id, {"type": "pong"})

                elif msg_type == "subscribe":
                    # Update filter for this session
                    new_filter = {k: v for k, v in msg.items() if k != "type"}
                    ws_manager._filters[session_id] = new_filter
                    await ws_manager.send_personal(session_id, {
                        "type": "subscribed",
                        "filters": new_filter,
                    })

            except json.JSONDecodeError:
                await ws_manager.send_personal(session_id, {
                    "type": "error",
                    "message": "Invalid JSON",
                })
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(session_id)


# ── Analytics REST endpoints ──────────────────────────────────────────────────

@router.get(
    "/stats",
    summary="Aggregate surveillance statistics",
)
async def get_stats(
    hours: int = Query(24, ge=1, le=168),
    _: Dict = Depends(require_any_role),
) -> Dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    col = events_col()

    pipeline = [
        {"$match": {"timestamp": {"$gte": since}}},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "avg_risk": {"$avg": "$risk_score"},
                "max_risk": {"$max": "$risk_score"},
                "by_severity": {
                    "$push": "$severity"
                },
                "by_type": {
                    "$push": "$event_type"
                },
            }
        },
    ]

    results = await col.aggregate(pipeline).to_list(1)
    if not results:
        return {
            "period_hours": hours,
            "total_events": 0,
            "avg_risk_score": 0,
            "max_risk_score": 0,
            "by_severity": {},
            "by_event_type": {},
            "active_cameras": 0,
            "connected_clients": ws_manager.connection_count,
        }

    r = results[0]

    def _count(lst: List[str]) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for item in lst:
            counts[item] = counts.get(item, 0) + 1
        return counts

    # Active cameras
    active_count = await cameras_col().count_documents({"status": "active"})

    return {
        "period_hours": hours,
        "total_events": r["total"],
        "avg_risk_score": round(r["avg_risk"], 4),
        "max_risk_score": round(r["max_risk"], 4),
        "by_severity": _count(r["by_severity"]),
        "by_event_type": _count(r["by_type"]),
        "active_cameras": active_count,
        "connected_clients": ws_manager.connection_count,
    }


@router.get(
    "/heatmap",
    summary="Event density per camera for heatmap visualization",
)
async def get_heatmap(
    hours: int = Query(24, ge=1, le=168),
    _: Dict = Depends(require_any_role),
) -> List[Dict[str, Any]]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    pipeline = [
        {"$match": {"timestamp": {"$gte": since}}},
        {
            "$group": {
                "_id": "$camera_id",
                "total_events": {"$sum": 1},
                "avg_risk": {"$avg": "$risk_score"},
                "high_risk_count": {
                    "$sum": {
                        "$cond": [
                            {"$in": ["$severity", ["high", "critical"]]},
                            1,
                            0,
                        ]
                    }
                },
                "last_event": {"$max": "$timestamp"},
            }
        },
        {"$sort": {"total_events": -1}},
    ]

    results = await events_col().aggregate(pipeline).to_list(100)

    # Enrich with camera location
    enriched = []
    for r in results:
        cam = await cameras_col().find_one({"camera_id": r["_id"]})
        enriched.append({
            "camera_id": r["_id"],
            "total_events": r["total_events"],
            "avg_risk_score": round(r["avg_risk"], 4),
            "high_risk_count": r["high_risk_count"],
            "last_event": r["last_event"],
            "location": cam.get("location") if cam else None,
            "latitude": cam.get("latitude") if cam else None,
            "longitude": cam.get("longitude") if cam else None,
        })

    return enriched


@router.get(
    "/timeline",
    summary="Event timeline bucketed by hour",
)
async def get_timeline(
    hours: int = Query(24, ge=1, le=168),
    camera_id: Optional[str] = Query(None),
    _: Dict = Depends(require_any_role),
) -> List[Dict[str, Any]]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    match: Dict = {"timestamp": {"$gte": since}}
    if camera_id:
        match["camera_id"] = camera_id

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": {
                    "year": {"$year": "$timestamp"},
                    "month": {"$month": "$timestamp"},
                    "day": {"$dayOfMonth": "$timestamp"},
                    "hour": {"$hour": "$timestamp"},
                },
                "count": {"$sum": 1},
                "avg_risk": {"$avg": "$risk_score"},
            }
        },
        {"$sort": {"_id": 1}},
    ]

    results = await events_col().aggregate(pipeline).to_list(200)
    return [
        {
            "bucket": f"{r['_id']['year']}-{r['_id']['month']:02d}-{r['_id']['day']:02d}T{r['_id']['hour']:02d}:00",
            "count": r["count"],
            "avg_risk": round(r["avg_risk"], 4),
        }
        for r in results
    ]
