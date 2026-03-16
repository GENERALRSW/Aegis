"""
AEGIS — Event ingestion + query endpoints.
POST /api/events/ingest
GET  /api/events
GET  /api/events/{event_id}
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import require_any_role, require_operator_or_above
from app.cv.risk_scorer import compute_risk
from app.db.mongodb import events_col
from app.models.enums import EventType, Severity
from app.schemas.schemas import EventIngestRequest, EventResponse
from app.services.broker import publish_detection
from app.services.llm_service import generate_incident_summary
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/api/events", tags=["events"])


def _to_response(doc: Dict) -> EventResponse:
    doc["event_id"] = str(doc.get("event_id", doc.get("_id", "")))
    doc.pop("_id", None)
    return EventResponse(**doc)


@router.post(
    "/ingest",
    response_model=EventResponse,
    status_code=201,
    summary="Ingest a detection event from a CV client",
)
async def ingest_event(
    body: EventIngestRequest,
    user: Dict = Depends(require_operator_or_above),
) -> EventResponse:
    # Compute risk
    risk_score, event_type, severity = compute_risk(body.detections)

    # LLM summary
    summary = await generate_incident_summary(
        camera_id=body.camera_id,
        event_type=event_type,
        severity=severity,
        risk_score=risk_score,
        detections=body.detections,
    )

    event_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    doc: Dict[str, Any] = {
        "event_id": event_id,
        "camera_id": body.camera_id,
        "event_type": event_type.value,
        "severity": severity.value,
        "risk_score": risk_score,
        "detections": [d.model_dump() for d in body.detections],
        "summary": summary,
        "timestamp": body.frame_timestamp or now,
        "ingested_at": now,
        "raw_metadata": body.raw_metadata,
        "ingested_by": user.get("sub"),
    }

    await events_col().insert_one(doc)
    doc.pop("_id", None)

    # Publish to broker + WebSocket
    broker_payload = {
        "event_id": event_id,
        "camera_id": body.camera_id,
        "event_type": event_type.value,
        "severity": severity.value,
        "risk_score": risk_score,
        "summary": summary,
        "timestamp": str(doc["timestamp"]),
    }
    await publish_detection(broker_payload)
    await ws_manager.broadcast({"type": "event", **broker_payload})

    return EventResponse(**doc)


@router.get(
    "",
    response_model=List[EventResponse],
    summary="Query events with optional filters",
)
async def query_events(
    camera_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    from_ts: Optional[datetime] = Query(None),
    to_ts: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    _: Dict = Depends(require_any_role),
) -> List[EventResponse]:
    query: Dict = {}
    if camera_id:
        query["camera_id"] = camera_id
    if event_type:
        query["event_type"] = event_type
    if severity:
        query["severity"] = severity
    if from_ts or to_ts:
        ts_filter: Dict = {}
        if from_ts:
            ts_filter["$gte"] = from_ts
        if to_ts:
            ts_filter["$lte"] = to_ts
        query["timestamp"] = ts_filter

    cursor = events_col().find(query).sort("timestamp", -1).skip(skip).limit(limit)
    events = []
    async for doc in cursor:
        events.append(_to_response(doc))
    return events


@router.get(
    "/{event_id}",
    response_model=EventResponse,
    summary="Get a single event by ID",
)
async def get_event(
    event_id: str,
    _: Dict = Depends(require_any_role),
) -> EventResponse:
    doc = await events_col().find_one({"event_id": event_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    return _to_response(doc)
