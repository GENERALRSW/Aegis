# AEGIS — AI-Powered Surveillance Frontend

```
 █████╗ ███████╗ ██████╗ ██╗███████╗
██╔══██╗██╔════╝██╔════╝ ██║██╔════╝
███████║█████╗  ██║  ███╗██║███████╗
██╔══██║██╔══╝  ██║   ██║██║╚════██║
██║  ██║███████╗╚██████╔╝██║███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝
Autonomous Event & Guard Intelligence System
```

Production-grade FastAPI backend for a multi-source AI surveillance platform.
Ingests video frames from phones, laptops, and USB webcams; runs YOLOv8 +
MediaPipe inference; classifies threats; streams live alerts to dashboards and
mobile devices via WebSocket and FCM.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Features](#features)
3. [Quick Start](#quick-start)
4. [API Reference](#api-reference)
5. [Computer Vision Pipeline](#computer-vision-pipeline)
6. [Event Classification & Risk Scoring](#event-classification--risk-scoring)
7. [LLM Integration](#llm-integration)
8. [WebSocket Dashboard Stream](#websocket-dashboard-stream)
9. [Configuration](#configuration)
10. [Deployment](#deployment)
11. [Demo Flow](#demo-flow)
12. [Testing](#testing)
13. [Project Structure](#project-structure)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VIDEO SOURCES                            │
│  📱 Phone App    💻 Laptop Webcam    🔌 USB Webcam (OpenCV)     │
└──────────────────────────┬──────────────────────────────────────┘
                           │  JPEG frames (HTTP multipart / base64)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FastAPI Backend (AEGIS)                       │
│                                                                 │
│  POST /api/cv/detect                                            │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────┐           │
│  │           CV Engine (async)                     │           │
│  │  YOLOv8 Person/Weapon  │  MediaPipe Pose        │           │
│  └─────────────┬───────────────────────────────────┘           │
│                │ Detections                                     │
│                ▼                                               │
│  ┌─────────────────────────┐   ┌─────────────────────────┐    │
│  │    Risk Scorer          │   │    LLM (Gemini)          │    │
│  │  intruder+weapon+conflict│   │  Human-readable summary  │    │
│  │  → severity + score     │   │  Incident reports        │    │
│  └──────────┬──────────────┘   └────────────┬────────────┘    │
│             │                               │                  │
│             ▼                               ▼                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Event Store (MongoDB)                  │  │
│  └─────────────────────────┬────────────────────────────────┘  │
│                            │                                    │
│             ┌──────────────┴──────────────┐                    │
│             ▼                             ▼                    │
│  ┌─────────────────────┐      ┌───────────────────────────┐   │
│  │  Kafka / RabbitMQ   │      │   WebSocket Manager       │   │
│  │  topics:            │      │   WS /api/dashboard/stream│   │
│  │  - detections       │      └───────────────────────────┘   │
│  │  - alerts           │                                       │
│  └─────────────────────┘                                       │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────────┐                                       │
│  │  FCM Push (Firebase)│                                       │
│  │  Mobile alerts      │                                       │
│  └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Features

| Category | Feature |
|---|---|
| **Video Ingestion** | Phone (HTTP multipart), laptop webcam (browser/WebRTC relay), USB webcam (OpenCV client script) |
| **CV Models** | YOLOv8 (person + weapon detection), MediaPipe Pose (conflict/aggression detection) |
| **Risk Scoring** | Combinatorial severity engine: intruder → low, weapon → medium, weapon+conflict → high, all three → critical |
| **LLM Layer** | Gemini 1.5 Flash for human-readable incident summaries and natural language event queries |
| **Event Streaming** | Kafka or RabbitMQ with automatic in-process fallback |
| **Live Dashboard** | WebSocket stream with per-client filtering (camera, severity, event type) |
| **Push Notifications** | Firebase Cloud Messaging (FCM) — topic broadcast or per-device tokens |
| **Auth & RBAC** | JWT (access + refresh tokens), roles: admin / operator / viewer |
| **Security** | HTTPS enforcement, rate limiting (sliding window), request ID tracing, input validation |
| **Deployment** | Dockerfile (multi-stage), Docker Compose, Kubernetes manifests + HPA |
| **Analytics** | Dashboard stats, per-camera heatmap, hourly event timeline |

---

## Quick Start

### Prerequisites

- Python 3.11+
- MongoDB 7.x running locally or via Atlas
- (Optional) Kafka or RabbitMQ
- (Optional) Firebase project for push notifications
- (Optional) Gemini API key for LLM summaries

### 1. Clone and set up

```bash
git clone https://github.com/your-org/aegis-backend.git
cd aegis-backend

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set SECRET_KEY and MONGO_URI
openssl rand -hex 32   # generates a good SECRET_KEY value
```

### 3. Seed demo data

```bash
python scripts/seed_db.py
```

This creates three demo accounts:

| Email | Password | Role |
|---|---|---|
| admin@aegis.ai | Admin@1234 | admin |
| operator@aegis.ai | Operator@1234 | operator |
| viewer@aegis.ai | Viewer@1234 | viewer |

> **Note:** Re-register via `POST /api/users/register` for properly hashed passwords.

### 4. Download YOLOv8 model

```bash
mkdir -p models
# The ultralytics package auto-downloads on first inference.
# To pre-download:
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
mv yolov8n.pt models/
```

### 5. Run the server

```bash
# Development (auto-reload)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Production
gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers 2
```

### 6. Open interactive docs

```
http://localhost:8000/docs     ← Swagger UI
http://localhost:8000/redoc    ← ReDoc
```

---

## Docker Quick Start

```bash
# Copy and configure env
cp .env.example .env

# Start all services (backend + MongoDB + Kafka)
docker compose up -d

# With Mongo Express UI (port 8081)
docker compose --profile dev up -d

# Seed demo data
docker compose exec backend python scripts/seed_db.py

# Tail logs
docker compose logs -f backend
```

---

## API Reference

### Authentication

All endpoints (except `/health`, `/`, `/api/users/login`, `/api/users/register`) require:

```
Authorization: Bearer <access_token>
```

#### Login
```http
POST /api/users/login
Content-Type: application/json

{
  "email": "operator@aegis.ai",
  "password": "Operator@1234"
}
```

Response:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

---

### Camera Management

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/cameras/register` | operator+ | Register a camera source |
| GET | `/api/cameras` | any | List all cameras |
| GET | `/api/cameras/{id}` | any | Get camera by ID |
| PUT | `/api/cameras/{id}` | operator+ | Update camera |
| DELETE | `/api/cameras/{id}` | operator+ | Deregister camera |

#### Register a camera
```http
POST /api/cameras/register
Authorization: Bearer <token>

{
  "camera_id": "phone-cam-001",
  "name": "Zone A — Main Entrance",
  "camera_type": "phone",
  "location": "Main Gate",
  "latitude": 17.9970,
  "longitude": -76.7936
}
```

Camera types: `phone` | `laptop` | `usb` | `ip` | `cctv`

---

### Computer Vision — Frame Detection

#### Multipart (phone / webcam / OpenCV)
```http
POST /api/cv/detect
Authorization: Bearer <token>
Content-Type: multipart/form-data

frame=<image_file>
camera_id=phone-cam-001
source_type=phone
location=Zone A
```

#### JSON / base64
```http
POST /api/cv/detect/json
Authorization: Bearer <token>
Content-Type: application/json

{
  "camera_id": "laptop-cam-001",
  "source_type": "laptop",
  "frame_b64": "<base64_encoded_jpeg>",
  "location": "Control Room"
}
```

Response:
```json
{
  "camera_id": "phone-cam-001",
  "detections": [
    {
      "label": "intruder",
      "confidence": 0.912,
      "bounding_box": { "x1": 120, "y1": 80, "x2": 340, "y2": 460, "width": 220, "height": 380 }
    },
    {
      "label": "weapon",
      "confidence": 0.843,
      "bounding_box": { "x1": 210, "y1": 200, "x2": 290, "y2": 350, "width": 80, "height": 150 }
    }
  ],
  "event_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "severity": "high",
  "risk_score": 0.8942,
  "summary": "At 14:23 UTC, camera phone-cam-001 detected an intruder carrying a weapon with 91% confidence. Risk level is HIGH. Dispatch security to Zone A immediately.",
  "processing_time_ms": 142.7
}
```

#### Natural language query
```http
POST /api/cv/query
Authorization: Bearer <token>

{
  "question": "Show me all weapon detections in the last 24 hours in Zone B"
}
```

#### CV engine status
```http
GET /api/cv/status
Authorization: Bearer <token>
```

---

### Events

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/events/ingest` | Manually ingest a pre-processed detection |
| GET | `/api/events` | Query events (filters: camera_id, event_type, severity, from_ts, to_ts) |
| GET | `/api/events/{id}` | Get event by ID |

#### Query events
```http
GET /api/events?severity=high&event_type=weapon&limit=20
Authorization: Bearer <token>
```

Event types: `intruder` | `weapon` | `conflict` | `motion` | `unknown`
Severities: `low` | `medium` | `high` | `critical`

---

### Alerts

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/alerts/send` | Send FCM push + broker alert |
| GET | `/api/alerts` | List alerts |
| GET | `/api/alerts/{id}` | Get alert by ID |

```http
POST /api/alerts/send
Authorization: Bearer <token>

{
  "event_id": "3fa85f64-...",
  "title": "⚠️ HIGH RISK — Weapon Detected",
  "body": "Weapon detected at Zone A with 89% confidence. Respond immediately.",
  "topic": "high_alerts",
  "data": { "camera_id": "phone-cam-001", "severity": "high" }
}
```

---

### Dashboard

| Method | Endpoint | Description |
|---|---|---|
| WS | `/api/dashboard/stream` | Live event WebSocket stream |
| GET | `/api/dashboard/stats` | Aggregate stats for past N hours |
| GET | `/api/dashboard/heatmap` | Event density per camera |
| GET | `/api/dashboard/timeline` | Hourly event bucketing |

---

### Users

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/users/register` | public | Create account |
| POST | `/api/users/login` | public | Get JWT tokens |
| GET | `/api/users/me` | any | Current user info |
| GET | `/api/users` | admin | List all users |
| PUT | `/api/users/{id}/role` | admin | Update user role |

---

## Computer Vision Pipeline

```
Image bytes
     │
     ├─── YOLOv8 (general)     → person → label "intruder"
     │
     ├─── YOLOv8 (weapon)      → knife/gun/etc → label "weapon"
     │       (falls back to general model COCO classes 43/76)
     │
     └─── MediaPipe Pose       → body landmarks → visibility score
                                → label "conflict" if visibility > 0.5

All three run concurrently via asyncio.gather + ThreadPoolExecutor
```

### Adding a custom weapon model

Train or download a YOLOv8 model fine-tuned on weapons, then:

```bash
# Place in models/ directory
cp my_weapon_model.pt models/weapon_yolov8.pt

# Update .env
WEAPON_MODEL_PATH=models/weapon_yolov8.pt
```

The engine will automatically use the weapon-specific model for weapon inference.

### GPU acceleration

```bash
# .env
DEVICE=cuda          # NVIDIA GPU
# DEVICE=mps         # Apple Silicon

# Install CUDA-enabled torch first:
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

---

## Event Classification & Risk Scoring

The risk scorer (`app/cv/risk_scorer.py`) uses a deterministic combinatorial
rule set — no ML required for classification:

| Detections | Severity | Risk Score Range |
|---|---|---|
| None / motion only | low | 0.05 |
| Intruder only | low | 0.20 – 0.55 |
| Conflict only | medium | 0.40 – 0.70 |
| Weapon only | medium | 0.50 – 0.85 |
| Intruder + Weapon | high | 0.75 – 0.95 |
| Intruder + Conflict | high | 0.70 – 0.90 |
| Weapon + Conflict | high | 0.80 – 0.95 |
| Intruder + Weapon + Conflict | critical | 0.95 – 1.00 |

Risk scores are modulated by the individual detection confidence scores.

---

## LLM Integration

Gemini 1.5 Flash is used as an optional intelligence layer:

### Incident summarization
Every detection event automatically receives an LLM-generated summary:
> "At 14:23 UTC, camera Zone-A-01 detected an intruder carrying a weapon with 91% confidence. Aggressive movement was also observed between two individuals. Risk is CRITICAL. Dispatch armed security to Zone A and lock down the premises immediately."

### Natural language queries
```http
POST /api/cv/query
{ "question": "How many weapon detections occurred in the last 6 hours?" }
```

### Disabling LLM
```bash
# .env
LLM_ENABLED=false
```
The system falls back to a template-based summary generator — all other features remain fully functional.

---

## WebSocket Dashboard Stream

Connect with any WebSocket client:

```javascript
// Browser / dashboard
const ws = new WebSocket(
  "ws://localhost:8000/api/dashboard/stream?token=<jwt>&severity=high"
);

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  console.log(msg.type, msg);
  // msg.type: "connected" | "event" | "detection" | "alert" | "pong"
};

// Ping keepalive
setInterval(() => ws.send(JSON.stringify({ type: "ping" })), 30000);

// Filter updates at runtime
ws.send(JSON.stringify({ type: "subscribe", camera_id: "usb-cam-001" }));
```

### Query parameters

| Parameter | Description |
|---|---|
| `token` | JWT access token (required) |
| `camera_id` | Filter to a specific camera |
| `severity` | Filter by severity level |

### Message types

| Type | Payload |
|---|---|
| `connected` | Session info + active filters |
| `detection` | Full CV detection result |
| `event` | Ingested event (from `/api/events/ingest`) |
| `alert` | Push alert confirmation |
| `pong` | Response to ping |
| `error` | Error message |

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | *(required)* | JWT signing key (min 32 chars) |
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DB` | `aegis_db` | Database name |
| `BROKER` | `kafka` | `kafka` or `rabbitmq` |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka servers |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost/` | RabbitMQ URL |
| `GEMINI_API_KEY` | *(optional)* | Enables LLM summaries |
| `LLM_ENABLED` | `true` | Toggle LLM features |
| `YOLO_MODEL_PATH` | `models/yolov8n.pt` | YOLOv8 general model |
| `WEAPON_MODEL_PATH` | `models/weapon_yolov8.pt` | Weapon-specific model |
| `CONFIDENCE_THRESHOLD` | `0.45` | Minimum detection confidence |
| `DEVICE` | `cpu` | `cpu`, `cuda`, or `mps` |
| `FCM_CREDENTIALS_PATH` | `firebase_credentials.json` | Firebase service account |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | JWT access token TTL |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS origins (comma-separated) |
| `RATE_LIMIT_PER_MINUTE` | `120` | Requests per IP per minute |

---

## Deployment

### Docker Compose (Recommended for demo)

```bash
cp .env.example .env
# Edit .env with your SECRET_KEY and API keys

docker compose up -d
docker compose exec backend python scripts/seed_db.py
```

Services started:
- `aegis-backend` → port 8000
- `aegis-mongo` → port 27017
- `aegis-kafka` → port 9092
- `aegis-zookeeper` → internal
- `aegis-mongo-express` → port 8081 (with `--profile dev`)

### Kubernetes

```bash
# Create namespace
kubectl create namespace aegis

# Apply configs
kubectl apply -f k8s/configmap.yaml -n aegis
kubectl apply -f k8s/deployment.yaml -n aegis
kubectl apply -f k8s/ingress.yaml -n aegis

# Check rollout
kubectl rollout status deployment/aegis-backend -n aegis

# Scale manually
kubectl scale deployment aegis-backend --replicas=4 -n aegis
```

The HPA automatically scales between 2–8 pods based on CPU (70%) and memory (80%) utilization.

---

## Demo Flow

The complete demo flow for judges/presentations:

```bash
# Terminal 1: Start server
docker compose up -d
# or: uvicorn app.main:app --reload

# Terminal 2: Seed data
python scripts/seed_db.py

# Terminal 3: Run multi-source demo client
# Simulates phone + laptop + USB webcam simultaneously
python scripts/demo_client.py \
  --url http://localhost:8000 \
  --email operator@aegis.ai \
  --password Operator@1234

# Terminal 4: USB webcam (if physical webcam connected)
# First get a token:
TOKEN=$(curl -s -X POST http://localhost:8000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@aegis.ai","password":"Operator@1234"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

python scripts/usb_webcam_client.py \
  --url http://localhost:8000 \
  --token $TOKEN \
  --camera-id usb-cam-001 \
  --fps 2

# Browser: Open Swagger UI for live API interaction
open http://localhost:8000/docs

# Browser: Connect dashboard WebSocket
# wscat -c "ws://localhost:8000/api/dashboard/stream?token=$TOKEN"
```

### Endpoints to demonstrate live

1. `GET /api/dashboard/stats` — live threat statistics
2. `WS /api/dashboard/stream` — real-time event feed
3. `GET /api/events?severity=high` — high-risk events list
4. `GET /api/dashboard/heatmap` — per-camera event density
5. `POST /api/cv/query` — natural language query via LLM

---

## Testing

```bash
# Install test dependencies (included in requirements.txt)
pip install pytest pytest-asyncio httpx

# Run all tests
pytest

# Run with coverage
pip install pytest-cov
pytest --cov=app --cov-report=term-missing

# Run only unit tests (no I/O)
pytest tests/test_cv.py -v
```

---

## Project Structure

```
aegis-backend/
├── app/
│   ├── main.py                    # FastAPI app factory + lifespan
│   ├── api/
│   │   └── routes/
│   │       ├── cameras.py         # Camera CRUD
│   │       ├── events.py          # Event ingestion + query
│   │       ├── cv.py              # /api/cv/detect — frame processing
│   │       ├── alerts.py          # Push notification management
│   │       ├── dashboard.py       # WebSocket stream + analytics
│   │       └── users.py           # Auth + user management
│   ├── core/
│   │   ├── config.py              # Pydantic settings (env vars)
│   │   ├── security.py            # JWT, password hashing, RBAC
│   │   └── logging.py             # structlog configuration
│   ├── cv/
│   │   ├── engine.py              # YOLOv8 + MediaPipe inference engine
│   │   └── risk_scorer.py         # Combinatorial threat scoring
│   ├── db/
│   │   └── mongodb.py             # Motor async client + index provisioning
│   ├── middleware/
│   │   ├── rate_limit.py          # Sliding window rate limiter
│   │   └── request_id.py          # X-Request-ID tracing
│   ├── models/
│   │   └── enums.py               # Shared enumerations
│   ├── schemas/
│   │   └── schemas.py             # Pydantic v2 request/response models
│   └── services/
│       ├── broker.py              # Kafka / RabbitMQ abstraction
│       ├── fcm_service.py         # Firebase Cloud Messaging
│       ├── llm_service.py         # Gemini LLM integration
│       └── websocket_manager.py   # WebSocket connection registry
├── scripts/
│   ├── seed_db.py                 # Demo data seeder
│   ├── demo_client.py             # Multi-source frame streamer
│   └── usb_webcam_client.py       # OpenCV USB webcam streamer
├── tests/
│   ├── test_cv.py                 # Risk scorer unit tests
│   └── test_api.py                # Integration tests (mocked I/O)
├── k8s/
│   ├── deployment.yaml            # Deployment + Service + HPA
│   ├── configmap.yaml             # ConfigMap + Secret template
│   └── ingress.yaml               # NGINX Ingress + TLS
├── Dockerfile                     # Multi-stage build
├── docker-compose.yml             # Full stack (backend + Mongo + Kafka)
├── requirements.txt
├── pytest.ini
├── .env.example
└── .gitignore
```

---

## Security Notes

- JWT secret must be at least 32 characters — generate with `openssl rand -hex 32`
- Never commit `.env` or `firebase_credentials.json` to version control
- Rate limiting is in-memory — use Redis in multi-instance deployments
- HTTPS is enforced via the Kubernetes Ingress TLS config
- The Docker image runs as non-root user (`aegis`, UID 1001)
- Input validation via Pydantic v2 on all endpoints
- Frame size is limited to 10 MB per request

---

## License

MIT — Built for AEGIS AI Surveillance Platform Demo.
