# Scheduled Task Dossier System

## Problem

Scheduled tasks are currently created via a freeform form with mission/campaign types that don't fit the automation use case. The `maintenance` type exists in the backend but not the UI. Tasks like WORKTREE SWEEP have no description, and there's no way to replicate them across battlefields through the UI.

## Solution

Replace the freeform schedule form with a **dossier-driven selector**. Every scheduled task picks from a catalog of pre-built task dossiers. No freeform briefings or custom tasks — only pre-developed, tested operations.

## Task Types

Four types replace the old `mission | campaign | maintenance`:

| Type | Purpose |
|------|---------|
| `maintenance` | Cleanup and hygiene operations |
| `health` | Build checks, test runs, repo state verification |
| `reporting` | Activity summaries, cost reports, digests |
| `sync` | Upstream pulls, dependency updates |

## Dossier Registry

A static TypeScript constant at `src/lib/scheduler/dossiers.ts`. Not DB-stored — these are hardcoded operations with matching scheduler execution logic.

```typescript
interface ScheduleTaskDossier {
  id: string;                    // e.g. 'worktree-sweep'
  name: string;                  // e.g. 'WORKTREE SWEEP'
  type: 'maintenance' | 'health' | 'reporting' | 'sync';
  description: string;           // shown below selector in the form
  defaultCron: string;           // pre-filled when dossier is selected
}
```

### Initial Dossiers

#### WORKTREE SWEEP (maintenance)

- **ID:** `worktree-sweep`
- **Default cron:** `0 3 * * *` (daily at 3am)
- **Description:** Cleans orphaned worktrees from completed, failed, or abandoned missions. Compares existing worktrees against active mission IDs and removes any that no longer have a running mission.
- **Execution:** Already implemented in `Scheduler.runMaintenance()`. No changes needed.

#### BRANCH SWEEP (maintenance)

- **ID:** `branch-sweep`
- **Default cron:** `0 3 * * *` (daily at 3am)
- **Description:** Removes local branches already merged into main and local branches with no commits in 7+ days. Prunes remote tracking refs for deleted upstream branches (git fetch --prune).
- **Execution:** New. For each target battlefield using simple-git:
  1. `git fetch --prune` — clean stale remote tracking refs
  2. Delete local branches already merged into main (`git branch --merged main`, excluding main itself)
  3. Delete local branches whose last commit is older than 7 days (`git log -1 --format=%ci` per branch)
  4. Log results to `commandLogs` table

#### ACTIVITY DIGEST (reporting)

- **ID:** `activity-digest`
- **Default cron:** `0 8 * * 1` (weekly Monday at 8am)
- **Description:** Generates a summary of recent battlefield activity — missions launched, success/failure rates, campaigns completed, and open intel notes. Report window automatically matches your schedule interval, computed from the previous execution time.
- **Execution:** New. In the scheduler:
  1. Compute report window: `lastRunAt → now`. If no previous run, compute the cron interval duration and look back that far using `cron-parser` to find the previous theoretical run time.
  2. Query missions created/completed in window, group by status. Count campaigns completed. Count open intel notes.
  3. Format as a structured text summary.
  4. Insert into `notifications` table (level: `info`, title: `ACTIVITY DIGEST`).
  5. Send via Telegram if configured for that battlefield.

## Form Flow

The schedule form (`src/components/schedule/schedule-form.tsx`) is rewritten:

1. **Name** — free text input
2. **Type** — dropdown: Maintenance, Health, Reporting, Sync
3. **Task** — dropdown filtered by selected type, showing dossier names
   - When a type has no dossiers yet (health, sync), show a disabled "No tasks available for this type" item
   - Selecting a dossier shows its `description` below the selector in `text-dr-muted` styling
   - Selecting a dossier pre-fills the cron field with the dossier's `defaultCron`
4. **Cron** — manual input + preset buttons (same UI as today). Pre-filled by dossier but freely editable.

All mission/campaign-specific fields are removed from the form: briefing textarea, asset selector, priority dropdown, campaign template selector.

## Schema Changes

### scheduled_tasks table

Add one column via a new Drizzle migration:

```sql
ALTER TABLE scheduled_tasks ADD COLUMN dossier_id TEXT;
```

The `type` column changes from `'mission' | 'campaign' | 'maintenance'` to `'maintenance' | 'health' | 'reporting' | 'sync'`.

Existing columns `mission_template` and `campaign_id` remain in the DB (no destructive migration) but are no longer written to by the new form. The scheduler can continue reading `mission_template` for any legacy mission-type tasks that may exist.

### Drizzle schema update

In `src/lib/db/schema.ts`, add `dossierId` to the `scheduledTasks` table definition:

```typescript
dossierId: text('dossier_id'),
```

### Migration

Generate via `pnpm drizzle-kit generate`. The migration adds the `dossier_id` column. Existing WORKTREE SWEEP rows get backfilled: set `dossier_id = 'worktree-sweep'` for any task with `name = 'WORKTREE SWEEP'` and `type = 'maintenance'`.

## Server Action Changes

### CreateScheduledTaskInput

```typescript
interface CreateScheduledTaskInput {
  battlefieldId: string;
  name: string;
  type: 'maintenance' | 'health' | 'reporting' | 'sync';
  dossierId: string;
  cron: string;
}
```

Remove: `briefing`, `assetId`, `priority`, `campaignId`.

Validation: the `dossierId` must exist in the dossier registry and its type must match the provided `type`.

### UpdateScheduledTaskInput

```typescript
interface UpdateScheduledTaskInput {
  name?: string;
  type?: 'maintenance' | 'health' | 'reporting' | 'sync';
  dossierId?: string;
  cron?: string;
}
```

Same removals. Same validation on dossierId/type if provided.

## Scheduler Execution Changes

### Dispatch by dossierId

Currently `runMaintenance` dispatches by task name string. Migrate to dispatching by `dossierId`:

- `worktree-sweep` → existing `cleanOrphanedWorktrees` logic (unchanged)
- `branch-sweep` → new `runBranchSweep` method
- `activity-digest` → new `runActivityDigest` method

Keep a fallback: if `dossierId` is null but `name === 'WORKTREE SWEEP'` and `type === 'maintenance'`, still run the worktree sweep. This handles pre-existing rows that haven't been backfilled.

### Generalize beyond maintenance

The current scheduler separates maintenance tasks from "regular" tasks. With the new types, rename the concept: all scheduled tasks are dossier-driven. The batching logic (run once per dossier across battlefields) applies to all types, not just maintenance.

```
tick() →
  group due tasks by dossierId →
  for each group: execute once with all battlefield IDs →
  mark all tasks in group as executed
```

### New: runBranchSweep(battlefieldIds)

For each battlefield:
1. Open repo with simple-git at `battlefield.repoPath`
2. `git fetch --prune`
3. Get merged branches: `git branch --merged main` → filter out `main`/`master`/current branch → delete each
4. Get all local branches, for each: `git log -1 --format=%ci <branch>` → if older than 7 days and not main → delete
5. Log summary to `commandLogs`

### New: runActivityDigest(battlefieldIds)

For each battlefield:
1. Compute window start: `task.lastRunAt` if available, otherwise estimate from cron interval using `cron-parser`'s `prev()` method
2. Query `missions` where `createdAt >= windowStart`: count by status, total count
3. Query `campaigns` where `updatedAt >= windowStart` and terminal status: count
4. Query `intelNotes` where `column = 'tasked'`: count open items
5. Format summary text:
   ```
   ACTIVITY DIGEST — <battlefield codename>
   Period: <start> → <end>
   
   Missions: X launched, Y accomplished, Z compromised
   Campaigns: X completed
   Open Intel: X notes in tasked column
   ```
6. Insert notification: `level: 'info'`, `entityType: 'battlefield'`, `entityId: battlefieldId`
7. Send via Telegram using existing notification dispatch if Telegram is configured

## Schedule List UI

The schedule list (`src/components/schedule/schedule-list.tsx`) gets minor updates:

- Type badge colors: `maintenance` = blue, `health` = green, `reporting` = amber, `sync` = cyan (mapped to `text-dr-blue`/`border-dr-blue` etc.)
- No other changes needed — name, cron display, toggle, delete all work the same

## Schedule Page

The page at `src/app/(hq)/battlefields/[id]/schedule/page.tsx` simplifies: no longer needs to pass `assets` or `campaignTemplates` to the form since those fields are removed.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/scheduler/dossiers.ts` | **New.** Dossier registry constant + types |
| `src/lib/db/schema.ts` | Add `dossierId` to `scheduledTasks` |
| `drizzle/migrations/XXXX_*.sql` | **New.** Add `dossier_id` column |
| `src/components/schedule/schedule-form.tsx` | Rewrite: type selector, dossier selector, remove mission/campaign fields |
| `src/components/schedule/schedule-list.tsx` | Update type badge colors for new types |
| `src/actions/schedule.ts` | Update input interfaces, add dossierId validation |
| `src/lib/scheduler/scheduler.ts` | Add branch-sweep + activity-digest execution, dispatch by dossierId, generalize batching |
| `src/app/(hq)/battlefields/[id]/schedule/page.tsx` | Remove assets/campaignTemplates props |
