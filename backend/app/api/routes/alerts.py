"""
AEGIS — Alert management endpoints.
POST /api/alerts/send
GET  /api/alerts
GET  /api/alerts/{alert_id}
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import require_any_role, require_operator_or_above
from app.db.mongodb import alerts_col
from app.schemas.schemas import AlertResponse, AlertSendRequest
from app.services.broker import publish_alert
from app.services.fcm_service import send_push_notification
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.post(
    "/send",
    response_model=AlertResponse,
    status_code=201,
    summary="Send a push notification alert",
)
async def send_alert(
    body: AlertSendRequest,
    user: Dict = Depends(require_operator_or_above),
) -> AlertResponse:
    success, failure = await send_push_notification(
        title=body.title,
        body=body.body,
        tokens=body.target_tokens,
        topic=body.topic,
        data=body.data,
    )

    alert_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    doc: Dict[str, Any] = {
        "alert_id": alert_id,
        "event_id": body.event_id,
        "title": body.title,
        "body": body.body,
        "target_tokens": body.target_tokens,
        "topic": body.topic,
        "data": body.data,
        "sent_at": now,
        "success_count": success,
        "failure_count": failure,
        "sent_by": user.get("sub"),
    }
    await alerts_col().insert_one(doc)

    # Publish to broker
    await publish_alert({
        "alert_id": alert_id,
        "event_id": body.event_id,
        "title": body.title,
        "body": body.body,
        "sent_at": str(now),
    })

    # Also push to dashboard WebSocket
    await ws_manager.broadcast({
        "type": "alert",
        "alert_id": alert_id,
        "event_id": body.event_id,
        "title": body.title,
        "body": body.body,
        "sent_at": str(now),
    })

    doc.pop("_id", None)
    return AlertResponse(**doc)


@router.get(
    "",
    response_model=List[AlertResponse],
    summary="List alerts",
)
async def list_alerts(
    event_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    _: Dict = Depends(require_any_role),
) -> List[AlertResponse]:
    query: Dict = {}
    if event_id:
        query["event_id"] = event_id

    cursor = alerts_col().find(query).sort("sent_at", -1).skip(skip).limit(limit)
    results = []
    async for doc in cursor:
        doc["alert_id"] = str(doc.get("alert_id", doc.get("_id", "")))
        doc.pop("_id", None)
        results.append(AlertResponse(**doc))
    return results


@router.get(
    "/{alert_id}",
    response_model=AlertResponse,
    summary="Get alert by ID",
)
async def get_alert(
    alert_id: str,
    _: Dict = Depends(require_any_role),
) -> AlertResponse:
    doc = await alerts_col().find_one({"alert_id": alert_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Alert not found")
    doc["alert_id"] = str(doc.get("alert_id", doc.get("_id", "")))
    doc.pop("_id", None)
    return AlertResponse(**doc)
