# Native macOS Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Docker-based deployment with native macOS services (launchd + Caddy via Homebrew + xbar menu bar plugin) so DEVROOM can access the host filesystem, Keychain, and git worktrees directly.

**Architecture:** Three launchd-managed services — DEVROOM app (dev or prod mode via wrapper script), Caddy reverse proxy (Homebrew), and xbar for menu bar status. A `devroom-ctl.sh` script provides CLI commands for start/stop/mode-switching. Mode persists in `~/.devroom/mode`.

**Tech Stack:** launchd, bash, xbar (Homebrew), Caddy (Homebrew), pnpm, Next.js

---

### Task 1: Create the service wrapper script

**Files:**
- Create: `scripts/devroom-service.sh`

This script is what launchd runs. It sets up the shell environment (critical — launchd starts with minimal PATH), reads the mode file, and execs the appropriate pnpm command.

- [ ] **Step 1: Create `scripts/devroom-service.sh`**

```bash
#!/bin/bash
# devroom-service.sh — launchd wrapper for DEVROOM
# Reads ~/.devroom/mode and starts in dev or prod accordingly.

set -euo pipefail

# launchd starts with a minimal environment — source Homebrew + node/pnpm/claude
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="/opt/homebrew/bin:$PATH"

# fnm (if used) or nvm — uncomment whichever applies:
# eval "$(fnm env)"
# export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

DEVROOM_DIR="/Users/nyhzdev/devroom/nyhzops-devroom"
MODE_FILE="$HOME/.devroom/mode"

cd "$DEVROOM_DIR"

# Load .env.local
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

# Read mode (default: prod)
MODE="prod"
if [ -f "$MODE_FILE" ]; then
  MODE=$(cat "$MODE_FILE" | tr -d '[:space:]')
fi

echo "[DEVROOM] Starting in ${MODE} mode..."

if [ "$MODE" = "dev" ]; then
  exec pnpm dev
else
  echo "[DEVROOM] Building for production..."
  pnpm build
  exec pnpm start
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/devroom-service.sh`

- [ ] **Step 3: Create the mode directory and default mode file**

Run: `mkdir -p ~/.devroom/logs && echo "dev" > ~/.devroom/mode`

We default to `dev` since the user is actively developing right now.

- [ ] **Step 4: Test the wrapper locally**

Run: `bash scripts/devroom-service.sh`
Expected: DEVROOM starts in dev mode with hot reload. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add scripts/devroom-service.sh
git commit -m "feat: add launchd wrapper script for native macOS deployment"
```

---

### Task 2: Create the CLI control script

**Files:**
- Create: `scripts/devroom-ctl.sh`

Provides `devroom start|stop|restart|dev|prod|status|logs` commands.

- [ ] **Step 1: Create `scripts/devroom-ctl.sh`**

```bash
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
#   devroom caddy       Show Caddy status

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
  if brew services info caddy 2>/dev/null | grep -q "running"; then
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
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/devroom-ctl.sh`

- [ ] **Step 3: Test status command (service not yet loaded)**

Run: `./scripts/devroom-ctl.sh status`
Expected: Shows "STOPPED" status with current mode.

- [ ] **Step 4: Commit**

```bash
git add scripts/devroom-ctl.sh
git commit -m "feat: add devroom-ctl CLI for service management"
```

---

### Task 3: Create the launchd plist

**Files:**
- Create: `scripts/com.devroom.app.plist` (in repo, installed via symlink or copy)

- [ ] **Step 1: Create the plist file**

Create `scripts/com.devroom.app.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.devroom.app</string>

	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>/Users/nyhzdev/devroom/nyhzops-devroom/scripts/devroom-service.sh</string>
	</array>

	<key>WorkingDirectory</key>
	<string>/Users/nyhzdev/devroom/nyhzops-devroom</string>

	<key>RunAtLoad</key>
	<true/>

	<key>KeepAlive</key>
	<true/>

	<key>StandardOutPath</key>
	<string>/Users/nyhzdev/.devroom/logs/devroom.log</string>

	<key>StandardErrorPath</key>
	<string>/Users/nyhzdev/.devroom/logs/devroom.log</string>

	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
	</dict>
</dict>
</plist>
```

- [ ] **Step 2: Install the plist (symlink to LaunchAgents)**

Run: `ln -sf /Users/nyhzdev/devroom/nyhzops-devroom/scripts/com.devroom.app.plist ~/Library/LaunchAgents/com.devroom.app.plist`

- [ ] **Step 3: Load and test the service**

Run: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.devroom.app.plist`
Then: `./scripts/devroom-ctl.sh status`
Expected: Shows "RUNNING" with dev mode, PID, uptime.

Verify the app is accessible:
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:7777`
Expected: `200`

- [ ] **Step 4: Test restart via ctl**

Run: `./scripts/devroom-ctl.sh restart`
Then: `./scripts/devroom-ctl.sh status`
Expected: "RUNNING", new PID.

- [ ] **Step 5: Commit**

```bash
git add scripts/com.devroom.app.plist
git commit -m "feat: add launchd plist for auto-start on login"
```

---

### Task 4: Update Caddyfile and install Caddy natively

**Files:**
- Modify: `Caddyfile`

- [ ] **Step 1: Install Caddy via Homebrew**

Run: `brew install caddy`

- [ ] **Step 2: Update the Caddyfile upstream**

Change `Caddyfile` from:

```
devroom.lan {
	tls internal
	reverse_proxy devroom:7777 {
		transport http {
			versions 1.1
		}
	}
}
```

To:

```
devroom.lan {
	tls internal
	reverse_proxy localhost:7777 {
		transport http {
			versions 1.1
		}
	}
}
```

- [ ] **Step 3: Symlink Caddyfile to Homebrew's expected location**

Run: `ln -sf /Users/nyhzdev/devroom/nyhzops-devroom/Caddyfile /opt/homebrew/etc/Caddyfile`

- [ ] **Step 4: Add `devroom.lan` to /etc/hosts**

Run: `echo '127.0.0.1 devroom.lan' | sudo tee -a /etc/hosts`

Verify it's not duplicated — check first with `grep devroom.lan /etc/hosts`.

- [ ] **Step 5: Start Caddy via Homebrew services**

Run: `brew services start caddy`

Verify: `brew services info caddy`
Expected: Shows "running".

- [ ] **Step 6: Trust Caddy's local CA (for HTTPS without browser warnings)**

Run: `caddy trust`

This installs Caddy's root CA into the macOS system trust store.

- [ ] **Step 7: Verify HTTPS access**

Run: `curl -s -o /dev/null -w "%{http_code}" https://devroom.lan`
Expected: `200`

- [ ] **Step 8: Commit**

```bash
git add Caddyfile
git commit -m "fix: update Caddyfile upstream from Docker service to localhost"
```

---

### Task 5: Create the xbar menu bar plugin

**Files:**
- Create: `scripts/devroom-status.5s.sh`

xbar plugins are shell scripts whose output follows a specific format. Lines before `---` appear in the menu bar. Lines after `---` appear in the dropdown. Pipe-separated params control behavior (`bash=`, `terminal=`, `href=`, `color=`).

- [ ] **Step 1: Install xbar via Homebrew**

Run: `brew install --cask xbar`

Open xbar once to initialize its plugin directory:
Run: `open -a xbar`

- [ ] **Step 2: Create `scripts/devroom-status.5s.sh`**

```bash
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
if brew services info caddy 2>/dev/null | grep -q "running"; then
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
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x scripts/devroom-status.5s.sh`

- [ ] **Step 4: Symlink to xbar plugins directory**

Run: `ln -sf /Users/nyhzdev/devroom/nyhzops-devroom/scripts/devroom-status.5s.sh "$HOME/Library/Application Support/xbar/plugins/devroom-status.5s.sh"`

- [ ] **Step 5: Refresh xbar**

Run: `open -a xbar`

Expected: Green dot "● DEVROOM" appears in menu bar. Clicking shows the dropdown with status, mode, and action items.

- [ ] **Step 6: Test menu actions**

Click "Restart" in the dropdown — DEVROOM should restart (verify via `devroom-ctl.sh status`).
Click "Switch to Prod/Dev" — mode should toggle.
Click "Open HQ" — browser opens `https://devroom.lan`.

- [ ] **Step 7: Commit**

```bash
git add scripts/devroom-status.5s.sh
git commit -m "feat: add xbar menu bar plugin for DEVROOM status"
```

---

### Task 6: Remove Docker files and credential sync

**Files:**
- Delete: `Dockerfile`
- Delete: `docker-compose.yml`
- Delete: `.dockerignore`
- Delete: `docker-entrypoint.sh`
- Delete: `scripts/sync-claude-credentials.sh`

- [ ] **Step 1: Stop Docker containers if running**

Run: `docker compose down 2>/dev/null || true`

- [ ] **Step 2: Unload the credential sync launchd plist**

Run: `launchctl bootout gui/$(id -u)/com.devroom.claude-credentials-sync 2>/dev/null || true`

- [ ] **Step 3: Remove the credential sync plist file**

Run: `rm -f ~/Library/LaunchAgents/com.devroom.claude-credentials-sync.plist`

- [ ] **Step 4: Delete Docker files from repo**

Run:
```bash
git rm Dockerfile docker-compose.yml .dockerignore docker-entrypoint.sh scripts/sync-claude-credentials.sh
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove Docker deployment and credential sync

DEVROOM now runs natively on macOS via launchd.
Claude CLI accesses Keychain directly — no sync needed."
```

---

### Task 7: Add shell alias and update documentation

**Files:**
- Modify: `CLAUDE.md` (deployment section)

- [ ] **Step 1: Add the `devroom` shell alias**

Append to `~/.zshrc`:

```bash
# DEVROOM CLI
alias devroom="/Users/nyhzdev/devroom/nyhzops-devroom/scripts/devroom-ctl.sh"
```

Run: `source ~/.zshrc`

- [ ] **Step 2: Verify the alias works**

Run: `devroom status`
Expected: Shows the DEVROOM status output.

- [ ] **Step 3: Update CLAUDE.md tech stack table**

In `CLAUDE.md`, find the Tech Stack table and remove the Docker row. The table should reflect native deployment. No need to add launchd/xbar to the table — they're operational tooling, not part of the app's tech stack.

- [ ] **Step 4: Update CLAUDE.md Quick Reference or add a deployment note**

Add a brief deployment section at the end of `CLAUDE.md`:

```markdown
---

## Native Deployment

DEVROOM runs natively on the Mac Mini via `launchd`. No Docker.

| Command | Action |
|---------|--------|
| `devroom status` | Service status, mode, uptime |
| `devroom dev` | Switch to dev mode (hot reload) |
| `devroom prod` | Switch to prod mode (optimized build) |
| `devroom restart` | Restart the service |
| `devroom logs` | Tail the service log |

Menu bar: xbar plugin shows live status with one-click controls.
Reverse proxy: Caddy via Homebrew at `https://devroom.lan`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for native macOS deployment"
```

---

### Task 8: End-to-end verification

No files to change — this task validates everything works together.

- [ ] **Step 1: Verify DEVROOM is running via launchd**

Run: `devroom status`
Expected: "RUNNING", correct mode, PID, uptime.

- [ ] **Step 2: Verify Caddy is proxying**

Run: `curl -s -o /dev/null -w "%{http_code}" https://devroom.lan`
Expected: `200`

- [ ] **Step 3: Verify xbar menu bar**

Look at the macOS menu bar — green dot "● DEVROOM" should be visible.
Click it — dropdown should show status, mode, actions.

- [ ] **Step 4: Test mode switching**

Run: `devroom prod`
Wait for build to complete.
Run: `devroom status`
Expected: "RUNNING" in prod mode.

Run: `devroom dev`
Run: `devroom status`
Expected: "RUNNING" in dev mode.

- [ ] **Step 5: Test reboot survival**

Run: `devroom stop && devroom start`
Run: `devroom status`
Expected: "RUNNING" in the last mode used.

- [ ] **Step 6: Test crash recovery (KeepAlive)**

Get PID: `devroom status`
Kill the process: `kill <PID>`
Wait 2-3 seconds.
Run: `devroom status`
Expected: "RUNNING" with a new PID — launchd auto-restarted it.

- [ ] **Step 7: Verify Docker is no longer needed**

Run: `docker ps -a | grep devroom`
Expected: No DEVROOM containers. Docker can be stopped or uninstalled entirely.
