# Native macOS Deployment

**Date:** 2026-03-31
**Status:** Approved

## Problem

DEVROOM runs in Docker, but its core purpose — spawning Claude Code processes that create git worktrees and modify files on the host filesystem — is fundamentally incompatible with container isolation. The Docker VM cannot access macOS files, Keychain, or create worktrees in host repositories.

## Solution

Replace the entire Docker deployment with native macOS services managed by `launchd`. Add an xbar menu bar plugin for status monitoring and control.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  macOS Login                                     │
│                                                  │
│  launchd starts:                                 │
│    ├── com.devroom.app (DEVROOM via wrapper)     │
│    ├── homebrew.mxcl.caddy (Caddy via brew)      │
│    └── xbar (menu bar, loads plugin)             │
│                                                  │
│  ┌──────────┐    ┌───────────┐    ┌──────────┐  │
│  │  Caddy   │───▶│  DEVROOM  │    │  xbar    │  │
│  │ :443/:80 │    │   :7777   │    │  plugin  │  │
│  │ TLS term │    │ dev/prod  │    │  5s poll  │  │
│  └──────────┘    └───────────┘    └──────────┘  │
│                        │                         │
│  ~/.devroom/mode ◀─────┘ (reads on start)        │
│  ~/.devroom/logs/  (stdout/stderr)               │
│                                                  │
│  devroom-ctl.sh: start|stop|restart|dev|prod     │
└─────────────────────────────────────────────────┘

Internet/LAN ──▶ https://devroom.lan ──▶ Caddy ──▶ localhost:7777
```

## Components

### 1. DEVROOM launchd Service

**Plist:** `~/Library/LaunchAgents/com.devroom.app.plist`

| Property | Value |
|----------|-------|
| RunAtLoad | `true` |
| KeepAlive | `true` |
| WorkingDirectory | `/Users/nyhzdev/devroom/nyhzops-devroom` |
| Program | `scripts/devroom-service.sh` |
| StandardOutPath | `~/.devroom/logs/devroom.log` |
| StandardErrorPath | `~/.devroom/logs/devroom.log` |

**Wrapper script** (`scripts/devroom-service.sh`):

1. Sources `~/.zshrc` (or a dedicated `~/.devroom/env.sh`) to get Homebrew, `node`, `pnpm`, and `claude` on PATH. launchd starts with a minimal environment — this step is critical.
2. Reads `~/.devroom/mode` (defaults to `prod` if file missing)
3. Loads environment from `.env.local` via `set -a; source .env.local; set +a`
4. If `prod`: runs `pnpm build && exec pnpm start`
5. If `dev`: runs `exec pnpm dev`

### 2. Caddy (Native via Homebrew)

**Install:** `brew install caddy`

**Management:** `brew services start caddy` — creates its own launchd plist, starts on login, auto-restarts.

**Config location:** Symlink the repo's Caddyfile to Homebrew's expected location:
```
ln -s /Users/nyhzdev/devroom/nyhzops-devroom/Caddyfile /opt/homebrew/etc/Caddyfile
```

**Caddyfile change:** Upstream changes from `devroom:7777` (Docker service name) to `localhost:7777`.

**DNS:** Add `127.0.0.1 devroom.lan` to `/etc/hosts` on the Mac Mini. Other LAN devices need the same hosts entry or a local DNS server.

### 3. Mode Persistence

**File:** `~/.devroom/mode` — contains the string `dev` or `prod`.

- Survives reboots (satisfies "remember last mode" requirement)
- Defaults to `prod` if the file doesn't exist
- Written by `devroom-ctl.sh` when switching modes

### 4. CLI Control (`scripts/devroom-ctl.sh`)

| Command | Action |
|---------|--------|
| `devroom start` | `launchctl bootstrap gui/$(id -u) <plist>` |
| `devroom stop` | `launchctl bootout gui/$(id -u)/com.devroom.app` |
| `devroom restart` | `launchctl kickstart -k gui/$(id -u)/com.devroom.app` |
| `devroom dev` | Write `dev` to mode file + restart |
| `devroom prod` | Write `prod` to mode file + restart (triggers build) |
| `devroom status` | Check if running, current mode, uptime |
| `devroom logs` | `tail -f ~/.devroom/logs/devroom.log` |

Shell alias in `~/.zshrc`: `alias devroom="/Users/nyhzdev/devroom/nyhzops-devroom/scripts/devroom-ctl.sh"`

### 5. xbar Menu Bar Plugin

**Install:** `brew install xbar`

**Plugin:** `scripts/devroom-status.5s.sh` symlinked to `~/Library/Application Support/xbar/plugins/`.

The `5s` suffix configures a 5-second refresh interval.

**Display:**
```
● DEVROOM
---
Mode: Dev
Uptime: 2h 34m
Port: 7777
---
Switch to Prod
Restart
Stop
---
Caddy: ● Running
---
Open HQ | href=https://devroom.lan
View Logs
```

**Implementation:**
- Checks `com.devroom.app` status via `launchctl print gui/$(id -u)/com.devroom.app`
- Reads `~/.devroom/mode` for current mode
- Calculates uptime from process start time
- Checks Caddy via `brew services info caddy`
- Menu actions invoke `devroom-ctl.sh` commands

## Files Removed

| File | Reason |
|------|--------|
| `Dockerfile` | No longer running in Docker |
| `docker-compose.yml` | No longer running in Docker |
| `.dockerignore` | No longer needed |
| `docker-entrypoint.sh` | Was for copying credentials into container |
| `scripts/sync-claude-credentials.sh` | Claude CLI accesses Keychain directly now |
| `~/Library/LaunchAgents/com.devroom.claude-credentials-sync.plist` | Unloaded and removed |

## Files Changed

| File | Change |
|------|--------|
| `Caddyfile` | Upstream `devroom:7777` → `localhost:7777` |
| `.env.local` | Remove Docker-specific path overrides if any |
| `CLAUDE.md` | Update deployment section to reflect native setup |
| `.devroom/` docs | Update deployment references |

## New Files

| File | Purpose |
|------|---------|
| `scripts/devroom-service.sh` | Wrapper script for launchd (reads mode, execs pnpm) |
| `scripts/devroom-ctl.sh` | CLI control commands (start/stop/dev/prod/status/logs) |
| `scripts/devroom-status.5s.sh` | xbar menu bar plugin |
| `~/Library/LaunchAgents/com.devroom.app.plist` | launchd service definition |
| `~/.devroom/mode` | Mode persistence file (`dev` or `prod`) |

## Benefits

- **Full filesystem access** — agents create worktrees, modify files, access git repos directly
- **Keychain integration** — Claude CLI authenticates via macOS Keychain, no credential sync needed
- **Hot reload in dev** — `pnpm dev` with Turbopack, instant feedback while developing DEVROOM
- **Optimized prod** — `pnpm build && pnpm start` for production performance
- **Survives reboots** — launchd starts services on login, remembers last mode
- **Menu bar monitoring** — at-a-glance status, one-click mode switching
- **CLI control** — scriptable management via `devroom` command
- **No Docker dependency** — one less abstraction layer, simpler debugging
- **Caddy with auto-TLS** — `https://devroom.lan` preserved, now via Homebrew
