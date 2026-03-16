"""
AEGIS — Cloudinary photo storage service.

Handles uploading face photos for missing persons, criminals, and restricted
persons. Stores images in organised folders and returns secure URLs.

If Cloudinary credentials are not configured the service degrades gracefully:
upload() returns None and callers fall back to storing nothing (the face
embedding is still saved for matching).

Install:  pip install cloudinary
"""

from __future__ import annotations

import base64
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Optional cloudinary import ────────────────────────────────────────────────

try:
    import cloudinary  # type: ignore
    import cloudinary.uploader  # type: ignore
    _CLOUDINARY_AVAILABLE = True
except ImportError:
    _CLOUDINARY_AVAILABLE = False
    logger.warning(
        "cloudinary package not installed — photo storage disabled. "
        "Run: pip install cloudinary"
    )

_configured = False


def _ensure_configured() -> bool:
    """Configure the cloudinary SDK once. Returns True if ready."""
    global _configured
    if _configured:
        return True
    if not _CLOUDINARY_AVAILABLE:
        return False
    if not (settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret):
        logger.warning(
            "Cloudinary credentials not set — photo storage disabled. "
            "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env"
        )
        return False
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )
    _configured = True
    logger.info("Cloudinary configured", cloud_name=settings.cloudinary_cloud_name)
    return True


@property
def is_available() -> bool:
    return _ensure_configured()


async def upload_photo(
    image_bytes: bytes,
    folder: str,
    public_id: str,
) -> Optional[str]:
    """
    Upload a photo to Cloudinary.

    Args:
        image_bytes: Raw image bytes (JPEG/PNG/WebP).
        folder:      Cloudinary folder, e.g. "aegis/missing_persons".
        public_id:   Filename without extension, e.g. the person_id UUID.

    Returns:
        Secure HTTPS URL of the uploaded image, or None on failure.
    """
    if not _ensure_configured():
        return None

    import asyncio

    def _upload() -> Optional[str]:
        try:
            # Encode bytes as data URI so cloudinary accepts raw bytes
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            data_uri = f"data:image/jpeg;base64,{b64}"

            result = cloudinary.uploader.upload(
                data_uri,
                folder=folder,
                public_id=public_id,
                overwrite=True,
                resource_type="image",
                transformation=[
                    # Normalise to a consistent size — reduces storage and
                    # speeds up face encoding on the stored thumbnail.
                    {"width": 800, "height": 800, "crop": "limit", "quality": "auto"},
                ],
            )
            url: str = result["secure_url"]
            logger.info(
                "Photo uploaded to Cloudinary",
                folder=folder,
                public_id=public_id,
                url=url,
            )
            return url
        except Exception as exc:
            logger.error("Cloudinary upload failed", error=str(exc))
            return None

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _upload)


async def delete_photo(folder: str, public_id: str) -> bool:
    """Delete a photo from Cloudinary. Returns True on success."""
    if not _ensure_configured():
        return False

    import asyncio

    def _delete() -> bool:
        try:
            cloudinary.uploader.destroy(f"{folder}/{public_id}")
            logger.info("Photo deleted from Cloudinary", folder=folder, public_id=public_id)
            return True
        except Exception as exc:
            logger.error("Cloudinary delete failed", error=str(exc))
            return False

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _delete)


# ── Folder constants ──────────────────────────────────────────────────────────

FOLDER_MISSING   = "aegis/missing_persons"
FOLDER_CRIMINAL  = "aegis/criminals"
FOLDER_RESTRICTED = "aegis/restricted_persons"


def person_folder(category: str) -> str:
    """Return the correct Cloudinary folder for a given person category."""
    return FOLDER_CRIMINAL if category == "criminal" else FOLDER_MISSING
