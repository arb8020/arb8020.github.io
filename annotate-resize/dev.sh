#!/usr/bin/env bash
set -euo pipefail

# Dev runner for annotate-resize.
# Uses portless for a stable https://annotate-resize.localhost URL.
# Opens a tmux session with a dev pane and a log tail pane.
#
# First run: portless will prompt for your password to install a local CA cert.
# After that it's automatic.
#
# Usage: ./dev.sh

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION="annotate-resize"
DEV_PORT="5173"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
LOG="$LOG_DIR/dev_${TS}.log"

# ── helpers ────────────────────────────────────────────────────────────────────

log() { echo "[dev.sh] $*"; }

check_deps() {
  for cmd in node npm tmux portless; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "❌  $cmd not found. Install it and retry." >&2
      exit 1
    fi
  done
}

kill_port() {
  local port="$1"
  local pid
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    log "killing process $pid on port $port"
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.3
  fi
}

ensure_proxy() {
  if portless proxy start 2>&1 | grep -q "already running"; then
    log "portless proxy already running"
  else
    log "portless proxy started (may prompt for CA cert password)"
  fi
}

# ── main ───────────────────────────────────────────────────────────────────────

check_deps
log "log → $LOG"

# (portless disabled — using plain vite on localhost:5173)

# Clear the dev port (kills whatever is holding it, including stale vite)
kill_port "$DEV_PORT"

# If already in a tmux session, just run inline
if [[ -n "${TMUX:-}" ]]; then
  log "already inside tmux — running portless inline"
  cd "$ROOT_DIR"
  portless annotate-resize vite 2>&1 | tee -a "$LOG" | sed 's/^/[vite] /'
  exit 0
fi

# Kill any stale session
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create new detached session — main pane runs the dev server
tmux new-session -d -s "$SESSION" -x 220 -y 50 \
  "cd '$ROOT_DIR' && npm run dev 2>&1 | tee -a '$LOG' | sed 's/^/[vite] /'; echo '[dev] server exited'; read"

# Split horizontally — bottom pane tails the log
tmux split-window -t "$SESSION" -v -l 12 \
  "tail -f '$LOG'"

# Focus the top pane
tmux select-pane -t "$SESSION:0.0"

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  annotate-resize dev                        │"
echo "  │  → http://localhost:5173                    │"
echo "  │                                             │"
echo "  │  tmux session: $SESSION                     │"
echo "  │  log: $LOG"
echo "  │                                             │"
echo "  │  attach:  tmux attach -t $SESSION           │"
echo "  │  stop:    tmux kill-session -t $SESSION     │"
echo "  └─────────────────────────────────────────────┘"
echo ""

[[ "${1:-}" != "--no-attach" ]] && tmux attach -t "$SESSION"
