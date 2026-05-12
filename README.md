# Green Tech: Edge-Computed Crop Monitoring

An end-to-end, local edge-computed agricultural monitoring system. This project captures real-time video from an ESP32-CAM, processes it locally using YOLOv8 for threat detection, and features an AI agronomist powered by the Groq Llama-4-Scout model.

## Tech Stack
* **Frontend:** React.js, WebSockets, rc-slider
* **Backend:** Python FastAPI, SQLite, WebSockets
* **Computer Vision:** OpenCV, Ultralytics YOLOv8n
* **AI Agent:** Groq Vision API (Llama-4-Scout-17B)
* **Hardware:** ESP32 local server

## Features
* **Real-Time Pan/Tilt:** Control camera servos directly from the React dashboard.
* **Intruder & Fire Detection:** YOLOv8 and hardware sensors trigger strict Anti-Spam state machines.
* **Telegram Integration:** Instant push notifications with annotated image captures of intruders.
* **AI Agronomist:** Chat interface to analyze current crop frames and sensor data.

## Setup Instructions
1. Create a Python virtual environment in either `.venv/` or `venv/`.
2. Install backend dependencies:
   `pip install -r backend/requirements.txt`
3. Install frontend dependencies:
   `cd frontend && npm install`
4. Copy `backend/.env.example` to `backend/.env` and fill in the variables you need.
5. Start both services from the project root:
   `./run.sh`

### Notes
* `run.sh` prefers the currently active virtual environment, then falls back to `.venv/`, then `venv/`.
* Hedera logging is optional. If `hedera-sdk-py` or the `HEDERA_*` variables are missing, intruder snapshots are still saved locally in `backend/evidence/`.
* Hardware endpoints can be overridden in `backend/.env` with `ESP32_URL`, `ESP32_CAM_STREAM_URL`, and `MOBILE_NODE_URL`.
