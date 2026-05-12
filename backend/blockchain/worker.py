import queue
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2

from blockchain.hash_utils import sha256_hex
from blockchain.hedera_client import HederaTopicClient


BASE_DIR = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = BASE_DIR / "evidence"
EVIDENCE_DB_PATH = BASE_DIR / "evidence.db"


@dataclass
class IntruderEvent:
    frame: Any
    local_datetime: datetime


class IntruderEvidenceWorker:
    def __init__(self, cooldown_seconds: int = 10, queue_size: int = 16):
        self.cooldown_seconds = cooldown_seconds
        self._queue: "queue.Queue[IntruderEvent]" = queue.Queue(maxsize=queue_size)
        self._state_lock = threading.Lock()
        self._worker_thread: Optional[threading.Thread] = None
        self._event_logged_for_active_state = False
        self._last_enqueued_monotonic = 0.0
        self._hedera_client = HederaTopicClient()

    def start(self):
        with self._state_lock:
            if self._worker_thread and self._worker_thread.is_alive():
                return

            self._ensure_storage()
            self._init_evidence_db()
            hedera_availability_error = self._hedera_client.get_availability_error()
            if hedera_availability_error is not None:
                print(f"[Evidence Worker] Hedera logging disabled: {hedera_availability_error}")
            self._worker_thread = threading.Thread(
                target=self._run,
                name="intruder-evidence-worker",
                daemon=True,
            )
            self._worker_thread.start()

    def enqueue_intruder_frame(self, frame: Any, event_epoch: Optional[float] = None) -> bool:
        if frame is None:
            return False

        event_dt = self._resolve_event_time(event_epoch)
        event = IntruderEvent(frame=frame.copy(), local_datetime=event_dt)
        now_monotonic = time.monotonic()

        with self._state_lock:
            if self._event_logged_for_active_state:
                return False
            if self._last_enqueued_monotonic and (now_monotonic - self._last_enqueued_monotonic) < self.cooldown_seconds:
                return False
            try:
                self._queue.put_nowait(event)
            except queue.Full:
                return False

            self._event_logged_for_active_state = True
            self._last_enqueued_monotonic = now_monotonic
            return True

    def reset_event_gate(self):
        with self._state_lock:
            self._event_logged_for_active_state = False

    @staticmethod
    def _resolve_event_time(event_epoch: Optional[float]) -> datetime:
        if event_epoch is None:
            return datetime.now().astimezone()
        return datetime.fromtimestamp(event_epoch, tz=timezone.utc).astimezone()

    @staticmethod
    def _ensure_storage():
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _init_evidence_db():
        conn = sqlite3.connect(EVIDENCE_DB_PATH)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS intruder_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    image_path TEXT,
                    sha256_hash TEXT,
                    hedera_sequence TEXT,
                    hedera_timestamp TEXT,
                    local_timestamp TEXT
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def _run(self):
        while True:
            event = self._queue.get()
            try:
                self._process_event(event)
            except Exception as exc:
                print(f"[Evidence Worker] Unexpected error: {exc}")
            finally:
                self._queue.task_done()

    def _process_event(self, event: IntruderEvent):
        image_bytes = self._encode_frame(event.frame)
        if image_bytes is None:
            print("[Evidence Worker] JPEG encoding failed. Skipping event.")
            return

        local_timestamp = event.local_datetime.isoformat()
        image_name = f"intruder_{event.local_datetime.strftime('%Y%m%d_%H%M%S')}.jpg"
        image_path = EVIDENCE_DIR / image_name
        saved_image_path = self._save_image(image_path, image_bytes)
        sha256_hash = sha256_hex(image_bytes)

        hedera_sequence = None
        hedera_timestamp = None
        hedera_availability_error = self._hedera_client.get_availability_error()
        if hedera_availability_error is None:
            try:
                hedera_result = self._hedera_client.submit_intruder_hash(sha256_hash, local_timestamp)
                hedera_sequence = hedera_result.sequence
                hedera_timestamp = hedera_result.consensus_timestamp
            except Exception as exc:
                print(f"[Evidence Worker] Hedera submission failed: {exc}")

        self._insert_event_record(
            image_path=str(saved_image_path) if saved_image_path is not None else None,
            sha256_hash=sha256_hash,
            hedera_sequence=hedera_sequence,
            hedera_timestamp=hedera_timestamp,
            local_timestamp=local_timestamp,
        )

    @staticmethod
    def _encode_frame(frame: Any) -> Optional[bytes]:
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            return None
        return encoded.tobytes()

    def _save_image(self, image_path: Path, image_bytes: bytes) -> Optional[Path]:
        self._ensure_storage()
        try:
            with image_path.open("wb") as image_file:
                image_file.write(image_bytes)
            return image_path
        except Exception as exc:
            print(f"[Evidence Worker] Failed to save image {image_path}: {exc}")
            return None

    @staticmethod
    def _insert_event_record(
        image_path: Optional[str],
        sha256_hash: str,
        hedera_sequence: Optional[str],
        hedera_timestamp: Optional[str],
        local_timestamp: str,
    ):
        conn = sqlite3.connect(EVIDENCE_DB_PATH)
        try:
            conn.execute(
                """
                INSERT INTO intruder_events (
                    image_path,
                    sha256_hash,
                    hedera_sequence,
                    hedera_timestamp,
                    local_timestamp
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (image_path, sha256_hash, hedera_sequence, hedera_timestamp, local_timestamp),
            )
            conn.commit()
        finally:
            conn.close()
