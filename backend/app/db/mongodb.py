"""
AEGIS — Motor (async MongoDB) client + collection accessors.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_db() -> None:
    global _client, _db
    logger.info("Connecting to MongoDB", uri=settings.mongo_uri)
    _client = AsyncIOMotorClient(
        settings.mongo_uri,
        serverSelectionTimeoutMS=5_000,
        maxPoolSize=20,
    )
    _db = _client[settings.mongo_db]
    await _ensure_indexes()
    logger.info("MongoDB connected", db=settings.mongo_db)


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        logger.info("MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialized — call connect_db() first")
    return _db


# ── Collection shortcuts ──────────────────────────────────────────────────────

def cameras_col():
    return get_db()["cameras"]


def events_col():
    return get_db()["events"]


def users_col():
    return get_db()["users"]


def alerts_col():
    return get_db()["alerts"]


def restricted_persons_col():
    return get_db()["restricted_persons"]


def missing_persons_col():
    return get_db()["missing_persons"]


def security_audit_col():
    return get_db()["security_audit"]


def system_settings_col():
    return get_db()["system_settings"]


# ── Index provisioning ────────────────────────────────────────────────────────

async def _ensure_indexes() -> None:
    db = get_db()

    # cameras
    await db["cameras"].create_index("camera_id", unique=True)
    await db["cameras"].create_index("status")

    # events
    await db["events"].create_index([("timestamp", -1)])
    await db["events"].create_index("camera_id")
    await db["events"].create_index("severity")
    await db["events"].create_index("event_type")
    await db["events"].create_index([("timestamp", -1), ("severity", 1)])

    # users
    await db["users"].create_index("email", unique=True)
    await db["users"].create_index("username", unique=True)

    # alerts
    await db["alerts"].create_index([("created_at", -1)])
    await db["alerts"].create_index("event_id")

    # restricted_persons
    await db["restricted_persons"].create_index("person_id", unique=True)
    await db["restricted_persons"].create_index("active")

    # missing_persons
    await db["missing_persons"].create_index("person_id", unique=True)
    await db["missing_persons"].create_index("status")
    await db["missing_persons"].create_index("category")

    # security_audit
    await db["security_audit"].create_index([("detected_at", -1)])
    await db["security_audit"].create_index("person_id")
    await db["security_audit"].create_index("event_type")

    logger.info("MongoDB indexes ensured")
