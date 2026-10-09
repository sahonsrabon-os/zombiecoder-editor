#!/usr/bin/env bash
# =============================================================================
# Mission Barisal — stop-all.sh
# Stops every locally-started Mission Barisal service (Engine + MCP + combined)
# using the PID files written by start-all.sh.
#
# Usage:
#   ./scripts/stop-all.sh
# =============================================================================
set -euo pipefail

PID_ROOT="${HOME}/.missionbarisal/pids"
C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_NC='\033[0m'
ok()   { echo -e "${C_GREEN}✔${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}⚠${C_NC} $*"; }

stopped=0
for name in engine combined mcp; do
  pid_file="${PID_ROOT}/${name}.pid"
  if [[ -f "${pid_file}" ]]; then
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null && ok "Stopped ${name} (PID ${pid})" || warn "Could not kill ${name} (PID ${pid})"
      stopped=1
    fi
    rm -f "${pid_file}"
  fi
done

if [[ "${stopped}" -eq 0 ]]; then
  warn "No Mission Barisal services were running (no PID files found)."
else
  ok "All Mission Barisal services stopped."
fi
