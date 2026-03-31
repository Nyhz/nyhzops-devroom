#!/bin/bash
# devroom-ctl.sh — CLI control for DEVROOM launchd service
#
# Usage:
#   devroom start       Load and start the service
#   devroom stop        Stop and unload the service
#   devroom restart     Restart the service (same mode)
#   devroom dev         Switch to dev mode and restart
#   devroom prod        Switch to prod mode and restart
#   devroom status      Show service status, mode, and uptime
#   devroom logs        Tail the service log

set -euo pipefail

SERVICE_LABEL="com.devroom.app"
PLIST="$HOME/Library/LaunchAgents/${SERVICE_LABEL}.plist"
MODE_FILE="$HOME/.devroom/mode"
LOG_FILE="$HOME/.devroom/logs/devroom.log"
GUI_DOMAIN="gui/$(id -u)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
AMBER='\033[0;33m'
DIM='\033[0;90m'
RESET='\033[0m'

is_running() {
  launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" &>/dev/null
}

get_mode() {
  if [ -f "$MODE_FILE" ]; then
    cat "$MODE_FILE" | tr -d '[:space:]'
  else
    echo "prod"
  fi
}

get_pid() {
  launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null \
    | grep -m1 "pid =" \
    | awk '{print $3}'
}

get_uptime() {
  local pid
  pid=$(get_pid)
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    ps -p "$pid" -o etime= 2>/dev/null | tr -d ' '
  else
    echo "-"
  fi
}

cmd_start() {
  if is_running; then
    echo -e "${AMBER}DEVROOM is already running.${RESET}"
    return
  fi
  if [ ! -f "$PLIST" ]; then
    echo -e "${RED}Plist not found at ${PLIST}${RESET}"
    echo "Run the setup first — see docs/superpowers/specs/2026-03-31-native-macos-deployment-design.md"
    exit 1
  fi
  echo "Starting DEVROOM..."
  launchctl bootstrap "${GUI_DOMAIN}" "$PLIST"
  echo -e "${GREEN}DEVROOM started in $(get_mode) mode.${RESET}"
}

cmd_stop() {
  if ! is_running; then
    echo -e "${DIM}DEVROOM is not running.${RESET}"
    return
  fi
  echo "Stopping DEVROOM..."
  launchctl bootout "${GUI_DOMAIN}/${SERVICE_LABEL}"
  echo -e "${DIM}DEVROOM stopped.${RESET}"
}

cmd_restart() {
  if ! is_running; then
    echo -e "${AMBER}DEVROOM is not running. Starting...${RESET}"
    cmd_start
    return
  fi
  echo "Restarting DEVROOM..."
  launchctl kickstart -k "${GUI_DOMAIN}/${SERVICE_LABEL}"
  echo -e "${GREEN}DEVROOM restarted in $(get_mode) mode.${RESET}"
}

cmd_dev() {
  echo "dev" > "$MODE_FILE"
  echo -e "Mode set to ${GREEN}dev${RESET}."
  cmd_restart
}

cmd_prod() {
  echo "prod" > "$MODE_FILE"
  echo -e "Mode set to ${AMBER}prod${RESET} (will build on start)."
  cmd_restart
}

cmd_status() {
  local mode
  mode=$(get_mode)

  echo ""
  echo "═══════════════════════════════════════════"
  echo "  NYHZ OPS — DEVROOM STATUS"
  echo "═══════════════════════════════════════════"

  if is_running; then
    local pid uptime
    pid=$(get_pid)
    uptime=$(get_uptime)
    echo -e "  Service: ${GREEN}RUNNING${RESET}"
    echo -e "  Mode:    ${mode}"
    echo -e "  PID:     ${pid}"
    echo -e "  Uptime:  ${uptime}"
  else
    echo -e "  Service: ${RED}STOPPED${RESET}"
    echo -e "  Mode:    ${mode} (will use on next start)"
  fi

  echo -e "  Port:    7777"
  echo ""

  # Caddy status
  if brew services info caddy 2>/dev/null | grep -qi "running"; then
    echo -e "  Caddy:   ${GREEN}RUNNING${RESET}"
  else
    echo -e "  Caddy:   ${RED}STOPPED${RESET}"
  fi

  echo "═══════════════════════════════════════════"
  echo ""
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "No log file found at ${LOG_FILE}"
    exit 1
  fi
  tail -f "$LOG_FILE"
}

# --- Main ---
case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  dev)     cmd_dev ;;
  prod)    cmd_prod ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)
    echo "Usage: devroom {start|stop|restart|dev|prod|status|logs}"
    exit 1
    ;;
esac
