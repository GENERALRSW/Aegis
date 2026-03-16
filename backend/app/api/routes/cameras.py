"""
AEGIS — Camera management endpoints.
POST /api/cameras/register
GET  /api/cameras
GET  /api/cameras/{camera_id}
PUT  /api/cameras/{camera_id}
DELETE /api/cameras/{camera_id}
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import require_any_role, require_operator_or_above
from app.db.mongodb import cameras_col
from app.models.enums import CameraStatus
from app.schemas.schemas import CameraRegisterRequest, CameraResponse, CameraUpdateRequest

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


def _serialize(doc: Dict) -> Dict:
    doc["camera_id"] = str(doc.get("camera_id", doc.get("_id", "")))
    doc.pop("_id", None)
    return doc


@router.post(
    "/register",
    response_model=CameraResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new camera source",
)
async def register_camera(
    body: CameraRegisterRequest,
    _: Dict = Depends(require_operator_or_above),
) -> CameraResponse:
    col = cameras_col()
    existing = await col.find_one({"camera_id": body.camera_id})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Camera '{body.camera_id}' already registered",
        )

    doc: Dict[str, Any] = {
        **body.model_dump(),
        "status": CameraStatus.active.value,
        "registered_at": datetime.now(timezone.utc),
    }
    await col.insert_one(doc)
    doc.pop("_id", None)
    return CameraResponse(**doc)


@router.get(
    "",
    response_model=List[CameraResponse],
    summary="List all registered cameras",
)
async def list_cameras(
    status_filter: str = Query(None, alias="status"),
    camera_type: str = Query(None),
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
    _: Dict = Depends(require_any_role),
) -> List[CameraResponse]:
    query: Dict = {}
    if status_filter:
        query["status"] = status_filter
    if camera_type:
        query["camera_type"] = camera_type

    col = cameras_col()
    cursor = col.find(query).skip(skip).limit(limit).sort("registered_at", -1)
    cameras = []
    async for doc in cursor:
        doc = _serialize(doc)
        cameras.append(CameraResponse(**doc))
    return cameras


@router.get(
    "/{camera_id}",
    response_model=CameraResponse,
    summary="Get camera by ID",
)
async def get_camera(
    camera_id: str,
    _: Dict = Depends(require_any_role),
) -> CameraResponse:
    doc = await cameras_col().find_one({"camera_id": camera_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Camera not found")
    return CameraResponse(**_serialize(doc))


@router.put(
    "/{camera_id}",
    response_model=CameraResponse,
    summary="Update camera metadata or status",
)
async def update_camera(
    camera_id: str,
    body: CameraUpdateRequest,
    _: Dict = Depends(require_operator_or_above),
) -> CameraResponse:
    col = cameras_col()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update fields provided")

    result = await col.find_one_and_update(
        {"camera_id": camera_id},
        {"$set": update_data},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Camera not found")
    return CameraResponse(**_serialize(result))


@router.delete(
    "/{camera_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Deregister a camera",
)
async def delete_camera(
    camera_id: str,
    _: Dict = Depends(require_operator_or_above),
) -> None:
    result = await cameras_col().delete_one({"camera_id": camera_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Camera not found")
    # Do not return anything here — FastAPI will automatically send 204 No Content