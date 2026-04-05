import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestAsset } from '@/lib/test/fixtures';
import { createMockDbModule } from '@/lib/test/mock-db';
import type Database from 'better-sqlite3';
import type { TestDB } from '@/lib/test/db';
import type { TestSuiteResult } from '@/types';

let db: TestDB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => createMockDbModule(() => db));

// Mock the mission action to capture calls
const createAndDeployMissionMock = vi.fn().mockResolvedValue({
  id: 'mock-mission-id',
  title: 'Fix Failing Tests',
  status: 'queued',
});

vi.mock('@/actions/mission', () => ({
  createAndDeployMission: (...args: unknown[]) => createAndDeployMissionMock(...args),
}));

const { deployFixMission } = await import('@/actions/tests');

describe('deployFixMission', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    createAndDeployMissionMock.mockClear();
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  it('creates a mission with failing test details in briefing', async () => {
    const bf = createTestBattlefield(db);
    const assertAsset = createTestAsset(db, { codename: 'ASSERT' });

    const suites: TestSuiteResult[] = [
      {
        name: 'math.test.ts',
        file: '/repo/src/__tests__/math.test.ts',
        tests: [
          { name: 'adds numbers', status: 'passed', durationMs: 5 },
          {
            name: 'divides by zero',
            status: 'failed',
            durationMs: 3,
            error: { message: 'Expected Infinity but got NaN' },
          },
        ],
      },
    ];

    const result = await deployFixMission(bf.id, suites);
    expect(result).toBe('mock-mission-id');

    expect(createAndDeployMissionMock).toHaveBeenCalledOnce();
    const call = createAndDeployMissionMock.mock.calls[0][0];
    expect(call.battlefieldId).toBe(bf.id);
    expect(call.briefing).toContain('Fix Failing Tests');
    expect(call.briefing).toContain('math.test.ts');
    expect(call.briefing).toContain('divides by zero');
    expect(call.briefing).toContain('Expected Infinity but got NaN');
    // Should NOT include passing tests
    expect(call.briefing).not.toContain('adds numbers');
    // Should have the ASSERT asset
    expect(call.assetId).toBe(assertAsset.id);
  });

  it('throws when ASSERT asset is not found', async () => {
    const bf = createTestBattlefield(db);

    const suites: TestSuiteResult[] = [
      {
        name: 'foo.test.ts',
        file: '/repo/foo.test.ts',
        tests: [
          { name: 'fails', status: 'failed', durationMs: 1, error: { message: 'bad' } },
        ],
      },
    ];

    await expect(deployFixMission(bf.id, suites)).rejects.toThrow('ASSERT');
  });

  it('filters to only failing suites', async () => {
    const bf = createTestBattlefield(db);
    createTestAsset(db, { codename: 'ASSERT' });

    const suites: TestSuiteResult[] = [
      {
        name: 'passing.test.ts',
        file: '/repo/passing.test.ts',
        tests: [{ name: 'works', status: 'passed', durationMs: 1 }],
      },
      {
        name: 'broken.test.ts',
        file: '/repo/broken.test.ts',
        tests: [
          { name: 'breaks', status: 'failed', durationMs: 1, error: { message: 'oops' } },
        ],
      },
    ];

    await deployFixMission(bf.id, suites);
    const call = createAndDeployMissionMock.mock.calls[0][0];
    expect(call.briefing).toContain('broken.test.ts');
    expect(call.briefing).not.toContain('passing.test.ts');
  });
});
