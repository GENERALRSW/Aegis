"""
AEGIS — Simple in-memory sliding-window rate limiter middleware.
Uses a token bucket per IP address.
In production, swap the in-memory store for Redis.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Sliding window state: ip → deque of request timestamps
_windows: Dict[str, Deque[float]] = defaultdict(deque)

WINDOW_SECONDS = 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip rate limiting for health checks
        if request.url.path in ("/health", "/", "/docs", "/openapi.json", "/redoc"):
            return await call_next(request)

        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window = _windows[ip]

        # Evict timestamps outside the window
        while window and now - window[0] > WINDOW_SECONDS:
            window.popleft()

        if len(window) >= settings.rate_limit_per_minute:
            logger.warning("Rate limit exceeded", ip=ip, count=len(window))
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Rate limit exceeded. Max "
                    f"{settings.rate_limit_per_minute} requests/minute."
                },
                headers={
                    "Retry-After": str(WINDOW_SECONDS),
                    "X-RateLimit-Limit": str(settings.rate_limit_per_minute),
                    "X-RateLimit-Remaining": "0",
                },
            )

        window.append(now)

        response = await call_next(request)
        remaining = max(0, settings.rate_limit_per_minute - len(window))
        response.headers["X-RateLimit-Limit"] = str(settings.rate_limit_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
