import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestMission } from '@/lib/test/fixtures';
import type { DB } from '@/lib/db/index';
import { eq } from 'drizzle-orm';
import { missions } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

let testDb: DB;
let testSqlite: Database.Database;

vi.mock('@/lib/db/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/index')>();
  return {
    ...original,
    getDatabase: () => testDb,
    getOrThrow: original.getOrThrow,
  };
});

vi.mock('../merge-executor', () => ({
  executeMerge: vi.fn(),
}));

vi.mock('@/lib/orchestrator/worktree', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/overseer/escalation', () => ({
  escalate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/actions/follow-up', () => ({
  extractAndSaveSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/socket/emit', () => ({
  emitStatusChange: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    rmSync: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { triggerQuartermaster } from '../quartermaster';
import { executeMerge } from '../merge-executor';
import { removeWorktree } from '@/lib/orchestrator/worktree';
import { escalate } from '@/lib/overseer/escalation';
import { extractAndSaveSuggestions } from '@/actions/follow-up';
import { emitStatusChange } from '@/lib/socket/emit';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triggerQuartermaster', () => {
  beforeEach(() => {
    const { db, sqlite } = getTestDb();
    testDb = db;
    testSqlite = sqlite;
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeTestDb(testSqlite);
  });

  it('skips mission not in approved status', async () => {
    const bf = createTestBattlefield(testDb, { repoPath: '/tmp/test-repo' });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      status: 'in_combat',
    });

    await triggerQuartermaster(m.id);

    // No state change — status should still be in_combat
    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('in_combat');
    expect(emitStatusChange).not.toHaveBeenCalled();
  });

  it('non-worktree mission goes directly to accomplished', async () => {
    const bf = createTestBattlefield(testDb, { repoPath: '/tmp/test-repo' });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      status: 'approved',
      debrief: 'Mission accomplished. Next: fix tests.',
    });

    await triggerQuartermaster(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('accomplished');
    expect(row?.completedAt).toBeTruthy();
    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'accomplished');
    expect(extractAndSaveSuggestions).toHaveBeenCalled();
    expect(executeMerge).not.toHaveBeenCalled();
  });

  it('worktree mission with successful merge goes to accomplished and cleans worktree', async () => {
    const bf = createTestBattlefield(testDb, {
      repoPath: '/tmp/test-repo',
      defaultBranch: 'main',
      claudeMdPath: '/tmp/test-repo/CLAUDE.md',
    });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      status: 'approved',
      worktreeBranch: 'devroom/test-bf/abc123456789',
      useWorktree: 1,
      debrief: 'All done. Next: update docs.',
    });

    vi.mocked(executeMerge).mockResolvedValueOnce({
      success: true,
      conflictResolved: false,
    });

    await triggerQuartermaster(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('accomplished');
    expect(row?.completedAt).toBeTruthy();

    // Should have emitted merging first, then accomplished
    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'merging');
    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'accomplished');

    // Worktree should have been removed
    expect(removeWorktree).toHaveBeenCalledWith(
      '/tmp/test-repo',
      '/tmp/test-repo/.worktrees/devroom-test-bf-abc123456789',
      'devroom/test-bf/abc123456789',
    );

    expect(extractAndSaveSuggestions).toHaveBeenCalled();
    expect(escalate).not.toHaveBeenCalled();
  });

  it('worktree mission with failed merge goes to compromised with merge-failed reason', async () => {
    const bf = createTestBattlefield(testDb, {
      repoPath: '/tmp/test-repo',
      defaultBranch: 'main',
    });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      status: 'approved',
      worktreeBranch: 'devroom/test-bf/def123456789',
      useWorktree: 1,
      debrief: 'Done.',
    });

    vi.mocked(executeMerge).mockResolvedValueOnce({
      success: false,
      conflictResolved: false,
      error: 'Conflict resolution failed after retry.',
    });

    await triggerQuartermaster(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('compromised');
    expect(row?.compromiseReason).toBe('merge-failed');
    expect(row?.completedAt).toBeTruthy();

    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'merging');
    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'compromised');

    // Should escalate
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'critical',
        entityType: 'mission',
        entityId: m.id,
      }),
    );

    // Worktree should NOT have been removed (branch preserved)
    expect(removeWorktree).not.toHaveBeenCalled();
  });
});
