"""
AEGIS — Firebase Cloud Messaging (FCM) push notification service.
Gracefully degrades when credentials file is not present.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional, Tuple

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_fcm_app = None
_fcm_available = False


def _init_fcm() -> bool:
    global _fcm_app, _fcm_available
    if _fcm_app is not None:
        return _fcm_available

    creds_path = settings.fcm_credentials_path
    if not os.path.exists(creds_path):
        logger.warning(
            "FCM credentials file not found — push notifications disabled",
            path=creds_path,
        )
        _fcm_available = False
        return False

    try:
        import firebase_admin  # type: ignore
        from firebase_admin import credentials  # type: ignore

        cred = credentials.Certificate(creds_path)
        _fcm_app = firebase_admin.initialize_app(cred)
        _fcm_available = True
        logger.info("Firebase Admin SDK initialized", project=settings.fcm_project_id)
    except Exception as exc:
        logger.error("FCM initialization failed", error=str(exc))
        _fcm_available = False

    return _fcm_available


async def send_push_notification(
    title: str,
    body: str,
    tokens: Optional[List[str]] = None,
    topic: Optional[str] = None,
    data: Optional[Dict[str, str]] = None,
) -> Tuple[int, int]:
    """
    Send FCM push notification.
    Returns (success_count, failure_count).
    tokens XOR topic must be provided.
    """
    if not _init_fcm():
        logger.debug("FCM not available — skipping push")
        return 0, 0

    try:
        from firebase_admin import messaging  # type: ignore

        notification = messaging.Notification(title=title, body=body)
        extra_data = data or {}

        if topic:
            msg = messaging.Message(
                notification=notification,
                topic=topic,
                data=extra_data,
            )
            response = messaging.send(msg)
            logger.info("FCM topic message sent", topic=topic, response=response)
            return 1, 0

        if tokens:
            multicast_msg = messaging.MulticastMessage(
                notification=notification,
                tokens=tokens,
                data=extra_data,
            )
            response = messaging.send_multicast(multicast_msg)
            success = response.success_count
            failure = response.failure_count
            logger.info(
                "FCM multicast sent",
                success=success,
                failure=failure,
                total=len(tokens),
            )
            return success, failure

        logger.warning("No FCM target: provide tokens or topic")
        return 0, 0

    except Exception as exc:
        logger.error("FCM send failed", error=str(exc))
        return 0, 0
