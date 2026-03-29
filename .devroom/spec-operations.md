# Operations — Git Dashboard, Console & Scheduler

## Git Dashboard — `/battlefields/[id]/git`

Visual git interface so the Commander never needs to open a terminal for git operations.

### Status View

The default tab. Shows the output of `git status` in a structured UI:

- **Staged files**: green list with file paths. Action: `[UNSTAGE]` per file.
- **Modified files**: amber list. Action: `[STAGE]` per file, `[DIFF]` to view changes.
- **Untracked files**: dim list. Action: `[STAGE]` per file.
- **Bulk actions**: `[STAGE ALL]`, `[UNSTAGE ALL]`.
- **Commit form**: message input + `[COMMIT]` button. Only enabled when staged files exist.
- Auto-refreshes every 5 seconds or on Socket.IO `activity:event` for this battlefield.

All operations via `simple-git` through Server Actions in `actions/git.ts`.

### Log View

Commit history:
- List of commits: hash (short), message, author, relative time.
- Branch/tag labels as badges next to relevant commits.
- Clicking a commit expands to show the full diff.
- Paginated: load 50 at a time, `[LOAD MORE]` at the bottom.

### Branches View

- List of local branches. Current branch highlighted with `●`.
- Remote branches in a separate section (collapsed by default).
- Actions per branch: `[CHECKOUT]`, `[DELETE]` (with confirmation, not on current branch).
- `[NEW BRANCH]` button: input for branch name, created from current HEAD.
- Merge operations: `[MERGE INTO CURRENT]` on non-current branches.

### Diff Viewer

When viewing a file diff (from status or log):
- Side-by-side or unified view toggle.
- Syntax-highlighted with line numbers.
- Added lines in green background, removed in red, modified in amber.
- File path as header.

### Git Operations Safety

- All destructive operations (delete branch, hard reset) require confirmation via modal.
- No force-push button. If the Commander needs force-push, they must create a mission for it.
- No rebase UI. Too complex and risky for a dashboard. Use missions for that.

---

## Console & Dev Server — `/battlefields/[id]/console`

Command execution panel. Replaces the need to open a terminal for routine operations.

### Dev Server Panel

Top section of the console page. Manages the project's development server.

```
┌─ DEV SERVER ─────────────────────────────────────────────────┐
│  Status: ● RUNNING on port 3000              [STOP] [RESTART]│
│  Command: npm run dev                                        │
│  PID: 42381 | Uptime: 2h 14m                                │
│  ──────────────────────────────────────────────────────────  │
│  [14:32:01] ready - started server on 0.0.0.0:3000           │
│  [14:32:03] ✓ Compiled /page in 234ms                        │
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

### Quick Commands

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

---

## Scheduled Tasks — `/battlefields/[id]/schedule`

Cron-based automation for recurring missions and campaigns.

### Concept

A scheduled task is a recurring trigger that automatically creates and queues a mission (or re-runs a campaign template) on a cron schedule. The schedule page shows all tasks for this battlefield with their next run times.

### Schedule List

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

### Creating a Scheduled Task

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

### Scheduler Engine

In `lib/scheduler/scheduler.ts`: polls every 60 seconds for due tasks, creates missions or re-runs campaign templates, updates `lastRunAt`, `nextRunAt`, and `runCount`.

- `nextRunAt` is precomputed after each run using the cron expression.
- Missions created by schedules have a title prefixed with `[Scheduled]` for easy identification.
- If DEVROOM was down and missed a scheduled run, it executes once on next boot (catch-up).

### Execution History

Each scheduled task has a `[VIEW LOG]` that shows its past executions:
- List of missions/campaigns created by this schedule.
- Status, duration, tokens for each.
- Click to navigate to the mission/campaign detail.
