# Phase D3: Console & Dev Server — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** D3 (Console)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Replace the console stub with a command execution panel: dev server lifecycle management (start/stop/restart with log streaming), quick command buttons auto-detected from package.json, and custom command input. Reuses the existing `command-runner.ts` utility and Socket.IO infrastructure.

---

## 1. Dev Server Manager

**File:** `src/lib/process/dev-server.ts`

Manages the dev server process per battlefield.

```typescript
class DevServerManager {
  private servers: Map<string, { proc: ChildProcess; port?: number; pid: number; startedAt: number }>;

  start(battlefieldId: string, command: string, cwd: string): void;
  stop(battlefieldId: string): void;
  restart(battlefieldId: string): void;
  getStatus(battlefieldId: string): DevServerStatus;
  stopAll(): void;  // for graceful shutdown
}

interface DevServerStatus {
  running: boolean;
  port: number | null;
  pid: number | null;
  uptime: number | null;  // ms since start
}
```

**`start`:** Spawn the dev command via `child_process.spawn` with `shell: true`. Stream stdout/stderr via Socket.IO `devserver:{battlefieldId}` room. Auto-detect port from output (regex for common patterns like "localhost:3000"). Store process reference.

**`stop`:** Send SIGTERM, wait 5s, SIGKILL if needed. Emit `devserver:status` (stopped).

**`restart`:** Stop then start.

**Singleton:** Created in `server.ts`, stored on `globalThis.devServerManager`.

**Auto-start:** On server boot, query battlefields with `autoStartDevServer = 1`, start their dev servers.

---

## 2. Console Server Actions

**File:** `src/actions/console.ts`

### Actions

| Action | Behavior |
|--------|----------|
| `startDevServer(battlefieldId)` | Get battlefield's devServerCommand, call DevServerManager.start |
| `stopDevServer(battlefieldId)` | Call DevServerManager.stop |
| `restartDevServer(battlefieldId)` | Call DevServerManager.restart |
| `getDevServerStatus(battlefieldId)` | Return current status |
| `runQuickCommand(battlefieldId, command)` | Use `runCommand` from command-runner.ts, stream to `console:{battlefieldId}`, log in commandLogs |
| `getPackageScripts(battlefieldId)` | Read package.json from repo, extract `scripts` object, return as array |
| `getCommandHistory(battlefieldId, limit?)` | Query `commandLogs` table for recent commands |

---

## 3. Console Page

**Replace:** `src/app/projects/[id]/console/page.tsx`

### Layout

**Top: Dev Server Panel**
- Status indicator: `● RUNNING` (green) / `● STOPPED` (dim) / `● CRASHED` (red)
- Info: command, PID, uptime
- Buttons: `[START]` / `[STOP]` / `[RESTART]`
- Log stream: Terminal component subscribing to `devserver:{battlefieldId}` Socket.IO room
- `[Open http://localhost:{port} ↗]` link when running

**Middle: Quick Commands**
- Auto-detected from package.json scripts (buttons)
- Custom command input + `[RUN]` button

**Bottom: Command Output**
- Terminal showing last command output (subscribes to `console:{battlefieldId}`)
- Exit code display
- Command history (collapsible list from commandLogs)

### Components

- `src/components/console/dev-server-panel.tsx` — Client Component (Socket.IO for logs + status)
- `src/components/console/quick-commands.tsx` — Client Component (buttons + custom input)
- `src/components/console/command-output.tsx` — Client Component (uses existing `useCommandOutput` hook)

### Hooks

- Existing `useCommandOutput` from `src/hooks/use-command-output.ts` — reuse for quick command output
- New `useDevServer` hook (`src/hooks/use-dev-server.ts`) — subscribes to `devserver:{battlefieldId}` for log streaming + status events

---

## 4. Socket.IO Events

**Dev server events (already defined in Phase A):**
| Event | Payload | Room |
|-------|---------|------|
| `devserver:log` | `{ battlefieldId, content, timestamp }` | `devserver:{battlefieldId}` |
| `devserver:status` | `{ battlefieldId, status, port, pid }` | `devserver:{battlefieldId}` |

---

## 5. Server.ts Changes

- Create DevServerManager singleton, store on `globalThis.devServerManager`
- On startup: auto-start dev servers for flagged battlefields
- On shutdown: `devServerManager.stopAll()`
