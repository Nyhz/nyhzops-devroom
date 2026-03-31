import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock simple-git — returns a factory that produces a mock git instance
const mockGitInstance = {
  status: vi.fn(),
  add: vi.fn(),
  reset: vi.fn(),
  commit: vi.fn(),
  log: vi.fn(),
  branchLocal: vi.fn(),
  checkout: vi.fn(),
  branch: vi.fn(),
  diff: vi.fn(),
};

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
}));

// Mock getDatabase — return a fake db that resolves battlefield repoPath
const TEST_BATTLEFIELD_ID = 'bf_test_001';
const TEST_REPO_PATH = '/tmp/test-repo';

const mockGet = vi.fn().mockReturnValue({ repoPath: TEST_REPO_PATH });
const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock('@/lib/db/index', () => ({
  getDatabase: vi.fn(() => ({
    select: mockSelect,
  })),
}));

// ---------------------------------------------------------------------------
// Import actions under test (after mocks are set up)
// ---------------------------------------------------------------------------
import {
  getGitStatus,
  stageFile,
  unstageFile,
  stageAll,
  unstageAll,
  commitChanges,
  getGitLog,
  getBranches,
  checkoutBranch,
  deleteBranch,
  createBranch,
  getFileDiff,
} from '../git';
import simpleGit from 'simple-git';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish the default battlefield lookup
  mockGet.mockReturnValue({ repoPath: TEST_REPO_PATH });
});

// ---------------------------------------------------------------------------
// getGitStatus
// ---------------------------------------------------------------------------
describe('getGitStatus', () => {
  it('parses staged, modified, and untracked files', async () => {
    mockGitInstance.status.mockResolvedValue({
      staged: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      created: ['src/a.ts'],
      deleted: ['src/b.ts'],
      renamed: [],
      modified: ['src/c.ts', 'src/d.ts'],
      not_added: ['src/e.ts'],
    });

    const result = await getGitStatus(TEST_BATTLEFIELD_ID);

    expect(simpleGit).toHaveBeenCalledWith(TEST_REPO_PATH);
    expect(result.staged).toEqual([
      { path: 'src/a.ts', status: 'added' },
      { path: 'src/b.ts', status: 'deleted' },
      { path: 'src/c.ts', status: 'modified' },
    ]);
    // src/d.ts is modified but not staged
    expect(result.modified).toEqual([
      { path: 'src/d.ts', status: 'modified' },
    ]);
    expect(result.untracked).toEqual([
      { path: 'src/e.ts', status: 'untracked' },
    ]);
  });

  it('detects renamed files in staged list', async () => {
    mockGitInstance.status.mockResolvedValue({
      staged: ['new-name.ts'],
      created: [],
      deleted: [],
      renamed: [{ from: 'old-name.ts', to: 'new-name.ts' }],
      modified: [],
      not_added: [],
    });

    const result = await getGitStatus(TEST_BATTLEFIELD_ID);
    expect(result.staged).toEqual([
      { path: 'new-name.ts', status: 'renamed' },
    ]);
  });

  it('includes unstaged deleted files in modified list', async () => {
    mockGitInstance.status.mockResolvedValue({
      staged: [],
      created: [],
      deleted: ['gone.ts'],
      renamed: [],
      modified: [],
      not_added: [],
    });

    const result = await getGitStatus(TEST_BATTLEFIELD_ID);
    expect(result.modified).toEqual([
      { path: 'gone.ts', status: 'deleted' },
    ]);
  });

  it('returns empty arrays for clean repo', async () => {
    mockGitInstance.status.mockResolvedValue({
      staged: [],
      created: [],
      deleted: [],
      renamed: [],
      modified: [],
      not_added: [],
    });

    const result = await getGitStatus(TEST_BATTLEFIELD_ID);
    expect(result).toEqual({ staged: [], modified: [], untracked: [] });
  });

  it('throws when battlefield not found', async () => {
    mockGet.mockReturnValue(undefined);
    await expect(getGitStatus('nonexistent')).rejects.toThrow(
      'Battlefield nonexistent not found',
    );
  });
});

// ---------------------------------------------------------------------------
// stageFile / unstageFile
// ---------------------------------------------------------------------------
describe('stageFile', () => {
  it('stages a single file and revalidates', async () => {
    mockGitInstance.add.mockResolvedValue(undefined);

    await stageFile(TEST_BATTLEFIELD_ID, 'src/foo.ts');

    expect(simpleGit).toHaveBeenCalledWith(TEST_REPO_PATH);
    expect(mockGitInstance.add).toHaveBeenCalledWith('src/foo.ts');
    expect(revalidatePath).toHaveBeenCalledWith(
      `/battlefields/${TEST_BATTLEFIELD_ID}/git`,
    );
  });
});

describe('unstageFile', () => {
  it('unstages a single file and revalidates', async () => {
    mockGitInstance.reset.mockResolvedValue(undefined);

    await unstageFile(TEST_BATTLEFIELD_ID, 'src/foo.ts');

    expect(mockGitInstance.reset).toHaveBeenCalledWith([
      'HEAD',
      '--',
      'src/foo.ts',
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/battlefields/${TEST_BATTLEFIELD_ID}/git`,
    );
  });
});

// ---------------------------------------------------------------------------
// stageAll / unstageAll
// ---------------------------------------------------------------------------
describe('stageAll', () => {
  it('stages all files with -A flag', async () => {
    mockGitInstance.add.mockResolvedValue(undefined);

    await stageAll(TEST_BATTLEFIELD_ID);

    expect(mockGitInstance.add).toHaveBeenCalledWith('-A');
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe('unstageAll', () => {
  it('resets HEAD to unstage all files', async () => {
    mockGitInstance.reset.mockResolvedValue(undefined);

    await unstageAll(TEST_BATTLEFIELD_ID);

    expect(mockGitInstance.reset).toHaveBeenCalledWith(['HEAD']);
    expect(revalidatePath).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// commitChanges
// ---------------------------------------------------------------------------
describe('commitChanges', () => {
  it('commits with the given message and revalidates', async () => {
    mockGitInstance.commit.mockResolvedValue(undefined);

    await commitChanges(TEST_BATTLEFIELD_ID, 'feat: add new feature');

    expect(mockGitInstance.commit).toHaveBeenCalledWith('feat: add new feature');
    expect(revalidatePath).toHaveBeenCalledWith(
      `/battlefields/${TEST_BATTLEFIELD_ID}/git`,
    );
  });
});

// ---------------------------------------------------------------------------
// getGitLog
// ---------------------------------------------------------------------------
describe('getGitLog', () => {
  const mockLogEntries = Array.from({ length: 10 }, (_, i) => ({
    hash: `abc${i}`,
    message: `commit ${i}`,
    author_name: 'Commander',
    date: '2026-03-31',
    refs: '',
  }));

  it('returns commits with default limit and offset', async () => {
    mockGitInstance.log.mockResolvedValue({ all: mockLogEntries });

    const result = await getGitLog(TEST_BATTLEFIELD_ID);

    expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 50 });
    expect(result.commits).toHaveLength(10);
    expect(result.commits[0]).toEqual({
      hash: 'abc0',
      message: 'commit 0',
      author: 'Commander',
      date: '2026-03-31',
      refs: '',
    });
  });

  it('respects limit and offset parameters', async () => {
    mockGitInstance.log.mockResolvedValue({ all: mockLogEntries });

    const result = await getGitLog(TEST_BATTLEFIELD_ID, 3, 2);

    expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 5 }); // limit + offset
    expect(result.commits).toHaveLength(3);
    expect(result.commits[0].hash).toBe('abc2'); // offset = 2
    expect(result.commits[2].hash).toBe('abc4');
  });

  it('returns empty array when log has no entries', async () => {
    mockGitInstance.log.mockResolvedValue({ all: [] });

    const result = await getGitLog(TEST_BATTLEFIELD_ID);
    expect(result.commits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBranches
// ---------------------------------------------------------------------------
describe('getBranches', () => {
  it('returns current branch and local branch list', async () => {
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main', 'feature/test', 'develop'],
    });

    const result = await getBranches(TEST_BATTLEFIELD_ID);

    expect(result.current).toBe('main');
    expect(result.local).toEqual([
      { name: 'main', current: true },
      { name: 'feature/test', current: false },
      { name: 'develop', current: false },
    ]);
  });

  it('handles single branch repo', async () => {
    mockGitInstance.branchLocal.mockResolvedValue({
      current: 'main',
      all: ['main'],
    });

    const result = await getBranches(TEST_BATTLEFIELD_ID);
    expect(result.local).toHaveLength(1);
    expect(result.local[0]).toEqual({ name: 'main', current: true });
  });
});

// ---------------------------------------------------------------------------
// checkoutBranch
// ---------------------------------------------------------------------------
describe('checkoutBranch', () => {
  it('checks out the given branch and revalidates', async () => {
    mockGitInstance.checkout.mockResolvedValue(undefined);

    await checkoutBranch(TEST_BATTLEFIELD_ID, 'feature/test');

    expect(mockGitInstance.checkout).toHaveBeenCalledWith('feature/test');
    expect(revalidatePath).toHaveBeenCalledWith(
      `/battlefields/${TEST_BATTLEFIELD_ID}/git`,
    );
  });
});

// ---------------------------------------------------------------------------
// deleteBranch / createBranch
// ---------------------------------------------------------------------------
describe('deleteBranch', () => {
  it('deletes a branch with -d flag', async () => {
    mockGitInstance.branch.mockResolvedValue(undefined);

    await deleteBranch(TEST_BATTLEFIELD_ID, 'old-branch');

    expect(mockGitInstance.branch).toHaveBeenCalledWith(['-d', 'old-branch']);
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe('createBranch', () => {
  it('creates a new branch', async () => {
    mockGitInstance.branch.mockResolvedValue(undefined);

    await createBranch(TEST_BATTLEFIELD_ID, 'new-branch');

    expect(mockGitInstance.branch).toHaveBeenCalledWith(['new-branch']);
    expect(revalidatePath).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getFileDiff
// ---------------------------------------------------------------------------
describe('getFileDiff', () => {
  it('returns unstaged diff when available', async () => {
    mockGitInstance.diff.mockResolvedValue('--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new');

    const result = await getFileDiff(TEST_BATTLEFIELD_ID, 'src/foo.ts');

    expect(mockGitInstance.diff).toHaveBeenCalledWith(['src/foo.ts']);
    expect(result).toContain('+new');
  });

  it('falls back to staged diff when unstaged diff is empty', async () => {
    mockGitInstance.diff
      .mockResolvedValueOnce('') // unstaged: empty
      .mockResolvedValueOnce('--- staged diff ---'); // cached

    const result = await getFileDiff(TEST_BATTLEFIELD_ID, 'src/bar.ts');

    expect(mockGitInstance.diff).toHaveBeenCalledTimes(2);
    expect(mockGitInstance.diff).toHaveBeenNthCalledWith(1, ['src/bar.ts']);
    expect(mockGitInstance.diff).toHaveBeenNthCalledWith(2, ['--cached', 'src/bar.ts']);
    expect(result).toBe('--- staged diff ---');
  });

  it('returns empty string when no diff exists', async () => {
    mockGitInstance.diff.mockResolvedValue('');

    const result = await getFileDiff(TEST_BATTLEFIELD_ID, 'clean.ts');
    expect(result).toBe('');
  });
});
