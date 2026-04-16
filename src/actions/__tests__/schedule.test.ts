import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import * as schema from '@/lib/db/schema';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createMockDbModule } from '@/lib/test/mock-db';
import type { TestDB } from '@/lib/test/db';

// ---------------------------------------------------------------------------
// In-memory test database — uses shared getTestDb() to stay in sync with schema
// ---------------------------------------------------------------------------

let sqlite: Database.Database;
let testDb: TestDB;

function createTestDb() {
  const result = getTestDb();
  sqlite = result.sqlite;
  testDb = result.db;
  return testDb;
}

// ---------------------------------------------------------------------------
// Mock @/lib/db/index — must be before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/index', () => createMockDbModule(() => testDb));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  toggleScheduledTask,
  getScheduleHistory,
} from '../schedule';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BF_ID = 'bf_sched_test';

function seedBattlefield() {
  testDb.insert(schema.battlefields).values({
    id: BF_ID,
    name: 'Sched Test',
    codename: 'SCHED',
    repoPath: '/tmp/sched-repo',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }).run();
}

function seedScheduledMissions(count: number) {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    testDb.insert(schema.missions).values({
      id: `m_sched_${i}`,
      battlefieldId: BF_ID,
      title: `[Scheduled] task-${i}`,
      briefing: `Scheduled briefing ${i}`,
      status: 'accomplished',
      createdAt: now - (count - i) * 1000,
      updatedAt: now - (count - i) * 1000,
    }).run();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  createTestDb();
  seedBattlefield();
  vi.clearAllMocks();
});

afterEach(() => {
  closeTestDb(sqlite);
});

// ---------------------------------------------------------------------------
// createScheduledTask
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// updateScheduledTask
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// deleteScheduledTask
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// listScheduledTasks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// toggleScheduledTask
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getScheduleHistory
// ---------------------------------------------------------------------------

describe('getScheduleHistory', () => {
  it('returns missions prefixed with [Scheduled]', async () => {
    seedScheduledMissions(5);

    // Also seed a non-scheduled mission
    testDb.insert(schema.missions).values({
      id: 'm_regular',
      battlefieldId: BF_ID,
      title: 'Regular Mission',
      briefing: 'Not scheduled',
      status: 'accomplished',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    const history = await getScheduleHistory(BF_ID);

    expect(history).toHaveLength(5);
    expect(history.every((m) => m.title.startsWith('[Scheduled]'))).toBe(true);
  });

  it('respects limit parameter', async () => {
    seedScheduledMissions(10);

    const history = await getScheduleHistory(BF_ID, 3);
    expect(history).toHaveLength(3);
  });

  it('returns empty array when no scheduled missions exist', async () => {
    const history = await getScheduleHistory(BF_ID);
    expect(history).toEqual([]);
  });

  it('orders by createdAt descending', async () => {
    seedScheduledMissions(3);

    const history = await getScheduleHistory(BF_ID);

    // Most recent first
    for (let i = 0; i < history.length - 1; i++) {
      expect(history[i].createdAt).toBeGreaterThanOrEqual(history[i + 1].createdAt);
    }
  });
});
