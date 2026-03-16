"""
AEGIS — Structured logging via structlog.
Call configure_logging() once at startup.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import structlog

from app.core.config import settings


def configure_logging() -> None:
    Path(settings.log_file).parent.mkdir(parents=True, exist_ok=True)

    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if settings.is_production:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Also configure stdlib so uvicorn/gunicorn logs pass through
    logging.basicConfig(
        format="%(message)s",
        level=level,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(settings.log_file),
        ],
    )


def get_logger(name: str) -> structlog.BoundLogger:
    return structlog.get_logger(name)
