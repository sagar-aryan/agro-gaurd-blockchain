#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

resolve_python_bin() {
  if [[ -n "${VIRTUAL_ENV:-}" && -x "${VIRTUAL_ENV}/bin/python" ]]; then
    printf '%s\n' "${VIRTUAL_ENV}/bin/python"
    return
  fi

  if [[ -x "${PROJECT_ROOT}/.venv/bin/python" ]]; then
    printf '%s\n' "${PROJECT_ROOT}/.venv/bin/python"
    return
  fi

  if [[ -x "${PROJECT_ROOT}/venv/bin/python" ]]; then
    printf '%s\n' "${PROJECT_ROOT}/venv/bin/python"
    return
  fi

  printf '%s\n' "python3"
}

detect_host_ip() {
  local ip=""

  if command -v hostname >/dev/null 2>&1; then
    read -r ip _ < <(hostname -I 2>/dev/null || true)
  fi

  if [[ -z "${ip}" ]]; then
    ip="127.0.0.1"
  fi

  printf '%s\n' "${ip}"
}

PYTHON_BIN="$(resolve_python_bin)"
PUBLIC_HOST_IP="${PUBLIC_HOST_IP:-$(detect_host_ip)}"

export PUBLIC_HOST_IP
export BACKEND_PORT
export FRONTEND_PORT
export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://${PUBLIC_HOST_IP}:${BACKEND_PORT}}"
export VITE_ALERTS_WS_URL="${VITE_ALERTS_WS_URL:-ws://${PUBLIC_HOST_IP}:${BACKEND_PORT}/ws/alerts}"

echo "Starting backend..."
echo "Using Python: ${PYTHON_BIN}"
echo "Backend URL: ${VITE_BACKEND_URL}"

cd "${PROJECT_ROOT}/backend"
"${PYTHON_BIN}" -m uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" &
BACKEND_PID=$!
echo "Backend started with PID ${BACKEND_PID}"

echo "Starting frontend..."
cd "${PROJECT_ROOT}/frontend"
npm run dev &
FRONTEND_PID=$!
echo "Frontend started with PID ${FRONTEND_PID}"

cleanup() {
  echo "Stopping both..."
  kill "${BACKEND_PID}" "${FRONTEND_PID}" 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

wait
