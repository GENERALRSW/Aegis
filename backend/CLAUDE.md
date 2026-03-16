# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run development server (auto-reload):**
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Run with Docker Compose (recommended — starts MongoDB + Kafka):**
```bash
docker compose up -d
docker compose exec backend python scripts/seed_db.py  # seed demo accounts
docker compose logs -f backend
```

**Run tests:**
```bash
pytest                                          # all tests
pytest tests/test_cv.py -v                     # CV unit tests only
pytest tests/test_api.py -v                    # integration tests only
pytest --cov=app --cov-report=term-missing     # with coverage
```

**Seed demo database (creates admin/operator/viewer accounts):**
```bash
python scripts/seed_db.py
```

**Generate a SECRET_KEY:**
```bash
openssl rand -hex 32
```

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:
- `SECRET_KEY` — min 32 chars, required for JWT
- `MONGO_URI` / `MONGO_DB` — MongoDB connection
- `BROKER` — `kafka` or `rabbitmq`
- `DEVICE` — `cpu`, `cuda`, or `mps` for CV inference
- `YOLO_MODEL_PATH` — path to YOLOv8 `.pt` file
- `GEMINI_API_KEY` — optional; enables LLM-generated incident summaries
- `LLM_ENABLED` — set `false` to skip LLM calls and use template summaries

## Architecture

### Request Flow
```
HTTP Request
  → CORS → RateLimitMiddleware → RequestIDMiddleware
  → FastAPI Router
  → JWT dependency (require_admin / require_operator_or_above / require_any_role)
  → Route handler → Service layer → MongoDB (Motor async)
                                 → Broker (Kafka/RabbitMQ)
                                 → WebSocket broadcast
```

### Computer Vision Pipeline (`app/cv/`)
- **`engine.py`** — Singleton `CVEngine` with lazy model loading. On first call, loads YOLOv8 (person + weapon) and MediaPipe Pose. All three run concurrently via `asyncio.gather` + `ThreadPoolExecutor`. Protected by `asyncio.Lock`.
- **`risk_scorer.py`** — Pure rule-based threat scoring. Combinatorial logic maps detection combinations (intruder, weapon, conflict) to severity (low → critical) and a 0–1 risk score. No ML involved.

### Event Broker (`app/services/broker.py`)
Abstract `BrokerClient` with `KafkaBroker` (aiokafka) and `RabbitMQBroker` (aio_pika) implementations. If the broker is unavailable, events fall back to in-memory local subscribers so the WebSocket dashboard still works.

Topics: `detections`, `alerts`.

### WebSocket Live Dashboard (`app/api/routes/dashboard.py`, `app/services/websocket_manager.py`)
Clients connect to `WS /api/dashboard/stream?token=<jwt>&camera_id=...&severity=...`. The `ConnectionManager` registers sessions with filters. When the broker relays a detection event, `broadcast()` applies per-client filter matching before sending.

### Authentication & RBAC (`app/core/security.py`)
JWT with roles: `admin`, `operator`, `viewer`. Role checks are FastAPI dependencies:
- `require_admin` — admin only
- `require_operator_or_above` — admin or operator
- `require_any_role` — any authenticated user

Tokens: short-lived access token + refresh token, both in `TokenResponse`.

### LLM Integration (`app/services/llm_service.py`)
Uses Gemini to auto-generate 2–3 sentence incident summaries on every detection. Also powers `/api/cv/query` for natural-language event queries. Gracefully degrades to template strings when disabled or key is absent.

### Database (`app/db/mongodb.py`)
Async Motor client with `maxPoolSize=20`. Indexes provisioned at startup: compound index on `(timestamp, severity)`, unique on `camera_id`, `email`, `username`. Collections: `cameras`, `events`, `users`, `alerts`.

### Middleware
- **`rate_limit.py`** — Sliding-window per-IP limiter (in-memory). Replace with Redis-backed for multi-instance deployments.
- **`request_id.py`** — Injects `X-Request-ID` for distributed tracing.

### Logging (`app/core/logging.py`)
structlog with `ConsoleRenderer` in development and `JSONRenderer` in production. `configure_logging()` is called in the app lifespan. Use `get_logger(name)` throughout the codebase.

## Key Files
- `app/main.py` — App factory (`create_app()`), async lifespan (startup/shutdown of DB, broker, CV warm-up)
- `app/core/config.py` — All settings via Pydantic `BaseSettings`
- `app/schemas/schemas.py` — All Pydantic v2 DTOs
- `app/models/enums.py` — `CameraType`, `EventType`, `Severity`, `UserRole`, `CameraStatus`
- `scripts/demo_client.py` — Simulates multi-source frame streaming for local testing
- `scripts/usb_webcam_client.py` — Real OpenCV webcam client

## Testing Notes
- `pytest.ini` sets `asyncio_mode = auto` — async test functions work without decorators.
- Integration tests in `test_api.py` mock I/O; CV unit tests in `test_cv.py` test the risk scorer logic directly.
