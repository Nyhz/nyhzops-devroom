import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import { createMockDbModule } from '@/lib/test/mock-db';

// ---------------------------------------------------------------------------
// In-memory test database
// ---------------------------------------------------------------------------

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS battlefields (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  codename TEXT NOT NULL,
  description TEXT,
  initial_briefing TEXT,
  repo_path TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  claude_md_path TEXT,
  spec_md_path TEXT,
  scaffold_command TEXT,
  scaffold_status TEXT,
  dev_server_command TEXT DEFAULT 'npm run dev',
  auto_start_dev_server INTEGER DEFAULT 0,
  status TEXT DEFAULT 'initializing',
  bootstrap_mission_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  battlefield_id TEXT NOT NULL REFERENCES battlefields(id),
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  worktree_mode TEXT DEFAULT 'phase',
  current_phase INTEGER DEFAULT 0,
  is_template INTEGER DEFAULT 0,
  template_id TEXT,
  debrief TEXT,
  stall_reason TEXT,
  stalled_phase_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT DEFAULT 'standby',
  debrief TEXT,
  total_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  completing_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  battlefield_id TEXT NOT NULL REFERENCES battlefields(id),
  campaign_id TEXT REFERENCES campaigns(id),
  phase_id TEXT REFERENCES phases(id),
  type TEXT DEFAULT 'standard',
  title TEXT NOT NULL,
  briefing TEXT NOT NULL,
  status TEXT DEFAULT 'standby',
  priority TEXT DEFAULT 'normal',
  asset_id TEXT,
  use_worktree INTEGER DEFAULT 0,
  worktree_branch TEXT,
  depends_on TEXT,
  session_id TEXT,
  debrief TEXT,
  iterations INTEGER DEFAULT 0,
  cost_input INTEGER DEFAULT 0,
  cost_output INTEGER DEFAULT 0,
  cost_cache_hit INTEGER DEFAULT 0,
  review_attempts INTEGER DEFAULT 0,
  compromise_reason TEXT,
  merge_retry_at INTEGER,
  merge_result TEXT,
  merge_conflict_files TEXT,
  merge_timestamp INTEGER,
  skill_overrides TEXT,
  duration_ms INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  battlefield_id TEXT NOT NULL REFERENCES battlefields(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  mission_template TEXT,
  campaign_id TEXT REFERENCES campaigns(id),
  last_run_at INTEGER,
  next_run_at INTEGER,
  run_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

function createTestDb() {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TABLE_SQL);
  testDb = drizzle(sqlite, { schema });
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
  sqlite.close();
});

// ---------------------------------------------------------------------------
// createScheduledTask
// ---------------------------------------------------------------------------

describe('createScheduledTask', () => {
  it('creates a mission-type task with template', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Nightly Build',
      type: 'mission',
      cron: '0 2 * * *',
      briefing: 'Run the build',
      assetId: 'asset_1',
      priority: 'high',
    });

    expect(task.id).toBeDefined();
    expect(task.name).toBe('Nightly Build');
    expect(task.type).toBe('mission');
    expect(task.cron).toBe('0 2 * * *');
    expect(task.enabled).toBe(1);
    expect(task.runCount).toBe(0);
    expect(task.nextRunAt).toBeGreaterThan(Date.now() - 1000);

    const template = JSON.parse(task.missionTemplate!);
    expect(template.briefing).toBe('Run the build');
    expect(template.assetId).toBe('asset_1');
    expect(template.priority).toBe('high');

    expect(revalidatePath).toHaveBeenCalledWith(`/battlefields/${BF_ID}/schedule`);
  });

  it('creates a campaign-type task without mission template', async () => {
    // Seed a campaign for the FK
    testDb.insert(schema.campaigns).values({
      id: 'camp_1',
      battlefieldId: BF_ID,
      name: 'Test Campaign',
      objective: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Weekly Campaign',
      type: 'campaign',
      cron: '0 0 * * 1',
      campaignId: 'camp_1',
    });

    expect(task.type).toBe('campaign');
    expect(task.campaignId).toBe('camp_1');
    expect(task.missionTemplate).toBeNull();
  });

  it('creates a maintenance-type task', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'DB Cleanup',
      type: 'maintenance',
      cron: '0 3 * * 0',
    });

    expect(task.type).toBe('maintenance');
    expect(task.missionTemplate).toBeNull();
    expect(task.campaignId).toBeNull();
  });

  it('throws on invalid cron expression', async () => {
    await expect(
      createScheduledTask({
        battlefieldId: BF_ID,
        name: 'Bad Cron',
        type: 'mission',
        cron: 'not-a-cron',
      }),
    ).rejects.toThrow('invalid cron expression');
  });

  it('defaults priority to normal when not specified', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Default Priority',
      type: 'mission',
      cron: '*/10 * * * *',
    });

    const template = JSON.parse(task.missionTemplate!);
    expect(template.priority).toBe('normal');
    expect(template.briefing).toBe('');
    expect(template.assetId).toBeNull();
  });

  it('persists in the database', async () => {
    const task = await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Persisted',
      type: 'mission',
      cron: '0 * * * *',
    });

    const found = testDb
      .select()
      .from(schema.scheduledTasks)
      .where(eq(schema.scheduledTasks.id, task.id))
      .get();

    expect(found).toBeDefined();
    expect(found!.name).toBe('Persisted');
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
      type: 'mission',
      cron: '0 * * * *',
      briefing: 'Original briefing',
      priority: 'normal',
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

  it('merges mission template fields', async () => {
    const updated = await updateScheduledTask(taskId, { priority: 'critical' });

    const template = JSON.parse(updated.missionTemplate!);
    expect(template.priority).toBe('critical');
    expect(template.briefing).toBe('Original briefing');
  });

  it('clears missionTemplate when switching to campaign type', async () => {
    const updated = await updateScheduledTask(taskId, { type: 'campaign' });

    expect(updated.type).toBe('campaign');
    expect(updated.missionTemplate).toBeNull();
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
      type: 'mission',
      cron: '0 1 * * *',
    });
    await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'Task B',
      type: 'maintenance',
      cron: '0 2 * * *',
    });

    const tasks = await listScheduledTasks(BF_ID);

    expect(tasks).toHaveLength(2);
    // Ordered by nextRunAt ascending
    expect(tasks[0].name).toBe('Task A');
    expect(tasks[1].name).toBe('Task B');
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
      cron: '0 0 * * *',
    });
    await createScheduledTask({
      battlefieldId: BF_ID,
      name: 'My Task',
      type: 'maintenance',
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
      cron: '0 0 * * *',
    });

    // Disable first
    await toggleScheduledTask(task.id, false);
    vi.clearAllMocks();

    // Enable — should recompute nextRunAt
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
