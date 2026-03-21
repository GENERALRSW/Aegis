# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Aegis Dashboard** is a React SPA for campus security intelligence. It integrates live camera feeds, computer vision detection, facial recognition, incident management, and AI-generated reports. The backend is a separate service deployed on Railway.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build
npm run preview   # Preview production build
```

No test suite is currently configured.

## Environment Variables

Create a `.env` file in the root:
```
VITE_API_URL=<backend URL for production>
```

> **Security note:** API keys (Anthropic, Gemini, etc.) must NEVER be added here.
> Any `VITE_*` variable is embedded in the browser bundle and visible to anyone.
> All AI/LLM calls go through the backend — add API keys to the backend `.env` only.

In development, `/api/*` requests are proxied to `https://aegis-backend-2-production.up.railway.app` (configured in `vite.config.js`).

## Architecture

### Service Layer (`src/services/`)
All backend communication is abstracted here. `api.js` is the base HTTP client — it automatically attaches the `aegis_token` Bearer token from localStorage and redirects to `/login` on 401. All other services use this client.

- `authService.js` — login, register, get current user
- `alertService.js` — alerts and CV detection events
- `cameraService.js` — camera CRUD and status
- `aiService.js` — AI helpers (incident summaries, report narratives, risk assessment). All calls go through the backend `/api/cv/query` endpoint — no API keys in the frontend.
- `analyticsService.js` — statistics and trend data
- `missingPersonsService.js` — missing/restricted person profiles and facial recognition
- `reportService.js` — report storage in localStorage (intentional for prototype)

### Routing & Auth (`src/App.jsx`)
React Router v6. All dashboard routes are wrapped in `<ProtectedRoute>`, which checks for `aegis_token` in localStorage. Unauthenticated users are redirected to `/login`.

Routes: `/overview`, `/alerts`, `/alerts/:id`, `/cameras`, `/missing-persons`, `/query`, `/analytics`, `/reports`, `/settings`.

### Layout (`src/components/DashboardLayout.jsx`)
Shared shell for all authenticated pages: sidebar navigation + main content area. Pages are rendered as children.

### Path Aliases
Configured in both `jsconfig.json` and `vite.config.js`:
- `@/` → `src/`
- `@components/` → `src/components/`
- `@constants/` → `src/constants/`
- `@assets/` → `src/assets/`

### Camera Input Paths
There are three distinct ways a camera feed reaches the dashboard, each with its own component:

1. **`WebcamFeed.jsx`** — Single laptop webcam. Used on the Cameras page (`/cameras`). Registers the camera, sends JPEG frames to `/api/cv/detect/json` every 2 seconds, displays CV results.

2. **`MultiCameraFeed.jsx` + `MobileCameraSlot.jsx`** — Used on the Overview page. Supports up to 4 simultaneous slots. Each `CameraSlot` is identical in logic to `WebcamFeed`. `MobileCameraSlot` instead awaits a WebRTC peer connection: it generates a room ID, opens a WebSocket to `/ws/signal`, and streams video from a phone via offer/answer/ICE exchange.

3. **`PhoneCamera.jsx`** (`/mobile` route, not in the main nav) — A standalone mobile-first page meant to be opened on an iPhone via QR code or shared link. It authenticates with email/password (or a `?t=` token in the URL), captures from the rear camera, and sends frames to the same `/api/cv/detect/json` endpoint.

### CV Detection Data Shape
`detectJSON()` returns `{ detections, severity, risk_score, summary, ... }`.

Each detection in `detections[]` is one of:
- **Bounding box type** (intruder, weapon): `{ label, confidence, bounding_box: { x1, y1, x2, y2, width, height } }` — pixel coords relative to the captured frame size.
- **Keypoint type** (conflict/pose): `{ label, confidence, keypoints: [{ x, y, visibility }, ...] }` — 33 MediaPipe landmarks, `x`/`y` normalized 0–1, `visibility` 0–1.

### Styling
Each component and page has a co-located `.css` file. `SharedStyles.css` contains cross-cutting classes (`.page-title`, `.badge-*`, `.btn`, etc.) — import it in any new page that needs those utilities. Theme tokens (colors, spacing) live in `src/index.css` as CSS variables (`--weapon`, `--conflict`, `--intruder`, `--online`, `--muted`, etc.).

### Key Design Decisions
- AI calls are proxied through the backend (`POST /api/cv/query`) — API keys never leave the server.
- Incident reports are persisted to **localStorage**, not the backend (prototype limitation — swap `reportService.js` for a backend endpoint before production).
- Feature flags for facial recognition are fetched from `/api/security/features/`.
- Frame-sending loops use a `sendingRef` (not state) as an overlap guard so the closure never goes stale across re-renders.
- `api.js` exports `postFormData` for multipart uploads (face photos) — it skips the `Content-Type: application/json` header so the browser sets the correct boundary automatically.
