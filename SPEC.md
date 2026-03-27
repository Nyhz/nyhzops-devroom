# SPEC.md — DEVROOM Operational Specifications

**NYHZ OPS — DEVROOM**

This document specifies every feature, screen, and workflow. Use alongside `CLAUDE.md` for tech stack, structure, coding rules, and domain model.

---

## 1. System Boot & Server

### 1.1 Startup Sequence

1. Load config from `.env.local` and environment variables.
2. Open SQLite at `DEVROOM_DB_PATH` via better-sqlite3.
3. Set pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
4. Run pending Drizzle migrations.
5. Seed default assets if assets table is empty.
6. Prepare Next.js app.
7. Create HTTP server, attach Socket.IO, wire Next.js handler.
8. Create Orchestrator (queue poll loop) and DevServerManager, assign to `globalThis`.
9. Pause any campaigns left `active` from previous run.
10. Auto-start dev servers for flagged battlefields (`autoStartDevServer = true`).
11. Start Scheduler (cron engine + seed WORKTREE SWEEP daily task at 03:00).
12. Start Telegram bot polling (if `DEVROOM_TELEGRAM_BOT_TOKEN` configured).
13. Detect local IP via `os.networkInterfaces()`.
14. Register graceful shutdown handler (SIGINT/SIGTERM).
15. Log startup:
```
═══════════════════════════════════════════
  NYHZ OPS — DEVROOM
  Status:  OPERATIONAL
  Local:   http://localhost:7777
  Network: http://192.168.1.42:7777
  Agents:  0/5 deployed
═══════════════════════════════════════════
```

### 1.2 Graceful Shutdown

On `SIGINT` / `SIGTERM`:

1. Log: `DEVROOM — STANDING DOWN...`
2. Stop Telegram polling.
3. Stop Scheduler.
4. Stop all dev servers gracefully.
5. Abort all running missions via `orchestrator.shutdown()` (sets status → `abandoned`, notes shutdown in debrief).
6. Start 5s force-exit timer (unref'd so it doesn't keep the process alive).
7. Close Socket.IO, close HTTP server, close DB.
8. Exit.

### 1.3 LAN Access

Binds `0.0.0.0`. Footer: `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`. No auth.

---

## 2. Layout Shell

Every page shares the same shell (see `CLAUDE.md` for ASCII reference).

### 2.1 Intel Bar (top)

Full-width bar: `INTEL //` prefix + rotating military quote (60s interval, fade transition). Client Component.

### 2.2 Sidebar (left)

Fixed-width left sidebar:

**Identity block** (top):
- Brand initial `N` in colored circle.
- `NYHZ OPS` label + green operational dot.
- `DEVROOM` subtitle.

**Battlefield selector**:
- Dropdown showing current battlefield name (codename style).
- Selecting navigates to `/battlefields/[id]`.

**Global navigation** (top, above battlefield selector):
- `HQ` — Main dashboard overview.
- `CAPTAIN LOG` — AI decision log viewer.
- `LOGISTICS` — Token usage & rate limits.
- `OVERWATCH` — System metrics (links to `/overwatch`).

**Battlefield section navigation** (when a battlefield is selected):
- `■ MISSIONS` — with count badge.
- `✕ CAMPAIGNS`
- `◎ ASSETS`
- `◆ GIT`
- `▶ CONSOLE`
- `⏱ SCHEDULE`
- `⚙ CONFIG`

Active section: `bg-dr-elevated`, amber text.

**Intel Briefing** (bottom):
- Collapsible. System status: `● All systems operational`.
- Active agent count: `3/5 assets deployed`.

### 2.3 Status Footer (bottom)

Full-width: `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`. Green dot, dim monospace.

---

## 3. Battlefield Creation & Bootstrap

### 3.1 Creating a Battlefield

The creation form (`<CreateBattlefield />`) collects:

- **Name**: human-readable project name (e.g. "My Blog Engine").
- **Codename**: auto-generated tactical codename (e.g. "OPERATION THUNDER"), editable.
- **Description**: short one-liner about the project.
- **Initial Briefing**: large textarea — the Commander's description of the project. What it is, what stack it uses, what conventions to follow, the scope, architecture decisions, anything relevant. Can be a paragraph or several pages. This is the primary input for the bootstrap process.
- **Scaffold command** (optional): a command to run after folder creation (e.g. `npx create-next-app@latest . --typescript --tailwind --app --src-dir --use-npm`). If blank, only `git init` is performed.
- **Default branch**: (default: `main`).

The **repo path is NOT a form field**. It is auto-generated as `{DEVROOM_DEV_BASE_PATH}/{name-in-kebab-case}`. For a project named "My Blog Engine" with default base path `/dev`, the repo lands at `/dev/my-blog-engine`.

On submit:
1. Compute `repoPath` = `{basePath}/{toKebabCase(name)}`. Validate the folder doesn't already exist.
2. Create the directory: `mkdir -p {repoPath}`.
3. Run `git init` in the new directory.
4. If a scaffold command is provided:
   a. Execute it in the new directory (via `child_process.spawn`).
   b. Stream output to the client in real-time (Socket.IO `console:{battlefieldId}` room).
   c. Wait for completion. If it fails, show the error but still create the battlefield (Commander can fix later).
   d. After scaffold, run `git add -A && git commit -m "Initial scaffold"`.
5. Create battlefield record with status `initializing`.
6. Create a bootstrap mission (type `bootstrap`, asset ARCHITECT, priority `critical`).
7. Queue the bootstrap mission immediately.
8. Redirect to the battlefield page, which shows scaffold output (if any) followed by bootstrap in progress.

### 3.2 Linking Existing Repos

A secondary flow for existing projects. Toggle `[Link existing repo]` on the creation form reveals:
- **Repo path**: absolute path input. Validated as a git repo.
- Everything else stays the same (name, codename, description, initial briefing, etc.).
- The repo path is used directly instead of auto-generated.
- No `mkdir`, no `git init`, no scaffold. Straight to bootstrap.

### 3.3 Bootstrap Process

The bootstrap mission is a special mission type (`type: 'bootstrap'`). It runs like any other mission but has a dedicated prompt (see §14.6) and a specific post-completion flow.

The bootstrap process:
1. Claude Code analyzes the repo (file structure, existing code, package.json, configs, etc.).
2. Reads the Commander's Initial Briefing.
3. Generates two files:
   - **CLAUDE.md**: project conventions, stack, structure, domain model, coding rules, definition of done.
   - **SPEC.md**: detailed feature specification, screens, workflows, behaviors.
4. The generated content is stored in the mission's debrief field as a structured output (JSON with `claudeMd` and `specMd` keys).

### 3.4 Bootstrap Review

When the bootstrap mission reaches `accomplished`, the battlefield page shows a **review screen** instead of the normal overview. The `<BootstrapReview />` component displays:

```
┌──────────────────────────────────────────────────────────────┐
│  OPERATION THUNDER — BOOTSTRAP COMPLETE                      │
│  Status: INITIALIZING — Awaiting Commander review            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ CLAUDE.md ─────────────────────────────────────────────┐ │
│  │  (rendered markdown preview, scrollable)                 │ │
│  │  ...                                                    │ │
│  │                                            [EDIT]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ SPEC.md ───────────────────────────────────────────────┐ │
│  │  (rendered markdown preview, scrollable)                 │ │
│  │  ...                                                    │ │
│  │                                            [EDIT]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [APPROVE & DEPLOY]              [REGENERATE]  [ABANDON]     │
└──────────────────────────────────────────────────────────────┘
```

- **EDIT**: Opens an inline markdown editor for each file. Commander can modify before approving.
- **APPROVE & DEPLOY**: Commits both files to the repo root, auto-sets `claudeMdPath` and `specMdPath` on the battlefield, transitions status to `active`. The battlefield is now operational.
- **REGENERATE**: Re-runs the bootstrap mission with the same briefing (or Commander can edit the briefing first). Increments the mission's `iterations` count.
- **ABANDON**: Deletes the battlefield and the bootstrap mission.

### 3.5 Bootstrap During Initialization

While the bootstrap mission is running (`in_combat`), the battlefield page shows:

```
┌──────────────────────────────────────────────────────────────┐
│  OPERATION THUNDER — INITIALIZING                            │
│  Generating battlefield intel...                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  COMMS (live)                                                │
│  ──────────────────────────────────────────────────────────  │
│  > Analyzing repository structure...                         │
│  > Found: Next.js 14, TypeScript, Tailwind, Prisma          │
│  > Reading Commander's briefing...                           │
│  > Generating CLAUDE.md...                                   │
│  > █                                                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The Commander can watch the bootstrap in real-time via the comms stream, just like any other mission.

### 3.6 Skipping Bootstrap

If the Commander already has a CLAUDE.md for the project (e.g. migrating from another tool), the creation form includes an optional `[Skip bootstrap — I'll provide my own CLAUDE.md]` toggle. When enabled:
- The `claudeMdPath` field appears (file path input).
- Optionally `specMdPath`.
- The battlefield is created directly in `active` status. No bootstrap mission.

---

## 4. Battlefield Overview — `/battlefields/[id]`

Server Component. The main working screen.

### 4.1 Header

- Breadcrumb: `Battlefields // {name}`
- Title: `{codename}` — large, tactical font.
- Description line.
- Buttons: `[EDIT]` `[ASSETS]`.

### 4.2 Deploy Mission (inline)

Card with amber header `DEPLOY MISSION`:
- **Textarea**: placeholder "Describe the mission objective and any relevant intel..."
- **Asset selector**: dropdown of active assets (codename only).
- **Buttons**: `[SAVE]` (green) — saves as STANDBY. `[SAVE & DEPLOY]` (amber) — saves and queues. `[Load dossier]` — file picker for `.md`/`.txt` to populate briefing.
- Server Actions: `createMission` / `createAndDeployMission`.

### 4.3 Stats Bar

Large numbers + uppercase labels:

```
| 0 IN COMBAT | 251 ACCOMPLISHED | 0 COMPROMISED | 0 STANDBY | 100% |
```

Last value = overall cache hit rate. Live-updated via Socket.IO.

### 4.4 Mission List

Section header `MISSIONS` (amber) + search input.

Rows (div-based, not `<table>`):
- Mission title (truncated) + iteration badge if > 1.
- Below: `{ASSET} · {relative_time}` in dim.
- Status badge + `VIEW` button.
- Sorted: active first, then `createdAt` desc.
- Search filters by title.

### 4.5 Right Sidebar

**ASSETS** section:
- Header with `manage` link → `/battlefields/[id]/assets`.
- List: green dot (active) / gray (offline) + codename + model dim text.

**ASSET BREAKDOWN** section:
- Per-asset mission counts: `{CODENAME}  {total} ({done} done)`.
- Sorted by total desc.
- Includes `NO ASSET` row for unassigned.

---

## 5. Missions

### 5.1 Lifecycle

```
STANDBY → QUEUED → DEPLOYING → IN COMBAT → REVIEWING → ACCOMPLISHED
                                                     → COMPROMISED
                                          → ABANDONED
```

### 5.2 Creating a Mission

**Quick deploy** (battlefield overview): textarea + asset + SAVE/SAVE & DEPLOY.

**Full form** (modal or page): title, briefing (markdown + image paste), priority, asset, worktree toggle.

### 5.3 Load Dossier

The `<DossierSelector />` component lets the Commander pick a saved dossier template from the database. If the dossier has `{{variable}}` placeholders, a form appears to fill in values. The interpolated template populates the briefing textarea and the recommended asset is auto-selected. See §20 for full dossier details.

### 5.4 Execution Flow

In `executor.ts` when the orchestrator dequeues a mission:

1. **Status → DEPLOYING**. Emit events.
2. Worktree setup (if enabled):
   - Branch: `devroom/{codename}/{mission-id-short}`.
   - Create worktree via simple-git.
   - `cwd` = worktree path.
3. No worktree: `cwd` = repo root.
4. Build prompt via `prompt-builder.ts` (see §14).
5. Spawn Claude Code with AbortController.
6. **Status → IN COMBAT**.
7. Stream stdout:
   - Parse each JSON line.
   - Emit `mission:log` to Socket.IO room.
   - Store in `missionLogs`.
   - Track tokens incrementally.
8. On process close:
   - Calculate duration.
   - Parse final token usage.
   - Generate debrief (§5.6).
   - If worktree + success: trigger merge (§11).
   - **Status → REVIEWING** (captain review begins asynchronously).
   - Captain reviews debrief quality via `review-handler.ts` (up to 2 retries for successful missions, 1 for compromised).
   - On review pass: **Status → ACCOMPLISHED** or **COMPROMISED**.
   - On review fail after retries: escalate to Commander via Telegram.
   - Emit: `mission:status`, `mission:debrief`, `mission:tokens`, `activity:event`.

### 5.5 Session Reuse

Completed missions store `sessionId`. Detail page shows:
- **[Continue Mission]**: new mission reusing session (context preserved).
- **[Redeploy]**: re-run same mission (`iterations++`).

### 5.6 Debrief Generation

Extract summary from Claude Code output. If unclear, spawn a quick process to generate one. Written in Commander-addressed military briefing style.

### 5.7 Mission Detail — `/battlefields/[id]/missions/[missionId]`

Server Component + Client children for real-time:

```
┌──────────────────────────────────────────────────────────────┐
│  MISSION: Fix authentication bug                             │
│  Status: ● IN COMBAT | Asset: ARCHITECT | Priority: HIGH    │
│  Battlefield: OPERATION THUNDER                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  BRIEFING                                                    │
│  ──────────────────────────────────────────────────────────  │
│  Fix the JWT token refresh logic...                          │
│                                                              │
│  COMMS                                                       │
│  ──────────────────────────────────────────────────────────  │
│  14:32:01 │ Analyzing auth middleware...                      │
│  14:32:03 │ Found issue in refreshToken handler...           │
│  14:32:15 │ Applying fix to src/auth/refresh.ts              │
│  14:32:20 │ Running test suite...                            │
│  14:32:45 │ All tests passing ✓                              │
│  █                                                           │
│                                                              │
│  ┌─ TOKENS ────────────────────────────────────────────────┐ │
│  │ Input: 12,340 │ Output: 3,210 │ Cache: 11,100 (91.0%)  │ │
│  │ Duration: 2m 14s                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [ABANDON]  [CONTINUE MISSION]  [REDEPLOY]                  │
└──────────────────────────────────────────────────────────────┘
```

After completion: DEBRIEF section with Commander-addressed report.

---

## 6. Campaigns

### 6.1 Concept

Multi-phase operation. Phases execute sequentially. Within each phase, missions run in parallel. After each phase, a debrief is generated and passed to the next phase — NOT full logs.

### 6.2 Creating a Campaign

**Step 1**: Name, objective, worktree mode. Server Action → `draft`.

**Step 2**: `[GENERATE BATTLE PLAN]` spawns Claude Code with planning prompt. Response parsed as JSON with phases, missions, recommended assets.

**Step 3**: `<PlanGenerator />` shows editable plan. Reorder/add/remove phases and missions. Recruit recommended assets. Assign assets.

**Step 4**: `[LAUNCH OPERATION]` → `active`. Execution begins.

### 6.3 Execution

1. Phase 1 → `active`.
2. Worktree mode applied per mission or per phase.
3. Queue all phase missions. Parallel execution (up to `DEVROOM_MAX_AGENTS`).
4. All missions terminal:
   - All accomplished → phase `secured`.
   - Any compromised → phase `compromised`, campaign `paused`. Commander decides.
   - Merge worktrees if applicable.
   - Generate phase debrief.
   - Record `totalTokens`, `durationMs`.
   - Advance `currentPhase`.
5. Next phase. Pass ONLY phase debrief as context.
6. Repeat. All phases secured → campaign `accomplished`.

### 6.4 Templates

`isTemplate = true` → appears in templates section. `[RUN TEMPLATE]` clones campaign + phases + missions.

### 6.5 Campaign Detail — `/battlefields/[id]/campaigns/[campaignId]`

```
┌──────────────────────────────────────────────────────────────┐
│  Battlefields // Project // Campaigns // Operation Clean Sweep│
│  OPERATION CLEAN SWEEP                                        │
│                    [MISSION ACCOMPLISHED] [REDEPLOY] [ABANDON]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Phase 1  Recon ──────────────────────────────── SECURED ┐│
│  │  1 day ago · 1m 48s · 683.0K tok                         ││
│  │                                                          ││
│  │  ┌─────────────────┐  ┌─────────────────┐               ││
│  │  │ Code audit      │  │ Test coverage   │               ││
│  │  │ ARCHITECT       │  │ ASSERT          │               ││
│  │  │ ● ACCOMPLISHED  │  │ ● ACCOMPLISHED  │               ││
│  │  │ 1m 9s  226.8K   │  │ 1m 36s  456.3K  │               ││
│  │  └─────────────────┘  └─────────────────┘               ││
│  │                                                          ││
│  │  Debrief ▸ (collapsible)                                 ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Phase 2  Strike ─────────────────────────────── SECURED ┐│
│  │  1 day ago · 7m 35s · 1.0M tok                           ││
│  │                                                          ││
│  │  ┌─────────────────┐                                     ││
│  │  │ Write missing   │                                     ││
│  │  │ tests           │                                     ││
│  │  │ ASSERT          │                                     ││
│  │  │ ● ACCOMPLISHED  │                                     ││
│  │  │ 7m 32s  1.0M    │                                     ││
│  │  └─────────────────┘                                     ││
│  │                                                          ││
│  │  Debrief ▸ (collapsible)                                 ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              ✓ Mission Accomplished.                      ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

Phase containers: left border (green=secured, amber=active). Header: `Phase {n}` dim + **name** amber + status right. Metadata: relative time · duration · tokens. Mission cards horizontal inside. Debrief collapsible.

### 6.6 Campaign Controls

- **MISSION ACCOMPLISHED** (green outline): manually complete the campaign.
- **REDEPLOY**: clone and re-run.
- **ABANDON** (red outline): cancel. Abort in-combat missions. Status → `compromised`.

---

## 7. Assets

### 7.1 Defaults (seeded)

| Codename   | Specialty   | Description                                               |
|------------|-------------|-----------------------------------------------------------|
| ARCHITECT  | general     | Full-stack generalist. Follows project conventions.       |
| ASSERT     | testing     | QA specialist. Tests, edge cases, coverage.               |
| CANVAS     | frontend    | Frontend specialist. UI, styling, responsive.             |
| CRITIC     | review      | Code reviewer. Issues, improvements.                      |
| DISTILL    | docs        | Documentation specialist.                                 |
| GOPHER     | backend     | Backend specialist. APIs, databases, logic.               |
| REBASE     | devops      | Infrastructure, CI/CD, migrations.                        |
| SCANNER    | security    | Security auditor. Vulnerabilities, hardening.             |

All default to `claude-sonnet-4-6`.

### 7.2 Management — `/battlefields/[id]/assets`

Grid of cards: codename, specialty, model, status, completed count. Edit, toggle offline, recruit new.

### 7.3 Recruitment

Campaign plan generation may recommend new assets. `[RECRUIT]` creates via Server Action. Manual creation also available.

### 7.4 Status

- **active**: available, green dot.
- **offline**: disabled, gray dot.

Multiple missions can use the same asset concurrently (it's a profile, not a singleton).

---

## 8. Git Dashboard — `/battlefields/[id]/git`

Visual git interface so the Commander never needs to open a terminal for git operations.

### 8.1 Status View

The default tab. Shows the output of `git status` in a structured UI:

- **Staged files**: green list with file paths. Action: `[UNSTAGE]` per file.
- **Modified files**: amber list. Action: `[STAGE]` per file, `[DIFF]` to view changes.
- **Untracked files**: dim list. Action: `[STAGE]` per file.
- **Bulk actions**: `[STAGE ALL]`, `[UNSTAGE ALL]`.
- **Commit form**: message input + `[COMMIT]` button. Only enabled when staged files exist.
- Auto-refreshes every 5 seconds or on Socket.IO `activity:event` for this battlefield.

All operations via `simple-git` through Server Actions in `actions/git.ts`.

### 8.2 Log View

Commit history:
- List of commits: hash (short), message, author, relative time.
- Branch/tag labels as badges next to relevant commits.
- Clicking a commit expands to show the full diff.
- Paginated: load 50 at a time, `[LOAD MORE]` at the bottom.

### 8.3 Branches View

- List of local branches. Current branch highlighted with `●`.
- Remote branches in a separate section (collapsed by default).
- Actions per branch: `[CHECKOUT]`, `[DELETE]` (with confirmation, not on current branch).
- `[NEW BRANCH]` button: input for branch name, created from current HEAD.
- Merge operations: `[MERGE INTO CURRENT]` on non-current branches.

### 8.4 Diff Viewer

When viewing a file diff (from status or log):
- Side-by-side or unified view toggle.
- Syntax-highlighted with line numbers.
- Added lines in green background, removed in red, modified in amber.
- File path as header.

### 8.5 Git Operations Safety

- All destructive operations (delete branch, hard reset) require confirmation via modal.
- No force-push button. If the Commander needs force-push, they must create a mission for it.
- No rebase UI. Too complex and risky for a dashboard. Use missions for that.

---

## 9. Console & Dev Server — `/battlefields/[id]/console`

Command execution panel. Replaces the need to open a terminal for routine operations.

### 9.1 Dev Server Panel

Top section of the console page. Manages the project's development server.

```
┌─ DEV SERVER ─────────────────────────────────────────────────┐
│  Status: ● RUNNING on port 3000              [STOP] [RESTART]│
│  Command: npm run dev                                        │
│  PID: 42381 | Uptime: 2h 14m                                │
│  ──────────────────────────────────────────────────────────  │
│  [14:32:01] ready - started server on 0.0.0.0:3000           │
│  [14:32:03] ✓ Compiled /page in 234ms                        │
│  [14:35:12] ✓ Compiled /api/users in 89ms                    │
│  > █                                                         │
│                                                              │
│  [Open http://localhost:3000 ↗]                              │
└──────────────────────────────────────────────────────────────┘
```

**Configuration** (per battlefield, stored in DB):
- **Dev command**: the command to run (default: `npm run dev`). Editable in battlefield config.
- **Port**: auto-detected from output or configured manually.

**Lifecycle** (managed by `lib/process/dev-server.ts`):
- `[START]`: spawns the dev command as a child process in the battlefield's repo directory. Captures stdout/stderr, streams via Socket.IO `devserver:{battlefieldId}`.
- `[STOP]`: sends SIGTERM, waits 5s, SIGKILL if needed. Updates status.
- `[RESTART]`: stop then start.
- Status indicator: `● RUNNING` (green) / `● STOPPED` (dim) / `● CRASHED` (red).
- On DEVROOM shutdown: all dev servers are stopped gracefully.
- The `DevServerManager` tracks all running dev servers and their PIDs.

**Auto-start** (optional): battlefield config can flag `autoStartDevServer = true`. On DEVROOM boot, dev servers for flagged battlefields start automatically.

### 9.2 Quick Commands

Below the dev server panel. Predefined command buttons + custom command input.

**Predefined commands** (auto-detected from `package.json` scripts):
- Parse the battlefield's `package.json` on page load.
- Show buttons for common scripts: `[npm install]` `[npm test]` `[npm run build]` `[npm run lint]` etc.
- Each button executes the command and streams output.

**Custom command input**:
- Text input + `[RUN]` button.
- Executes any shell command in the battlefield's repo directory.
- Output streams in real-time via Socket.IO `console:{battlefieldId}`.

**Output display** (`<CommandOutput />`):
- Terminal-style component below the command area.
- Shows the last command's output.
- Scrollable, monospace, green-on-black.
- Exit code displayed at the end: `✓ Exit 0` (green) or `✗ Exit 1` (red).
- History: collapsible list of recent commands and their outputs (from `commandLogs` table).

**Safety**:
- Commands run in the battlefield's repo directory.
- No command whitelist/blacklist — the Commander has full control.
- Commands are logged in `commandLogs` table for audit.
- Running commands can be cancelled via AbortController.

### 9.3 Socket.IO Integration

```typescript
// Rooms
devserver:{battlefieldId}  — dev server stdout/stderr stream
console:{battlefieldId}    — quick command output stream

// Events
devserver:log    — { battlefieldId, content, timestamp }
devserver:status — { battlefieldId, status, port, pid }
console:output   — { battlefieldId, commandId, content, timestamp }
console:exit     — { battlefieldId, commandId, exitCode, durationMs }
```

---

## 10. Scheduled Tasks — `/battlefields/[id]/schedule`

Cron-based automation for recurring missions and campaigns.

### 10.1 Concept

A scheduled task is a recurring trigger that automatically creates and queues a mission (or re-runs a campaign template) on a cron schedule. The schedule page shows all tasks for this battlefield with their next run times.

### 10.2 Schedule List

```
┌──────────────────────────────────────────────────────────────┐
│  SCHEDULED TASKS                              [+ NEW TASK]   │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ● Nightly test suite          Every day at 03:00     │  │
│  │    Mission | Asset: ASSERT | Last: 6h ago | Runs: 34  │  │
│  │    Next: Tomorrow 03:00              [EDIT] [DISABLE]  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ○ Weekly deploy          Every Monday at 09:00        │  │
│  │    Campaign: Op. Deploy | Last: 5d ago | Runs: 12     │  │
│  │    Next: Disabled                     [EDIT] [ENABLE]  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Green dot = enabled, gray dot = disabled.

### 10.3 Creating a Scheduled Task

Form fields:
- **Name**: descriptive name.
- **Type**: `Mission`, `Campaign`, or `Maintenance` (internal tasks like WORKTREE SWEEP).
- **Schedule**: cron expression with human-readable preview (e.g. "Every day at 03:00"). Common presets: hourly, daily, weekly, monthly.
- **If Mission type**:
  - Briefing (markdown).
  - Asset (dropdown).
  - Priority.
  - Use worktree (toggle).
- **If Campaign type**:
  - Select a campaign template to re-run.
- **Enabled**: toggle (default: on).

### 10.4 Scheduler Engine

In `lib/scheduler/scheduler.ts`:

```typescript
// Runs every 60 seconds
setInterval(() => {
  const now = Date.now();
  const dueTasks = db.select().from(scheduledTasks)
    .where(and(
      eq(scheduledTasks.enabled, 1),
      lte(scheduledTasks.nextRunAt, now)
    )).all();

  for (const task of dueTasks) {
    if (task.type === 'mission') {
      createMissionFromTemplate(task);
    } else {
      rerunCampaignTemplate(task);
    }
    // Update lastRunAt, nextRunAt, runCount
    updateScheduleAfterRun(task);
  }
}, 60_000);
```

- `nextRunAt` is precomputed after each run using the cron expression.
- Missions created by schedules have a title prefixed with `[Scheduled]` for easy identification.
- If DEVROOM was down and missed a scheduled run, it executes once on next boot (catch-up).

### 10.5 Execution History

Each scheduled task has a `[VIEW LOG]` that shows its past executions:
- List of missions/campaigns created by this schedule.
- Status, duration, tokens for each.
- Click to navigate to the mission/campaign detail.

---

## 11. Git Worktree Management

### 11.1 Lifecycle

`Create branch → Create worktree → Execute → Merge → Delete worktree → Delete branch`

### 11.2 Branch Naming

- Mission: `devroom/{codename-lower}/{mission-ulid-short}`
- Phase: `devroom/{codename-lower}/phase-{n}-{slug}`

### 11.3 Merge

```typescript
async function mergeBranch(repoPath: string, source: string, target: string, context: MergeContext) {
  const git = simpleGit(repoPath);
  await git.checkout(target);
  try {
    await git.merge([source, '--no-ff']);
    await cleanupWorktree(repoPath, source);
  } catch (err) {
    if (isConflictError(err)) {
      await resolveConflictsWithClaude(repoPath, source, target, context);
    } else throw err;
  }
}
```

Conflict resolution: spawn Claude Code with diff + mission debriefs. Failure → `compromised`, branch intact, `[RETRY MERGE]` in UI.

### 11.4 Worktree Modes

| Mode      | Behavior                                                   |
|-----------|------------------------------------------------------------|
| `none`    | All work on repo root. No branching.                      |
| `phase`   | One worktree per phase. Best for independent files.       |
| `mission` | One worktree per mission. Safest for overlapping files.   |

### 11.5 Cleanup

A daily WORKTREE SWEEP maintenance task (seeded at startup, cron `0 3 * * *`) removes worktrees for terminal missions and deletes orphaned `devroom/` branches. Worktrees are also cleaned up immediately after successful merge on mission completion.

---

## 12. Real-Time (Socket.IO)

### 12.1 Server

```typescript
export function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket) => {
    socket.on('mission:subscribe', (id) => socket.join(`mission:${id}`));
    socket.on('mission:unsubscribe', (id) => socket.leave(`mission:${id}`));
    socket.on('campaign:subscribe', (id) => socket.join(`campaign:${id}`));
    socket.on('campaign:unsubscribe', (id) => socket.leave(`campaign:${id}`));
    socket.on('hq:subscribe', () => socket.join('hq:activity'));
    socket.on('hq:unsubscribe', () => socket.leave('hq:activity'));
    socket.on('devserver:subscribe', (id) => socket.join(`devserver:${id}`));
    socket.on('devserver:unsubscribe', (id) => socket.leave(`devserver:${id}`));
    socket.on('console:subscribe', (id) => socket.join(`console:${id}`));
    socket.on('console:unsubscribe', (id) => socket.leave(`console:${id}`));
  });
}
```

### 12.2 Events

**Server → Client:**
- `mission:log` — `{ missionId, timestamp, type, content }`
- `mission:status` — `{ missionId, status, timestamp }`
- `mission:debrief` — `{ missionId, debrief }`
- `mission:tokens` — `{ missionId, input, output, cacheHit, cacheCreation, costUsd }`
- `campaign:status` — campaign status updates
- `campaign:phase` — campaign phase transitions
- `activity:event` — `{ type, battlefieldCodename, missionTitle, timestamp, detail }`
- `devserver:log` — `{ battlefieldId, content, timestamp }`
- `devserver:status` — `{ battlefieldId, status, port, pid }`
- `console:output` — `{ battlefieldId, commandId, content, timestamp }`
- `console:exit` — `{ battlefieldId, commandId, exitCode, durationMs }`
- `notification` — in-app notification delivery

### 12.3 Client Hook

```typescript
export function useMissionComms(missionId: string, initialLogs: MissionLog[]) {
  const [logs, setLogs] = useState(initialLogs);
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    socket.emit('mission:subscribe', missionId);
    const handler = (log: MissionLog) => setLogs(prev => [...prev, log]);
    socket.on('mission:log', handler);
    return () => {
      socket.off('mission:log', handler);
      socket.emit('mission:unsubscribe', missionId);
    };
  }, [socket, missionId]);
  return logs;
}
```

### 12.4 Reconnection

Auto-reconnect via Socket.IO. On reconnect: re-join rooms, backfill missed logs via Server Action.

---

## 13. Queue & Concurrency

### 13.1 Orchestrator Loop

Polls every 2s:

```typescript
const activeJobs = new Map<string, AbortController>();
setInterval(() => {
  if (activeJobs.size >= config.maxAgents) return;
  const slots = config.maxAgents - activeJobs.size;
  const next = getNextQueuedMissions(slots);
  for (const mission of next) {
    const ac = new AbortController();
    activeJobs.set(mission.id, ac);
    executeMission(mission, io, ac).finally(() => activeJobs.delete(mission.id));
  }
}, 2000);
```

### 13.2 Priority Queue

```typescript
function getNextQueuedMissions(limit: number) {
  return db.select().from(missions)
    .where(eq(missions.status, 'queued'))
    .orderBy(
      sql`CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END`,
      missions.createdAt
    )
    .limit(limit).all();
}
```

### 13.3 Rate Limit Handling

Rate-limit exit → `queued` (not compromised) → exponential backoff (1m, 2m, 4m, 8m, 16m) → after 5 retries → `compromised`.

---

## 14. Prompt Architecture

### 14.1 Standard Mission

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC (cached)

---

{ASSET_SYSTEM_PROMPT}                              ← SEMI-STATIC

---

## Mission Briefing

**Mission**: {title}
**Battlefield**: {codename}
**Priority**: {priority}

{briefing}                                         ← DYNAMIC

---

## Operational Parameters

- Execute the task described above.
- Commit with clear, descriptive messages.
- Upon completion, provide a debrief addressed to the Commander:
  what was done, what changed, risks, and recommended next actions.
```

### 14.2 Campaign Mission

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC

---

{ASSET_SYSTEM_PROMPT}                              ← SEMI-STATIC

---

## Campaign Context

**Operation**: {campaign.name}
**Objective**: {campaign.objective}
**Phase**: {phase.name} ({n} of {total})

### Previous Phase Debrief
{previousPhase.debrief}                            ← SEMI-DYNAMIC

---

## Mission Briefing

**Mission**: {title}
**Priority**: {priority}

{briefing}                                         ← DYNAMIC

---

## Operational Parameters

- Execute the task above.
- Other missions run in parallel. Stay within your assigned scope.
- Commit with messages prefixed by mission title.
- Provide debrief addressed to the Commander.
```

### 14.3 Conflict Resolution

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC

---

## Merge Conflict Resolution

Branch `{source}` into `{target}`.

### Context
{missionDebriefs}

### Conflicts
{gitDiffWithMarkers}

### Orders
1. Analyze both sides.
2. Resolve preserving both intents.
3. If incompatible, prefer source (new work). Note losses.
4. Run tests.
5. Commit: "Merge {source}: resolve conflicts"
6. Report to the Commander.
```

### 14.4 Phase Debrief Generation

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC

---

## Phase Debrief Generation

**Operation**: {campaign.name}
**Phase**: {phase.name} ({n} of {total})

### Mission Debriefs
{allMissionDebriefs}

### Orders
Produce a concise debrief addressed to "Commander":
1. What was accomplished.
2. Issues or partial failures.
3. Readiness for next phase.
4. Recommended adjustments.

Under 300 words. Military briefing tone — factual, precise, actionable.
```

### 14.5 Cache Optimization

Static top, dynamic bottom. 2000-token CLAUDE.md + 500-token asset prompt = 2500 tokens cached. Target 90%+ hit rate.

### 14.6 Bootstrap Prompt

Used when generating CLAUDE.md + SPEC.md for a new battlefield:

```
## Battlefield Bootstrap — Intelligence Generation

You are initializing a new battlefield for the DEVROOM agent orchestrator.
Your task is to analyze this repository and the Commander's briefing, then
generate two comprehensive documents.

### Commander's Briefing

{battlefield.initialBriefing}

### Repository Analysis

Analyze the repository at the current working directory. Examine:
- File structure, language, frameworks, dependencies
- Existing configuration files (package.json, tsconfig, etc.)
- Code conventions, patterns, architecture
- Database schema if present
- Test setup and coverage tooling
- CI/CD configuration
- Any existing documentation

### Orders

Generate TWO documents as a single JSON response:

{
  "claudeMd": "...(full CLAUDE.md content)...",
  "specMd": "...(full SPEC.md content)..."
}

**CLAUDE.md** should include:
- Project overview and purpose
- Tech stack with rationale
- Project structure (actual, from repo analysis)
- Domain model (entities, relationships, database schema)
- Coding rules and conventions (inferred from existing code + Commander's briefing)
- Key patterns (API structure, state management, error handling)
- Definition of Done checklist
- Environment variables and configuration
- Scripts / commands reference

**SPEC.md** should include:
- Detailed feature specifications for every major feature
- Screen/page descriptions with layout and behavior
- User flows and workflows
- API endpoint specifications if applicable
- Business logic rules
- Error handling specifications
- Edge cases and constraints
- Future features / backlog if mentioned in the briefing

Both documents should be written as if they are the authoritative reference
for any developer (or AI agent) working on this project. Be thorough,
precise, and specific to this actual codebase — not generic.

Address the Commander in any commentary. Use military briefing tone in
meta-commentary only, not in the technical documentation itself.

Respond ONLY with the JSON object. No preamble, no markdown fences.
```

---

## 15. Configuration — `/battlefields/[id]/config`

Per-battlefield:
- Name / codename / description (editable).
- Initial Briefing (editable — can re-trigger bootstrap with updated briefing).
- Repo path (read-only after creation, unless linked from existing repo).
- Default branch (dropdown from repo branches).
- CLAUDE.md path (auto-set by bootstrap, editable, preview button).
- SPEC.md path (auto-set by bootstrap, editable, preview button).
- `[RE-BOOTSTRAP]` button: re-run the bootstrap process with current briefing. Shows review before committing.
- Max agents override (optional per-battlefield cap).
- Default asset for deploy form.
- **Dev server command**: the command to start the dev server (default: `npm run dev`).
- **Auto-start dev server**: toggle. If on, dev server starts when DEVROOM boots.

---

## 16. Screenshots & Images

Briefing textarea supports clipboard paste (Cmd+V) and drag-and-drop. Stored as base64 in markdown. Passed directly to Claude Code.

---

## 17. Persistence

### 17.1 SQLite

WAL mode, foreign keys, 5s busy timeout. Single file.

### 17.2 Drizzle

Schema in `lib/db/schema.ts`. Migrations via `npx drizzle-kit generate`. Applied on startup.

### 17.3 Log Retention

`DEVROOM_LOG_RETENTION_DAYS` (default 30) is configured but log cleanup is not yet implemented. This is a backlog item — the config value is loaded and ready for use when retention logic is added.

---

## 18. Error Handling

### 18.1 Process Crashes

Crash → capture partial output → `compromised` → error in debrief. Campaign mission → pause campaign.

### 18.2 Git Errors

simple-git throw → log → `compromised` → git error in debrief → `[RETRY MERGE]` in UI.

### 18.3 Error UI

`error.tsx` boundaries: red alert banner, military quote, `[RETRY]`, collapsible `<details>` with trace.

---

## 19. Captain — AI Decision Layer

### 19.1 Concept

The Captain is an autonomous AI decision layer that makes judgment calls during mission and campaign execution without Commander intervention. It reviews debriefs, handles phase failures, and escalates critical decisions.

Implementation: `src/lib/captain/`

### 19.2 Modules

| Module                    | Purpose                                               |
|---------------------------|-------------------------------------------------------|
| `captain.ts`              | Core decision engine — evaluates situations, makes calls |
| `captain-db.ts`           | Persists decisions to `captainLogs` table             |
| `debrief-reviewer.ts`     | Reviews mission debriefs for quality and completeness |
| `escalation.ts`           | Routes critical decisions to Commander via Telegram   |
| `phase-failure-handler.ts`| Handles phase failures — retry, skip, or escalate    |
| `review-handler.ts`       | Post-completion captain review with retry/escalation  |

### 19.3 Decision Confidence

Each decision is logged with a confidence level:
- **high**: Captain acts autonomously.
- **medium**: Captain acts but logs prominently for review.
- **low**: Captain escalates to Commander (via Telegram if configured).

### 19.4 Captain Log Page — `/(hq)/captain-log`

Displays all Captain decisions across battlefields. Each entry shows the question faced, the decision made, reasoning, confidence level, and whether it was escalated.

---

## 20. Dossiers — Briefing Templates

### 20.1 Concept

Dossiers are reusable mission briefing templates with variable interpolation. Each dossier has a codename (e.g. `CODE_REVIEW`, `SECURITY_AUDIT`), a markdown template with `{{variable}}` placeholders, and an optional recommended asset.

### 20.2 Schema

See `Dossier` table in CLAUDE.md. Variables are stored as a JSON array of `DossierVariable` objects: `{ key, label, description, placeholder }`.

### 20.3 Usage

- The deploy mission form includes a `[Load dossier]` button (`<DossierSelector />`).
- Selecting a dossier populates the briefing textarea with the template.
- If the dossier has variables, a form appears to fill in values before populating.
- The recommended asset is auto-selected if specified.

### 20.4 CRUD

Server Actions in `src/actions/dossier.ts`: create, update, delete, list, get by codename.

---

## 21. Notifications & Escalations

### 21.1 Concept

Notifications track important events (mission completions, failures, Captain escalations) and optionally deliver them via Telegram.

### 21.2 Levels

| Level      | Color  | Telegram | Description                        |
|------------|--------|----------|------------------------------------|
| `info`     | blue   | No       | Mission completed, phase secured   |
| `warning`  | amber  | Optional | Captain medium-confidence decision |
| `critical` | red    | Yes      | Mission compromised, escalation    |

### 21.3 In-App

Notifications are accessible via a bell icon or notification panel. Unread count shown in nav. Mark as read via Server Action.

### 21.4 Telegram Integration

When `DEVROOM_TELEGRAM_BOT_TOKEN` is set:
- Bot polls for incoming messages (no webhooks — LAN-only).
- Critical notifications are sent to the configured Telegram chat.
- Commander can respond to escalations directly in Telegram.
- `telegramSent` and `telegramMsgId` fields track delivery status.

Implementation: `src/lib/telegram/telegram.ts`

---

## 22. Logistics — Token & Cost Tracking

### 22.1 Page — `/(hq)/logistics`

Dashboard showing token usage and rate limit status across all battlefields.

### 22.2 Features

- **Token usage breakdown**: input tokens, output tokens, cache hits, cache creation.
- **Rate limit status**: fetched via `GET /api/logistics/rate-limit` (proxied Claude API check).
- **Cost tracking**: per-mission cost data from `costInput`, `costOutput`, `costCacheHit` fields.
- **Cache hit rate**: overall and per-battlefield percentage.

Server Actions in `src/actions/logistics.ts`.

---

## 23. OVERWATCH — System Metrics

### 23.1 Page — `/overwatch`

A standalone monitoring dashboard (outside the HQ layout group) showing system-wide operational metrics.

### 23.2 Features

- **Agent status**: active/total agent slots, currently running missions.
- **Token counters**: live token usage with flash animation on updates.
- **Uptime tracking**: system uptime since last boot.
- **Battlefield status overview**: quick status of all battlefields.

Component: `src/components/overwatch/overwatch.tsx`

---

## 24. War Room — Boot Sequence

### 24.1 Page — `/warroom`

A cinematic boot animation shown on first visit to DEVROOM. Creates an immersive tactical startup experience.

### 24.2 Flow

1. First visit to HQ triggers redirect to `/warroom`.
2. Boot sequence animation plays (typewriter text, system checks, ASCII art).
3. On completion, redirects to HQ dashboard.
4. A session flag prevents re-showing on subsequent visits.

Components: `src/components/warroom/boot-gate.tsx`, `src/components/warroom/boot-sequence.tsx`

The HQ root layout uses `<BootGate>` as an overlay — if the boot animation hasn't been seen, it renders on top of the HQ content and fades out on completion. This avoids a flash of content before redirect.

---

## 25. Future Ops (Backlog)

- [ ] Auto-import skills from curated registry.
- [ ] Cost dashboard with token graphs over time (basic cost tracking exists in Logistics).
- [ ] Mobile-optimized UI pass.
- [x] Push notifications on completion (implemented via Telegram integration).
- [ ] Mission dependencies (DAG within phases — `dependsOn` field exists but no UI).
- [ ] Multi-repo campaigns.
- [ ] Audit log.
- [ ] Log retention cleanup (config exists, logic not yet wired).
- [ ] Export/import state.
- [ ] Voice debriefs (TTS).
- [x] Dossier library (saved briefing templates — fully implemented).
- [x] Captain AI decision layer (autonomous judgment, escalation, debrief review).
- [x] OVERWATCH system metrics dashboard.
- [x] War Room boot sequence animation.
- [x] Logistics / token usage dashboard.
- [ ] Image paste in briefing textarea (Cmd+V, base64 — component exists but not fully wired).
