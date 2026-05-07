#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Category Intelligence — startup script
#
# Usage:
#   ./scripts/start.sh                 # defaults (backend 8005, frontend 3005)
#   ./scripts/start.sh 8006 3006       # custom ports
#   ./scripts/start.sh --kill-only     # just free the default ports
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configurable ports ───────────────────────────────────────────────────────
BACKEND_PORT="${1:-8005}"
FRONTEND_PORT="${2:-3005}"

if [[ "${1:-}" == "--kill-only" ]]; then
  BACKEND_PORT=8005
  FRONTEND_PORT=3005
  KILL_ONLY=true
else
  KILL_ONLY=false
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
VENV="$SCRIPT_DIR/.venv"
LOG_DIR="$SCRIPT_DIR/.logs"
ENV_ROOT="$SCRIPT_DIR/.env.local"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*"; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── Kill process on a port ───────────────────────────────────────────────────
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    success "Killed process(es) on port $port"
  else
    info "Port $port is already free"
  fi
}

# ── Detect host IP for URL display ───────────────────────────────────────────
get_host_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' \
    || ip route get 1 2>/dev/null | awk '{print $7; exit}' \
    || echo "localhost"
}

# ── Main ─────────────────────────────────────────────────────────────────────

header "═══ Category Intelligence ═══"

# Free ports first
header "Freeing ports…"
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

if $KILL_ONLY; then
  success "Done (kill-only mode)."
  exit 0
fi

# Validate dirs
for d in "$BACKEND_DIR" "$FRONTEND_DIR"; do
  [[ -d "$d" ]] || { error "Directory not found: $d"; exit 1; }
done

# Load root .env.local so SERPAPI_KEY / GCP creds reach the backend process
if [[ -f "$ENV_ROOT" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_ROOT"
  set +a
  success "Loaded env from $ENV_ROOT"
else
  warn "No $ENV_ROOT — backend will start with empty SERPAPI_KEY / GCP creds"
fi

# Pre-flight warnings
[[ -z "${SERPAPI_KEY:-}" ]] && warn "SERPAPI_KEY is empty — /feeds/prices will fail until you set it"
[[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -z "${GOOGLE_CLOUD_PROJECT:-}" ]] && \
  warn "No GOOGLE_APPLICATION_CREDENTIALS — BigQuery calls will fail with auth errors"

# Resolve uvicorn (project venv → backend venv → system PATH)
UVICORN=""
for candidate in "$VENV/bin/uvicorn" "$BACKEND_DIR/.venv/bin/uvicorn" "$(command -v uvicorn || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    UVICORN="$candidate"
    break
  fi
done
if [[ -z "$UVICORN" ]]; then
  error "uvicorn not found in $VENV/bin, $BACKEND_DIR/.venv/bin, or PATH"
  exit 1
fi
info "Using uvicorn at $UVICORN"

# Auto-update frontend .env.local to point at this run's host/port
HOST_IP=$(get_host_ip)
ENV_FILE="$FRONTEND_DIR/.env.local"
cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_API_BASE_URL=http://${HOST_IP}:${BACKEND_PORT}
BACKEND_URL=http://${HOST_IP}:${BACKEND_PORT}
EOF
success "Updated $ENV_FILE → http://${HOST_IP}:${BACKEND_PORT}"

# Ensure frontend deps are fully installed.
# A previous run that was Ctrl-C'd can leave node_modules populated but with
# the .bin symlinks missing — that's why "next: not found" happens even though
# the package is there. Detect both cases.
if [[ ! -d "$FRONTEND_DIR/node_modules" ]] || [[ ! -x "$FRONTEND_DIR/node_modules/.bin/next" ]]; then
  warn "frontend deps incomplete — running clean npm install"
  (cd "$FRONTEND_DIR" && rm -rf node_modules package-lock.json && npm install)
fi

mkdir -p "$LOG_DIR"

# ── Start backend ────────────────────────────────────────────────────────────
header "Starting backend (port $BACKEND_PORT)…"
(
  cd "$BACKEND_DIR"
  "$UVICORN" main:app \
    --host 0.0.0.0 \
    --port "$BACKEND_PORT" \
    --reload \
    >> "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)
BACKEND_PID=$(cat "$LOG_DIR/backend.pid")
success "Backend started (PID $BACKEND_PID) → log: .logs/backend.log"

sleep 2
if kill -0 "$BACKEND_PID" 2>/dev/null; then
  success "Backend is running"
else
  error "Backend failed to start. Last 20 lines of .logs/backend.log:"
  tail -20 "$LOG_DIR/backend.log"
  exit 1
fi

# ── Start frontend ───────────────────────────────────────────────────────────
header "Starting frontend (port $FRONTEND_PORT)…"
(
  cd "$FRONTEND_DIR"
  rm -rf .next .turbo
  NEXT_PUBLIC_API_BASE_URL="http://${HOST_IP}:${BACKEND_PORT}" \
  BACKEND_URL="http://${HOST_IP}:${BACKEND_PORT}" \
    npm run dev -- --hostname 0.0.0.0 -p "$FRONTEND_PORT" \
    >> "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)
FRONTEND_PID=$(cat "$LOG_DIR/frontend.pid")
success "Frontend started (PID $FRONTEND_PID) → log: .logs/frontend.log"

info "Waiting for frontend to be ready…"
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  ✓ Category Intelligence is running!${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Frontend${RESET}  →  ${CYAN}http://${HOST_IP}:${FRONTEND_PORT}${RESET}"
echo -e "  ${BOLD}Backend ${RESET}  →  ${CYAN}http://${HOST_IP}:${BACKEND_PORT}${RESET}"
echo -e "  ${BOLD}API docs${RESET}  →  ${CYAN}http://${HOST_IP}:${BACKEND_PORT}/docs${RESET}"
echo ""
echo -e "  Logs:  .logs/backend.log   .logs/frontend.log"
echo -e "  Stop:  ${YELLOW}./scripts/start.sh --kill-only${RESET}   or   ${YELLOW}Ctrl+C${RESET}"
echo ""

# ── Tail logs (Ctrl+C to exit) ───────────────────────────────────────────────
cleanup() {
  echo ""
  warn "Shutting down…"
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  success "Stopped."
  exit 0
}
trap cleanup INT TERM

tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
