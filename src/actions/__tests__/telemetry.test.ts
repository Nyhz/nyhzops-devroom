import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  execSync: vi.fn(() => '1024\t/some/path'),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn().mockReturnValue({ size: 1024 * 1024 }),
  };
});

// Shared query builder mock — supports chaining .select().from().where()...
const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue(null);
const mockLimit = vi.fn().mockReturnValue({ all: mockAll, get: mockGet });
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit, all: mockAll });
const mockWhere = vi.fn().mockReturnValue({
  get: mockGet,
  all: mockAll,
  orderBy: mockOrderBy,
  limit: mockLimit,
});
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere, all: mockAll, orderBy: mockOrderBy });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock('@/lib/db/index', () => ({
  getDatabase: vi.fn(() => ({
    select: mockSelect,
  })),
}));

vi.mock('@/lib/config', () => ({
  config: {
    maxAgents: 5,
    dbPath: '/tmp/devroom-test.db',
  },
}));

vi.mock('@/actions/console', () => ({
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  restartDevServer: vi.fn(),
  getDevServerStatus: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import actions under test (after mocks)
// ---------------------------------------------------------------------------
import {
  classifyFailure,
  getActiveProcesses,
  getResourceUsage,
  getRecentExits,
  getExitContext,
} from '../telemetry';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.clearAllMocks();
  mockAll.mockReturnValue([]);
  mockGet.mockReturnValue(null);

  // Restore fs defaults after clearAllMocks
  const fsModule = await import('fs');
  vi.mocked(fsModule.existsSync).mockReturnValue(false);
  vi.mocked(fsModule.statSync).mockReturnValue({ size: 1024 * 1024 } as ReturnType<typeof fsModule.statSync>);

  // Reset globalThis singletons
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).orchestrator = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).io = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).scheduler = undefined;
});

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------
describe('classifyFailure', () => {
  it('returns null for accomplished missions', () => {
    expect(classifyFailure('accomplished', null, null)).toBeNull();
    expect(classifyFailure('accomplished', 'timeout', 'some debrief')).toBeNull();
  });

  it('returns timeout for compromiseReason === timeout', () => {
    expect(classifyFailure('compromised', 'timeout', null)).toBe('timeout');
  });

  it('returns stall_killed for compromiseReason === escalated', () => {
    expect(classifyFailure('compromised', 'escalated', null)).toBe('stall_killed');
  });

  it('returns null for merge-failed (not a process failure)', () => {
    expect(classifyFailure('compromised', 'merge-failed', null)).toBeNull();
  });

  it('returns auth_failure when debrief contains auth keyword', () => {
    expect(classifyFailure('compromised', null, 'Claude auth error occurred')).toBe('auth_failure');
    expect(classifyFailure('compromised', null, 'invalid token provided')).toBe('auth_failure');
    expect(classifyFailure('compromised', null, '401 unauthorized')).toBe('auth_failure');
  });

  it('returns killed for abandoned missions', () => {
    expect(classifyFailure('abandoned', null, null)).toBe('killed');
  });

  it('returns cli_error for generic compromised missions', () => {
    expect(classifyFailure('compromised', null, 'Process exited with code 1')).toBe('cli_error');
  });

  it('returns null for unknown status', () => {
    expect(classifyFailure('standby', null, null)).toBeNull();
  });

  it('prioritizes compromiseReason over text detection', () => {
    // timeout reason takes precedence over debrief text
    expect(classifyFailure('compromised', 'timeout', 'auth error unauthorized')).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// getActiveProcesses
// ---------------------------------------------------------------------------
describe('getActiveProcesses', () => {
  it('returns empty array when no orchestrator is present', async () => {
    // globalThis.orchestrator is undefined
    const result = await getActiveProcesses('bf_test_001');
    expect(result).toEqual([]);
    // DB should NOT have been queried
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns empty array when orchestrator exists but no active missions', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).orchestrator = { getWorkingCount: vi.fn(() => 0) };
    mockAll.mockReturnValue([]);

    const result = await getActiveProcesses('bf_test_001');
    expect(result).toEqual([]);
  });

  it('maps DB rows to ProcessEntry shape with placeholder PID and memory', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).orchestrator = { getWorkingCount: vi.fn(() => 1) };

    const now = Date.now();
    const missionRows = [
      {
        id: 'mission-001',
        title: 'Alpha Strike',
        assetId: 'asset-001',
        status: 'in_combat',
        startedAt: now - 60_000,
        updatedAt: now,
      },
    ];
    const assetRows = [{ id: 'asset-001', codename: 'RANGER' }];

    // First call: missions, second call: assets
    mockAll.mockReturnValueOnce(missionRows).mockReturnValueOnce(assetRows);

    const result = await getActiveProcesses('bf_test_001');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      missionId: 'mission-001',
      missionCodename: 'Alpha Strike',
      asset: 'RANGER',
      pid: 0,
      status: 'in_combat',
      memoryRss: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// getResourceUsage
// ---------------------------------------------------------------------------
describe('getResourceUsage', () => {
  const TEST_BATTLEFIELD_ID = 'bf_test_001';

  beforeEach(() => {
    // Provide battlefield repoPath for getRepoPath helper
    mockGet.mockReturnValue({ repoPath: '/tmp/test-repo' });
  });

  it('returns zero agent slots when orchestrator is missing', async () => {
    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);

    expect(result.agentSlots).toEqual({ active: 0, max: 5 });
  });

  it('returns orchestrator working count when available', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).orchestrator = { getWorkingCount: vi.fn(() => 3) };

    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);

    expect(result.agentSlots).toEqual({ active: 3, max: 5 });
  });

  it('returns zero worktreeDisk when worktrees dir does not exist', async () => {
    const fsModule = await import('fs');
    vi.mocked(fsModule.existsSync).mockReturnValue(false);

    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);

    expect(result.worktreeDisk).toBe(0);
  });

  it('returns socket connections from globalThis.io', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).io = { engine: { clientsCount: 7 } };

    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);

    expect(result.socketConnections).toBe(7);
  });

  it('returns zero socket connections when io is not present', async () => {
    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);
    expect(result.socketConnections).toBe(0);
  });

  it('returns a numeric dbSize (may be 0 in test env)', async () => {
    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);
    // statSync may or may not resolve in test environment — just verify it's a number
    expect(typeof result.dbSize).toBe('number');
    expect(result.dbSize).toBeGreaterThanOrEqual(0);
  });

  it('returns correct shape', async () => {
    const result = await getResourceUsage(TEST_BATTLEFIELD_ID);

    expect(result).toMatchObject({
      agentSlots: expect.objectContaining({ active: expect.any(Number), max: expect.any(Number) }),
      worktreeDisk: expect.any(Number),
      tempDisk: expect.any(Number),
      dbSize: expect.any(Number),
      socketConnections: expect.any(Number),
    });
  });
});

// ---------------------------------------------------------------------------
// getRecentExits
// ---------------------------------------------------------------------------
describe('getRecentExits', () => {
  it('returns empty array when no terminal missions', async () => {
    mockAll.mockReturnValue([]);

    const result = await getRecentExits('bf_test_001');
    expect(result).toEqual([]);
  });

  it('maps accomplished mission to exit code 0', async () => {
    const ts = Date.now();
    mockAll.mockReturnValue([
      {
        id: 'mission-001',
        title: 'Ghost Protocol',
        status: 'accomplished',
        compromiseReason: null,
        debrief: 'Mission accomplished.',
        startedAt: ts - 5000,
        completedAt: ts,
        durationMs: 5000,
      },
    ]);

    const result = await getRecentExits('bf_test_001');

    expect(result).toHaveLength(1);
    expect(result[0].exitCode).toBe(0);
    expect(result[0].failureType).toBeNull();
    expect(result[0].missionCodename).toBe('Ghost Protocol');
  });

  it('maps compromised mission with timeout to exit code 1 and failureType timeout', async () => {
    const ts = Date.now();
    mockAll.mockReturnValue([
      {
        id: 'mission-002',
        title: 'Iron Fist',
        status: 'compromised',
        compromiseReason: 'timeout',
        debrief: null,
        startedAt: ts - 300_000,
        completedAt: ts,
        durationMs: 300_000,
      },
    ]);

    const result = await getRecentExits('bf_test_001');

    expect(result).toHaveLength(1);
    expect(result[0].exitCode).toBe(1);
    expect(result[0].failureType).toBe('timeout');
  });

  it('maps abandoned mission to killed failureType', async () => {
    const ts = Date.now();
    mockAll.mockReturnValue([
      {
        id: 'mission-003',
        title: 'Blackout',
        status: 'abandoned',
        compromiseReason: null,
        debrief: 'Mission abandoned: server shutdown.',
        startedAt: ts - 1000,
        completedAt: ts,
        durationMs: 1000,
      },
    ]);

    const result = await getRecentExits('bf_test_001');

    expect(result[0].failureType).toBe('killed');
  });
});

// ---------------------------------------------------------------------------
// getExitContext
// ---------------------------------------------------------------------------
describe('getExitContext', () => {
  it('returns log entries in chronological order', async () => {
    mockAll.mockReturnValue([
      { content: 'Line 3 (most recent)' },
      { content: 'Line 2' },
      { content: 'Line 1 (oldest)' },
    ]);

    const result = await getExitContext('mission-001');

    // Should be reversed to chronological order
    expect(result).toEqual(['Line 1 (oldest)', 'Line 2', 'Line 3 (most recent)']);
  });

  it('returns empty array when no logs', async () => {
    mockAll.mockReturnValue([]);

    const result = await getExitContext('mission-999');
    expect(result).toEqual([]);
  });
});
