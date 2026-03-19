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

### Layout (`src/components/DashboardLayout.jsx`)
Shared shell for all authenticated pages: sidebar navigation + main content area. Pages are rendered as children.

### Path Aliases
Configured in both `jsconfig.json` and `vite.config.js`:
- `@/` → `src/`
- `@components/` → `src/components/`
- `@constants/` → `src/constants/`
- `@assets/` → `src/assets/`

### Key Design Decisions
- AI calls are proxied through the backend (`POST /api/cv/query`) — API keys never leave the server.
- Incident reports are persisted to **localStorage**, not the backend (prototype limitation — swap `reportService.js` for a backend endpoint before production).
- Feature flags for facial recognition are fetched from `/api/security/features/`.
