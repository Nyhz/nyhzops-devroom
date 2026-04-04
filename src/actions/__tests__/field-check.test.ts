import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGitInstance = {
  raw: vi.fn(),
  branchLocal: vi.fn(),
  branch: vi.fn(),
  log: vi.fn(),
  status: vi.fn(),
};

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => '0\t/some/path'),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() - 1000 * 60 * 60 }),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

const TEST_BATTLEFIELD_ID = 'bf_test_001';
const TEST_REPO_PATH = '/tmp/test-repo';

// Shared query builder mock — supports chaining .select().from().where().get()/.all()/.limit()/.orderBy()
const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue({ repoPath: TEST_REPO_PATH });
const mockLimit = vi.fn().mockReturnValue({ all: mockAll });
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({
  get: mockGet,
  all: mockAll,
  orderBy: mockOrderBy,
  limit: mockLimit,
});
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere, all: mockAll });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock('@/lib/db/index', () => ({
  getDatabase: vi.fn(() => ({
    select: mockSelect,
  })),
}));

vi.mock('@/lib/orchestrator/worktree', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import actions under test (after mocks)
// ---------------------------------------------------------------------------
import {
  getWorktreeStatus,
  getBranchHygiene,
  getRepoVitals,
  cleanupWorktree,
  cleanupAllStale,
  deleteBranch,
  pruneAllMerged,
  getQuartermasterLog,
} from '../field-check';
import simpleGit from 'simple-git';
import { removeWorktree } from '@/lib/orchestrator/worktree';

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  // Restore default battlefield lookup
  mockGet.mockReturnValue({ repoPath: TEST_REPO_PATH });
  mockAll.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// getWorktreeStatus
// ---------------------------------------------------------------------------
describe('getWorktreeStatus', () => {
  it('returns empty array when no extra worktrees exist', async () => {
    // git worktree list --porcelain returns only the main worktree
    mockGitInstance.raw.mockResolvedValue(
      `worktree ${TEST_REPO_PATH}\nHEAD abc123\nbranch refs/heads/main\n\n`,
    );

    const result = await getWorktreeStatus(TEST_BATTLEFIELD_ID);

    expect(simpleGit).toHaveBeenCalledWith(TEST_REPO_PATH);
    expect(result).toEqual([]);
  });

  it('classifies an active worktree linked to a running mission', async () => {
    const worktreePath = '/tmp/test-repo/.worktrees/devroom-bf-abc123';
    const branchName = 'devroom/bf/abc123';

    mockGitInstance.raw.mockResolvedValue(
      `worktree ${TEST_REPO_PATH}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${worktreePath}\nHEAD def\nbranch refs/heads/${branchName}\n\n`,
    );

    mockAll.mockReturnValue([
      {
        id: 'mission-001',
        codename: 'Alpha Strike',
        status: 'in_combat',
        worktreeBranch: branchName,
      },
    ]);

    const result = await getWorktreeStatus(TEST_BATTLEFIELD_ID);

    expect(result).toHaveLength(1);
    expect(result[0].branch).toBe(branchName);
    expect(result[0].state).toBe('active');
    expect(result[0].linkedMission?.id).toBe('mission-001');
  });

  it('classifies a stale worktree linked to a completed mission', async () => {
    const worktreePath = '/tmp/test-repo/.worktrees/devroom-bf-stale';
    const branchName = 'devroom/bf/stale';

    mockGitInstance.raw.mockResolvedValue(
      `worktree ${TEST_REPO_PATH}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${worktreePath}\nHEAD def\nbranch refs/heads/${branchName}\n\n`,
    );

    mockAll.mockReturnValue([
      {
        id: 'mission-002',
        codename: 'Old Strike',
        status: 'accomplished',
        worktreeBranch: branchName,
      },
    ]);

    const result = await getWorktreeStatus(TEST_BATTLEFIELD_ID);

    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('stale');
  });

  it('classifies an orphaned worktree with no linked mission', async () => {
    const worktreePath = '/tmp/test-repo/.worktrees/devroom-bf-orphan';
    const branchName = 'devroom/bf/orphan';

    mockGitInstance.raw.mockResolvedValue(
      `worktree ${TEST_REPO_PATH}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${worktreePath}\nHEAD def\nbranch refs/heads/${branchName}\n\n`,
    );

    // No missions linked
    mockAll.mockReturnValue([]);

    const result = await getWorktreeStatus(TEST_BATTLEFIELD_ID);

    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('orphaned');
    expect(result[0].linkedMission).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cleanupWorktree
// ---------------------------------------------------------------------------
describe('cleanupWorktree', () => {
  it('delegates to removeWorktree with correct args', async () => {
    await cleanupWorktree(
      TEST_BATTLEFIELD_ID,
      '/tmp/test-repo/.worktrees/foo',
      'devroom/bf/foo',
    );

    expect(removeWorktree).toHaveBeenCalledWith(
      TEST_REPO_PATH,
      '/tmp/test-repo/.worktrees/foo',
      'devroom/bf/foo',
    );
  });
});

// ---------------------------------------------------------------------------
// cleanupAllStale
// ---------------------------------------------------------------------------
describe('cleanupAllStale', () => {
  it('returns zero cleaned when no stale worktrees', async () => {
    mockGitInstance.raw.mockResolvedValue(
      `worktree ${TEST_REPO_PATH}\nHEAD abc\nbranch refs/heads/main\n\n`,
    );

    const result = await cleanupAllStale(TEST_BATTLEFIELD_ID);
    expect(result).toEqual({ cleaned: 0 });
  });
});

// ---------------------------------------------------------------------------
// getBranchHygiene
// ---------------------------------------------------------------------------
describe('getBranchHygiene', () => {
  it('returns clean stats with no problems when only main branch exists', async () => {
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main'],
    });
    mockGitInstance.raw.mockResolvedValue('* main\n');

    const result = await getBranchHygiene(TEST_BATTLEFIELD_ID);

    expect(result.stats.total).toBe(1);
    expect(result.problems).toEqual([]);
  });

  it('reports merged branch as a problem', async () => {
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main', 'feature/done'],
    });
    // feature/done is merged
    mockGitInstance.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'branch' && args[1] === '--merged') {
        return '  main\n  feature/done\n';
      }
      // rev-list
      return '0\t5\n';
    });

    // No active missions
    mockAll.mockReturnValue([]);

    mockGitInstance.log.mockResolvedValue({
      latest: { date: new Date(Date.now() - 86400000).toISOString() },
    });

    const result = await getBranchHygiene(TEST_BATTLEFIELD_ID);

    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].name).toBe('feature/done');
    expect(result.problems[0].problem).toBe('merged');
  });

  it('skips active branches even if merged', async () => {
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main', 'devroom/bf/active'],
    });
    mockGitInstance.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'branch' && args[1] === '--merged') {
        return '  main\n  devroom/bf/active\n';
      }
      return '';
    });

    // active mission linked to this branch
    mockAll.mockReturnValue([
      { worktreeBranch: 'devroom/bf/active' },
    ]);

    const result = await getBranchHygiene(TEST_BATTLEFIELD_ID);
    expect(result.problems).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deleteBranch
// ---------------------------------------------------------------------------
describe('deleteBranch', () => {
  it('calls git.branch with -d flag', async () => {
    mockGitInstance.branch.mockResolvedValue(undefined);

    await deleteBranch(TEST_BATTLEFIELD_ID, 'old-branch');

    expect(simpleGit).toHaveBeenCalledWith(TEST_REPO_PATH);
    expect(mockGitInstance.branch).toHaveBeenCalledWith(['-d', 'old-branch']);
  });
});

// ---------------------------------------------------------------------------
// pruneAllMerged
// ---------------------------------------------------------------------------
describe('pruneAllMerged', () => {
  it('returns zero pruned when no merged problem branches', async () => {
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main'],
    });
    mockGitInstance.raw.mockResolvedValue('  main\n');

    const result = await pruneAllMerged(TEST_BATTLEFIELD_ID);
    expect(result).toEqual({ pruned: 0 });
  });
});

// ---------------------------------------------------------------------------
// getQuartermasterLog
// ---------------------------------------------------------------------------
describe('getQuartermasterLog', () => {
  it('returns empty array when no merge records', async () => {
    // mockAll returns [] by default; mockGet returns the battlefield
    mockGet
      .mockReturnValueOnce({ repoPath: TEST_REPO_PATH }) // getRepoPath — not called here
      .mockReturnValue({ defaultBranch: 'main' });

    const result = await getQuartermasterLog(TEST_BATTLEFIELD_ID);
    expect(result).toEqual([]);
  });

  it('maps DB rows to QMLogEntry shape', async () => {
    const ts = Date.now();

    // First call: isNotNull missions query
    mockAll.mockReturnValueOnce([
      {
        id: 'mission-abc',
        title: 'Ghost Protocol',
        worktreeBranch: 'devroom/bf/abc',
        mergeResult: 'clean',
        mergeConflictFiles: '[]',
        mergeTimestamp: ts,
      },
    ]);

    // Second call: battlefield defaultBranch
    mockGet.mockReturnValueOnce({ defaultBranch: 'main' });

    const result = await getQuartermasterLog(TEST_BATTLEFIELD_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      missionId: 'mission-abc',
      missionCodename: 'Ghost Protocol',
      sourceBranch: 'devroom/bf/abc',
      targetBranch: 'main',
      result: 'clean',
      conflictFiles: [],
      timestamp: ts,
    });
  });
});

// ---------------------------------------------------------------------------
// getRepoVitals
// ---------------------------------------------------------------------------
describe('getRepoVitals', () => {
  it('returns expected shape with defaults', async () => {
    mockGitInstance.raw.mockResolvedValue('42\n');
    mockGitInstance.log.mockResolvedValue({
      latest: {
        message: 'feat: initial commit',
        date: new Date(2026, 0, 1).toISOString(),
      },
    });
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main'],
    });
    mockGitInstance.status.mockResolvedValue({ isClean: () => true });

    const result = await getRepoVitals(TEST_BATTLEFIELD_ID);

    expect(result).toMatchObject({
      totalCommits: 42,
      mainBranch: 'main',
      isDirty: false,
    });
    expect(typeof result.repoSize).toBe('number');
    expect(typeof result.worktreeDisk).toBe('number');
    expect(result.lastCommit).not.toBeNull();
    expect(result.lastCommit?.message).toBe('feat: initial commit');
  });

  it('handles git errors gracefully and returns zero values', async () => {
    mockGitInstance.raw.mockRejectedValue(new Error('git error'));
    mockGitInstance.log.mockRejectedValue(new Error('git error'));
    mockGitInstance.branchLocal.mockRejectedValue(new Error('git error'));
    mockGitInstance.status.mockRejectedValue(new Error('git error'));

    const result = await getRepoVitals(TEST_BATTLEFIELD_ID);

    expect(result.totalCommits).toBe(0);
    expect(result.lastCommit).toBeNull();
    expect(result.mainBranch).toBe('main');
    expect(result.isDirty).toBe(false);
  });
});
