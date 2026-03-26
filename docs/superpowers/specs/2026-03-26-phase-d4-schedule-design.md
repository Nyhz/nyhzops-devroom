# Phase D4: Scheduled Tasks — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** D4 (Schedule)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Replace the schedule stub with cron-based automation: create recurring tasks that auto-deploy missions or re-run campaign templates on a schedule. Includes a scheduler engine, task management UI, and execution history. Also adds the WORKTREE SWEEP daily task (from memory).

---

## 1. Scheduler Engine

**File:** `src/lib/scheduler/scheduler.ts`

Polls every 60 seconds for due tasks.

```typescript
class Scheduler {
  private interval: NodeJS.Timeout | null = null;

  start(): void {
    this.tick(); // Run once immediately
    this.interval = setInterval(() => this.tick(), 60_000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private tick(): void {
    const now = Date.now();
    const db = getDatabase();
    const dueTasks = db.select().from(scheduledTasks)
      .where(and(eq(scheduledTasks.enabled, 1), lte(scheduledTasks.nextRunAt, now)))
      .all();

    for (const task of dueTasks) {
      this.executeTask(task);
      this.updateNextRun(task);
    }
  }

  private executeTask(task): void {
    if (task.type === 'mission') {
      // Parse missionTemplate JSON, create mission, queue it
      const template = JSON.parse(task.missionTemplate);
      // createAndDeployMission(template)
    } else if (task.type === 'campaign') {
      // Re-run campaign template
      // runTemplate(task.campaignId)
    }
    // Increment runCount, set lastRunAt
  }

  private updateNextRun(task): void {
    // Calculate next run from cron expression
    // Update nextRunAt in DB
  }
}
```

**Cron parsing:** Use a lightweight cron library. Install `cron-parser` for next-run calculation.

```bash
pnpm add cron-parser
```

**Singleton:** Created in `server.ts`, stored on `globalThis.scheduler`.

---

## 2. Cron Utilities

**File:** `src/lib/scheduler/cron.ts`

```typescript
import cronParser from 'cron-parser';

export function getNextRun(cronExpression: string): number {
  const interval = cronParser.parseExpression(cronExpression);
  return interval.next().getTime();
}

export function formatCronHuman(cron: string): string {
  // Simple human-readable descriptions for common patterns
  // "0 3 * * *" → "Every day at 03:00"
  // "0 9 * * 1" → "Every Monday at 09:00"
  // "0 */2 * * *" → "Every 2 hours"
}

export function validateCron(cron: string): boolean {
  try { cronParser.parseExpression(cron); return true; }
  catch { return false; }
}
```

---

## 3. Server Actions

**File:** `src/actions/schedule.ts`

### Actions

| Action | Behavior |
|--------|----------|
| `createScheduledTask(data)` | Insert with generateId, compute nextRunAt from cron. Validate cron expression. |
| `updateScheduledTask(id, data)` | Update fields, recompute nextRunAt if cron changed. |
| `deleteScheduledTask(id)` | Delete the record. |
| `listScheduledTasks(battlefieldId)` | All tasks for battlefield, ordered by nextRunAt. |
| `toggleScheduledTask(id, enabled)` | Enable/disable. Recompute nextRunAt if enabling. |
| `getScheduleHistory(taskId, limit?)` | Query missions/campaigns created by this schedule (by title prefix `[Scheduled]`). |

### Input type

```typescript
interface CreateScheduledTaskInput {
  battlefieldId: string;
  name: string;
  type: 'mission' | 'campaign';
  cron: string;
  // If mission type:
  missionTemplate?: {
    briefing: string;
    assetId?: string;
    priority?: MissionPriority;
  };
  // If campaign type:
  campaignId?: string;  // template campaign to re-run
}
```

---

## 4. Schedule Page

**Replace:** `src/app/projects/[id]/schedule/page.tsx`

### Layout

**Header:** `SCHEDULED TASKS` + `[+ NEW TASK]` button

**Task list:** Cards for each scheduled task:
- Green dot (enabled) / gray dot (disabled) + name
- Schedule: human-readable cron description
- Type: Mission | Campaign
- Last run + run count
- Next run time (or "Disabled")
- `[EDIT]` `[ENABLE/DISABLE]` buttons

**Create/Edit form** (modal or inline):
- Name (TacInput)
- Type selector: Mission / Campaign
- Cron expression (TacInput + human-readable preview)
- Common presets: buttons for "Hourly", "Daily 3am", "Weekly Monday 9am", "Monthly 1st"
- If Mission: briefing (TacTextarea), asset selector, priority
- If Campaign: select a campaign template from dropdown
- `[SAVE]` / `[CANCEL]`

### Components

- `src/components/schedule/schedule-list.tsx` — Task cards
- `src/components/schedule/schedule-form.tsx` — Create/edit form (Client Component)

---

## 5. Built-in WORKTREE SWEEP Task

On first server startup (or via seed), create a default scheduled task:
- Name: "WORKTREE SWEEP"
- Type: mission
- Cron: "0 3 * * *" (daily at 3am)
- Briefing: calls `cleanOrphanedWorktrees` for all battlefields
- Enabled: true by default

Actually, WORKTREE SWEEP is not a Claude Code mission — it's an internal maintenance operation. Add it as a special `type: 'maintenance'` that the scheduler handles differently: instead of creating a mission, it directly calls the cleanup function.

---

## 6. Server.ts Changes

- Create Scheduler singleton, store on `globalThis.scheduler`
- Start scheduler after orchestrator
- Stop scheduler in shutdown handler
- Seed WORKTREE SWEEP task if not exists

---

## 7. End State

- Scheduler engine polls every 60s, executes due tasks
- Commander creates recurring mission/campaign tasks with cron expressions
- Human-readable cron descriptions
- Enable/disable toggle
- Execution history viewable
- WORKTREE SWEEP runs daily at 3am
