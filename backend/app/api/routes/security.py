"""
AEGIS — Security API: restricted persons, missing/criminal persons,
        gait enrolment, audit log, facial-recognition policy, and feature flags.

POST   /api/security/restricted               Add restricted person
GET    /api/security/restricted               List restricted persons
DELETE /api/security/restricted/{person_id}  Remove restricted person

POST   /api/security/missing                  Register missing/criminal profile
GET    /api/security/missing                  List missing persons
PUT    /api/security/missing/{person_id}/found  Mark as found

POST   /api/security/gait/enroll             Enroll gait signature for a person

GET    /api/security/audit                   Audit log (admin only)
PUT    /api/security/audit/{log_id}/acknowledge  Acknowledge an audit entry

GET    /api/security/fr/status               Facial recognition policy status
PUT    /api/security/fr/toggle               Toggle FR engine (admin only)

GET    /api/security/features                List all feature flags and their state
PUT    /api/security/features/{flag}         Set a feature flag (admin only)
DELETE /api/security/features/{flag}         Reset flag to config default (admin only)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import require_admin, require_any_role, require_jdf_or_admin
from app.cv.face_engine import face_engine
from app.cv.gait_analyzer import gait_analyzer
from app.db.mongodb import (
    missing_persons_col,
    restricted_persons_col,
    security_audit_col,
    system_settings_col,
)
from app.models.enums import PersonCategory
from app.schemas.schemas import (
    FRStatusResponse,
    GaitEnrollRequest,
    MissingPersonRequest,
    MissingPersonResponse,
    RestrictedPersonRequest,
    RestrictedPersonResponse,
    SecurityAuditEntry,
)
from app.services.cloudinary_service import (
    FOLDER_RESTRICTED,
    delete_photo,
    person_folder,
    upload_photo,
)
from app.services.admin_audit import write_admin_audit
from app.services.feature_flags import VALID_FLAGS, feature_flags

logger = get_logger(__name__)
router = APIRouter(prefix="/api/security", tags=["security"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean(doc: Dict) -> Dict:
    doc.pop("_id", None)
    doc.pop("face_encoding", None)   # never return raw embeddings
    doc.pop("gait_signature", None)
    return doc


# ── Restricted Persons ────────────────────────────────────────────────────────

@router.post(
    "/restricted",
    response_model=RestrictedPersonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a restricted person (triggers alerts on detection)",
)
async def add_restricted_person(
    body: RestrictedPersonRequest,
    user: Dict = Depends(require_jdf_or_admin),
) -> RestrictedPersonResponse:
    # Encode face
    embedding = await face_engine.encode_face(body.face_image_b64)
    if embedding is None and face_engine.is_operational:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a face in the provided image. "
                   "Please use a clear, front-facing photo.",
        )

    person_id = str(uuid.uuid4())
    photo_bytes = base64.b64decode(body.face_image_b64)
    photo_url = await upload_photo(photo_bytes, FOLDER_RESTRICTED, person_id)

    doc: Dict[str, Any] = {
        "person_id": person_id,
        "name": body.name,
        "reason": body.reason,
        "face_encoding": embedding,
        "face_image_url": photo_url,         # Cloudinary URL (None if unavailable)
        "metadata": body.metadata or {},
        "registered_by": user.get("sub", "unknown"),
        "registered_at": datetime.now(timezone.utc),
        "active": True,
    }
    await restricted_persons_col().insert_one(doc)
    logger.info("Restricted person registered", person_id=person_id, name=body.name)

    return RestrictedPersonResponse(
        person_id=person_id,
        name=body.name,
        reason=body.reason,
        registered_by=doc["registered_by"],
        registered_at=doc["registered_at"],
        active=True,
        has_face_encoding=embedding is not None,
        metadata=body.metadata or {},
    )


@router.get(
    "/restricted",
    summary="List all active restricted persons",
)
async def list_restricted_persons(
    active_only: bool = Query(True),
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
    _: Dict = Depends(require_jdf_or_admin),
) -> List[Dict]:
    query: Dict = {}
    if active_only:
        query["active"] = True

    docs = await restricted_persons_col().find(
        query,
        {"face_image_b64": 0, "_id": 0},
    ).skip(skip).limit(limit).sort("registered_at", -1).to_list(length=limit)

    for d in docs:
        d["has_face_encoding"] = isinstance(d.get("face_encoding"), list) and len(d["face_encoding"]) > 0
        d.pop("face_encoding", None)
    return docs


@router.delete(
    "/restricted/{person_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Deactivate a restricted person record",
)
async def remove_restricted_person(
    person_id: str,
    request: Request,
    admin: Dict = Depends(require_jdf_or_admin),
) -> None:
    result = await restricted_persons_col().update_one(
        {"person_id": person_id}, {"$set": {"active": False}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Restricted person not found")
    await write_admin_audit(
        admin=admin,
        action="remove_restricted_person",
        detail={"person_id": person_id},
        request=request,
    )


# ── Missing / Criminal Persons ────────────────────────────────────────────────

@router.post(
    "/missing",
    response_model=MissingPersonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a missing person or criminal profile",
)
async def register_missing_person(
    body: MissingPersonRequest,
    user: Dict = Depends(require_jdf_or_admin),
) -> MissingPersonResponse:
    embedding: Optional[List] = None
    photo_url: Optional[str] = None
    if body.face_image_b64:
        embedding = await face_engine.encode_face(body.face_image_b64)
        photo_bytes = base64.b64decode(body.face_image_b64)
        photo_url = await upload_photo(
            photo_bytes, person_folder(body.category.value), str(uuid.uuid4())
        )

    person_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc: Dict[str, Any] = {
        "person_id": person_id,
        "name": body.name,
        "description": body.description,
        "category": body.category.value,
        "status": "active",
        "face_encoding": embedding,
        "face_image_url": photo_url,
        "gait_signature": None,
        "missing_since": body.missing_since,
        "metadata": body.metadata or {},
        "registered_by": user.get("sub", "unknown"),
        "registered_at": now,
    }
    await missing_persons_col().insert_one(doc)
    logger.info(
        "Missing/criminal person registered",
        person_id=person_id,
        name=body.name,
        category=body.category.value,
    )

    return MissingPersonResponse(
        person_id=person_id,
        name=body.name,
        description=body.description,
        category=body.category,
        status="active",  # type: ignore[arg-type]
        missing_since=body.missing_since,
        registered_by=doc["registered_by"],
        registered_at=now,
        has_face_encoding=embedding is not None,
        has_gait_signature=False,
        metadata=body.metadata or {},
    )


@router.get(
    "/missing",
    summary="List missing / criminal persons",
)
async def list_missing_persons(
    status_filter: Optional[str] = Query(None, alias="status"),
    category: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
    _: Dict = Depends(require_jdf_or_admin),
) -> List[Dict]:
    query: Dict = {}
    if status_filter:
        query["status"] = status_filter
    if category:
        query["category"] = category

    docs = await missing_persons_col().find(
        query,
        {"face_image_b64": 0, "_id": 0},
    ).skip(skip).limit(limit).sort("registered_at", -1).to_list(length=limit)

    for d in docs:
        d["has_face_encoding"] = isinstance(d.get("face_encoding"), list) and len(d["face_encoding"]) > 0
        d["has_gait_signature"] = isinstance(d.get("gait_signature"), list) and len(d["gait_signature"]) > 0
        d.pop("face_encoding", None)
        d.pop("gait_signature", None)
    return docs


@router.get(
    "/missing/{person_id}",
    summary="Get a single missing/criminal person record",
)
async def get_missing_person(
    person_id: str,
    _: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    doc = await missing_persons_col().find_one(
        {"person_id": person_id},
        {"face_image_b64": 0, "_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Person not found")
    doc["has_face_encoding"] = isinstance(doc.get("face_encoding"), list) and len(doc["face_encoding"]) > 0
    doc["has_gait_signature"] = isinstance(doc.get("gait_signature"), list) and len(doc["gait_signature"]) > 0
    doc.pop("face_encoding", None)
    doc.pop("gait_signature", None)
    return doc


@router.post(
    "/missing/{person_id}/reencode",
    summary="Re-generate face encoding from stored Cloudinary photo (use after facenet is installed)",
)
async def reencode_missing_person(
    person_id: str,
    _: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    """
    Fetches the stored Cloudinary photo URL and re-generates the face embedding.
    Use this when a person was registered before facenet-pytorch was installed,
    resulting in has_face_encoding=false.
    """
    if not face_engine.is_operational:
        raise HTTPException(
            status_code=503,
            detail="Facial recognition is not operational. "
                   "Ensure facenet-pytorch is installed and facial_recognition_enabled=true.",
        )

    doc = await missing_persons_col().find_one(
        {"person_id": person_id}, {"face_image_url": 1, "face_encoding": 1, "_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Person not found")

    photo_url = doc.get("face_image_url")
    if not photo_url:
        raise HTTPException(
            status_code=422,
            detail="No stored photo URL. Use PUT /missing/{person_id}/photo to upload a photo first.",
        )

    # Fetch image bytes from Cloudinary
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(photo_url)
            resp.raise_for_status()
            photo_bytes = resp.content
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch photo from Cloudinary: {exc}")

    face_image_b64 = base64.b64encode(photo_bytes).decode("utf-8")
    embedding = await face_engine.encode_face(face_image_b64)
    if embedding is None:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a face in the stored photo. "
                   "Use PUT /missing/{person_id}/photo to upload a clearer front-facing image.",
        )

    await missing_persons_col().update_one(
        {"person_id": person_id},
        {"$set": {"face_encoding": embedding, "reencoded_at": datetime.now(timezone.utc)}},
    )
    logger.info("Face re-encoded from Cloudinary photo", person_id=person_id, dims=len(embedding))
    return {"person_id": person_id, "has_face_encoding": True, "embedding_dims": len(embedding)}


@router.put(
    "/missing/{person_id}/found",
    summary="Mark a missing person as found",
)
async def mark_as_found(
    person_id: str,
    request: Request,
    admin: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    result = await missing_persons_col().update_one(
        {"person_id": person_id},
        {"$set": {"status": "found", "found_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Person not found")
    await write_admin_audit(
        admin=admin,
        action="mark_missing_person_found",
        detail={"person_id": person_id},
        request=request,
    )
    return {"person_id": person_id, "status": "found"}


# ── Photo Upload Helpers ──────────────────────────────────────────────────────

def _photo_to_b64(photo_bytes: bytes) -> str:
    return base64.b64encode(photo_bytes).decode("utf-8")


# ── Missing / Criminal Persons — Multipart Upload ─────────────────────────────

@router.post(
    "/missing/upload",
    response_model=MissingPersonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a missing person or criminal with a photo file upload",
)
async def register_missing_person_upload(
    photo: UploadFile = File(..., description="Face photo (JPEG/PNG/WebP)"),
    name: str = Form(..., min_length=1, max_length=128),
    description: str = Form(..., max_length=1024),
    category: PersonCategory = Form(...),
    missing_since: Optional[str] = Form(None, description="ISO datetime string"),
    user: Dict = Depends(require_jdf_or_admin),
) -> MissingPersonResponse:
    """
    Multipart alternative to POST /api/security/missing.
    Accepts a photo file directly instead of a base64 string.
    """
    if photo.content_type and not photo.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image/* files are accepted",
        )
    photo_bytes = await photo.read()
    if len(photo_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo too large (max 5 MB)")

    face_image_b64 = _photo_to_b64(photo_bytes)
    embedding = await face_engine.encode_face(face_image_b64)
    if embedding is None and face_engine.is_operational:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a face in the provided photo. "
                   "Please use a clear, front-facing image.",
        )

    missing_since_dt: Optional[datetime] = None
    if missing_since:
        try:
            missing_since_dt = datetime.fromisoformat(missing_since.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid missing_since datetime (use ISO 8601)")

    person_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    photo_url = await upload_photo(photo_bytes, person_folder(category.value), person_id)

    doc: Dict[str, Any] = {
        "person_id": person_id,
        "name": name,
        "description": description,
        "category": category.value,
        "status": "active",
        "face_encoding": embedding,
        "face_image_url": photo_url,
        "gait_signature": None,
        "missing_since": missing_since_dt,
        "metadata": {},
        "registered_by": user.get("sub", "unknown"),
        "registered_at": now,
    }
    await missing_persons_col().insert_one(doc)
    logger.info(
        "Missing/criminal person registered (photo upload)",
        person_id=person_id,
        name=name,
        category=category.value,
    )

    return MissingPersonResponse(
        person_id=person_id,
        name=name,
        description=description,
        category=category,
        status="active",  # type: ignore[arg-type]
        missing_since=missing_since_dt,
        registered_by=doc["registered_by"],
        registered_at=now,
        has_face_encoding=embedding is not None,
        has_gait_signature=False,
        metadata={},
    )


@router.put(
    "/missing/{person_id}/photo",
    summary="Update the face photo for an existing missing/criminal person",
)
async def update_missing_person_photo(
    person_id: str,
    photo: UploadFile = File(..., description="Replacement face photo (JPEG/PNG/WebP)"),
    user: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    if photo.content_type and not photo.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image/* files are accepted",
        )
    photo_bytes = await photo.read()
    if len(photo_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo too large (max 5 MB)")

    face_image_b64 = _photo_to_b64(photo_bytes)
    embedding = await face_engine.encode_face(face_image_b64)
    if embedding is None and face_engine.is_operational:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a face in the provided photo. "
                   "Please use a clear, front-facing image.",
        )

    # Fetch existing record to get category for correct folder
    existing = await missing_persons_col().find_one({"person_id": person_id}, {"category": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Person not found")

    photo_url = await upload_photo(
        photo_bytes, person_folder(existing.get("category", "missing")), person_id
    )

    await missing_persons_col().update_one(
        {"person_id": person_id},
        {"$set": {
            "face_image_url": photo_url,
            "face_encoding": embedding,
            "photo_updated_at": datetime.now(timezone.utc),
            "photo_updated_by": user.get("sub", "unknown"),
        }},
    )

    logger.info("Missing person photo updated", person_id=person_id)
    return {"person_id": person_id, "has_face_encoding": embedding is not None, "photo_url": photo_url}


# ── Restricted Persons — Multipart Upload ────────────────────────────────────

@router.post(
    "/restricted/upload",
    response_model=RestrictedPersonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a restricted person with a photo file upload",
)
async def add_restricted_person_upload(
    photo: UploadFile = File(..., description="Face photo (JPEG/PNG/WebP)"),
    name: str = Form(..., min_length=1, max_length=128),
    reason: str = Form(..., min_length=1, max_length=512),
    user: Dict = Depends(require_jdf_or_admin),
) -> RestrictedPersonResponse:
    """
    Multipart alternative to POST /api/security/restricted.
    Accepts a photo file directly instead of a base64 string.
    """
    if photo.content_type and not photo.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image/* files are accepted",
        )
    photo_bytes = await photo.read()
    if len(photo_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo too large (max 5 MB)")

    face_image_b64 = _photo_to_b64(photo_bytes)
    embedding = await face_engine.encode_face(face_image_b64)
    if embedding is None and face_engine.is_operational:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a face in the provided photo. "
                   "Please use a clear, front-facing image.",
        )

    person_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    photo_url = await upload_photo(photo_bytes, FOLDER_RESTRICTED, person_id)

    doc: Dict[str, Any] = {
        "person_id": person_id,
        "name": name,
        "reason": reason,
        "face_encoding": embedding,
        "face_image_url": photo_url,
        "metadata": {},
        "registered_by": user.get("sub", "unknown"),
        "registered_at": now,
        "active": True,
    }
    await restricted_persons_col().insert_one(doc)
    logger.info("Restricted person registered (photo upload)", person_id=person_id, name=name)

    return RestrictedPersonResponse(
        person_id=person_id,
        name=name,
        reason=reason,
        registered_by=doc["registered_by"],
        registered_at=now,
        active=True,
        has_face_encoding=embedding is not None,
        metadata={},
    )


@router.put(
    "/restricted/{person_id}/photo",
    summary="Update the face photo for an existing restricted person",
)
async def update_restricted_person_photo(
    person_id: str,
    photo: UploadFile = File(..., description="Replacement face photo (JPEG/PNG/WebP)"),
    user: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    if photo.content_type and not photo.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image/* files are accepted",
        )
    photo_bytes = await photo.read()
    if len(photo_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo too large (max 5 MB)")

    face_image_b64 = _photo_to_b64(photo_bytes)
    embedding = await face_engine.encode_face(face_image_b64)
    if embedding is None and face_engine.is_operational:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a face in the provided photo. "
                   "Please use a clear, front-facing image.",
        )

    photo_url = await upload_photo(photo_bytes, FOLDER_RESTRICTED, person_id)

    result = await restricted_persons_col().update_one(
        {"person_id": person_id},
        {"$set": {
            "face_image_url": photo_url,
            "face_encoding": embedding,
            "photo_updated_at": datetime.now(timezone.utc),
            "photo_updated_by": user.get("sub", "unknown"),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Restricted person not found")

    logger.info("Restricted person photo updated", person_id=person_id)
    return {"person_id": person_id, "has_face_encoding": embedding is not None, "photo_url": photo_url}


# ── Gait Enrolment ────────────────────────────────────────────────────────────

@router.post(
    "/gait/enroll",
    summary="Extract and store a gait signature from a frame",
)
async def enroll_gait(
    body: GaitEnrollRequest,
    _: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    try:
        frame_bytes = base64.b64decode(body.frame_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 frame data")

    sig = await gait_analyzer.extract_from_frame(frame_bytes)
    if sig is None:
        raise HTTPException(
            status_code=422,
            detail="Could not extract a gait signature — ensure the full body is visible.",
        )

    # Try to update missing person; also accept restricted person
    result = await missing_persons_col().update_one(
        {"person_id": body.person_id},
        {"$set": {"gait_signature": sig}},
    )
    if result.matched_count == 0:
        result = await restricted_persons_col().update_one(
            {"person_id": body.person_id},
            {"$set": {"gait_signature": sig}},
        )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Person not found in either list")

    logger.info("Gait signature enrolled", person_id=body.person_id)
    return {"person_id": body.person_id, "gait_enrolled": True, "dims": len(sig)}


# ── Audit Log ─────────────────────────────────────────────────────────────────

@router.get(
    "/audit",
    summary="Security detection audit log (admin only)",
)
async def get_audit_log(
    person_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    _: Dict = Depends(require_admin),
) -> List[Dict]:
    query: Dict = {}
    if person_id:
        query["person_id"] = person_id
    if event_type:
        query["event_type"] = event_type
    if acknowledged is not None:
        query["acknowledged"] = acknowledged

    docs = await security_audit_col().find(
        query, {"_id": 0}
    ).skip(skip).limit(limit).sort("detected_at", -1).to_list(length=limit)
    return docs


@router.put(
    "/audit/{log_id}/acknowledge",
    summary="Acknowledge a security audit entry",
)
async def acknowledge_audit(
    log_id: str,
    _: Dict = Depends(require_jdf_or_admin),
) -> Dict:
    result = await security_audit_col().update_one(
        {"log_id": log_id},
        {"$set": {"acknowledged": True, "acknowledged_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Audit entry not found")
    return {"log_id": log_id, "acknowledged": True}


# ── Facial Recognition Status & Toggle ───────────────────────────────────────

@router.get(
    "/fr/status",
    response_model=FRStatusResponse,
    summary="Facial recognition policy and runtime status",
)
async def fr_status(_: Dict = Depends(require_any_role)) -> FRStatusResponse:
    allowed_str = settings.allowed_facial_recognition_regions.strip()
    allowed_list = (
        [r.strip().upper() for r in allowed_str.split(",") if r.strip()]
        if allowed_str else []
    )
    return FRStatusResponse(
        enabled=face_engine.is_enabled,
        region_allowed=face_engine.is_region_allowed,
        system_region=settings.system_region.upper(),
        allowed_regions=allowed_list,
        deepface_available=face_engine.deepface_available,
        model=settings.facial_recognition_model,
        admin_override_permitted=settings.facial_recognition_admin_override,
    )


@router.put(
    "/fr/toggle",
    summary="Enable or disable facial recognition at runtime (admin only)",
)
async def toggle_fr(
    request: Request,
    enabled: bool = Query(..., description="true to enable, false to disable"),
    admin: Dict = Depends(require_admin),
) -> Dict:
    if not settings.facial_recognition_admin_override:
        raise HTTPException(
            status_code=403,
            detail="Admin override of facial recognition is disabled by system policy",
        )
    face_engine.admin_set_enabled(enabled)

    # Persist to system_settings so restarts can optionally respect it
    await system_settings_col().update_one(
        {"key": "facial_recognition_enabled"},
        {"$set": {"key": "facial_recognition_enabled", "value": enabled,
                  "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Jamaica DPA: biometric processing changes must be audited
    await write_admin_audit(
        admin=admin,
        action="toggle_facial_recognition",
        detail={"enabled": enabled},
        request=request,
    )
    return {"facial_recognition_enabled": enabled}


# ── Feature Flags ─────────────────────────────────────────────────────────────

@router.get(
    "/features",
    summary="List all security feature flags and their current state",
)
async def list_feature_flags(_: Dict = Depends(require_any_role)) -> Dict:
    """
    Returns each flag with:
      - enabled   : current effective value
      - source    : "runtime" (DB override) or "config" (default)
      - default   : the config-level default
      - description: human-readable explanation
      - updated_at / updated_by : set when a runtime override exists

    Available flags:
      facial_recognition  — face detection on every frame
      restricted_persons  — check against restraining-order / restricted list
      missing_persons     — check against missing persons list
      criminal_search     — include criminal-category persons in missing search
      gait_analysis       — gait signature matching
    """
    return await feature_flags.get_all()


@router.put(
    "/features/{flag}",
    summary="Enable or disable a security feature flag (admin only)",
)
async def set_feature_flag(
    flag: str,
    request: Request,
    enabled: bool = Query(..., description="true to enable, false to disable"),
    admin: Dict = Depends(require_admin),
) -> Dict:
    if flag not in VALID_FLAGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown flag '{flag}'. Valid flags: {sorted(VALID_FLAGS)}",
        )
    await feature_flags.set(flag, enabled, updated_by=admin.get("sub", "admin"))

    # Keep face_engine's in-process state in sync when toggling facial_recognition
    if flag == "facial_recognition" and settings.facial_recognition_admin_override:
        face_engine.admin_set_enabled(enabled)

    await write_admin_audit(
        admin=admin,
        action="set_feature_flag",
        detail={"flag": flag, "enabled": enabled},
        request=request,
    )
    return {"flag": flag, "enabled": enabled, "source": "runtime"}


@router.delete(
    "/features/{flag}",
    status_code=status.HTTP_200_OK,
    summary="Reset a feature flag to its config default (admin only)",
)
async def reset_feature_flag(
    flag: str,
    request: Request,
    admin: Dict = Depends(require_admin),
) -> Dict:
    if flag not in VALID_FLAGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown flag '{flag}'. Valid flags: {sorted(VALID_FLAGS)}",
        )
    await feature_flags.reset(flag)
    await write_admin_audit(
        admin=admin,
        action="reset_feature_flag",
        detail={"flag": flag},
        request=request,
    )
    return {"flag": flag, "source": "config", "message": "Reset to config default"}
