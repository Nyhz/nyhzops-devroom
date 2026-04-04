# FIELD CHECK & TELEMETRY — Page Revamp Design

> Replaces the legacy `/git` and `/console` pages with purpose-built operational dashboards.

---

## Background

The original `/git` page was a manual git GUI (stage, commit, branch, diff). The original `/console` page was a terminal replacement (dev server, quick commands, output history). Both were built early in the project when the Commander needed manual control.

DEVROOM has since matured into a full orchestrator where missions handle git operations automatically via worktrees, and the Quartermaster manages merging. Dedicated pages now exist for TESTS, DEPS, and ENV. Neither `/git` nor `/console` serves a purpose in their current form.

**What's missing:** operational visibility into repository hygiene and system health — the information the Commander needs when something feels off or during routine maintenance.

---

## FIELD CHECK — Repository Hygiene Dashboard

### Route & Navigation

| Property | Value |
|----------|-------|
| URL | `/battlefields/[id]/field-check` |
| Sidebar label | FIELD CHECK |
| Sidebar group | OPS TOOLS (replaces GIT) |
| Page title | FIELD CHECK |

### Purpose

Answers: *"Is my repo in good shape?"* — a maintenance dashboard for scanning the battlefield's repository for stale worktrees, dead branches, merge debris, and general health. Mostly read-only. The few actions are cleanup operations.

### Page Layout

Single page, no tabs. Four vertically stacked `TacCard` sections. No real-time subscriptions needed — data is fetched on page load (Server Component). A `[REFRESH]` button at the top triggers `router.refresh()`.

---

### Section 1: Worktree Status Board

A table of all worktrees associated with this battlefield.

**Columns:**

| Column | Description |
|--------|-------------|
| Branch | Worktree branch name (e.g. `devroom/operative/01JQXYZ`) |
| Mission | Linked mission codename + status badge, clickable to mission detail |
| Age | Duration since worktree creation |
| Disk | Size of the worktree directory on disk |
| State | Health indicator (see below) |

**State indicators:**

| State | Color | Meaning |
|-------|-------|---------|
| `● ACTIVE` | green | Linked to a running or reviewing mission |
| `● STALE` | amber | Mission is accomplished/compromised but worktree still exists |
| `● ORPHANED` | red | No linked mission found, or mission was abandoned |

**Actions:**
- Per-row `[CLEANUP]` button on stale/orphaned worktrees — removes worktree directory + deletes the branch. Requires confirmation.
- Bulk `[CLEANUP ALL STALE]` button in section header — removes all stale/orphaned worktrees at once. Requires confirmation with count.

**Empty state:** "NO WORKTREES — All clean."

**Data source:** `simple-git` worktree list cross-referenced with the `missions` table. Disk usage via `fs.stat` recursive size calculation (or `du -s`).

---

### Section 2: Branch Hygiene

Summary stats + a list of branches that need attention. Not a full branch list — only problems.

**Stats bar** (horizontal row of stat chips):

| Stat | Description |
|------|-------------|
| Total | Total local branch count |
| Merged | Branches fully merged into main but not yet deleted |
| Unmerged | Branches with unmerged commits |
| Active | Branches tied to in-progress missions |

**Problem branch list** (only shown if problems exist):

Each entry shows:
- Branch name
- Problem type: `MERGED — SAFE TO DELETE` / `STALE — NO LINKED MISSION` / `DIVERGED — X ahead, Y behind`
- Age since last commit on branch
- `[DELETE]` button (with confirmation)

**Bulk action:** `[PRUNE MERGED]` button — deletes all fully-merged branches at once. Requires confirmation with count.

**Clean state:** When no problem branches exist, show a green status line: "✓ ALL BRANCHES CLEAN"

**Data source:** `simple-git` branch list with `--merged` / `--no-merged` checks against main branch. Cross-reference with missions table for "active" classification.

---

### Section 3: Quartermaster Activity Log

Recent merge operations performed by the Quartermaster for this battlefield. Last 20 entries, newest first.

**Each entry shows:**

| Field | Description |
|-------|-------------|
| Mission | Codename, clickable to mission detail |
| Merge | Branch merged → target branch (e.g. `devroom/operative/01JQX → main`) |
| Result | `✓ CLEAN MERGE` (green) / `⚡ CONFLICT RESOLVED` (amber) / `✗ MERGE FAILED` (red) |
| Timestamp | Relative time |

**Expandable detail** (on conflict-resolved and failed entries):
- Files that conflicted
- Quartermaster's resolution approach (from its debrief)
- Number of conflict hunks resolved

**Empty state:** "NO MERGE ACTIVITY YET"

**Data source — NEW:** Requires persisting merge metadata. Two options:

1. **Extend missions table** — add `mergeResult` (enum: `clean` / `conflict_resolved` / `failed`), `mergeConflictFiles` (JSON array), `mergeTimestamp`. Simplest approach since merges are 1:1 with missions.
2. **New `quartermasterLogs` table** — separate table with `id`, `missionId`, `battlefieldId`, `sourceBranch`, `targetBranch`, `result`, `conflictFiles`, `resolutionSummary`, `createdAt`. More normalized but adds a table.

**Decision:** Option 1 (extend missions table). The merge is always tied to a mission. Three new columns is simpler than a new table. Add `mergeResult`, `mergeConflictFiles`, and `mergeTimestamp` to the missions schema.

---

### Section 4: Repo Vitals

Simple key-value stats panel. One horizontal row of stat cards.

| Metric | Description |
|--------|-------------|
| Repo Size | Total `.git` directory size (human-readable, e.g. "142 MB") |
| Total Commits | Commit count on main branch |
| Last Commit | Relative time + short message (truncated) |
| Worktree Disk | Sum of all worktree directory sizes |
| Main Branch | Branch name + clean/dirty indicator |

**Data source:** `simple-git` for commit count and last commit. `fs` for directory sizes. `git status --porcelain` for clean/dirty check.

---

### Server Actions (new file: `src/actions/field-check.ts`)

```
getWorktreeStatus(battlefieldId) → WorktreeEntry[]
cleanupWorktree(battlefieldId, worktreePath) → void
cleanupAllStale(battlefieldId) → { cleaned: number }
getBranchHygiene(battlefieldId) → { stats: BranchStats, problems: ProblemBranch[] }
deleteBranch(battlefieldId, branch) → void
pruneAllMerged(battlefieldId) → { pruned: number }
getQuartermasterLog(battlefieldId, limit?: number) → QMLogEntry[]
getRepoVitals(battlefieldId) → RepoVitals
```

---

### Components (new directory: `src/components/field-check/`)

```
WorktreeBoard       — table of worktrees with state indicators and cleanup actions
BranchHygiene       — stats bar + problem branch list with actions
QuartermasterLog    — merge activity list with expandable conflict details
RepoVitals          — horizontal stat card row
```

All are Client Components (they need `useTransition` for actions and `useConfirm` for destructive ops).

---

## TELEMETRY — System Diagnostics Center

### Route & Navigation

| Property | Value |
|----------|-------|
| URL | `/battlefields/[id]/telemetry` |
| Sidebar label | TELEMETRY |
| Sidebar group | OPS TOOLS (replaces CONSOLE) |
| Page title | TELEMETRY |

### Purpose

Answers: *"Is my orchestrator healthy?"* and *"Why did that mission die?"* — a system diagnostics dashboard showing active processes, resource usage, recent failures, and background service health. Partially live via Socket.IO.

### Page Layout

Single page, no tabs. Four vertically stacked `TacCard` sections. Sections 1 and 4 have live data via Socket.IO. Sections 2 and 3 are server-rendered with manual refresh.

---

### Section 1: Active Processes

Live table of all Claude Code processes currently running for this battlefield.

**Columns:**

| Column | Description |
|--------|-------------|
| Mission | Codename, clickable to mission detail |
| Asset | Asset codename (OPERATIVE, VANGUARD, etc.) |
| PID | Process ID |
| Runtime | Live counter (e.g. `4m 32s`), updating every second client-side |
| Status | Status badge (`IN COMBAT` / `REVIEWING` / `DEPLOYING`) |
| Memory | RSS memory usage of the process |
| Last Output | Relative time since last stdout/stderr line — stall indicator |

**Actions:**
- Per-row `[KILL]` button with confirmation — sends SIGTERM, then SIGKILL after 5s timeout
- `[KILL ALL]` in section header for emergencies — requires confirmation with count

**Empty state:** "NO ACTIVE PROCESSES" (dim)

**Dev Server Widget** — compact subsection below the process table:

| Field | Value |
|-------|-------|
| Status | `● RUNNING` on port XXXX / `● STOPPED` |
| PID | Process ID (if running) |
| Uptime | Duration since start |
| Controls | `[START]` / `[STOP]` / `[RESTART]` buttons |

No log stream — just status and controls. The old console's terminal view is intentionally not replicated.

**Real-time updates:** Subscribes to a new Socket.IO room `telemetry:{battlefieldId}`. Server emits:
- `telemetry:processes` — updated process list (emitted on process start/stop and every 10s for memory/stall updates)
- `telemetry:devserver` — dev server status changes

**Data source:** Process manager already tracks PIDs and start times. Memory usage via periodic `process.memoryUsage()` or `pidusage` npm package for child process stats. Last output timestamp from mission log stream.

---

### Section 2: Resource Usage

Key system metrics as a horizontal row of stat cards with health indicators.

| Metric | Green | Amber | Red |
|--------|-------|-------|-----|
| Agent Slots | `< 80%` used | `80-99%` used | `100%` (all full) |
| Worktree Disk | `< 500 MB` | `500 MB – 1 GB` | `> 1 GB` |
| Temp Disk (`/tmp/claude-config/`) | `< 200 MB` | `200 – 500 MB` | `> 500 MB` |
| DB Size (SQLite + WAL) | `< 50 MB` | `50 – 200 MB` | `> 200 MB` |
| Socket.IO Connections | Informational | — | — |

Each card shows:
- Metric label
- Current value (human-readable)
- Health dot (green/amber/red)
- For slot-based metrics: `3 / 5` format

**Thresholds are configurable defaults**, not hard rules. They can be adjusted later if needed.

**Data source:** Filesystem stats, SQLite file size, Socket.IO server `engine.clientsCount`, process manager state for agent slots.

---

### Section 3: Recent Exits

Last 20 process completions for this battlefield, newest first. The "why did that mission die" section.

**Each row:**

| Field | Description |
|-------|-------------|
| Mission | Codename, clickable to mission detail |
| Exit | `✓ 0` (green) / `✗ 1` (red) / `⏱ TIMEOUT` (amber) / `☠ KILLED` (red) |
| Duration | How long the process ran |
| Failure type | `TIMEOUT` / `AUTH FAILURE` / `CLI ERROR` / `STALL KILLED` / `UNKNOWN` (only for non-zero exits) |
| Timestamp | Relative time |

**Expandable:** Click a row to reveal the last ~20 lines of stderr/stdout captured before exit.

**Filters:** Toggle buttons at top — `ALL` / `CRASHES` / `TIMEOUTS` / `KILLED`. Default view: `ALL` (but non-zero exits are visually emphasized).

**Data source:** Missions table already has `status`, `exitCode`, `startedAt`, `completedAt`. Failure type classification:
- Exit code + timeout flag → `TIMEOUT`
- Exit code + killed flag → `STALL KILLED` or `KILLED`
- Stderr containing "auth" / "token" / "unauthorized" → `AUTH FAILURE`
- Everything else non-zero → `CLI ERROR` or `UNKNOWN`

**Stderr tail — NEW:** The last ~20 lines of output before exit need to be captured. Options:
1. **Ring buffer in process manager** — keep last 20 lines in memory during execution, persist to missions table on exit as `exitContext` (text field).
2. **Query missionLogs table** — fetch last 20 entries for that mission from the logs table on demand.

**Decision:** Option 2 (query missionLogs). The data already exists in `missionLogs`. No new storage needed — just a query with `ORDER BY timestamp DESC LIMIT 20`.

---

### Section 4: Scheduler & Background Services

Status of background systems for this battlefield. Compact subsection per service.

**Scheduler:**

| Field | Description |
|-------|-------------|
| Status | `● RUNNING` (green) / `● STALLED` (red, if last tick > 2 min ago) |
| Last tick | Relative timestamp of last scheduler poll |
| Next fire | Next scheduled task time for this battlefield (or "NONE SCHEDULED") |
| Missed runs | Count of runs that should have fired but didn't (since last restart) |

**Overseer Queue:**

| Field | Description |
|-------|-------------|
| Pending reviews | Count of missions in REVIEWING status for this battlefield |
| Avg review time | Average duration of Overseer reviews (last 20) |
| Last review | Relative timestamp |

**Quartermaster Queue:**

| Field | Description |
|-------|-------------|
| Pending merges | Count of missions in MERGING status for this battlefield |
| Last merge | Relative timestamp |

**Stall Detection:**

| Field | Description |
|-------|-------------|
| Stalls (24h) | Count of stall detections in last 24 hours |
| Last stall | Mission codename + timestamp + what Overseer decided |

**Health indicators:** Each subsystem gets a dot:
- Green: operating normally
- Amber: degraded (queue growing, slow reviews)
- Red: stalled or unresponsive

**Real-time updates:** Same `telemetry:{battlefieldId}` Socket.IO room. Server emits `telemetry:services` on state changes.

**Data source:** Scheduler state from scheduler singleton. Queue depths from missions table filtered by status. Stall data from `overseerLogs` or notifications table. Review/merge timing from mission timestamps.

---

### Server Actions (new file: `src/actions/telemetry.ts`)

```
getActiveProcesses(battlefieldId) → ProcessEntry[]
killProcess(battlefieldId, missionId) → void
killAllProcesses(battlefieldId) → { killed: number }
getDevServerStatus(battlefieldId) → DevServerStatus  (reuse from existing console actions)
startDevServer(battlefieldId) → void               (reuse from existing console actions)
stopDevServer(battlefieldId) → void                (reuse from existing console actions)
restartDevServer(battlefieldId) → void             (reuse from existing console actions)
getResourceUsage(battlefieldId) → ResourceMetrics
getRecentExits(battlefieldId, filter?: string) → ExitEntry[]
getExitContext(missionId) → string[]               (last 20 log lines)
getServiceHealth(battlefieldId) → ServiceHealthStatus
```

---

### Components (new directory: `src/components/telemetry/`)

```
ActiveProcesses     — live process table + kill actions + dev server widget (Client Component, Socket.IO)
ResourceUsage       — stat cards with health indicators (Server Component, refresh on demand)
RecentExits         — exit log with expandable stderr tail and filters (Client Component for interactivity)
ServiceHealth       — background service status panel (Client Component, Socket.IO)
```

---

### Socket.IO Events (new)

**Room:** `telemetry:{battlefieldId}`

| Event | Payload | Frequency |
|-------|---------|-----------|
| `telemetry:processes` | `ProcessEntry[]` | On process start/stop + every 10s |
| `telemetry:devserver` | `DevServerStatus` | On status change |
| `telemetry:services` | `ServiceHealthStatus` | On state change |

---

## Migration Plan

### What Gets Removed

- `/battlefields/[id]/git` route — page, loading skeleton
- `/battlefields/[id]/console` route — page, loading skeleton
- `src/components/git/` — all components (GitStatus, GitLog, GitBranches, GitDiff)
- `src/components/console/` — all components (DevServerPanel, QuickCommands, CommandOutput)
- `src/actions/git.ts` — all manual git actions (stage, unstage, commit, checkout, etc.)
- `src/actions/console.ts` — quick command runner actions (dev server actions are reused)
- `src/hooks/use-command-output.ts` — console output hook
- Sidebar references updated: GIT → FIELD CHECK, CONSOLE → TELEMETRY

### What Gets Reused

- `src/actions/console.ts` dev server actions (`startDevServer`, `stopDevServer`, `restartDevServer`, `getDevServerStatus`) — moved or re-exported from telemetry actions
- `src/hooks/use-dev-server.ts` — reused in Telemetry active processes section
- `src/lib/process/dev-server.ts` (DevServerManager) — unchanged
- `src/lib/process/command-runner.ts` — kept (used elsewhere), but no longer surfaced in a page
- `commandLogs` DB table — kept for history, no longer written to from a page UI
- UI primitives: `TacCard`, `TacButton`, `TacInput`, `Terminal` — reused as needed

### What Gets Added

- New route: `/battlefields/[id]/field-check` + page + loading skeleton
- New route: `/battlefields/[id]/telemetry` + page + loading skeleton
- New actions file: `src/actions/field-check.ts`
- New actions file: `src/actions/telemetry.ts`
- New component directory: `src/components/field-check/`
- New component directory: `src/components/telemetry/`
- New Socket.IO room: `telemetry:{battlefieldId}` with events
- DB migration: add `mergeResult`, `mergeConflictFiles`, `mergeTimestamp` columns to missions table
- Sidebar update: replace GIT/CONSOLE entries with FIELD CHECK/TELEMETRY

### What Gets Modified

- Quartermaster execution logic — persist merge result metadata to missions table after merge
- Process manager — expose memory usage and last-output timestamps
- Socket.IO server setup — register new `telemetry` room and events
- Sidebar component — update labels and routes

---

## Types (added to `src/types/index.ts`)

### Field Check Types

```typescript
interface WorktreeEntry {
  path: string
  branch: string
  linkedMission: { id: string; codename: string; status: MissionStatus } | null
  age: number          // ms since creation
  diskUsage: number    // bytes
  state: 'active' | 'stale' | 'orphaned'
}

interface BranchStats {
  total: number
  merged: number
  unmerged: number
  active: number
}

interface ProblemBranch {
  name: string
  problem: 'merged' | 'stale' | 'diverged'
  lastCommitAge: number   // ms
  ahead?: number
  behind?: number
}

interface QMLogEntry {
  missionId: string
  missionCodename: string
  sourceBranch: string
  targetBranch: string
  result: 'clean' | 'conflict_resolved' | 'failed'
  conflictFiles: string[]
  resolutionSummary: string | null
  timestamp: number
}

interface RepoVitals {
  repoSize: number       // bytes
  totalCommits: number
  lastCommit: { message: string; timestamp: number }
  worktreeDisk: number   // bytes
  mainBranch: string
  isDirty: boolean
}
```

### Telemetry Types

```typescript
interface ProcessEntry {
  missionId: string
  missionCodename: string
  asset: string
  pid: number
  startedAt: number
  status: MissionStatus
  memoryRss: number         // bytes
  lastOutputAt: number      // timestamp of last stdout/stderr line
}

interface ResourceMetrics {
  agentSlots: { active: number; max: number }
  worktreeDisk: number      // bytes
  tempDisk: number          // bytes
  dbSize: number            // bytes, includes WAL
  socketConnections: number
}

interface ExitEntry {
  missionId: string
  missionCodename: string
  exitCode: number | null
  duration: number          // ms
  failureType: 'timeout' | 'auth_failure' | 'cli_error' | 'stall_killed' | 'killed' | 'unknown' | null
  timestamp: number
}

interface ServiceHealthStatus {
  scheduler: {
    status: 'running' | 'stalled'
    lastTick: number | null
    nextFire: number | null
    missedRuns: number
  }
  overseer: {
    pendingReviews: number
    avgReviewTime: number | null  // ms
    lastReview: number | null
  }
  quartermaster: {
    pendingMerges: number
    lastMerge: number | null
  }
  stallDetection: {
    count24h: number
    lastStall: {
      missionCodename: string
      timestamp: number
      overseerDecision: string
    } | null
  }
}
```
