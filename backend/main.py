import os
import time
import asyncio
import cv2
import threading
import base64
import sqlite3
import json
from typing import List, Dict, Any, Optional
import socket
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv
from ultralytics import YOLO
from datetime import datetime, timedelta

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "fflags;nobuffer+ignidx+igndts|analyzeduration;0|timeout;5000000"

load_dotenv()

app = FastAPI(title="Green Tech Edge API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = "meta-llama/llama-4-scout-17b-16e-instruct"
ESP32_URL = os.getenv("ESP32_URL", "http://192.168.1.3:7070").rstrip("/")
ESP32_SENSOR_URL = f"{ESP32_URL}/data"
ESP32_CAM_STREAM_URL = os.getenv("ESP32_CAM_STREAM_URL", "http://192.168.1.2:81/stream")
MOBILE_NODE_URL = os.getenv("MOBILE_NODE_URL", "http://192.168.1.4:7070/data")
BACKEND_PORT = os.getenv("BACKEND_PORT", "8000")
FRONTEND_PORT = os.getenv("FRONTEND_PORT", "5173")

# Telegram Secrets
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

def detect_public_host_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 1))
            return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"

def describe_exception(exc: Exception) -> str:
    detail = str(exc).strip()
    if detail:
        return f"{exc.__class__.__name__}: {detail}"
    return repr(exc)

PUBLIC_HOST_IP = os.getenv("PUBLIC_HOST_IP") or detect_public_host_ip()

print("="*50)
print(f"🌍 STATIC NETWORK ACCESS URLS:")
print(f"💻 Frontend (React): http://{PUBLIC_HOST_IP}:{FRONTEND_PORT}")
print(f"⚙️ Backend (API):    http://{PUBLIC_HOST_IP}:{BACKEND_PORT}")
print("="*50)

from blockchain.worker import IntruderEvidenceWorker

async def send_telegram(message: str, image_frame=None):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[Telegram Warning] Secrets missing in .env! Skipping message.")
        return
    
    async with httpx.AsyncClient() as client:
        try:
            if image_frame:
                url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
                files = {'photo': ('frame.jpg', image_frame, 'image/jpeg')}
                data = {'chat_id': TELEGRAM_CHAT_ID, 'caption': message}
                await client.post(url, data=data, files=files)
                print(f"[Telegram] Photo sent: {message}")
            else:
                url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
                data = {'chat_id': TELEGRAM_CHAT_ID, 'text': message}
                await client.post(url, json=data)
                print(f"[Telegram] Text sent: {message}")
        except Exception as e:
            print(f"[Telegram Error] {e}")

# --- SQLite Setup ---
DB_PATH = "sensors.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS sensor_data (
            timestamp INTEGER PRIMARY KEY,
            temp REAL,
            hum REAL,
            soil REAL,
            ph REAL,
            fire INTEGER
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# Global State Trackers for Synchronization
current_fire_state = 0
current_state = 0  

# --- WS Alert Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        
        # FORCE INITIAL SYNC ON CONNECT TO PREVENT RACE CONDITIONS
        if current_fire_state == 1:
            await websocket.send_text("FIRE_ALERT")
        else:
            await websocket.send_text("FIRE_SAFE")

        if current_state == 1:
            await websocket.send_text("INTRUDER_ALERT")
        else:
            await websocket.send_text("INTRUDER_SAFE")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# --- Mobile Node Setup ---
MOBILE_DB_PATH = "mobile_nodes.db"

def init_mobile_db():
    conn = sqlite3.connect(MOBILE_DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            m1 INTEGER,
            m2 INTEGER,
            m3 INTEGER,
            m4 INTEGER,
            temp REAL,
            pressure REAL,
            lat REAL,
            lon REAL
        )
    ''')
    conn.commit()
    conn.close()

init_mobile_db()

last_mobile_data_str = ""

async def poll_mobile_node():
    global last_mobile_data_str
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                resp = await client.get(MOBILE_NODE_URL)
                if resp.status_code == 200:
                    data = resp.json()
                    new_data_str = json.dumps(data, sort_keys=True)
                    if new_data_str != last_mobile_data_str:
                        last_mobile_data_str = new_data_str
                        ts_str = datetime.utcnow().isoformat()
                        conn = sqlite3.connect(MOBILE_DB_PATH)
                        c = conn.cursor()
                        c.execute(
                            "INSERT INTO readings (timestamp, m1, m2, m3, m4, temp, pressure, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (ts_str, data.get("m1",0), data.get("m2",0), data.get("m3",0), data.get("m4",0), data.get("temp",0.0), data.get("pressure",0.0), data.get("lat",0.0), data.get("lon",0.0))
                        )
                        conn.commit()
                        conn.close()
            except httpx.RequestError as e:
                pass
            except Exception as e:
                pass
            await asyncio.sleep(5.0)

@app.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

global_ws_loop = None
intruder_evidence_worker = IntruderEvidenceWorker()

@app.on_event("startup")
async def startup_event():
    global global_ws_loop
    global_ws_loop = asyncio.get_event_loop()
    intruder_evidence_worker.start()
    asyncio.create_task(edge_polling_loop())
    asyncio.create_task(poll_mobile_node())

def send_alert_sync(message: str):
    if global_ws_loop and not global_ws_loop.is_closed():
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), global_ws_loop)

# --- Edge Polling Loop ---
async def edge_polling_loop():
    global current_fire_state
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                resp = await client.get(ESP32_SENSOR_URL)
                if resp.status_code == 200:
                    data = resp.json()
                    temp = data.get("temp", 0)
                    hum = data.get("hum", 0)
                    soil = data.get("soil", 0)
                    ph = data.get("ph", 0)
                    fire = data.get("fire", 0)
                    
                    conn = sqlite3.connect(DB_PATH)
                    c = conn.cursor()
                    ts = int(time.time())
                    c.execute(
                        "INSERT INTO sensor_data (timestamp, temp, hum, soil, ph, fire) VALUES (?, ?, ?, ?, ?, ?)",
                        (ts, temp, hum, soil, ph, fire)
                    )
                    conn.commit()
                    conn.close()
                    
                    # Fire Status Anti-Spam State Machine
                    if fire == 1 and current_fire_state == 0:
                        current_fire_state = 1
                        print("[ALERT] Polled Edge: Fire Detected!")
                        await manager.broadcast("FIRE_ALERT")
                        asyncio.create_task(send_telegram("🔥 FIRE DETECTED!"))
                    elif fire == 0 and current_fire_state == 1:
                        current_fire_state = 0
                        print("[RESTORE] Polled Edge: Fire Safe.")
                        await manager.broadcast("FIRE_SAFE")
                        asyncio.create_task(send_telegram("✅ Fire safely extinguished."))

            except httpx.RequestError as e:
                print(f"[EDGE WARNING] Failed to connect to Sensor Board at {ESP32_SENSOR_URL}: {describe_exception(e)}")
                # Pass zero arrays softly ensuring local graph data continues printing empty rows
            except Exception as e:
                pass
                
            await asyncio.sleep(5.0)

# --- Global Frame & Inference ---
latest_clean_frame = None
global_latest_frame = None
frame_lock = threading.Lock()

try:
    model = YOLO("yolov8n.pt") 
except Exception as e:
    print(f"Error loading YOLO: {e}")
    model = None

threat_start_time = None
threat_last_seen = None
safe_start_time = None
safe_last_seen = None

def video_processor_loop():
    global latest_clean_frame, current_state, global_latest_frame
    global threat_start_time, threat_last_seen, safe_start_time, safe_last_seen

    # FORCE 5-SECOND INITIAL CONNECTION RETRY LOOP
    cap = None
    start_time = time.time()
    print(f"Attempting initial connection to ESP32-CAM at {ESP32_CAM_STREAM_URL}...")
    while time.time() - start_time < 5.0:
        cap = cv2.VideoCapture(ESP32_CAM_STREAM_URL)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # CRITICAL: discard stale buffered frames
            print("✅ Successfully connected to ESP32-CAM!")
            break
        print("⏳ Connection refused or delayed, retrying...")
        if cap:
            cap.release()
        time.sleep(0.5)

    # FALLBACK LOGIC AFTER 5 SECONDS
    if not cap or not cap.isOpened():
        print("⚠️ 5 Seconds elapsed. ESP32-CAM unreachable. Falling back to local webcam (0).")
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("❌ CRITICAL: No camera sources available.")
            return
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    print("✅ Video stream connected successfully.")

    frame_count = 0
    last_annotated = None

    while True:  # MASTER RECONNECT LOOP — keeps thread alive forever
        print("[OpenCV] Inner frame-loop starting on active cap...")

        while True:  # FRAME READING LOOP
            success, frame = cap.read()
            if not success:
                print("⚠️ Frame drop or overread detected. Destroying and restarting connection...")
                cap.release()
                break  # Break to master loop to fully re-init cap

            frame_count += 1
            clean_frame = frame.copy()
            current_time = time.time()
            annotated_frame = frame.copy()

            if frame_count % 3 == 0 and model is not None:
                results = model.predict(clean_frame, imgsz=320, conf=0.5, verbose=False)
                annotated_frame = results[0].plot()
                last_annotated = annotated_frame

                classes = results[0].boxes.cls.tolist()
                names = model.names

                anomaly_detected = False
                for c_id in classes:
                    if names[int(c_id)] != 'potted plant':
                        anomaly_detected = True
                        break

                if current_state == 0:
                    if anomaly_detected:
                        threat_last_seen = current_time
                        if threat_start_time is None:
                            threat_start_time = current_time
                        else:
                            if current_time - threat_start_time >= 3.0:
                                current_state = 1
                                threat_start_time = None
                                threat_last_seen = None
                                send_alert_sync("INTRUDER_ALERT")
                                intruder_evidence_worker.enqueue_intruder_frame(clean_frame, current_time)
                                _, ann_buf = cv2.imencode('.jpg', annotated_frame)
                                if global_ws_loop and not global_ws_loop.is_closed():
                                    asyncio.run_coroutine_threadsafe(
                                        send_telegram("🚨 INTRUDER DETECTED!", ann_buf.tobytes()),
                                        global_ws_loop
                                    )
                    else:
                        if threat_last_seen is not None and (current_time - threat_last_seen > 1.0):
                            threat_start_time = None
                            threat_last_seen = None

                elif current_state == 1:
                    if not anomaly_detected:
                        safe_last_seen = current_time
                        if safe_start_time is None:
                            safe_start_time = current_time
                        else:
                            if current_time - safe_start_time >= 3.0:
                                current_state = 0
                                safe_start_time = None
                                safe_last_seen = None
                                intruder_evidence_worker.reset_event_gate()
                                send_alert_sync("INTRUDER_SAFE")
                                if global_ws_loop and not global_ws_loop.is_closed():
                                    asyncio.run_coroutine_threadsafe(
                                        send_telegram("✅ Area clear.", None),
                                        global_ws_loop
                                    )
                    else:
                        if safe_last_seen is not None and (current_time - safe_last_seen > 1.0):
                            safe_start_time = None
                            safe_last_seen = None
            else:
                if last_annotated is not None:
                    annotated_frame = last_annotated

            # Dynamic proportional overlay scaling
            h, w = frame.shape[:2]
            scale_factor = w / 1280.0
            dynamic_font_scale = max(0.4, 1.0 * scale_factor)
            dynamic_thickness = max(1, int(2 * scale_factor))
            margin_x = max(10, int(30 * scale_factor))
            margin_y = max(20, int(40 * scale_factor))
            line_spacing = max(15, int(35 * scale_factor))

            state_str = "STATE: 1 (ALERT)" if current_state == 1 else "STATE: 0 (SAFE)"
            color = (0, 0, 255) if current_state == 1 else (0, 255, 0)
            cv2.putText(annotated_frame, state_str, (margin_x, margin_y), cv2.FONT_HERSHEY_SIMPLEX, dynamic_font_scale, color, dynamic_thickness)

            analyzing_str = ""
            if current_state == 0 and threat_start_time is not None:
                elapsed = current_time - threat_start_time
                analyzing_str = f"ANALYZING: Threat detected {elapsed:.1f}s"
            elif current_state == 1 and safe_start_time is not None:
                elapsed = current_time - safe_start_time
                analyzing_str = f"ANALYZING: Safe verification {elapsed:.1f}s"

            if analyzing_str:
                cv2.putText(annotated_frame, analyzing_str, (margin_x, margin_y + line_spacing), cv2.FONT_HERSHEY_SIMPLEX, dynamic_font_scale * 0.8, (0, 255, 255), dynamic_thickness)

            # Save clean frame for AI chat
            _, clean_buffer = cv2.imencode('.jpg', clean_frame)
            with frame_lock:
                latest_clean_frame = clean_buffer.tobytes()

            # Encode final annotated frame once → write to global buffer (thread-safe)
            ret_enc, ann_buffer = cv2.imencode('.jpg', annotated_frame)
            if ret_enc:
                with frame_lock:
                    global_latest_frame = ann_buffer.tobytes()

            time.sleep(0.01)

        # Master loop: destroy poisoned cap and fully re-init
        print("[OpenCV] Re-initializing VideoCapture after connection drop...")
        time.sleep(2)
        cap = cv2.VideoCapture(ESP32_CAM_STREAM_URL)
        if not cap.isOpened():
            print("⚠️ ESP32-CAM still unreachable. Retrying webcam fallback...")
            cap = cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Always flush buffer on reconnect

threading.Thread(target=video_processor_loop, daemon=True).start()

# --- ESP32 Controller Proxy Endpoints ---
class CameraControl(BaseModel):
    horizontal: Optional[int] = None
    vertical: Optional[int] = None

class RelayControl(BaseModel):
    relay: int

@app.post("/api/control/camera")
async def control_camera(cmd: CameraControl):
    payload = {}
    if cmd.horizontal is not None:
        payload["horizontal"] = cmd.horizontal
    if cmd.vertical is not None:
        payload["vertical"] = cmd.vertical
    
    async with httpx.AsyncClient() as client:
        try:
            await client.post(f"{ESP32_URL}/control", json=payload)
        except Exception:
            pass # Non strict edge
    return {"status": "ok", "payload": payload}

@app.post("/api/control/relay")
async def control_relay(cmd: RelayControl):
    async with httpx.AsyncClient() as client:
        try:
            await client.post(f"{ESP32_URL}/control", json={"relay": cmd.relay})
        except Exception:
            pass
    return {"status": "ok", "relay": cmd.relay}

# --- Database & Historical Resolvers ---
@app.get("/api/sensors/live")
async def get_live_sensors():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT temp, hum, soil, ph FROM sensor_data ORDER BY timestamp DESC LIMIT 1")
    row = c.fetchone()
    conn.close()
    if row:
        return {"temperature": row[0], "humidity": row[1], "moisture": row[2], "ph": row[3]}
    return {"temperature": "N/A", "humidity": "N/A", "moisture": "N/A", "ph": "N/A"}

@app.get("/api/sensors/history")
async def get_sensor_history():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    ts_24h_ago = int(time.time()) - (24 * 3600)
    c.execute("SELECT timestamp, temp, hum, soil, ph FROM sensor_data WHERE timestamp > ? ORDER BY timestamp ASC", (ts_24h_ago,))
    rows = c.fetchall()
    conn.close()
    
    if not rows:
        return {"temperature": [], "humidity": [], "moisture": [], "ph": []}
        
    hourly_bins = {}
    for row in rows:
        dt = datetime.utcfromtimestamp(row[0])
        hour_key = dt.strftime("%Y-%m-%d %H:00")
        if hour_key not in hourly_bins:
            hourly_bins[hour_key] = {"temp": [], "hum": [], "soil": [], "ph": []}
        hourly_bins[hour_key]["temp"].append(row[1])
        hourly_bins[hour_key]["hum"].append(row[2])
        hourly_bins[hour_key]["soil"].append(row[3])
        hourly_bins[hour_key]["ph"].append(row[4])
        
    out = {"temperature": [], "humidity": [], "moisture": [], "ph": []}
    for h_key, vals in hourly_bins.items():
        dt_obj = datetime.strptime(h_key, "%Y-%m-%d %H:00")
        ts = int(dt_obj.timestamp())
        
        t_avg_val = sum(vals["temp"]) / len(vals["temp"]) if vals["temp"] else 0
        h_avg_val = sum(vals["hum"]) / len(vals["hum"]) if vals["hum"] else 0
        m_avg_val = sum(vals["soil"]) / len(vals["soil"]) if vals["soil"] else 0
        p_avg_val = sum(vals["ph"]) / len(vals["ph"]) if vals["ph"] else 0

        out["temperature"].append({"time": ts, "value": round(t_avg_val, 2)})
        out["humidity"].append({"time": ts, "value": round(h_avg_val, 2)})
        out["moisture"].append({"time": ts, "value": round(m_avg_val, 2)})
        out["ph"].append({"time": ts, "value": round(p_avg_val, 2)})
        
    return out

@app.get("/api/sensors/history/{feed_name}")
async def get_sensor_history_single(feed_name: str):
    data = await get_sensor_history()
    if feed_name in data:
         return data[feed_name]
    return []

@app.get("/api/mobile/latest")
async def get_mobile_latest():
    conn = sqlite3.connect(MOBILE_DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM readings ORDER BY id DESC LIMIT 10")
    rows = c.fetchall()
    conn.close()
    return [dict(ix) for ix in rows]

global_latest_frame = None

async def generate_frames():
    global global_latest_frame
    while True:
        with frame_lock:
            current_frame = global_latest_frame

        if current_frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + current_frame + b'\r\n')

        # Cap the output to ~30 FPS to prevent flooding the local network
        await asyncio.sleep(0.03)

@app.get("/api/video_feed")
async def video_feed():
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

# --- AI Chat Engine ---
class ChatMessage(BaseModel):
    role: str
    content: str
class ChatPayload(BaseModel):
    prompt: str
    chat_history: List[ChatMessage]

@app.post("/api/chat")
async def chat_with_agent(payload: ChatPayload):
    base64_image = ""
    with frame_lock:
        if latest_clean_frame:
            base64_image = "data:image/jpeg;base64," + base64.b64encode(latest_clean_frame).decode('utf-8')
    if not base64_image:
        base64_image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT temp, hum, soil, ph FROM sensor_data ORDER BY timestamp DESC LIMIT 1")
    row = c.fetchone()
    conn.close()
    
    sens = {"temp": "N/A", "hum": "N/A", "soil": "N/A", "ph": "N/A"}
    if row:
        sens = {"temp": row[0], "hum": row[1], "soil": row[2], "ph": row[3]}

    system_prompt = f"""You are an expert agricultural and farming advisor. 
You are observing a live video feed of a crop alongside realtime sensor data.
Current Edge Diagnostics:
- pH: {sens['ph']}
- Temperature: {sens['temp']}
- Humidity: {sens['hum']}
- Moisture: {sens['soil']}

STRICT INSTRUCTIONS:
1. You MUST format your entire response using Markdown.
2. Long explanatory paragraphs are strictly FORBIDDEN.
3. ALL actionable agricultural advice MUST be output in a Markdown table with the exact columns: | Parameter/Observation | Status | Recommended Action |.
"""
    messages = [{"role": "system", "content": system_prompt}]
    for msg in payload.chat_history:
        messages.append({"role": msg.role, "content": msg.content})
        
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": payload.prompt},
            {"type": "image_url", "image_url": {"url": base64_image}}
        ]
    })

    if not GROQ_API_KEY:
        return {"reply": "| Parameter/Observation | Status | Recommended Action |\n|---|---|---|\n| System | Offline | Insert GROQ_API_KEY in .env |"}

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    data = {"model": MODEL_NAME, "messages": messages, "temperature": 0.2, "max_tokens": 1024}
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=data)
            response.raise_for_status()
            return {"reply": response.json()["choices"][0]["message"]["content"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API Error: {str(e)}")
