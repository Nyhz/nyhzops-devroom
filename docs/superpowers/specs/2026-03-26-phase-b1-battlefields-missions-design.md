# Phase B1: Battlefields + Mission CRUD — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** B1 (Battlefields + Mission CRUD)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase A (Foundation) — complete

---

## Overview

Phase B1 adds the core data management layer: battlefield creation (both new and linked flows), mission CRUD with the quick deploy form, real-time scaffold streaming, and the mission detail page. After B1, the Commander can create projects, deploy missions to the queue, and view mission details. Execution (B2) and bootstrap (B3) come next.

---

## 1. Server Actions — Battlefield

**File:** `src/actions/battlefield.ts`

All actions use `"use server"` directive and call `revalidatePath()` after mutations.

### Actions

#### `createBattlefield(data: CreateBattlefieldInput): Promise<Battlefield>`

**Input:**
```typescript
interface CreateBattlefieldInput {
  name: string;
  codename: string;
  description?: string;
  initialBriefing?: string;
  scaffoldCommand?: string;
  defaultBranch?: string;       // default: 'main'
  repoPath?: string;            // provided only for "link existing repo" flow
}
```

**Behavior:**

*New project flow (no `repoPath`):*
1. Compute `repoPath` = `{config.devBasePath}/{toKebabCase(name)}`.
2. Validate directory does not already exist.
3. `mkdir -p {repoPath}`.
4. Run `git init` in the new directory (via `simple-git`).
5. Create battlefield record in DB with status `active`.
6. If `scaffoldCommand` provided: trigger scaffold via Route Handler (see §7). The scaffold runs asynchronously — the action returns immediately.
7. Return the battlefield.

*Link existing repo flow (`repoPath` provided):*
1. Validate `repoPath` exists and is a git repository (check for `.git`).
2. Detect default branch from the repo.
3. Create battlefield record in DB with status `active`.
4. Return the battlefield.

#### `getBattlefield(id: string): Promise<BattlefieldWithCounts | null>`

Returns battlefield with aggregated counts:
- `missionCount`: total missions
- `campaignCount`: total campaigns
- `activeMissionCount`: missions in non-terminal statuses

#### `listBattlefields(): Promise<Battlefield[]>`

Returns all battlefields ordered by `updatedAt` desc.

#### `updateBattlefield(id: string, data: Partial<UpdateBattlefieldInput>): Promise<Battlefield>`

Updates editable fields: name, codename, description, initialBriefing, devServerCommand, autoStartDevServer, defaultBranch. Sets `updatedAt` to now.

#### `deleteBattlefield(id: string): Promise<void>`

Deletes battlefield and cascading records: missions, mission logs, campaigns, phases, scheduled tasks, command logs. Performs a transaction for atomicity.

---

## 2. Server Actions — Mission

**File:** `src/actions/mission.ts`

### Actions

#### `createMission(data: CreateMissionInput): Promise<Mission>`

**Input:**
```typescript
interface CreateMissionInput {
  battlefieldId: string;
  briefing: string;
  title?: string;         // auto-generated from briefing if not provided
  assetId?: string;
  priority?: MissionPriority;  // default: 'normal'
}
```

**Behavior:**
1. If `title` not provided: extract from first line of briefing (strip `#` prefix if markdown header), truncate to 80 chars.
2. Create mission with status `standby`.
3. `revalidatePath()` on the battlefield page.
4. Return mission.

#### `createAndDeployMission(data: CreateMissionInput): Promise<Mission>`

Same as `createMission` but sets status to `queued`. Ready for B2's orchestrator.

#### `getMission(id: string): Promise<MissionWithDetails | null>`

Returns mission with:
- Asset details (codename, specialty) via join
- Battlefield codename
- Log count

#### `listMissions(battlefieldId: string, options?: ListMissionsOptions): Promise<Mission[]>`

**Options:**
```typescript
interface ListMissionsOptions {
  search?: string;       // filter by title (LIKE '%search%')
  status?: MissionStatus;
}
```

Sorted: active statuses first (`in_combat`, `deploying`, `queued` — by priority, then createdAt), then terminal/standby statuses by createdAt desc.

#### `abandonMission(id: string): Promise<Mission>`

Sets status to `abandoned`. Only valid from `standby` or `queued`. Throws if mission is in any other status. Sets `completedAt` to now.

---

## 3. Battlefield Creation Form

**New files:**
- `src/app/projects/new/page.tsx` — Page wrapper (Server Component)
- `src/components/battlefield/create-battlefield.tsx` — Form (Client Component)

### Page

`/projects/new` — accessible via `[+ NEW BATTLEFIELD]` button on the projects list page.

### Form Component

Client Component with two modes toggled by a switch/link.

**Default mode — New Project:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | text input | yes | Used to compute repo path |
| Codename | text input | yes | Auto-generated from name (e.g., "My Blog" → "OPERATION BLOG"), editable |
| Description | text input | no | One-liner |
| Initial Briefing | large textarea | no | Commander's project description |
| Scaffold command | text input | no | e.g., `npx create-next-app@latest . --typescript` |
| Default branch | text input | no | Default: "main" |

Displays computed repo path below name field: `{DEVROOM_DEV_BASE_PATH}/{kebab-case-name}` (read-only).

**Link Existing Repo mode** (toggle via `[Link existing repo]`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Repo path | text input | yes | Absolute path, validated as git repo |
| Name | text input | yes | |
| Codename | text input | yes | Auto-generated, editable |
| Description | text input | no | |
| Initial Briefing | large textarea | no | |

No scaffold command. No default branch input (detected from repo).

**Codename auto-generation:** Convert name to uppercase, prepend "OPERATION ". E.g., "My Blog Engine" → "OPERATION BLOG ENGINE". Commander can edit.

**Submit:**
1. Call `createBattlefield` Server Action.
2. On success: `router.push(/projects/[id])`.
3. If scaffold command was provided: the battlefield page will show scaffold output streaming.

**Validation:**
- Name required, non-empty.
- Repo path (link mode): validated server-side as existing directory with `.git`.
- Computed repo path (new mode): validated server-side as non-existing directory.

---

## 4. Quick Deploy Mission Form

**New file:** `src/components/dashboard/deploy-mission.tsx` — Client Component

**Modification:** `src/app/projects/[id]/page.tsx` — Replace disabled form with live component.

### Component

Props: `battlefieldId: string`, `assets: Asset[]`

**UI:**
- Amber header: `DEPLOY MISSION`
- **Textarea**: briefing input, placeholder "Describe the mission objective and any relevant intel..."
- **Asset selector**: TacSelect dropdown populated with active assets. Shows codename. Optional (missions can run without an assigned asset).
- **Load dossier**: Small link/button. Opens hidden `<input type="file" accept=".md,.txt">`. On file select: reads content via `FileReader.readAsText()`, sets textarea value. Filename shown briefly as confirmation.
- **SAVE** button (success variant): calls `createMission` → `standby`
- **SAVE & DEPLOY** button (primary/amber variant): calls `createAndDeployMission` → `queued`

**After submit:** Clear form fields. `revalidatePath` (called by Server Actions) refreshes the mission list below. Optionally show a brief success toast/flash.

---

## 5. Mission List (Real Data)

**New files:**
- `src/components/dashboard/mission-list.tsx` — Presentational (maps over missions, renders rows)
- `src/components/dashboard/mission-list-client.tsx` — Client Component wrapper (search state + filtering)
- `src/components/dashboard/stats-bar.tsx` — Stats bar component

**Modification:** `src/app/projects/[id]/page.tsx` — Replace empty state with real data.

### Stats Bar

Displays 5 metrics in a row with `bg-dr-surface` cells separated by 1px gaps:

| Metric | Color | Source |
|--------|-------|--------|
| IN COMBAT | amber | count of missions with status `in_combat` |
| ACCOMPLISHED | green | count of `accomplished` |
| COMPROMISED | red | count of `compromised` |
| STANDBY | dim | count of `standby` + `queued` |
| CACHE HIT % | green | computed from sum(costCacheHit) / sum(costInput) or "—" if no data |

Queried server-side in the page component and passed as props.

### Mission List

**Row layout:**
```
┌────────────────────────────────────────────────────────────┐
│ ▌ Mission title (truncated)                    ● STATUS    │
│ ▌ ASSET_CODENAME · 9 mins ago                      VIEW   │
└────────────────────────────────────────────────────────────┘
```

- Left border: 2px colored by status (green=accomplished, amber=in_combat/deploying/queued, red=compromised, dim=standby/abandoned)
- Title: `text-dr-text`, truncated with ellipsis
- Iteration badge: if `iterations > 1`, show `×{iterations}` badge
- Asset + time: dim text, asset codename or "NO ASSET", relative timestamp via `formatRelativeTime()`
- Status: TacBadge
- VIEW: link to `/projects/[id]/missions/[missionId]`

**Search:** Client-side filtering by title. SearchInput at the top of the section. Filters the pre-loaded mission array.

**Sorting:** Server-side. Active statuses first (in_combat > deploying > queued), then by createdAt desc.

---

## 6. Mission Detail Page

**Modification:** `src/app/projects/[id]/missions/[missionId]/page.tsx` — Replace stub.

### Server Component

Async with `await params` for both `id` and `missionId`. Queries:
- Mission with asset join
- Battlefield for codename
- Mission logs (empty in B1, ready for B2)

### Layout

**Header:**
- Title: `MISSION: {title}` (large)
- Status badge + Asset codename + Priority badge
- Breadcrumb: `Battlefields // {battlefield.name} // Missions // {title}`

**Briefing section:**
- `BRIEFING` header (amber)
- Separator
- Briefing content in `whitespace-pre-wrap` (plain text rendering for B1; markdown rendering can be added later)

**Comms section:**
- `COMMS` header (amber)
- Separator
- Terminal component with placeholder: "Awaiting deployment. Comms will appear here when the mission is in combat."
- In B2: this will subscribe to `mission:{id}` Socket.IO room for live streaming

**Tokens section:**
- Card with: Input tokens, Output tokens, Cache hit count + percentage, Duration
- All zeros/dashes in B1 until B2 populates them

**Actions:**
- `[ABANDON]` button (danger variant)
- Only enabled when status is `standby` or `queued`
- Calls `abandonMission` Server Action
- After action: page revalidates, status updates

---

## 7. Scaffold Streaming

**New files:**
- `src/app/api/battlefields/[id]/scaffold/route.ts` — Route Handler
- `src/lib/process/command-runner.ts` — Reusable process spawn utility
- `src/components/battlefield/scaffold-output.tsx` — Client Component

### Command Runner (`src/lib/process/command-runner.ts`)

Reusable utility for spawning shell commands with streaming:

```typescript
interface RunCommandOptions {
  command: string;
  cwd: string;
  socketRoom?: string;       // Socket.IO room to stream to
  abortSignal?: AbortSignal;
}

interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

**Behavior:**
1. Parse command string into executable + args (handle shell syntax).
2. Spawn via `child_process.spawn` with `shell: true`.
3. Stream stdout/stderr line by line:
   - If `socketRoom` provided: emit `console:output` events via `globalThis.io`
   - Accumulate in memory for the return value
4. On close: return `RunCommandResult`.
5. AbortController support: kills process on signal.

This utility will be reused by B2 (orchestrator/executor), Phase D (console quick commands), and Phase D (dev server management).

### Scaffold Route Handler (`POST /api/battlefields/[id]/scaffold`)

1. Read battlefield from DB, validate it has a `scaffoldCommand`.
2. Create an AbortController.
3. Run scaffold command via `runCommand()`:
   - `cwd`: battlefield's repo path
   - `socketRoom`: `console:{battlefieldId}`
4. On success (exit 0):
   - Run `git add -A && git commit -m "Initial scaffold"` via `simple-git`.
   - Emit `console:exit` event with exit code 0.
5. On failure:
   - Emit `console:exit` event with error exit code.
6. Return JSON: `{ success: boolean, exitCode: number }`.

### Scaffold Output Component (`src/components/battlefield/scaffold-output.tsx`)

Client Component:
- Subscribes to `console:{battlefieldId}` Socket.IO room via `useSocket()`
- Collects `console:output` events into a log array
- Renders in the Terminal component
- Shows exit status when `console:exit` received
- Displayed on the battlefield page when scaffold is in progress (detected by checking if the battlefield was just created and has a scaffoldCommand)

---

## 8. Socket.IO Events (New)

Phase B1 adds these events to the existing Socket.IO infrastructure:

### Server → Client

| Event | Payload | Room | Description |
|-------|---------|------|-------------|
| `console:output` | `{ battlefieldId, content, timestamp }` | `console:{battlefieldId}` | Scaffold command stdout/stderr line |
| `console:exit` | `{ battlefieldId, exitCode, durationMs }` | `console:{battlefieldId}` | Scaffold command completed |
| `activity:event` | `{ type, battlefieldCodename, missionTitle, timestamp, detail }` | `hq:activity` | Mission created/abandoned events |

### Client → Server

Already defined in Phase A:
- `console:subscribe` / `hq:subscribe` — room join

---

## 9. New Types

**Added to `src/types/index.ts`:**

```typescript
// Input types for Server Actions
interface CreateBattlefieldInput {
  name: string;
  codename: string;
  description?: string;
  initialBriefing?: string;
  scaffoldCommand?: string;
  defaultBranch?: string;
  repoPath?: string;
}

interface UpdateBattlefieldInput {
  name?: string;
  codename?: string;
  description?: string;
  initialBriefing?: string;
  devServerCommand?: string;
  autoStartDevServer?: boolean;
  defaultBranch?: string;
}

interface CreateMissionInput {
  battlefieldId: string;
  briefing: string;
  title?: string;
  assetId?: string;
  priority?: MissionPriority;
}

interface ListMissionsOptions {
  search?: string;
  status?: MissionStatus;
}

// Enriched types for UI
interface BattlefieldWithCounts extends Battlefield {
  missionCount: number;
  campaignCount: number;
  activeMissionCount: number;
}

interface MissionWithDetails extends Mission {
  assetCodename?: string;
  assetSpecialty?: string;
  battlefieldCodename: string;
  logCount: number;
}

// Command runner types
interface RunCommandOptions {
  command: string;
  cwd: string;
  socketRoom?: string;
  abortSignal?: AbortSignal;
}

interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

---

## 10. Page & Route Changes

### New Pages/Routes

| Route | Type | Description |
|-------|------|-------------|
| `/projects/new` | Page | Battlefield creation form |
| `/api/battlefields/[id]/scaffold` | Route Handler | POST — triggers scaffold command |

### Modified Pages

| Route | Change |
|-------|--------|
| `/projects` | Add `[+ NEW BATTLEFIELD]` button linking to `/projects/new` |
| `/projects/[id]` | Wire deploy form, real stats bar, real mission list |
| `/projects/[id]/missions/[missionId]` | Replace stub with full detail page |

### Sidebar Updates

The sidebar's mission count badge should now reflect real data. This is already queried in the sidebar Server Component from Phase A — it just needs to count missions per battlefield instead of showing 0.

---

## 11. Hooks (New)

### `src/hooks/use-command-output.ts`

Client hook for subscribing to command output streams:

```typescript
function useCommandOutput(battlefieldId: string): {
  logs: Array<{ content: string; timestamp: number }>;
  exitCode: number | null;
  isRunning: boolean;
}
```

Subscribes to `console:{battlefieldId}` room. Collects `console:output` and `console:exit` events.

---

## 12. What Is NOT Built in Phase B1

- Mission execution (Claude Code spawn) — Phase B2
- Orchestrator queue engine — Phase B2
- Real-time mission comms streaming — Phase B2
- Git worktree management — Phase B2
- Bootstrap flow (CLAUDE.md/SPEC.md generation) — Phase B3
- Image paste in briefing textarea — deferred (tracked in memory)
- Full mission form (modal with all fields) — deferred
- Campaign CRUD — Phase C
- Session reuse / Continue Mission / Redeploy — Phase B2

---

## 13. End State

After Phase B1 is complete:
1. Commander can create new battlefields (with directory scaffold + git init) or link existing repos
2. Scaffold commands stream output in real-time
3. Commander can quick-deploy missions with briefing + optional asset selection
4. Commander can load `.md`/`.txt` dossiers into the briefing
5. Missions appear in the list with correct statuses (standby/queued)
6. Mission detail page shows full layout with briefing, placeholder comms, and token stats
7. Commander can abandon standby/queued missions
8. Stats bar shows real mission counts
9. All data persisted in SQLite, real-time events flowing via Socket.IO
