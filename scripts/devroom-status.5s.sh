#!/bin/bash
# devroom-status.5s.sh — xbar plugin for DEVROOM status
# Filename encodes refresh interval: 5s = every 5 seconds
# xbar format: https://github.com/matryer/xbar-plugins/blob/main/CONTRIBUTING.md

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SERVICE_LABEL="com.devroom.app"
GUI_DOMAIN="gui/$(id -u)"
MODE_FILE="$HOME/.devroom/mode"
CTL="$HOME/devroom/nyhzops-devroom/scripts/devroom-ctl.sh"

# --- Gather state ---
RUNNING=false
PID=""
UPTIME="-"
if launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" &>/dev/null; then
  RUNNING=true
  PID=$(launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null \
    | grep -m1 "pid =" | awk '{print $3}')
  if [ -n "$PID" ] && [ "$PID" != "0" ]; then
    UPTIME=$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ')
  fi
fi

MODE="prod"
if [ -f "$MODE_FILE" ]; then
  MODE=$(cat "$MODE_FILE" | tr -d '[:space:]')
fi

CADDY_RUNNING=false
if brew services info caddy 2>/dev/null | grep -qi "running"; then
  CADDY_RUNNING=true
fi

# --- Menu bar title ---
if $RUNNING; then
  if [ "$MODE" = "dev" ]; then
    echo "● DEVROOM | color=#00ff00 size=13"
  else
    echo "● DEVROOM | color=#ffaa00 size=13"
  fi
else
  echo "○ DEVROOM | color=#666666 size=13"
fi

echo "---"

# --- Status section ---
if $RUNNING; then
  echo "Status: Running | color=#00ff00"
  MODE_UPPER=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
  echo "Mode: ${MODE_UPPER} | color=white"
  echo "Uptime: ${UPTIME} | color=#888888"
  echo "PID: ${PID} | color=#888888"
else
  echo "Status: Stopped | color=#ff4444"
  echo "Mode: $(echo "$MODE" | tr '[:lower:]' '[:upper:]') (on next start) | color=#888888"
fi

echo "Port: 7777 | color=#888888"

echo "---"

# --- Actions ---
if $RUNNING; then
  if [ "$MODE" = "dev" ]; then
    echo "Switch to Prod | bash=$CTL param1=prod terminal=false refresh=true"
  else
    echo "Switch to Dev | bash=$CTL param1=dev terminal=false refresh=true"
  fi
  echo "Restart | bash=$CTL param1=restart terminal=false refresh=true"
  echo "Stop | bash=$CTL param1=stop terminal=false refresh=true"
else
  echo "Start | bash=$CTL param1=start terminal=false refresh=true"
fi

echo "---"

# --- Caddy status ---
if $CADDY_RUNNING; then
  echo "Caddy: ● Running | color=#00ff00"
else
  echo "Caddy: ○ Stopped | color=#ff4444"
fi

echo "---"

# --- Links ---
echo "Open HQ | href=https://devroom.lan"
echo "View Logs | bash=/usr/bin/open param1=-a param2=Terminal param3=$HOME/.devroom/logs/devroom.log terminal=false"
