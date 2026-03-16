"""
AEGIS — Integration tests using HTTPX TestClient.
Mocks MongoDB and broker so no external services are needed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

# Patch heavy dependencies before importing app
import sys
sys.modules.setdefault("ultralytics", MagicMock())
sys.modules.setdefault("mediapipe", MagicMock())
sys.modules.setdefault("firebase_admin", MagicMock())
sys.modules.setdefault("firebase_admin.credentials", MagicMock())
sys.modules.setdefault("firebase_admin.messaging", MagicMock())
sys.modules.setdefault("google.generativeai", MagicMock())

from app.main import app  # noqa: E402


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── Health ─────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_health_endpoint(client: AsyncClient):
    with patch("app.main.get_db") as mock_db:
        mock_db.return_value.command = AsyncMock()
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


@pytest.mark.anyio
async def test_root(client: AsyncClient):
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "AEGIS" in resp.json()["name"]


# ── Auth ───────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_register_and_login(client: AsyncClient):
    mock_col = MagicMock()
    mock_col.find_one = AsyncMock(return_value=None)
    mock_col.insert_one = AsyncMock()

    with patch("app.api.routes.users.users_col", return_value=mock_col):
        resp = await client.post("/api/users/register", json={
            "username": "testoperator",
            "email": "test@aegis.ai",
            "password": "SecurePass123",
            "role": "operator",
        })
    assert resp.status_code == 201
    assert resp.json()["email"] == "test@aegis.ai"


# ── CV Risk Scorer (unit, no I/O) ──────────────────────────────────────────────

def test_risk_scorer_intruder_weapon():
    from app.cv.risk_scorer import compute_risk
    from app.models.enums import Severity
    from app.schemas.schemas import Detection

    dets = [
        Detection(label="intruder", confidence=0.91),
        Detection(label="weapon", confidence=0.87),
    ]
    risk, _, severity = compute_risk(dets)
    assert severity == Severity.high
    assert risk >= 0.75


def test_risk_scorer_critical():
    from app.cv.risk_scorer import compute_risk
    from app.models.enums import Severity
    from app.schemas.schemas import Detection

    dets = [
        Detection(label="intruder", confidence=0.95),
        Detection(label="weapon", confidence=0.92),
        Detection(label="conflict", confidence=0.88),
    ]
    risk, _, severity = compute_risk(dets)
    assert severity == Severity.critical
    assert risk >= 0.9
