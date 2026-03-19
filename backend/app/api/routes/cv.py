"""
AEGIS — Computer Vision detection endpoint.

POST /api/cv/detect
  Accepts:
    - multipart/form-data: frame (image file) + camera_id + source_type
    - application/json: { camera_id, source_type, frame_b64 (base64 encoded image) }

  Runs YOLOv8 + MediaPipe inference → risk scoring → LLM summary → event persisted
  Returns CVDetectResponse with detections, severity, risk score, and summary.

POST /api/cv/query (natural language query via LLM)
GET  /api/cv/status (engine health)
"""

from __future__ import annotations

import base64
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.core.security import (
    create_phone_stream_token,
    require_any_role,
    require_operator_or_above,
    verify_phone_stream_token,
)
from app.cv.engine import cv_engine
from app.cv.risk_scorer import compute_risk
from app.db.mongodb import events_col
from app.models.enums import EventType, Severity
from app.schemas.schemas import CVDetectResponse, Detection, SecurityAlertSummary
from app.services.broker import publish_detection
from app.services.llm_service import answer_natural_language_query, generate_incident_summary
from app.services.security_service import check_frame_for_security_threats
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/api/cv", tags=["computer-vision"])


# ── JSON body variant ─────────────────────────────────────────────────────────

class DetectJSONRequest(BaseModel):
    camera_id: str
    source_type: str = "unknown"   # phone | laptop | usb | ip
    frame_b64: str                 # base64-encoded image bytes
    location: Optional[str] = Field(
        default=None,
        max_length=200,
        pattern=r"^[a-zA-Z0-9 ,.\-_()/]+$",
        description="Plain-text location label. No HTML or special characters.",
    )


class NLQueryRequest(BaseModel):
    question: str


# ── Shared processing logic ───────────────────────────────────────────────────

async def _process_frame(
    camera_id: str,
    source_type: str,
    image_bytes: bytes,
    location: Optional[str] = None,
    user_id: Optional[str] = None,
) -> CVDetectResponse:
    t0 = time.perf_counter()

    # Run CV inference
    detections, infer_ms = await cv_engine.infer(image_bytes, camera_id=camera_id)

    # Risk scoring
    risk_score, event_type, severity = compute_risk(detections)

    # LLM summary
    summary = await generate_incident_summary(
        camera_id=camera_id,
        event_type=event_type,
        severity=severity,
        risk_score=risk_score,
        detections=detections,
        location=location,
    )

    # Persist event only if something was detected
    event_id: Optional[str] = None
    if detections:
        event_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        doc: Dict[str, Any] = {
            "event_id": event_id,
            "camera_id": camera_id,
            "source_type": source_type,
            "event_type": event_type.value,
            "severity": severity.value,
            "risk_score": risk_score,
            "detections": [d.model_dump() for d in detections],
            "summary": summary,
            "timestamp": now,
            "ingested_by": user_id,
        }
        await events_col().insert_one(doc)

        # Publish + broadcast
        broker_payload = {
            "event_id": event_id,
            "camera_id": camera_id,
            "event_type": event_type.value,
            "severity": severity.value,
            "risk_score": risk_score,
            "summary": summary,
            "timestamp": str(now),
        }
        await publish_detection(broker_payload)
        await ws_manager.broadcast({"type": "detection", **broker_payload})

    # Security face/gait screening — always runs, results included in response
    raw_alerts: list = []
    try:
        raw_alerts = await check_frame_for_security_threats(
            frame_bytes=image_bytes,
            camera_id=camera_id,
            location=location,
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Security screening error: %s", exc)

    alert_summaries = [
        SecurityAlertSummary(
            alert_type=a.get("alert_type", "unknown"),
            person_name=a.get("person_name", "Unknown"),
            confidence=round(float(a.get("confidence", 0.0)), 3),
            match_type=a.get("match_type", "face"),
            category=a.get("category"),
            reason=a.get("reason"),
        )
        for a in raw_alerts
    ]

    # Persist security alerts alongside the event if any person was identified
    if alert_summaries and event_id:
        await events_col().update_one(
            {"event_id": event_id},
            {"$set": {"security_alerts": [a.model_dump() for a in alert_summaries]}},
        )

    total_ms = (time.perf_counter() - t0) * 1000

    return CVDetectResponse(
        camera_id=camera_id,
        detections=detections,
        event_id=event_id,
        severity=severity if (detections or alert_summaries) else None,
        risk_score=risk_score,
        summary=summary if (detections or alert_summaries) else None,
        processing_time_ms=round(total_ms, 2),
        security_alerts=alert_summaries,
    )


# ── Multipart endpoint (phone / webcam / OpenCV) ──────────────────────────────

@router.post(
    "/detect",
    response_model=CVDetectResponse,
    summary="Submit a video frame for CV inference",
)
async def detect_multipart(
    frame: UploadFile = File(..., description="Raw image frame (JPEG/PNG/WebP)"),
    camera_id: str = Form(...),
    source_type: str = Form("unknown"),
    location: Optional[str] = Form(None),
    user: Dict = Depends(require_operator_or_above),
) -> CVDetectResponse:
    import re
    if location and (len(location) > 200 or not re.match(r"^[a-zA-Z0-9 ,.\-_()/]+$", location)):
        raise HTTPException(status_code=422, detail="Invalid location value")
    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image/* content types are accepted",
        )
    image_bytes = await frame.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10 MB guard
        raise HTTPException(status_code=413, detail="Frame too large (max 10 MB)")

    return await _process_frame(
        camera_id=camera_id,
        source_type=source_type,
        image_bytes=image_bytes,
        location=location,
        user_id=user.get("sub"),
    )


@router.post(
    "/detect/json",
    response_model=CVDetectResponse,
    summary="Submit a base64-encoded frame for CV inference (JSON body)",
)
async def detect_json(
    body: DetectJSONRequest,
    user: Dict = Depends(require_operator_or_above),
) -> CVDetectResponse:
    try:
        image_bytes = base64.b64decode(body.frame_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    return await _process_frame(
        camera_id=body.camera_id,
        source_type=body.source_type,
        image_bytes=image_bytes,
        location=body.location,
        user_id=user.get("sub"),
    )


# ── Natural language query ────────────────────────────────────────────────────

@router.post(
    "/query",
    summary="Natural language query about surveillance data (LLM-powered)",
)
async def nl_query(
    body: NLQueryRequest,
    _: Dict = Depends(require_any_role),
) -> Dict[str, str]:
    answer = await answer_natural_language_query(body.question)
    return {"question": body.question, "answer": answer}


# ── Phone camera — no-login streaming ────────────────────────────────────────

_PHONE_PAGE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AEGIS Camera — {camera_id}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }}
    video {{ position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; }}
    canvas {{ display: none; }}

    /* ── HUD top bar ── */
    #hud {{
      position: fixed; top: 0; left: 0; right: 0; z-index: 10;
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 16px;
      background: linear-gradient(to bottom, rgba(0,0,0,.6), transparent);
      color: #fff;
    }}
    #cam-label {{ font-size: 12px; opacity: .75; letter-spacing: .05em; text-transform: uppercase; }}
    #status-pill {{
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600;
      background: rgba(0,0,0,.5); border-radius: 20px; padding: 5px 12px;
    }}
    .dot {{ width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }}
    .green  {{ background: #22c55e; animation: pulse 1.8s ease-in-out infinite; }}
    .yellow {{ background: #f59e0b; }}
    .red    {{ background: #ef4444; }}
    @keyframes pulse {{ 0%,100%{{opacity:1}} 50%{{opacity:.35}} }}

    /* ── Detection bottom bar ── */
    #det-bar {{
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
      padding: 16px 20px 32px;
      background: linear-gradient(to top, rgba(0,0,0,.7), transparent);
      text-align: center;
    }}
    #det-label {{
      font-size: 18px; font-weight: 800; letter-spacing: .08em;
      text-shadow: 0 1px 6px rgba(0,0,0,.8);
    }}
    #det-conf {{ font-size: 13px; margin-top: 4px; opacity: .85; }}

    .sev-none     {{ color: rgba(255,255,255,.4); }}
    .sev-low      {{ color: #4ade80; }}
    .sev-medium   {{ color: #fbbf24; }}
    .sev-high     {{ color: #fb923c; }}
    .sev-critical {{ color: #f87171; }}

    /* ── Security alert banner ── */
    #security-banner {{
      position: fixed; top: 60px; left: 12px; right: 12px; z-index: 20;
      background: rgba(239,68,68,.92); border-radius: 12px;
      padding: 12px 16px; display: none; flex-direction: column; gap: 4px;
      box-shadow: 0 4px 20px rgba(0,0,0,.5);
      animation: flashBg 1s ease-in-out infinite alternate;
    }}
    #security-banner .sb-title {{
      font-size: 13px; font-weight: 800; letter-spacing: .1em;
      text-transform: uppercase; color: #fff;
    }}
    #security-banner .sb-name {{
      font-size: 18px; font-weight: 700; color: #fff;
    }}
    #security-banner .sb-meta {{
      font-size: 12px; color: rgba(255,255,255,.8);
    }}
    @keyframes flashBg {{ from{{opacity:1}} to{{opacity:.7}} }}

    /* ── HTTPS warning ── */
    #https-warn {{
      position: fixed; inset: 0; z-index: 99;
      background: #111; color: #fff;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 32px; text-align: center; gap: 16px;
    }}
    #https-warn h2 {{ font-size: 20px; color: #f87171; }}
    #https-warn p  {{ font-size: 14px; line-height: 1.6; opacity: .8; }}
    #https-warn code {{ background: #333; padding: 2px 6px; border-radius: 4px; font-size: 13px; }}
  </style>
</head>
<body>
  <!-- Camera feed -->
  <video id="vid" autoplay playsinline muted></video>
  <canvas id="cnv"></canvas>

  <!-- HUD -->
  <div id="hud">
    <span id="cam-label">&#9679; {camera_id}</span>
    <div id="status-pill">
      <span class="dot yellow" id="dot"></span>
      <span id="status-txt">Starting…</span>
    </div>
  </div>

  <!-- Security alert banner (missing/restricted person) -->
  <div id="security-banner">
    <span class="sb-title" id="sb-type">&#9888; MISSING PERSON DETECTED</span>
    <span class="sb-name" id="sb-name"></span>
    <span class="sb-meta" id="sb-meta"></span>
  </div>

  <!-- Detection overlay -->
  <div id="det-bar">
    <div id="det-label" class="sev-none">AWAITING FRAME</div>
    <div id="det-conf"></div>
  </div>

  <!-- HTTPS warning (hidden on HTTPS) -->
  <div id="https-warn" style="display:none">
    <h2>&#128274; Camera Blocked</h2>
    <p>Your browser requires a secure (HTTPS) connection to access the camera.<br>
       Ask your administrator to serve AEGIS over HTTPS, or use a tool like
       <code>ngrok</code> to create a secure tunnel.</p>
  </div>

  <script>
    const CAMERA_ID  = "{camera_id}";
    const TOKEN      = "{token}";
    const FPS        = {fps};
    const STREAM_URL = window.location.origin + "/api/cv/phone/" + CAMERA_ID + "/stream";

    const video      = document.getElementById("vid");
    const canvas     = document.getElementById("cnv");
    const dot        = document.getElementById("dot");
    const stTxt      = document.getElementById("status-txt");
    const detLabel   = document.getElementById("det-label");
    const detConf    = document.getElementById("det-conf");
    const httpsW     = document.getElementById("https-warn");
    const secBanner  = document.getElementById("security-banner");
    const sbType     = document.getElementById("sb-type");
    const sbName     = document.getElementById("sb-name");
    const sbMeta     = document.getElementById("sb-meta");
    let secBannerTimer = null;

    let framesPending = 0;

    // getUserMedia requires HTTPS (or localhost)
    const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!secure) {{
      httpsW.style.display = "flex";
    }} else {{
      startCamera();
    }}

    function setStatus(state, text) {{
      dot.className = "dot " + state;
      stTxt.textContent = text;
    }}

    function startCamera() {{
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {{
        setStatus("red", "Not supported");
        return;
      }}
      navigator.mediaDevices.getUserMedia({{
        video: {{
          facingMode: {{ ideal: "environment" }},
          width:  {{ ideal: 1280 }},
          height: {{ ideal: 720 }}
        }},
        audio: false
      }}).then(stream => {{
        video.srcObject = stream;
        video.onloadedmetadata = () => {{
          canvas.width  = video.videoWidth  || 1280;
          canvas.height = video.videoHeight || 720;
          setStatus("green", "Live");
          setInterval(sendFrame, Math.round(1000 / FPS));
        }};
      }}).catch(err => {{
        setStatus("red", "Camera error");
        detLabel.textContent = err.message;
        detLabel.className = "sev-critical";
        console.error("Camera:", err);
      }});
    }}

    async function sendFrame() {{
      if (framesPending > 0) return;   // drop frame if previous still in flight
      framesPending++;

      try {{
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

        const res = await fetch(STREAM_URL, {{
          method:  "POST",
          headers: {{ "Content-Type": "application/json" }},
          body:    JSON.stringify({{ frame_b64: b64, token: TOKEN }})
        }});

        if (res.ok) {{
          const data = await res.json();
          renderDetections(data);
          setStatus("green", "Live");
        }} else {{
          setStatus("yellow", "HTTP " + res.status);
        }}
      }} catch (e) {{
        setStatus("yellow", "Reconnecting…");
        console.warn("Stream error:", e);
      }} finally {{
        framesPending--;
      }}
    }}

    function renderDetections(data) {{
      // ── Security alerts (missing/restricted persons) ──
      const alerts = data.security_alerts || [];
      if (alerts.length > 0) {{
        const a = alerts[0];
        const typeLabel = a.alert_type === "restricted_person"
          ? "⚠ RESTRICTED PERSON" : "⚠ MISSING PERSON DETECTED";
        sbType.textContent = typeLabel;
        sbName.textContent = a.person_name;
        const pct = Math.round(a.confidence * 100);
        sbMeta.textContent = a.match_type.toUpperCase() + " MATCH  ·  " + pct + "% confidence"
          + (a.category ? "  ·  " + a.category.toUpperCase() : "");
        secBanner.style.display = "flex";
        if (secBannerTimer) clearTimeout(secBannerTimer);
        secBannerTimer = setTimeout(() => {{ secBanner.style.display = "none"; }}, 8000);
      }}

      // ── CV detections (persons, weapons, conflict) ──
      if (!data.detections || !data.detections.length) {{
        detLabel.className = "sev-none";
        detLabel.textContent = alerts.length ? "" : "CLEAR";
        detConf.textContent = "";
        return;
      }}

      const labels   = [...new Set(data.detections.map(d => d.label))];
      const severity = data.severity || "low";
      const maxConf  = Math.max(...data.detections.map(d => d.confidence));
      const pct      = Math.round(maxConf * 100) + "%";

      detLabel.className = "sev-" + severity;
      detLabel.textContent = labels.join(" + ").toUpperCase();
      detConf.textContent  = severity.toUpperCase() + "  ·  " + pct + " confidence";
    }}
  </script>
</body>
</html>
"""


class PhoneStreamRequest(BaseModel):
    frame_b64: str
    token: str


@router.get(
    "/phone/{camera_id}/link",
    summary="Generate a phone camera streaming link (no login required to use)",
)
async def get_phone_link(
    camera_id: str,
    fps: int = Query(2, ge=1, le=10, description="Frames per second the phone will capture"),
    expires_days: int = Query(30, ge=1, le=365),
    user: Dict = Depends(require_operator_or_above),
) -> Dict:
    """
    Returns a URL you can share (or show as a QR code) to any phone.
    Opening the link starts streaming the phone's camera immediately —
    no login, no app install required.
    """
    from app.core.config import settings as _cfg
    token = create_phone_stream_token(camera_id, expires_days=expires_days)
    # Build the page URL relative to the server's own origin
    page_url = f"/api/cv/phone/{camera_id}?token={token}&fps={fps}"
    return {
        "camera_id": camera_id,
        "stream_page_url": page_url,
        "token": token,
        "expires_days": expires_days,
        "fps": fps,
        "instructions": "Open stream_page_url on a phone browser. Camera starts immediately.",
    }


@router.get(
    "/phone/{camera_id}",
    response_class=HTMLResponse,
    include_in_schema=False,  # hide from docs — this is the end-user page
)
async def phone_camera_page(
    camera_id: str,
    token: str = Query(...),
    fps: int = Query(2, ge=1, le=10),
) -> HTMLResponse:
    """Self-contained HTML camera page. No login required — token is validated per-frame."""
    if not verify_phone_stream_token(token, camera_id):
        return HTMLResponse("<h2>Invalid or expired link. Ask an operator to generate a new one.</h2>", status_code=401)

    stream_url = f"/api/cv/phone/{camera_id}/stream"
    html = _PHONE_PAGE.format(
        camera_id=camera_id,
        token=token,
        stream_url=stream_url,
        fps=fps,
    )
    return HTMLResponse(html)


@router.post(
    "/phone/{camera_id}/stream",
    response_model=CVDetectResponse,
    summary="Receive a frame from a phone camera (token auth, no login cookie needed)",
)
async def phone_stream_frame(
    camera_id: str,
    body: PhoneStreamRequest,
) -> CVDetectResponse:
    """
    Accepts frames posted by the phone camera page.
    Authentication is a phone-stream JWT embedded in the page URL — no user login needed.
    """
    if not verify_phone_stream_token(body.token, camera_id):
        raise HTTPException(status_code=401, detail="Invalid or expired stream token")

    try:
        image_bytes = base64.b64decode(body.frame_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    return await _process_frame(
        camera_id=camera_id,
        source_type="phone",
        image_bytes=image_bytes,
    )


# ── Engine status ─────────────────────────────────────────────────────────────

@router.get(
    "/status",
    summary="CV engine health and loaded models",
)
async def cv_status(_: Dict = Depends(require_any_role)) -> Dict[str, Any]:
    return {
        "ready": cv_engine._ready,
        "models": cv_engine.status,
        "device": __import__("app.core.config", fromlist=["settings"]).settings.device,
        "active_cameras": cv_engine.active_cameras,
        "camera_count": len(cv_engine.active_cameras),
    }
