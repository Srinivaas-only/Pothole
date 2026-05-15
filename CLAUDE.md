# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a three-component system. Each component has its own runtime, language, and deploy target — treat them as separate projects that happen to share a repo.

| Component | What it is | Lang / Stack |
|---|---|---|
| `PotholeNet_ESP32_Firmware/` | Firmware flashed onto an AI-Thinker ESP32-CAM. Boots into Wi-Fi **Access Point** mode (SSID `PotholeNet-AP`), serves MJPEG at `:81/stream` and a JSON `/heartbeat`. | Arduino C++ (`.ino`) |
| `potholenet-backend/` | FastAPI server. Receives JPEG frames, runs **Roboflow pothole** + **YOLOv8n** (humans/vehicles/animals), persists hazard reports in SQLite, serves nearby-hazard queries. Has its own `CLAUDE.md` — read it before touching backend code. | Python 3, FastAPI, SQLAlchemy, ultralytics, roboflow |
| `potholenet-demo/` | Mobile-first React PWA. The phone runs this in a browser, displays the camera feed (ESP32 or phone), pushes GPS to the backend, polls the hazard map, and submits user-confirmed reports. | React 19 + Vite + TS + Tailwind, TF.js (local-fallback inference), framer-motion |

Top-level docs (`PotholeNet_BuildSpec_v2.md`, `PotholeNet_Hardware_Setup.md`) are the design source-of-truth for the app and ESP32 setup respectively. They predate parts of the implementation — when they disagree with code, code wins.

## Commands

### Frontend (`potholenet-demo/`)
```bash
npm install
npm run dev          # Vite dev server (default http://localhost:5173)
npm run build        # tsc + vite build → dist/
npm run preview      # Serve built output
```
No test or lint scripts are wired up.

### Backend (`potholenet-backend/`)
```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000   # reload on DEBUG=true
docker build -t potholenet-backend . && docker run -p 8000:8000 --env-file .env potholenet-backend
```
Configuration via `.env` (`ROBOFLOW_API_KEY` required for pothole model — server still starts without it; see backend CLAUDE.md "Degradation behavior"). Interactive docs at `/docs`. No tests, no linter.

### Firmware (`PotholeNet_ESP32_Firmware/`)
Built and flashed via the **Arduino IDE 2.x**, not the CLI:
- Board: *AI Thinker ESP32-CAM*, Partition: *Huge APP (3MB No OTA/1MB SPIFFS)*, PSRAM: Enabled
- Copy `secrets.h.example` → `secrets.h` (gitignored) and fill in `WIFI_SSID` / `WIFI_PASSWORD` before compiling.
- After flashing, the board hosts a hotspot at `http://192.168.4.1` (status, `/capture`, `/control`, `/heartbeat`); MJPEG stream is on port `81`.

## System architecture — what the three components actually do together

```
            ┌──────────────────────────┐
            │ ESP32-CAM (AP mode)      │       Phone connects to ESP32 Wi-Fi.
            │ 192.168.4.1              │       NO internet on this network.
            │  :81/stream   MJPEG      │◀──────────┐
            │  /heartbeat               │           │
            │  /control?led=…&servo=…   │           │
            └──────────────────────────┘           │
                                                    │
            ┌──────────────────────────┐           │   <img src=":81/stream">
            │ Phone browser (PWA)      │           │   fetch /heartbeat every 2s
            │ potholenet-demo          │───────────┘
            │                          │
            │ Two independent clients: │   ┌──────────────────────────┐
            │  • ESP32 over Wi-Fi      │   │ Backend (FastAPI)         │
            │  • Backend over LAN/cell │──▶│  POST /location/update    │
            │                          │   │  POST /detect/dual-mode   │
            │ Hooks:                   │   │  POST /reports            │
            │  useESPHeartbeat         │   │  GET  /hazards            │
            │  useDetection (BE or TF) │   │  GET  /health             │
            │  useGPS, useHazards      │   └──────────────────────────┘
            └──────────────────────────┘
```

Two non-obvious consequences of this topology:

1. **The phone usually can't reach the backend and the ESP32 at the same time.** When connected to `PotholeNet-AP`, the phone has no path to the internet or LAN backend unless the phone's cellular data is on and the OS routes `192.168.4.1` over Wi-Fi while routing everything else over cellular (Android usually does this; iOS sometimes doesn't). The demo treats backend reachability and ESP32 reachability as independent — see the two heartbeats in `App.tsx`. Do not assume one implies the other.
2. **The backend has no path to the ESP32.** Frames flow phone → backend, never camera → backend. The demo captures from the chosen source (`cameraSource: "phone" | "esp32"` in settings), `<canvas>`-encodes to JPEG, and POSTs to `/detect/dual-mode`. The backend's `/stream` route is for the *phone-uploaded* frame buffer, not the ESP32 directly.

## Cross-component contracts that must stay in sync

These are interfaces where a change on one side silently breaks the other — there is no schema generator binding them.

- **`/detect/dual-mode` response shape.** Backend route in `app/routes/detect.py` returns `{pothole, humans, vehicles, animals, alert, mode, velocity_kmh}`, each detection category being `{detected, count, details: [...]}`. The frontend `DualModeDetectionResponse` interface in `potholenet-demo/src/lib/api.ts` mirrors this, and `useDetection.ts` unpacks `result.humans.details`, etc. Renaming a category field requires changing both files.
- **GPS push.** Frontend `App.tsx` calls `updateLocation()` every 5s with `{latitude, longitude, speed_kmh}`. Backend `/location/update` writes into the module-global `app.main.gps_state`. The `/detect/dual-mode` route reads `gps_state["velocity_kmh"]` to pick `reverse` (skip pothole) vs `driving` mode. **There is no per-request GPS** — if the phone hasn't pushed location recently, mode auto-selection silently falls back to a default. This also means `--workers > 1` breaks mode selection (state isn't shared across workers).
- **ESP32 endpoints.** The firmware exposes `/heartbeat`, `:81/stream`, `/capture`, and `/control?led=...&servo=...`. The demo (`lib/esp32.ts`) hardcodes the same paths. The firmware's `ENABLE_SERVO`/`SERVO_PIN` and the demo's pan/center buttons are linked — don't change one without the other.

## The alert state machine

`PotholeNet_BuildSpec_v2.md` §3 defines **7 alert states** (REVERSE_CLEAR / REVERSE_APPROACHING / REVERSE_DANGER / REVERSE_PERSON / REVERSE_POTHOLE / DRIVING / DISCONNECTED). The current implementation in `potholenet-demo/src/lib/alertLogic.ts` is a simplified variant — fewer scene names (`CLEAR/APPROACHING/DANGER/PERSON/POTHOLE/DRIVING/DISCONNECTED`) and different vehicle-bbox thresholds (`25000` / `8000` px²) than the spec's "30% / 10% of frame". The spec is aspirational; the code is what ships.

Key invariants worth preserving when modifying `deriveAlertState`:
- **Person/animal detection bypasses distance** — any human/dog/cat → `PERSON` immediately. The spec's §3 "Why this exists" calls this the IP's "ethical value module"; do not gate it behind a bbox-size or confidence check.
- **DISCONNECTED is not CLEAR.** A green border with a frozen frame is the worst failure mode. The check for `cameraConnected` comes before any detection logic.
- **DRIVING is speed-gated at 5 km/h.** Above that, the predictive hazard-card flow runs and the reverse states are suppressed.

## Detection has two paths — pick deliberately

`useDetection.ts` runs **either** a backend POST loop (~3 FPS, `useBackend=true`) **or** a local TF.js COCO-SSD loop (~5 FPS, `useBackend=false`). The toggle is the `useBackendDetection` setting. Each path produces the same `Detection[]` shape so downstream code is identical, but:
- **Local TF.js cannot detect potholes.** COCO-SSD has no pothole class. If backend mode is off, the POT pill never lights.
- **Backend mode requires backend reachability.** When the phone is on the ESP32 AP with no other route to the backend, backend mode silently produces zero detections.

## Persistence (backend) — two separate hazard tables

This trips people up; the backend `CLAUDE.md` covers it in depth but in summary:
- `PotholeDetection` — written automatically by `/detect/dual-mode` whenever the pothole model fires. Raw ML telemetry. Uses the cached phone GPS.
- `HazardReport` — written by user-confirmed `POST /reports`. **Manual dedup** scans every row within `DEDUP_RADIUS_M` (5m) / `DEDUP_WINDOW_DAYS` (30d) and bumps `severity_score` instead of inserting. `GET /hazards` queries *this* table only.
- `RetrainingContribution` — false-negative submissions; image files in `retraining_queue/`.

Spatial queries are in-Python (`haversine()`), not SQL. There are no migrations; schema changes require dropping `potholenet.db`.

## Mobile-first PWA constraints

The demo is meant to run **full-screen on a phone in portrait, often offline after first load.** Constraints from `PotholeNet_BuildSpec_v2.md` §2 that show up across the code:
- Viewport meta blocks zoom; `env(safe-area-inset-*)` is used on the status bar and tab bar.
- Wake lock is requested via `useWakeLock` while the camera tab is active.
- Haptics (`useVibration`) and Web Audio beeps (`useAudioCues`) are state-driven and **must be user-toggleable** — they're driving-distraction-sensitive.
- The IP / disclaimer footer in the settings panel ("Implements UM IP PI 2017704203 — Assistive system. Driver retains full control.") is required attribution; do not remove it.

## Secrets and gitignored files

- `PotholeNet_ESP32_Firmware/secrets.h` — Wi-Fi SSID/password. Gitignored. The `.example` is the template.
- `potholenet-backend/.env` — `ROBOFLOW_API_KEY`, etc. Gitignored.
- `*.db`, `*.pt`, `*.onnx`, `retraining_queue/*.jpg` — gitignored.
