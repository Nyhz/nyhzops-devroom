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

// Canned overseer verdict — each test sets this before calling runOverseerReview
const reviewDebriefMock = vi.fn();
vi.mock('../debrief-reviewer', () => ({
  reviewDebrief: (...args: unknown[]) => reviewDebriefMock(...args),
}));

vi.mock('../overseer-db', () => ({
  storeOverseerLog: vi.fn(),
}));

vi.mock('../escalation', () => ({
  escalate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/socket/emit', () => ({
  emitStatusChange: vi.fn(),
}));

vi.mock('@/lib/orchestrator/safe-queue', () => ({
  safeQueueMission: vi.fn(),
}));

// Canned commit count — tests flip this between 0 and >0 to exercise the gate
const gitRawMock = vi.fn().mockResolvedValue('0\n');
const gitDiffMock = vi.fn().mockResolvedValue('');
vi.mock('simple-git', () => ({
  default: () => ({
    raw: gitRawMock,
    diff: gitDiffMock,
  }),
}));

// Spy on Quartermaster trigger to assert whether the merge path is taken
const triggerQuartermasterMock = vi.fn();
vi.mock('@/lib/quartermaster/quartermaster', () => ({
  triggerQuartermaster: (id: string) => triggerQuartermasterMock(id),
}));

vi.mock('@/lib/orchestrator/worktree', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/actions/follow-up', () => ({
  extractAndSaveSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => { throw new Error('no claude.md'); }),
    rmSync: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { runOverseerReview } from '../review-handler';
import { escalate } from '../escalation';
import { emitStatusChange } from '@/lib/socket/emit';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOverseerReview — mission type × commit count enforcement', () => {
  beforeEach(() => {
    const { db, sqlite } = getTestDb();
    testDb = db;
    testSqlite = sqlite;
    vi.clearAllMocks();
    gitRawMock.mockResolvedValue('0\n');
    gitDiffMock.mockResolvedValue('');
    reviewDebriefMock.mockResolvedValue({
      verdict: 'approve',
      concerns: [],
      reasoning: 'Looks good',
    });
  });

  afterEach(() => {
    closeTestDb(testSqlite);
  });

  it('verification mission with 0 commits + approve → accomplished, Quartermaster skipped', async () => {
    const bf = createTestBattlefield(testDb, { repoPath: '/tmp/test-repo', defaultBranch: 'main' });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      type: 'verification',
      status: 'reviewing',
      worktreeBranch: 'devroom/test-bf/verify1234',
      debrief: 'All checks pass. No changes made.',
    });
    gitRawMock.mockResolvedValue('0\n');

    await runOverseerReview(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('accomplished');
    expect(row?.completedAt).toBeTruthy();
    expect(triggerQuartermasterMock).not.toHaveBeenCalled();
    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'accomplished');
  });

  it('verification mission with >0 commits + approve → compromised (verification-mutated-code)', async () => {
    const bf = createTestBattlefield(testDb, { repoPath: '/tmp/test-repo', defaultBranch: 'main' });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      type: 'verification',
      status: 'reviewing',
      worktreeBranch: 'devroom/test-bf/verify5678',
      debrief: 'Ran tests. Also fixed a thing.',
    });
    gitRawMock.mockResolvedValue('3\n');

    await runOverseerReview(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('compromised');
    expect(row?.compromiseReason).toBe('verification-mutated-code');
    expect(triggerQuartermasterMock).not.toHaveBeenCalled();
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('direct_action mission with 0 commits + approve → compromised (no-commits-produced)', async () => {
    const bf = createTestBattlefield(testDb, { repoPath: '/tmp/test-repo', defaultBranch: 'main' });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      type: 'direct_action',
      status: 'reviewing',
      worktreeBranch: 'devroom/test-bf/action1111',
      debrief: 'I looked at the files but did not change anything.',
    });
    gitRawMock.mockResolvedValue('0\n');

    await runOverseerReview(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('compromised');
    expect(row?.compromiseReason).toBe('no-commits-produced');
    expect(triggerQuartermasterMock).not.toHaveBeenCalled();
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('direct_action mission with >0 commits + approve → approved, Quartermaster triggered', async () => {
    const bf = createTestBattlefield(testDb, { repoPath: '/tmp/test-repo', defaultBranch: 'main' });
    const m = createTestMission(testDb, {
      battlefieldId: bf.id,
      type: 'direct_action',
      status: 'reviewing',
      worktreeBranch: 'devroom/test-bf/action2222',
      debrief: 'Implemented the feature. Commits made.',
    });
    gitRawMock.mockResolvedValue('2\n');

    await runOverseerReview(m.id);

    const row = testDb.select().from(missions).where(eq(missions.id, m.id)).get();
    expect(row?.status).toBe('approved');
    expect(triggerQuartermasterMock).toHaveBeenCalledWith(m.id);
    expect(emitStatusChange).toHaveBeenCalledWith('mission', m.id, 'approved');
  });
});
