# AgroGuard — Edge-Computed Agricultural Monitoring & Security System

> **Python · FastAPI · React 19 · YOLOv8n · ESP32 · OpenCV · Hedera Hashgraph · Groq LLM**  
> *Apr 2026 · LPU Embedded Systems Project*

---

## Overview

AgroGuard is a **fully local, edge-first** agricultural IoT system that fuses real-time computer vision, multi-sensor telemetry, AI-driven crop advisory, and immutable blockchain forensics — all running on commodity hardware with zero cloud dependency for core operation.

A stationary **ESP32 sensor board** exposes a JSON HTTP endpoint for DHT22, soil moisture, pH, and flame sensor readings. A second roving **ESP32 mobile node** adds GPS-tagged BMP280 (temperature + pressure) and 4-channel moisture readings, accessible over the same LAN. A **FastAPI backend** on a local host asynchronously polls both nodes, stores data in SQLite, and runs **YOLOv8n** inference on a live MJPEG stream from an **ESP32-CAM** module — all concurrently without blocking the main event loop.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     LOCAL NETWORK (192.168.1.x)             │
│                                                             │
│  ESP32-CAM (:81/stream) ──────────────────────────────┐    │
│  ESP32 Sensor Node (:7070/data) ──┐                   │    │
│  ESP32 Mobile Node (:7070/data) ──┘                   ▼    │
│                              FastAPI Backend (:8000)        │
│                              ┌──────────────────────────┐   │
│                              │  AsyncIO Polling Loop     │   │
│                              │  OpenCV + YOLOv8n Thread  │   │
│                              │  SQLite Sensor Store      │   │
│                              │  WebSocket Alert Manager  │   │
│                              │  Groq LLM Chat Engine     │   │
│                              │  Hedera Evidence Worker   │   │
│                              └──────────┬───────────────┘   │
│                                         │                   │
│                              React PWA Dashboard (:5173)    │
└─────────────────────────────────────────────────────────────┘
                                          │
                              ┌───────────┴────────────┐
                        Telegram Bot API        Hedera Hashgraph
                        (alert + frame)         (SHA-256 forensics)
```

---

## Hardware Stack

| Component | Role | Static IP |
|---|---|---|
| ESP32-CAM (OV2640) | MJPEG stream at 320×240 QVGA, PSRAM-buffered, 2 framebuffers | `192.168.1.2` |
| ESP32 Sensor Node | DHT22 · Soil Moisture · pH · Flame sensors → JSON HTTP | `192.168.1.3` |
| ESP32 Mobile Node | BMP280 · TinyGPS++ · 4×ADC moisture → GPS-tagged JSON HTTP | `192.168.1.4` |
| Host Machine | FastAPI + YOLOv8n inference + React frontend | `192.168.1.10` |

All nodes connect to a single static SSID with reserved IPs — no DHCP, no mDNS required.

---

## Key Technical Features

### 1 · Dual-State Persistence State Machine (False-Positive Elimination)
YOLOv8n at `conf=0.5` runs on every 3rd frame at `imgsz=320`. Raw detections are **never** acted on immediately. A two-variable state machine (`threat_start_time`, `threat_last_seen`) enforces:
- **3.0-second continuous-presence window** before transitioning `SAFE → ALERT`
- **1.0-second micro-blink grace period** — a detection gap shorter than 1 s resets no timers, preventing flicker from shadows or brief occlusions
- Symmetric **3.0-second clear-scene verification** before transitioning `ALERT → SAFE`

This eliminates 100% of single-frame false positives at the cost of a deterministic 3-second latency budget.

### 2 · WebSocket Alert Bus with Race-Condition-Free Initial Sync
`/ws/alerts` uses a `ConnectionManager` class that, on each new WebSocket accept, **immediately pushes the current fire and intruder state** before the client sends a single message. This prevents the UI from showing a stale "SAFE" state if a client connects mid-alert. The video processing runs in a `daemon` thread; cross-thread alert dispatch uses `asyncio.run_coroutine_threadsafe()` against the captured event loop reference.

### 3 · Blockchain Forensic Evidence Pipeline
On every confirmed intruder state transition:
1. The clean (pre-annotation) frame is JPEG-encoded and SHA-256 hashed (`hashlib`).
2. An `IntruderEvidenceWorker` thread (background queue, 10 s cooldown gate) saves the image to `backend/evidence/` and writes a JSON message `{"type":"INTRUDER","hash":"...","local_time":"..."}` to a **Hedera Hashgraph HCS topic** via `hedera-sdk-py`.
3. The resulting `topicSequenceNumber` and `consensusTimestamp` are stored in a local `evidence.db` SQLite table — providing tamper-evident, externally verifiable proof of intrusion.

### 4 · Groq Multimodal AI Chat
The `/api/chat` endpoint injects:
- The **latest clean camera frame** (base64 JPEG) as a vision input
- Live sensor readings (pH, temperature, humidity, moisture) as a system-prompt context block
- Full conversation history for multi-turn coherence

Responses from `meta-llama/llama-4-scout-17b-16e-instruct` are constrained to Markdown tables with columns `Parameter | Status | Recommended Action` — ensuring structured, parseable advisory output rather than free-form prose.

### 5 · Resilient Camera Capture Thread
`VideoCapture` is managed in a **master reconnect loop**: a 5-second initial connection window tries `ESP32_CAM_STREAM_URL`; on failure, falls back to local webcam (`/dev/video0`). `CAP_PROP_BUFFERSIZE=1` discards stale buffered frames on every (re)connect. Frame drops trigger a full `cap.release()` + re-init cycle rather than a simple retry, preventing the decoder from accumulating corrupted state.

### 6 · Mobile Node — GPS-Tagged Field Telemetry
The mobile ESP32 runs an interrupt-driven architecture: a `FALLING` edge ISR on GPIO 14 sets a `volatile bool buttonPressed` flag, which the main loop services to snapshot 4-channel ADC soil moisture + BMP280 readings. GPS (TinyGPS++ over HardwareSerial UART2) updates continuously in the background. The backend polls `/data` every 5 s, deduplicates by JSON equality, and logs changes to `mobile_nodes.db`.

### 7 · 24-Hour Hourly-Binned Sensor History
The `/api/sensors/history` endpoint queries the last 86 400 seconds from SQLite, buckets readings by `YYYY-MM-DD HH:00` hour key, and returns per-feed averaged arrays — giving the frontend clean Chart.js time-series data without client-side aggregation.

---

## Software Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 · FastAPI · Uvicorn (async) · httpx |
| CV / ML | OpenCV · Ultralytics YOLOv8n (`yolov8n.pt`) |
| Database | SQLite (`sensors.db`, `mobile_nodes.db`, `evidence.db`) |
| Blockchain | Hedera Hashgraph HCS · `hedera-sdk-py` |
| AI Chat | Groq API · `meta-llama/llama-4-scout-17b-16e-instruct` |
| Notifications | Telegram Bot API (text + photo) |
| Frontend | React 19 · Vite 8 · Chart.js · Framer Motion · Howler.js |
| PWA | `vite-plugin-pwa` (service worker, offline shell) |
| Firmware | Arduino Core (ESP32) · `esp-camera` · Adafruit BMP280 · TinyGPS++ |

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in:

```env
GROQ_API_KEY=your_groq_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

HEDERA_ACCOUNT_ID=0.0.xxxxxx
HEDERA_PRIVATE_KEY=302e...
HEDERA_TOPIC_ID=0.0.xxxxxx
HEDERA_NETWORK=testnet

ESP32_URL=http://192.168.1.3:7070
ESP32_CAM_STREAM_URL=http://192.168.1.2:81/stream
MOBILE_NODE_URL=http://192.168.1.4:7070/data
```

---

## Running the Project

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Or use the provided convenience script:
```bash
chmod +x run.sh && ./run.sh
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/sensors/live` | Latest sensor snapshot |
| `GET` | `/api/sensors/history` | 24-hour hourly averages (all feeds) |
| `GET` | `/api/sensors/history/{feed}` | Single feed history |
| `GET` | `/api/mobile/latest` | Last 10 mobile node readings |
| `GET` | `/api/video_feed` | MJPEG stream with YOLOv8n annotations |
| `POST` | `/api/control/camera` | Pan/tilt servo control |
| `POST` | `/api/control/relay` | Relay toggle (irrigation) |
| `POST` | `/api/chat` | Multimodal AI crop advisory |
| `WS` | `/ws/alerts` | Real-time fire + intruder push alerts |

---

## Repository Structure

```
agro-guard/
├── backend/
│   ├── main.py                   # FastAPI app, polling loops, CV thread
│   ├── blockchain/
│   │   ├── hedera_client.py      # Hedera HCS topic submission
│   │   ├── worker.py             # Evidence queue, SHA-256, DB logging
│   │   └── hash_utils.py
│   ├── evidence/                 # Saved intruder JPEG frames
│   └── requirements.txt
├── ep32_cam/
│   ├── esp32_cam.ino             # ESP32-CAM firmware (static IP, MJPEG server)
│   └── board_config.h
├── esp32_mobile_node/
│   └── esp32_movile_node.ino     # Mobile node firmware (GPS + BMP280 + ADC)
└── frontend/
    └── src/
        ├── App.jsx               # Main dashboard, WebSocket client, Chart.js
        └── components/
            ├── alerts/           # Alert stage UI + audio hooks
            └── magic/            # Sensor cards, typewriter, welcome banner
```

---

*Built at Lovely Professional University · ECE Department · 2026*
