"""
AEGIS — Feature flags service.

Provides a thin layer over system_settings (MongoDB) that lets admins
toggle security features at runtime without restarting the server.

Each flag has:
  - A config-level default (read from Settings at startup).
  - An optional runtime override stored in system_settings collection.

Runtime overrides take precedence over config defaults.
The in-memory cache is refreshed on every read so changes propagate
within one request cycle without requiring a restart.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Flag definitions ──────────────────────────────────────────────────────────
# Maps flag name → (config default, human-readable description)
_FLAG_DEFAULTS: Dict[str, tuple] = {
    "facial_recognition":   (settings.facial_recognition_enabled,  "Face recognition on incoming frames"),
    "restricted_persons":   (settings.restricted_persons_enabled,   "Check frames against restricted/restraining-order persons"),
    "missing_persons":      (settings.missing_persons_enabled,      "Check frames against missing persons list"),
    "criminal_search":      (settings.criminal_search_enabled,      "Include criminal-category persons in missing-persons search"),
    "gait_analysis":        (settings.gait_analysis_enabled,        "Gait signature matching"),
}

VALID_FLAGS = set(_FLAG_DEFAULTS.keys())


class FeatureFlags:
    """
    Singleton.  Call `await flags.get(name)` anywhere in the app.
    Runtime overrides persist in MongoDB; config defaults are the fallback.
    """

    _instance: Optional["FeatureFlags"] = None

    @classmethod
    def get_instance(cls) -> "FeatureFlags":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get(self, flag: str) -> bool:
        """Return the current value of a flag (runtime override > config default)."""
        if flag not in _FLAG_DEFAULTS:
            raise ValueError(f"Unknown feature flag: '{flag}'. Valid: {sorted(VALID_FLAGS)}")

        from app.db.mongodb import system_settings_col
        doc = await system_settings_col().find_one({"key": f"flag:{flag}"})
        if doc is not None:
            return bool(doc.get("value", _FLAG_DEFAULTS[flag][0]))
        return _FLAG_DEFAULTS[flag][0]

    async def get_all(self) -> Dict[str, Any]:
        """Return all flags with their current values and metadata."""
        from app.db.mongodb import system_settings_col
        overrides = {
            doc["key"].removeprefix("flag:"): doc
            async for doc in system_settings_col().find(
                {"key": {"$regex": "^flag:"}}, {"_id": 0}
            )
        }

        result: Dict[str, Any] = {}
        for flag, (default, description) in _FLAG_DEFAULTS.items():
            override = overrides.get(flag)
            result[flag] = {
                "enabled": bool(override["value"]) if override else default,
                "source": "runtime" if override else "config",
                "default": default,
                "description": description,
                "updated_at": override.get("updated_at") if override else None,
                "updated_by": override.get("updated_by") if override else None,
            }
        return result

    # ── Write ─────────────────────────────────────────────────────────────────

    async def set(self, flag: str, value: bool, updated_by: str = "admin") -> None:
        """Persist a runtime override. Raises ValueError for unknown flags."""
        if flag not in _FLAG_DEFAULTS:
            raise ValueError(f"Unknown feature flag: '{flag}'")

        from app.db.mongodb import system_settings_col
        await system_settings_col().update_one(
            {"key": f"flag:{flag}"},
            {
                "$set": {
                    "key": f"flag:{flag}",
                    "value": value,
                    "updated_at": datetime.now(timezone.utc),
                    "updated_by": updated_by,
                }
            },
            upsert=True,
        )
        logger.info("Feature flag updated", flag=flag, value=value, by=updated_by)

    async def reset(self, flag: str) -> None:
        """Remove runtime override — flag reverts to config default."""
        if flag not in _FLAG_DEFAULTS:
            raise ValueError(f"Unknown feature flag: '{flag}'")
        from app.db.mongodb import system_settings_col
        await system_settings_col().delete_one({"key": f"flag:{flag}"})
        logger.info("Feature flag reset to default", flag=flag, default=_FLAG_DEFAULTS[flag][0])


# Singleton
feature_flags = FeatureFlags.get_instance()
