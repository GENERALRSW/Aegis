"""
AEGIS Surveillance Backend — Application Factory
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import alerts, cameras, cv, dashboard, security, users
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.cv.engine import cv_engine
from app.db.mongodb import close_db, connect_db
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.services.broker import get_broker, shutdown_broker
from app.services.websocket_manager import broker_to_ws_relay, ws_manager
from app.services.broker import subscribe_local

logger = get_logger(__name__)

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    configure_logging()
    logger.info("AEGIS starting up", env=settings.app_env)

    # Database
    await connect_db()

    # Event broker
    await get_broker()

    # Subscribe local WS relay (broker → dashboard WebSocket)
    subscribe_local(broker_to_ws_relay)

    # Warm up CV engine (non-blocking — runs in background)
    import asyncio
    asyncio.create_task(_warm_cv())

    logger.info("AEGIS ready", host=settings.app_host, port=settings.app_port)

    yield

    # Shutdown
    logger.info("AEGIS shutting down …")
    await shutdown_broker()
    await close_db()
    logger.info("AEGIS stopped")


async def _warm_cv() -> None:
    try:
        await cv_engine.ensure_loaded()
    except Exception as exc:
        logger.warning("CV engine warm-up failed", error=str(exc))


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="AEGIS Surveillance Backend",
        description=(
            "AI-powered multi-source surveillance system. "
            "Ingests video from phones, laptops, and USB cameras; "
            "runs YOLOv8 + MediaPipe inference; "
            "streams live alerts to dashboards and mobile devices."
        ),
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # ── Middleware (order matters — outermost first) ───────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestIDMiddleware)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(users.router)
    app.include_router(cameras.router)
    app.include_router(events.router)
    app.include_router(alerts.router)
    app.include_router(cv.router)
    app.include_router(dashboard.router)
    app.include_router(security.router)

    # ── Exception handlers ────────────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.error(
            "Unhandled exception",
            path=request.url.path,
            error=str(exc),
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"},
        )

    # ── Health & root ─────────────────────────────────────────────────────────
    @app.get("/health", tags=["system"])
    async def health():
        from app.db.mongodb import get_db
        try:
            await get_db().command("ping")
            db_status = "ok"
        except Exception:
            db_status = "error"

        return {
            "status": "ok",
            "version": "1.0.0",
            "db": db_status,
            "broker": settings.broker,
            "cv_engine": cv_engine.status,
            "ws_clients": ws_manager.connection_count,
        }

    @app.get("/", tags=["system"])
    async def root():
        return {
            "name": "AEGIS Surveillance Backend",
            "version": "1.0.0",
            "docs": "/docs",
        }

    return app


# Import here to avoid circular imports
from app.api.routes import events  # noqa: E402

app = create_app()
