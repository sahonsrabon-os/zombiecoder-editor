#!/usr/bin/env bash
# =============================================================================
# Mission Barisal — start-all.sh
# One-line starter for ALL local Mission Barisal services.
#
# Runs every server DETACHED (nohup + disown + PID files) so closing the
# terminal does NOT kill the processes — the exact failure mode that used to
# kill 3001/3002/3100 (and the Engine) whenever the terminal closed.
#
# Usage:
#   ./scripts/start-all.sh            # start Engine only (MCP optional now)
#   ./scripts/start-all.sh --mcp      # ALSO start External MCP + combined (3001/3002/3100)
#   ./scripts/start-all.sh status     # show running services + UDS socket
#   ./scripts/start-all.sh stop       # stop everything (alias for stop-all.sh)
#
# Restart flow (syllabus): stop old process → start new → the new port wins
# and the Extension picks it up (response pattern stays identical).
# =============================================================================
set -euo pipefail

ENGINE_DIR="${ENGINE_DIR:-/home/sahon/dev/Engine}"
MCP_DIR="${MCP_DIR:-/home/sahon/Desktop/External MCP}"
LOG_ROOT="${HOME}/.missionbarisal/logs"
PID_ROOT="${HOME}/.missionbarisal/pids"
UDS_PATH="$(node -e 'console.log(require("os").tmpdir())')/zombiecoder/mcp.sock"

mkdir -p "${LOG_ROOT}" "${PID_ROOT}"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_CYAN='\033[0;36m'; C_RED='\033[0;31m'; C_NC='\033[0m'

ok()   { echo -e "${C_GREEN}✔${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}⚠${C_NC} $*"; }
info() { echo -e "${C_CYAN}›${C_NC} $*"; }
err()  { echo -e "${C_RED}✘${C_NC} $*"; }

is_running() { # $1 = pid file
  [[ -f "$1" ]] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null
}

start_engine() {
  if is_running "${PID_ROOT}/engine.pid"; then
    ok "Engine already running (PID $(cat "${PID_ROOT}/engine.pid"))"
    return
  fi
  (
    cd "${ENGINE_DIR}"
    nohup node start.js >> "${LOG_ROOT}/engine.log" 2>&1 &
    echo $! > "${PID_ROOT}/engine.pid"
  )
  disown 2>/dev/null || true
  sleep 1.5
  if is_running "${PID_ROOT}/engine.pid"; then
    ok "Engine started (PID $(cat "${PID_ROOT}/engine.pid")) — http://0.0.0.0:3000"
    info "UDS socket: ${UDS_PATH}"
  else
    err "Engine failed to start — check ${LOG_ROOT}/engine.log"
    return 1
  fi
}

start_mcp() {
  if is_running "${PID_ROOT}/mcp.pid"; then
    ok "External MCP already running (PID $(cat "${PID_ROOT}/mcp.pid"))"
  else
    (
      cd "${MCP_DIR}"
      nohup node start.js >> "${LOG_ROOT}/mcp.log" 2>&1 &
      echo $! > "${PID_ROOT}/mcp.pid"
    )
    disown 2>/dev/null || true
    ok "External MCP started (3001 facebook-ads + 3002 public-api, PID $(cat "${PID_ROOT}/mcp.pid"))"
  fi
  if is_running "${PID_ROOT}/combined.pid"; then
    ok "Combined gateway already running (PID $(cat "${PID_ROOT}/combined.pid"))"
  else
    (
      cd "${MCP_DIR}"
      nohup node combined.js >> "${LOG_ROOT}/combined.log" 2>&1 &
      echo $! > "${PID_ROOT}/combined.pid"
    )
    disown 2>/dev/null || true
    ok "Combined gateway started on 3100 (PID $(cat "${PID_ROOT}/combined.pid"))"
  fi
}

show_status() {
  info "Mission Barisal services:"
  is_running "${PID_ROOT}/engine.pid"  && ok  "Engine  (port 5000)  PID $(cat "${PID_ROOT}/engine.pid")" || warn "Engine  (port 5000)  STOPPED"
  is_running "${PID_ROOT}/mcp.pid"     && ok  "MCP     (3001/3002) PID $(cat "${PID_ROOT}/mcp.pid")"    || warn "MCP     (3001/3002) STOPPED (optional)"
  is_running "${PID_ROOT}/combined.pid" && ok "Combined (3100)     PID $(cat "${PID_ROOT}/combined.pid")" || warn "Combined (3100)     STOPPED (optional)"
  if [[ -S "${UDS_PATH}" ]]; then
    ok "UDS socket present: ${UDS_PATH}"
  else
    warn "UDS socket NOT present: ${UDS_PATH} (Engine not listening?)"
  fi
}

stop_all() {
  for name in engine combined mcp; do
    if is_running "${PID_ROOT}/${name}.pid"; then
      kill "$(cat "${PID_ROOT}/${name}.pid")" 2>/dev/null && ok "Stopped ${name} (PID $(cat "${PID_ROOT}/${name}.pid"))"
      rm -f "${PID_ROOT}/${name}.pid"
    fi
  done
  warn "All Mission Barisal services stopped."
}

case "${1:-}" in
  --mcp)  start_engine; start_mcp; show_status ;;
  status) show_status ;;
  stop)   stop_all ;;
  *)      start_engine; show_status ;;
esac
