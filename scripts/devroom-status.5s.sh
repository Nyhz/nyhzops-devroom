#!/bin/bash
# devroom-status.5s.sh — xbar plugin for DEVROOM status
# Filename encodes refresh interval: 5s = every 5 seconds
# xbar format: https://github.com/matryer/xbar-plugins/blob/main/CONTRIBUTING.md

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SERVICE_LABEL="com.devroom.app"
GUI_DOMAIN="gui/$(id -u)"
MODE_FILE="$HOME/.devroom/mode"
CTL="$HOME/devroom/nyhzops-devroom/scripts/devroom-ctl.sh"
XRUN="$HOME/devroom/nyhzops-devroom/scripts/devroom-xbar-run.sh"
LOG_FILE="$HOME/.devroom/logs/devroom.log"
STARTUP_GRACE_SECONDS=30

# --- Gather state ---
RUNNING=false
PID=""
UPTIME="-"
PROCESS_AGE_SECONDS=0
if launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" &>/dev/null; then
  RUNNING=true
  PID=$(launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null \
    | grep -m1 "pid =" | awk '{print $3}')
  if [ -n "$PID" ] && [ "$PID" != "0" ]; then
    UPTIME=$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ')
    # Calculate process age in seconds from etime (format: [[dd-]hh:]mm:ss)
    ETIME_RAW=$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ')
    if [ -n "$ETIME_RAW" ]; then
      # Parse etime into seconds
      DAYS=0; HOURS=0; MINS=0; SECS=0
      if echo "$ETIME_RAW" | grep -q '-'; then
        DAYS=$(echo "$ETIME_RAW" | cut -d'-' -f1)
        ETIME_RAW=$(echo "$ETIME_RAW" | cut -d'-' -f2)
      fi
      IFS=':' read -ra PARTS <<< "$ETIME_RAW"
      case ${#PARTS[@]} in
        3) HOURS=${PARTS[0]}; MINS=${PARTS[1]}; SECS=${PARTS[2]} ;;
        2) MINS=${PARTS[0]}; SECS=${PARTS[1]} ;;
        1) SECS=${PARTS[0]} ;;
      esac
      PROCESS_AGE_SECONDS=$(( 10#$DAYS * 86400 + 10#$HOURS * 3600 + 10#$MINS * 60 + 10#$SECS ))
    fi
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

# --- HTTP health check ---
HTTP_HEALTHY=false
if $RUNNING && [ -n "$PID" ] && [ "$PID" != "0" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 3 "http://localhost:7777" 2>/dev/null)
  if [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 500 ] 2>/dev/null; then
    HTTP_HEALTHY=true
  fi
fi

# --- Determine display state ---
# States: healthy, starting, crashed, stopped
STATE="stopped"
if $RUNNING; then
  if $HTTP_HEALTHY; then
    STATE="healthy"
  elif [ "$PROCESS_AGE_SECONDS" -lt "$STARTUP_GRACE_SECONDS" ]; then
    STATE="starting"
  else
    STATE="crashed"
  fi
fi

# --- Menu bar title ---
case $STATE in
  healthy)
    if [ "$MODE" = "dev" ]; then
      echo "● DEVROOM | color=#00ff00 size=13"
    else
      echo "● DEVROOM | color=#ffaa00 size=13"
    fi
    ;;
  starting)
    echo "● DEVROOM | color=#ffaa00 size=13"
    ;;
  crashed)
    echo "● DEVROOM | color=#ff4444 size=13"
    ;;
  stopped)
    echo "○ DEVROOM | color=#ff4444 size=13"
    ;;
esac

echo "---"

# --- Status section ---
case $STATE in
  healthy)
    echo "Status: Running | color=#00ff00"
    MODE_UPPER=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
    echo "Mode: ${MODE_UPPER} | color=white"
    echo "Uptime: ${UPTIME} | color=#888888"
    echo "PID: ${PID} | color=#888888"
    ;;
  starting)
    echo "Status: Starting... | color=#ffaa00"
    MODE_UPPER=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
    echo "Mode: ${MODE_UPPER} | color=white"
    echo "PID: ${PID} | color=#888888"
    ;;
  crashed)
    echo "Status: Crashed | color=#ff4444"
    MODE_UPPER=$(echo "$MODE" | tr '[:lower:]' '[:upper:]')
    echo "Mode: ${MODE_UPPER} | color=white"
    echo "PID: ${PID} | color=#888888"
    echo "---"
    echo "Recent log: | color=#ff4444"
    if [ -f "$LOG_FILE" ]; then
      tail -8 "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
        # Truncate long lines and escape pipe characters for xbar
        TRIMMED=$(echo "$line" | cut -c1-80 | sed 's/|/∣/g')
        echo "  ${TRIMMED} | color=#ff8888 font=Menlo size=10"
      done
    else
      echo "  (no log file found) | color=#888888 size=10"
    fi
    ;;
  stopped)
    echo "Status: Stopped | color=#ff4444"
    echo "Mode: $(echo "$MODE" | tr '[:lower:]' '[:upper:]') (on next start) | color=#888888"
    ;;
esac

echo "Port: 7777 | color=#888888"

echo "---"

# --- Actions ---
if [ "$STATE" = "healthy" ] || [ "$STATE" = "starting" ] || [ "$STATE" = "crashed" ]; then
  if [ "$MODE" = "dev" ]; then
    echo "Switch to Prod | bash=$XRUN param1=prod terminal=false refresh=true"
  else
    echo "Switch to Dev | bash=$XRUN param1=dev terminal=false refresh=true"
  fi
  echo "Restart | bash=$XRUN param1=restart terminal=false refresh=true"
  echo "Stop | bash=$XRUN param1=stop terminal=false refresh=true"
else
  echo "Start | bash=$XRUN param1=start terminal=false refresh=true"
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
echo "View Logs | bash=/usr/bin/open param1=-a param2=Terminal param3=$LOG_FILE terminal=false"
