# Scheduled Task Dossier System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the freeform schedule form with a dossier-driven selector where every scheduled task picks from a catalog of pre-built task dossiers, and implement WORKTREE SWEEP, BRANCH SWEEP, and ACTIVITY DIGEST operations.

**Architecture:** A static dossier registry defines available tasks with metadata (id, name, type, description, defaultCron). The schedule form selects from this registry. The scheduler dispatches execution by `dossierId`. A new `dossier_id` column on `scheduled_tasks` links each row to its dossier.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, simple-git, cron-parser, Next.js Server Actions/Components, Tailwind CSS

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/scheduler/dossiers.ts` | Create | Dossier registry: types, constant array, lookup helpers |
| `src/lib/db/schema.ts` | Modify | Add `dossierId` column to `scheduledTasks` |
| `src/lib/db/migrations/0022_schedule_dossier_id.sql` | Create | ALTER TABLE migration |
| `src/actions/schedule.ts` | Modify | New input types, dossierId validation, drop mission/campaign fields |
| `src/actions/__tests__/schedule.test.ts` | Modify | Update tests for new types + dossierId |
| `src/components/schedule/schedule-form.tsx` | Rewrite | Dossier-driven form: type → task → cron |
| `src/components/schedule/schedule-list.tsx` | Modify | Update type badge colors for 4 new types |
| `src/app/(hq)/battlefields/[id]/schedule/page.tsx` | Modify | Remove assets/campaignTemplates props |
| `src/lib/scheduler/scheduler.ts` | Modify | Dispatch by dossierId, add branch-sweep + activity-digest |
| `src/lib/scheduler/__tests__/dossiers.test.ts` | Create | Tests for dossier registry |

---

### Task 1: Dossier Registry

**Files:**
- Create: `src/lib/scheduler/dossiers.ts`
- Create: `src/lib/scheduler/__tests__/dossiers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/scheduler/__tests__/dossiers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SCHEDULE_DOSSIERS,
  getScheduleDossier,
  getDossiersByType,
  SCHEDULE_TASK_TYPES,
  type ScheduleTaskType,
  type ScheduleTaskDossier,
} from '../dossiers';

describe('SCHEDULE_DOSSIERS', () => {
  it('contains exactly 3 dossiers', () => {
    expect(SCHEDULE_DOSSIERS).toHaveLength(3);
  });

  it('has unique ids', () => {
    const ids = SCHEDULE_DOSSIERS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique names', () => {
    const names = SCHEDULE_DOSSIERS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every dossier has a valid type', () => {
    for (const d of SCHEDULE_DOSSIERS) {
      expect(SCHEDULE_TASK_TYPES).toContain(d.type);
    }
  });

  it('every dossier has a non-empty description', () => {
    for (const d of SCHEDULE_DOSSIERS) {
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
});

describe('getScheduleDossier', () => {
  it('returns dossier by id', () => {
    const d = getScheduleDossier('worktree-sweep');
    expect(d).toBeDefined();
    expect(d!.name).toBe('WORKTREE SWEEP');
    expect(d!.type).toBe('maintenance');
  });

  it('returns undefined for unknown id', () => {
    expect(getScheduleDossier('nonexistent')).toBeUndefined();
  });
});

describe('getDossiersByType', () => {
  it('returns 2 maintenance dossiers', () => {
    const result = getDossiersByType('maintenance');
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.type === 'maintenance')).toBe(true);
  });

  it('returns 1 reporting dossier', () => {
    const result = getDossiersByType('reporting');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('activity-digest');
  });

  it('returns empty array for types with no dossiers', () => {
    expect(getDossiersByType('health')).toEqual([]);
    expect(getDossiersByType('sync')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/scheduler/__tests__/dossiers.test.ts`
Expected: FAIL — module `../dossiers` not found

- [ ] **Step 3: Write the dossier registry**

Create `src/lib/scheduler/dossiers.ts`:

```typescript
export const SCHEDULE_TASK_TYPES = [
  'maintenance',
  'health',
  'reporting',
  'sync',
] as const;

export type ScheduleTaskType = (typeof SCHEDULE_TASK_TYPES)[number];

export interface ScheduleTaskDossier {
  id: string;
  name: string;
  type: ScheduleTaskType;
  description: string;
  defaultCron: string;
}

export const SCHEDULE_DOSSIERS: readonly ScheduleTaskDossier[] = [
  {
    id: 'worktree-sweep',
    name: 'WORKTREE SWEEP',
    type: 'maintenance',
    description:
      'Cleans orphaned worktrees from completed, failed, or abandoned missions. ' +
      'Compares existing worktrees against active mission IDs and removes any ' +
      'that no longer have a running mission.',
    defaultCron: '0 3 * * *',
  },
  {
    id: 'branch-sweep',
    name: 'BRANCH SWEEP',
    type: 'maintenance',
    description:
      'Removes local branches already merged into main and local branches with ' +
      'no commits in 7+ days. Prunes remote tracking refs for deleted upstream ' +
      'branches (git fetch --prune).',
    defaultCron: '0 3 * * *',
  },
  {
    id: 'activity-digest',
    name: 'ACTIVITY DIGEST',
    type: 'reporting',
    description:
      'Generates a summary of recent battlefield activity — missions launched, ' +
      'success/failure rates, campaigns completed, and open intel notes. Report ' +
      'window automatically matches your schedule interval, computed from the ' +
      'previous execution time.',
    defaultCron: '0 8 * * 1',
  },
] as const;

export function getScheduleDossier(id: string): ScheduleTaskDossier | undefined {
  return SCHEDULE_DOSSIERS.find((d) => d.id === id);
}

export function getDossiersByType(type: ScheduleTaskType): ScheduleTaskDossier[] {
  return SCHEDULE_DOSSIERS.filter((d) => d.type === type);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/scheduler/__tests__/dossiers.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/dossiers.ts src/lib/scheduler/__tests__/dossiers.test.ts
git commit -m "feat(schedule): add dossier registry with worktree-sweep, branch-sweep, activity-digest"
```

---

### Task 2: DB Schema + Migration

**Files:**
- Modify: `src/lib/db/schema.ts:157-171`
- Create: `src/lib/db/migrations/0022_schedule_dossier_id.sql`

- [ ] **Step 1: Add `dossierId` to the Drizzle schema**

In `src/lib/db/schema.ts`, find the `scheduledTasks` table definition and add `dossierId` after `campaignId`:

```typescript
// Replace this block:
  campaignId: text('campaign_id').references(() => campaigns.id),

// With:
  campaignId: text('campaign_id').references(() => campaigns.id),
  dossierId: text('dossier_id'),
```

- [ ] **Step 2: Create the migration file**

Create `src/lib/db/migrations/0022_schedule_dossier_id.sql`:

```sql
ALTER TABLE scheduled_tasks ADD COLUMN dossier_id TEXT;

-- Backfill existing WORKTREE SWEEP tasks
UPDATE scheduled_tasks SET dossier_id = 'worktree-sweep' WHERE name = 'WORKTREE SWEEP' AND type = 'maintenance';
```

- [ ] **Step 3: Run `pnpm build` to verify schema compiles**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/0022_schedule_dossier_id.sql
git commit -m "feat(db): add dossier_id column to scheduled_tasks"
```

---

### Task 3: Update Server Actions + Tests

**Files:**
- Modify: `src/actions/schedule.ts:15-136`
- Modify: `src/actions/__tests__/schedule.test.ts`

- [ ] **Step 1: Update the test table SQL to include `dossier_id`**

In `src/actions/__tests__/schedule.test.ts`, find the `scheduled_tasks` CREATE TABLE statement (line 97-111) and add `dossier_id TEXT` after the `campaign_id` line:

```sql
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  battlefield_id TEXT NOT NULL REFERENCES battlefields(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  mission_template TEXT,
  campaign_id TEXT REFERENCES campaigns(id),
  dossier_id TEXT,
  last_run_at INTEGER,
  next_run_at INTEGER,
  run_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write failing tests for the new dossier-driven API**

Replace the existing `createScheduledTask` describe block and add new tests. In `src/actions/__tests__/schedule.test.ts`, replace the entire `describe('createScheduledTask', ...)` block (lines 197-304) with:

```typescript
describe('createScheduledTask', () => {
  it('creates a maintenance task with dossierId', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Nightly Sweep',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 3 * * *',
    });

    expect(task.id).toBeDefined();
    expect(task.name).toBe('Nightly Sweep');
    expect(task.type).toBe('maintenance');
    expect(task.dossierId).toBe('worktree-sweep');
    expect(task.cron).toBe('0 3 * * *');
    expect(task.enabled).toBe(1);
    expect(task.runCount).toBe(0);
    expect(task.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    expect(revalidatePath).toHaveBeenCalledWith(`/battlefields/${BF_ID}/schedule`);
  });

  it('creates a reporting task with dossierId', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Weekly Digest',
      type: 'reporting',
      dossierId: 'activity-digest',
      cron: '0 8 * * 1',
    });

    expect(task.type).toBe('reporting');
    expect(task.dossierId).toBe('activity-digest');
  });

  it('throws on invalid cron expression', async () => {
    await expect(
      createScheduledTask({
        battlefieldId: BF_ID,
        name: 'Bad Cron',
        type: 'maintenance',
        dossierId: 'worktree-sweep',
        cron: 'not-a-cron',
      }),
    ).rejects.toThrow('invalid cron expression');
  });

  it('throws on unknown dossierId', async () => {
    await expect(
      createScheduledTask({
        battlefieldId: BF_ID,
        name: 'Unknown',
        type: 'maintenance',
        dossierId: 'nonexistent-dossier',
        cron: '0 3 * * *',
      }),
    ).rejects.toThrow('Unknown schedule dossier');
  });

  it('throws when dossierId type does not match task type', async () => {
    await expect(
      createScheduledTask({
        battlefieldId: BF_ID,
        name: 'Mismatched',
        type: 'reporting',
        dossierId: 'worktree-sweep',
        cron: '0 3 * * *',
      }),
    ).rejects.toThrow('type mismatch');
  });

  it('persists in the database', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Persisted',
      type: 'maintenance',
      dossierId: 'branch-sweep',
      cron: '0 * * * *',
    });

    const found = testDb
      .select()
      .from(schema.scheduledTasks)
      .where(eq(schema.scheduledTasks.id, task.id))
      .get();

    expect(found).toBeDefined();
    expect(found!.name).toBe('Persisted');
    expect(found!.dossierId).toBe('branch-sweep');
  });
});
```

- [ ] **Step 3: Update the `updateScheduledTask` tests**

Replace the entire `describe('updateScheduledTask', ...)` block (lines 310-373) with:

```typescript
describe('updateScheduledTask', () => {
  let taskId: string;

  beforeEach(async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Original',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 * * * *',
    });
    taskId = task.id;
    vi.clearAllMocks();
  });

  it('updates name without changing cron', async () => {
    const updated = await updateScheduledTask(taskId, { name: 'Renamed' });

    expect(updated.name).toBe('Renamed');
    expect(updated.cron).toBe('0 * * * *');
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('updates cron and recomputes nextRunAt', async () => {
    const before = testDb
      .select()
      .from(schema.scheduledTasks)
      .where(eq(schema.scheduledTasks.id, taskId))
      .get();

    const updated = await updateScheduledTask(taskId, { cron: '30 2 * * *' });

    expect(updated.cron).toBe('30 2 * * *');
    expect(updated.nextRunAt).not.toBe(before!.nextRunAt);
  });

  it('throws on invalid cron update', async () => {
    await expect(
      updateScheduledTask(taskId, { cron: 'invalid' }),
    ).rejects.toThrow('invalid cron expression');
  });

  it('throws when task not found', async () => {
    await expect(
      updateScheduledTask('nonexistent', { name: 'X' }),
    ).rejects.toThrow('nonexistent not found');
  });

  it('updates dossierId with type validation', async () => {
    const updated = await updateScheduledTask(taskId, {
      dossierId: 'branch-sweep',
    });
    expect(updated.dossierId).toBe('branch-sweep');
  });

  it('throws when updated dossierId type does not match task type', async () => {
    await expect(
      updateScheduledTask(taskId, { dossierId: 'activity-digest' }),
    ).rejects.toThrow('type mismatch');
  });
});
```

- [ ] **Step 4: Update the remaining test blocks for new types**

In `listScheduledTasks` tests, update task creation calls to use the new API. Replace the `describe('listScheduledTasks', ...)` block (lines 411-467) with:

```typescript
describe('listScheduledTasks', () => {
  it('returns tasks for the given battlefield', async () => {
    await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Task A',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 1 * * *',
    });
    await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Task B',
      type: 'maintenance',
      dossierId: 'branch-sweep',
      cron: '0 2 * * *',
    });

    const tasks = await listScheduledTasks(BF_ID);

    expect(tasks).toHaveLength(2);
    const names = tasks.map(t => t.name).sort();
    expect(names).toEqual(['Task A', 'Task B']);
  });

  it('returns empty array for battlefield with no tasks', async () => {
    const tasks = await listScheduledTasks(BF_ID);
    expect(tasks).toEqual([]);
  });

  it('does not return tasks from other battlefields', async () => {
    testDb.insert(schema.battlefields).values({
      id: 'bf_other',
      name: 'Other',
      codename: 'OTHER',
      repoPath: '/tmp/other',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    await createScheduledTask({
      battlefieldId: 'bf_other',
      name: 'Other Task',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 0 * * *',
    });
    await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'My Task',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 0 * * *',
    });

    const tasks = await listScheduledTasks(BF_ID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe('My Task');
  });
});
```

Update the `toggleScheduledTask` tests. Replace the `describe('toggleScheduledTask', ...)` block (lines 473-514) with:

```typescript
describe('toggleScheduledTask', () => {
  it('disables an enabled task', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Toggle Me',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 0 * * *',
    });
    expect(task.enabled).toBe(1);

    const disabled = await toggleScheduledTask(task.id, false);

    expect(disabled.enabled).toBe(0);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('enables a disabled task and recomputes nextRunAt', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Toggle Me',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 0 * * *',
    });

    await toggleScheduledTask(task.id, false);
    vi.clearAllMocks();

    const enabled = await toggleScheduledTask(task.id, true);

    expect(enabled.enabled).toBe(1);
    expect(enabled.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('throws when task not found', async () => {
    await expect(toggleScheduledTask('nonexistent', true)).rejects.toThrow(
      'nonexistent not found',
    );
  });
});
```

Update `deleteScheduledTask` tests. Replace the `describe('deleteScheduledTask', ...)` block (lines 379-405) with:

```typescript
describe('deleteScheduledTask', () => {
  it('removes the task from the database', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'To Delete',
      type: 'maintenance',
      dossierId: 'worktree-sweep',
      cron: '0 0 * * *',
    });

    await deleteScheduledTask(task.id);

    const found = testDb
      .select()
      .from(schema.scheduledTasks)
      .where(eq(schema.scheduledTasks.id, task.id))
      .get();

    expect(found).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('throws when task not found', async () => {
    await expect(deleteScheduledTask('nonexistent')).rejects.toThrow(
      'nonexistent not found',
    );
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run src/actions/__tests__/schedule.test.ts`
Expected: FAIL — `createScheduledTask` doesn't accept `dossierId`, throws on old types

- [ ] **Step 6: Update `createScheduledTask` in `src/actions/schedule.ts`**

Replace the `CreateScheduledTaskInput` interface and `createScheduledTask` function (lines 15-70) with:

```typescript
import { getScheduleDossier, type ScheduleTaskType } from '@/lib/scheduler/dossiers';

interface CreateScheduledTaskInput {
  battlefieldId: string;
  name: string;
  type: ScheduleTaskType;
  dossierId: string;
  cron: string;
}

export async function createScheduledTask(
  data: CreateScheduledTaskInput,
): Promise<ScheduledTask> {
  if (!validateCron(data.cron)) {
    throw new Error(`createScheduledTask: invalid cron expression "${data.cron}"`);
  }

  const dossier = getScheduleDossier(data.dossierId);
  if (!dossier) {
    throw new Error(`createScheduledTask: Unknown schedule dossier "${data.dossierId}"`);
  }
  if (dossier.type !== data.type) {
    throw new Error(
      `createScheduledTask: type mismatch — dossier "${data.dossierId}" is ${dossier.type}, not ${data.type}`,
    );
  }

  const db = getDatabase();
  const id = generateId();
  const now = Date.now();
  const nextRunAt = getNextRun(data.cron);

  const record = db
    .insert(scheduledTasks)
    .values({
      id,
      battlefieldId: data.battlefieldId,
      name: data.name,
      type: data.type,
      cron: data.cron,
      enabled: 1,
      dossierId: data.dossierId,
      missionTemplate: null,
      campaignId: null,
      nextRunAt,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  revalidatePath(`/battlefields/${data.battlefieldId}/schedule`);
  return record;
}
```

- [ ] **Step 7: Update `updateScheduledTask` in `src/actions/schedule.ts`**

Replace the `UpdateScheduledTaskInput` interface and `updateScheduledTask` function (lines 76-136) with:

```typescript
interface UpdateScheduledTaskInput {
  name?: string;
  cron?: string;
  type?: ScheduleTaskType;
  dossierId?: string;
}

export async function updateScheduledTask(
  id: string,
  data: UpdateScheduledTaskInput,
): Promise<ScheduledTask> {
  const db = getDatabase();
  const existing = getOrThrow(scheduledTasks, id, 'updateScheduledTask');

  const now = Date.now();

  // Validate cron if changed
  let nextRunAt = existing.nextRunAt;
  if (data.cron && data.cron !== existing.cron) {
    if (!validateCron(data.cron)) {
      throw new Error(`updateScheduledTask: invalid cron expression "${data.cron}"`);
    }
    nextRunAt = getNextRun(data.cron);
  }

  // Validate dossierId if changed
  const effectiveType = data.type ?? existing.type;
  if (data.dossierId) {
    const dossier = getScheduleDossier(data.dossierId);
    if (!dossier) {
      throw new Error(`updateScheduledTask: Unknown schedule dossier "${data.dossierId}"`);
    }
    if (dossier.type !== effectiveType) {
      throw new Error(
        `updateScheduledTask: type mismatch — dossier "${data.dossierId}" is ${dossier.type}, not ${effectiveType}`,
      );
    }
  }

  const record = db
    .update(scheduledTasks)
    .set({
      name: data.name ?? existing.name,
      cron: data.cron ?? existing.cron,
      type: effectiveType,
      dossierId: data.dossierId ?? existing.dossierId,
      nextRunAt,
      updatedAt: now,
    })
    .where(eq(scheduledTasks.id, id))
    .returning()
    .get();

  revalidatePath(`/battlefields/${existing.battlefieldId}/schedule`);
  return record;
}
```

Also remove the old `import type { ScheduledTask, Mission } from '@/types';` line and ensure it now reads:

```typescript
import type { ScheduledTask, Mission } from '@/types';
import { getScheduleDossier, type ScheduleTaskType } from '@/lib/scheduler/dossiers';
```

(Add the dossier import near the top of the file, after the existing imports.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run src/actions/__tests__/schedule.test.ts`
Expected: all tests PASS

- [ ] **Step 9: Run full build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 10: Commit**

```bash
git add src/actions/schedule.ts src/actions/__tests__/schedule.test.ts
git commit -m "feat(schedule): update server actions to dossier-driven API"
```

---

### Task 4: Schedule Form Rewrite

**Files:**
- Rewrite: `src/components/schedule/schedule-form.tsx`

- [ ] **Step 1: Rewrite the schedule form**

Replace the entire contents of `src/components/schedule/schedule-form.tsx` with:

```typescript
'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { TacCard } from '@/components/ui/tac-card';
import {
  TacSelect,
  TacSelectTrigger,
  TacSelectContent,
  TacSelectItem,
  TacSelectValue,
} from '@/components/ui/tac-select';
import { createScheduledTask, updateScheduledTask } from '@/actions/schedule';
import { formatCronHuman, validateCron } from '@/lib/scheduler/cron';
import {
  SCHEDULE_TASK_TYPES,
  getDossiersByType,
  getScheduleDossier,
  type ScheduleTaskType,
} from '@/lib/scheduler/dossiers';
import type { ScheduledTask } from '@/types';

interface ScheduleFormProps {
  battlefieldId: string;
  editTask?: ScheduledTask;
  onClose: () => void;
}

const CRON_PRESETS = [
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 3am', cron: '0 3 * * *' },
  { label: 'Weekly Mon 9am', cron: '0 9 * * 1' },
  { label: 'Monthly 1st', cron: '0 0 1 * *' },
] as const;

const TYPE_LABELS: Record<ScheduleTaskType, string> = {
  maintenance: 'Maintenance',
  health: 'Health',
  reporting: 'Reporting',
  sync: 'Sync',
};

export function ScheduleForm({
  battlefieldId,
  editTask,
  onClose,
}: ScheduleFormProps) {
  const isEdit = !!editTask;

  const [name, setName] = useState(editTask?.name ?? '');
  const [type, setType] = useState<ScheduleTaskType>(
    (editTask?.type as ScheduleTaskType) ?? 'maintenance',
  );
  const [dossierId, setDossierId] = useState(editTask?.dossierId ?? '');
  const [cron, setCron] = useState(editTask?.cron ?? '0 3 * * *');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const cronValid = validateCron(cron);
  const cronHuman = cronValid ? formatCronHuman(cron) : 'Invalid expression';
  const availableDossiers = getDossiersByType(type);
  const selectedDossier = dossierId ? getScheduleDossier(dossierId) : undefined;

  function handleTypeChange(newType: ScheduleTaskType) {
    setType(newType);
    // Clear dossier selection when type changes — it may not be valid for the new type
    setDossierId('');
  }

  function handleDossierChange(newDossierId: string) {
    setDossierId(newDossierId);
    // Pre-fill cron with dossier default
    const dossier = getScheduleDossier(newDossierId);
    if (dossier) {
      setCron(dossier.defaultCron);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!dossierId) {
      setError('Task selection is required');
      return;
    }
    if (!cronValid) {
      setError('Invalid cron expression');
      return;
    }

    startTransition(async () => {
      try {
        if (isEdit) {
          await updateScheduledTask(editTask.id, {
            name: name.trim(),
            type,
            dossierId,
            cron,
          });
        } else {
          await createScheduledTask({
            battlefieldId,
            name: name.trim(),
            type,
            dossierId,
            cron,
          });
        }
        toast.success(isEdit ? 'Task updated' : 'Task scheduled');
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <TacCard status="amber" className="space-y-4">
      <h3 className="text-dr-amber font-tactical text-sm uppercase tracking-wider">
        {isEdit ? 'Edit Scheduled Task' : 'New Scheduled Task'}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Name
          </label>
          <TacInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nightly worktree cleanup"
            disabled={isPending}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Type
          </label>
          <TacSelect
            value={type}
            onValueChange={(v) => { if (v) handleTypeChange(v as ScheduleTaskType); }}
          >
            <TacSelectTrigger>
              <TacSelectValue />
            </TacSelectTrigger>
            <TacSelectContent>
              {SCHEDULE_TASK_TYPES.map((t) => (
                <TacSelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </TacSelectItem>
              ))}
            </TacSelectContent>
          </TacSelect>
        </div>

        {/* Task (dossier selector) */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Task
          </label>
          <TacSelect
            value={dossierId}
            onValueChange={(v) => { if (v) handleDossierChange(v); }}
          >
            <TacSelectTrigger>
              <TacSelectValue placeholder="Select task..." />
            </TacSelectTrigger>
            <TacSelectContent>
              {availableDossiers.length === 0 ? (
                <TacSelectItem value="_none" disabled>
                  No tasks available for this type
                </TacSelectItem>
              ) : (
                availableDossiers.map((d) => (
                  <TacSelectItem key={d.id} value={d.id}>
                    {d.name}
                  </TacSelectItem>
                ))
              )}
            </TacSelectContent>
          </TacSelect>
          {selectedDossier && (
            <p className="mt-2 text-dr-muted font-tactical text-xs leading-relaxed">
              {selectedDossier.description}
            </p>
          )}
        </div>

        {/* Cron */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Schedule (cron)
          </label>
          <TacInput
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 3 * * *"
            disabled={isPending}
          />
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`font-tactical text-xs ${
                cronValid ? 'text-dr-green' : 'text-dr-red'
              }`}
            >
              {cronHuman}
            </span>
          </div>
          {/* Presets */}
          <div className="flex flex-wrap gap-2 mt-2">
            {CRON_PRESETS.map((preset) => (
              <TacButton
                key={preset.cron}
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => setCron(preset.cron)}
                disabled={isPending}
              >
                {preset.label}
              </TacButton>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-dr-red font-tactical text-xs border border-dr-red/30 bg-dr-red/5 px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <TacButton type="submit" variant="success" className="min-h-[44px]" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </TacButton>
          <TacButton
            type="button"
            variant="ghost"
            className="min-h-[44px]"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </TacButton>
        </div>
      </form>
    </TacCard>
  );
}
```

- [ ] **Step 2: Run `pnpm build` to verify it compiles**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/schedule/schedule-form.tsx
git commit -m "feat(schedule): rewrite form with dossier-driven selector"
```

---

### Task 5: Schedule List + Page Updates

**Files:**
- Modify: `src/components/schedule/schedule-list.tsx:74-85`
- Modify: `src/app/(hq)/battlefields/[id]/schedule/page.tsx`

- [ ] **Step 1: Update type badge colors in schedule-list.tsx**

In `src/components/schedule/schedule-list.tsx`, replace the `getTypeBadgeColor` function (lines 74-85) with:

```typescript
  function getTypeBadgeColor(type: string): 'amber' | 'green' | 'blue' {
    switch (type) {
      case 'maintenance':
        return 'blue';
      case 'health':
        return 'green';
      case 'reporting':
        return 'amber';
      case 'sync':
        return 'blue';
      default:
        return 'amber';
    }
  }
```

- [ ] **Step 2: Update ScheduleList props to remove assets and campaignTemplates**

In `src/components/schedule/schedule-list.tsx`, update the interface and component signature. Replace the `ScheduleListProps` interface (lines 14-19) with:

```typescript
interface ScheduleListProps {
  tasks: ScheduledTask[];
  battlefieldId: string;
}
```

Update the component function signature (lines 21-26) to:

```typescript
export function ScheduleList({
  tasks,
  battlefieldId,
}: ScheduleListProps) {
```

Remove the `assets` and `campaignTemplates` props from the two `<ScheduleForm>` render locations. Replace the first `ScheduleForm` usage (lines 89-95) with:

```typescript
      <ScheduleForm
        battlefieldId={battlefieldId}
        editTask={editingTask}
        onClose={() => setEditingTask(null)}
      />
```

Replace the second `ScheduleForm` usage (lines 100-107) with:

```typescript
      <ScheduleForm
        battlefieldId={battlefieldId}
        onClose={() => setShowCreate(false)}
      />
```

Remove the unused imports `Asset` and `Campaign` from the import line (line 11). Change:

```typescript
import type { ScheduledTask, Asset, Campaign } from '@/types';
```

To:

```typescript
import type { ScheduledTask } from '@/types';
```

- [ ] **Step 3: Update the schedule page to remove asset/campaign queries**

Replace the entire contents of `src/app/(hq)/battlefields/[id]/schedule/page.tsx` with:

```typescript
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { listScheduledTasks } from '@/actions/schedule';
import { ScheduleList } from '@/components/schedule/schedule-list';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: battlefieldId } = await params;

  const tasks = await listScheduledTasks(battlefieldId);

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, battlefieldId)).get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'SCHEDULE']}
      title="SCHEDULE"
    >
      <ScheduleList
        tasks={tasks}
        battlefieldId={battlefieldId}
      />
    </PageWrapper>
  );
}
```

- [ ] **Step 4: Run `pnpm build`**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/schedule-list.tsx src/app/(hq)/battlefields/[id]/schedule/page.tsx
git commit -m "feat(schedule): update list badges and page for dossier-driven types"
```

---

### Task 6: Scheduler — Dispatch by dossierId + Branch Sweep

**Files:**
- Modify: `src/lib/scheduler/scheduler.ts`

- [ ] **Step 1: Rewrite the scheduler to dispatch by dossierId**

Replace the entire contents of `src/lib/scheduler/scheduler.ts` with:

```typescript
import { eq, and, lte, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { scheduledTasks, battlefields, missions, campaigns, intelNotes, commandLogs, notifications } from '@/lib/db/schema';
import { getNextRun } from './cron';
import { generateId } from '@/lib/utils';
import { CronExpressionParser } from 'cron-parser';

export class Scheduler {
  private interval: NodeJS.Timeout | null = null;

  start(): void {
    console.log('[Scheduler] Starting — polling every 60s');
    this.tick();
    this.interval = setInterval(() => this.tick(), 60_000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[Scheduler] Stopped');
  }

  private tick(): void {
    const now = Date.now();
    const db = getDatabase();

    const dueTasks = db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.enabled, 1),
          lte(scheduledTasks.nextRunAt, now),
        ),
      )
      .all();

    // Group by dossierId (or fallback to name for legacy tasks)
    const groups = new Map<string, typeof dueTasks>();
    for (const task of dueTasks) {
      const key = task.dossierId ?? `legacy:${task.name}`;
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }

    for (const [key, tasks] of groups) {
      const battlefieldIds = tasks.map((t) => t.battlefieldId);

      try {
        this.executeDossier(key, battlefieldIds, tasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Dossier ${key} failed: ${message}`);
      }

      for (const task of tasks) {
        this.markExecuted(task, now);
      }
    }
  }

  private markExecuted(task: typeof scheduledTasks.$inferSelect, now: number): void {
    const db = getDatabase();
    try {
      const nextRun = getNextRun(task.cron);
      db.update(scheduledTasks)
        .set({
          lastRunAt: now,
          nextRunAt: nextRun,
          runCount: (task.runCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(scheduledTasks.id, task.id))
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Failed to update next run for task ${task.id}: ${message}`);
    }
  }

  private executeDossier(
    key: string,
    battlefieldIds: string[],
    tasks: (typeof scheduledTasks.$inferSelect)[],
  ): void {
    const dossierId = key.startsWith('legacy:') ? null : key;
    const legacyName = key.startsWith('legacy:') ? key.slice(7) : null;

    // Resolve which operation to run
    const operationId = dossierId ?? this.resolveLegacyDossier(legacyName);

    switch (operationId) {
      case 'worktree-sweep':
        this.runWorktreeSweep(battlefieldIds).catch((err: unknown) => {
          console.error(`[Scheduler] WORKTREE SWEEP failed:`, err);
        });
        break;
      case 'branch-sweep':
        this.runBranchSweep(battlefieldIds).catch((err: unknown) => {
          console.error(`[Scheduler] BRANCH SWEEP failed:`, err);
        });
        break;
      case 'activity-digest':
        this.runActivityDigest(battlefieldIds, tasks).catch((err: unknown) => {
          console.error(`[Scheduler] ACTIVITY DIGEST failed:`, err);
        });
        break;
      default:
        console.warn(`[Scheduler] Unknown dossier: ${key}`);
    }
  }

  /** Map legacy task names (no dossierId) to dossier IDs */
  private resolveLegacyDossier(name: string | null): string | null {
    if (!name) return null;
    switch (name) {
      case 'WORKTREE SWEEP': return 'worktree-sweep';
      default: return null;
    }
  }

  // ---------------------------------------------------------------------------
  // WORKTREE SWEEP (existing logic, moved from runMaintenance)
  // ---------------------------------------------------------------------------

  private async runWorktreeSweep(battlefieldIds: string[]): Promise<void> {
    const { cleanOrphanedWorktrees } = await import('@/lib/orchestrator/worktree');
    const db = getDatabase();
    const startTime = Date.now();

    const targetBattlefields = db
      .select()
      .from(battlefields)
      .where(inArray(battlefields.id, battlefieldIds))
      .all();

    const activeMissions = db
      .select({ id: missions.id })
      .from(missions)
      .where(
        inArray(missions.status, ['standby', 'queued', 'deploying', 'in_combat', 'reviewing', 'approved', 'merging']),
      )
      .all();
    const activeIds = activeMissions.map((m) => m.id);

    let totalCleaned = 0;
    const logLines: string[] = [`WORKTREE SWEEP — ${new Date().toISOString()}`];

    for (const bf of targetBattlefields) {
      const cleaned = await cleanOrphanedWorktrees(bf.repoPath, activeIds);
      const line = `  ${bf.codename}: ${cleaned} orphaned worktree${cleaned !== 1 ? 's' : ''} cleaned`;
      logLines.push(line);
      if (cleaned > 0) {
        console.log(`[Scheduler] WORKTREE SWEEP: cleaned ${cleaned} orphaned worktrees in ${bf.codename}`);
      }
      totalCleaned += cleaned;
    }

    const durationMs = Date.now() - startTime;
    logLines.push(`  Total: ${totalCleaned} cleaned in ${durationMs}ms`);
    const logOutput = logLines.join('\n');

    for (const bfId of battlefieldIds) {
      db.insert(commandLogs)
        .values({
          id: generateId(),
          battlefieldId: bfId,
          command: 'WORKTREE SWEEP',
          exitCode: 0,
          durationMs,
          output: logOutput,
          createdAt: Date.now(),
        })
        .run();
    }

    console.log(`[Scheduler] WORKTREE SWEEP complete: ${totalCleaned} total cleaned`);
  }

  // ---------------------------------------------------------------------------
  // BRANCH SWEEP
  // ---------------------------------------------------------------------------

  private async runBranchSweep(battlefieldIds: string[]): Promise<void> {
    const simpleGit = (await import('simple-git')).default;
    const db = getDatabase();
    const startTime = Date.now();

    const targetBattlefields = db
      .select()
      .from(battlefields)
      .where(inArray(battlefields.id, battlefieldIds))
      .all();

    const logLines: string[] = [`BRANCH SWEEP — ${new Date().toISOString()}`];
    let totalDeleted = 0;

    for (const bf of targetBattlefields) {
      const git = simpleGit(bf.repoPath);
      const defaultBranch = bf.defaultBranch || 'main';
      let bfDeleted = 0;

      try {
        // Prune remote tracking refs
        await git.fetch(['--prune']);

        // Get current branch to avoid deleting it
        const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

        // Delete merged branches
        const mergedRaw = await git.raw(['branch', '--merged', defaultBranch]);
        const mergedBranches = mergedRaw
          .split('\n')
          .map((b) => b.trim().replace(/^\*\s*/, ''))
          .filter((b) => b && b !== defaultBranch && b !== 'master' && b !== currentBranch);

        for (const branch of mergedBranches) {
          try {
            await git.branch(['-d', branch]);
            bfDeleted++;
          } catch {
            // Branch may be protected or already gone
          }
        }

        // Delete stale branches (no commits in 7+ days)
        const allBranchesRaw = await git.raw(['branch']);
        const allBranches = allBranchesRaw
          .split('\n')
          .map((b) => b.trim().replace(/^\*\s*/, ''))
          .filter((b) => b && b !== defaultBranch && b !== 'master' && b !== currentBranch && !mergedBranches.includes(b));

        const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const branch of allBranches) {
          try {
            const dateStr = (await git.raw(['log', '-1', '--format=%ci', branch])).trim();
            if (dateStr) {
              const commitDate = new Date(dateStr).getTime();
              if (commitDate < cutoffMs) {
                await git.branch(['-D', branch]);
                bfDeleted++;
              }
            }
          } catch {
            // Skip branches that can't be inspected
          }
        }

        logLines.push(`  ${bf.codename}: ${bfDeleted} branch${bfDeleted !== 1 ? 'es' : ''} deleted`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logLines.push(`  ${bf.codename}: ERROR — ${msg}`);
      }

      totalDeleted += bfDeleted;
    }

    const durationMs = Date.now() - startTime;
    logLines.push(`  Total: ${totalDeleted} deleted in ${durationMs}ms`);
    const logOutput = logLines.join('\n');

    for (const bfId of battlefieldIds) {
      db.insert(commandLogs)
        .values({
          id: generateId(),
          battlefieldId: bfId,
          command: 'BRANCH SWEEP',
          exitCode: 0,
          durationMs,
          output: logOutput,
          createdAt: Date.now(),
        })
        .run();
    }

    console.log(`[Scheduler] BRANCH SWEEP complete: ${totalDeleted} total deleted`);
  }

  // ---------------------------------------------------------------------------
  // ACTIVITY DIGEST
  // ---------------------------------------------------------------------------

  private async runActivityDigest(
    battlefieldIds: string[],
    tasks: (typeof scheduledTasks.$inferSelect)[],
  ): Promise<void> {
    const db = getDatabase();

    for (const bfId of battlefieldIds) {
      const bf = db
        .select()
        .from(battlefields)
        .where(eq(battlefields.id, bfId))
        .get();
      if (!bf) continue;

      // Compute report window from lastRunAt or cron interval
      const task = tasks.find((t) => t.battlefieldId === bfId);
      let windowStart: number;

      if (task?.lastRunAt) {
        windowStart = task.lastRunAt;
      } else {
        // Estimate from cron interval: find previous theoretical run
        try {
          const interval = CronExpressionParser.parse(task?.cron ?? '0 0 * * *');
          windowStart = interval.prev().getTime();
        } catch {
          windowStart = Date.now() - 24 * 60 * 60 * 1000; // fallback: 24h
        }
      }

      const now = Date.now();

      // Query missions in window
      const allMissions = db
        .select()
        .from(missions)
        .where(eq(missions.battlefieldId, bfId))
        .all()
        .filter((m) => m.createdAt >= windowStart);

      const accomplished = allMissions.filter((m) => m.status === 'accomplished').length;
      const compromised = allMissions.filter((m) => m.status === 'compromised').length;
      const totalMissions = allMissions.length;

      // Query campaigns completed in window
      const allCampaigns = db
        .select()
        .from(campaigns)
        .where(eq(campaigns.battlefieldId, bfId))
        .all()
        .filter((c) => c.updatedAt >= windowStart && (c.status === 'accomplished' || c.status === 'compromised'));
      const campaignsCompleted = allCampaigns.length;

      // Count open intel notes
      const openNotes = db
        .select()
        .from(intelNotes)
        .where(
          and(
            eq(intelNotes.battlefieldId, bfId),
            eq(intelNotes.column, 'tasked'),
          ),
        )
        .all().length;

      // Format window dates
      const startDate = new Date(windowStart).toISOString().slice(0, 16).replace('T', ' ');
      const endDate = new Date(now).toISOString().slice(0, 16).replace('T', ' ');

      const summary = [
        `ACTIVITY DIGEST — ${bf.codename}`,
        `Period: ${startDate} → ${endDate}`,
        '',
        `Missions: ${totalMissions} launched, ${accomplished} accomplished, ${compromised} compromised`,
        `Campaigns: ${campaignsCompleted} completed`,
        `Open Intel: ${openNotes} note${openNotes !== 1 ? 's' : ''} in tasked column`,
      ].join('\n');

      // Create notification
      const { escalate } = await import('@/lib/overseer/escalation');
      await escalate({
        level: 'info',
        title: `ACTIVITY DIGEST — ${bf.codename}`,
        detail: summary,
        entityType: undefined,
        entityId: undefined,
        battlefieldId: bfId,
      });

      console.log(`[Scheduler] ACTIVITY DIGEST sent for ${bf.codename}`);
    }
  }
}
```

- [ ] **Step 2: Run `pnpm build`**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduler/scheduler.ts
git commit -m "feat(schedule): dispatch by dossierId, add branch-sweep and activity-digest"
```

---

### Task 7: Final Build Verification

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run`
Expected: all tests pass

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Verify migration applies on fresh DB**

Run the app to confirm migration `0022_schedule_dossier_id.sql` is picked up. Check that existing WORKTREE SWEEP tasks get `dossierId` backfilled if any exist.

- [ ] **Step 4: Commit any fixups**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(schedule): post-integration fixups for dossier system"
```
