import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestMission,
  createTestCaptainLog,
} from '@/lib/test/fixtures';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

let db: DB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => ({
  getDatabase: () => db,
}));

// captain.ts delegates to captain-db.ts which also calls getDatabase() —
// the mock above covers both since they share the same module.
const { getCaptainLogs, getCaptainStats } = await import('@/actions/captain');

describe('captain actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // getCaptainLogs
  // ---------------------------------------------------------------------------
  describe('getCaptainLogs', () => {
    it('returns empty array when no logs exist', async () => {
      const logs = await getCaptainLogs();
      expect(logs).toEqual([]);
    });

    it('returns all logs ordered by timestamp desc', async () => {
      const bf = createTestBattlefield(db);
      const m = createTestMission(db, { battlefieldId: bf.id });

      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, question: 'Q1', timestamp: 1000 });
      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, question: 'Q2', timestamp: 2000 });
      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, question: 'Q3', timestamp: 3000 });

      const logs = await getCaptainLogs();
      expect(logs).toHaveLength(3);
      expect(logs[0].question).toBe('Q3');
      expect(logs[2].question).toBe('Q1');
    });

    it('filters by missionId', async () => {
      const bf = createTestBattlefield(db);
      const m1 = createTestMission(db, { battlefieldId: bf.id, title: 'Mission A' });
      const m2 = createTestMission(db, { battlefieldId: bf.id, title: 'Mission B' });

      createTestCaptainLog(db, { missionId: m1.id, battlefieldId: bf.id, question: 'Q-A' });
      createTestCaptainLog(db, { missionId: m2.id, battlefieldId: bf.id, question: 'Q-B' });

      const logs = await getCaptainLogs({ missionId: m1.id });
      expect(logs).toHaveLength(1);
      expect(logs[0].question).toBe('Q-A');
    });

    it('filters by battlefieldId', async () => {
      const bf1 = createTestBattlefield(db, { codename: 'BF-1' });
      const bf2 = createTestBattlefield(db, { codename: 'BF-2' });
      const m1 = createTestMission(db, { battlefieldId: bf1.id });
      const m2 = createTestMission(db, { battlefieldId: bf2.id });

      createTestCaptainLog(db, { missionId: m1.id, battlefieldId: bf1.id });
      createTestCaptainLog(db, { missionId: m2.id, battlefieldId: bf2.id });

      const logs = await getCaptainLogs({ battlefieldId: bf1.id });
      expect(logs).toHaveLength(1);
      expect(logs[0].battlefieldId).toBe(bf1.id);
    });

    it('filters escalated only', async () => {
      const bf = createTestBattlefield(db);
      const m = createTestMission(db, { battlefieldId: bf.id });

      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, escalated: 0 });
      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, escalated: 1 });

      const logs = await getCaptainLogs({ escalatedOnly: true });
      expect(logs).toHaveLength(1);
      expect(logs[0].escalated).toBe(1);
    });

    it('combines multiple filters', async () => {
      const bf = createTestBattlefield(db);
      const m1 = createTestMission(db, { battlefieldId: bf.id, title: 'M1' });
      const m2 = createTestMission(db, { battlefieldId: bf.id, title: 'M2' });

      createTestCaptainLog(db, { missionId: m1.id, battlefieldId: bf.id, escalated: 1 });
      createTestCaptainLog(db, { missionId: m1.id, battlefieldId: bf.id, escalated: 0 });
      createTestCaptainLog(db, { missionId: m2.id, battlefieldId: bf.id, escalated: 1 });

      const logs = await getCaptainLogs({ missionId: m1.id, escalatedOnly: true });
      expect(logs).toHaveLength(1);
      expect(logs[0].missionId).toBe(m1.id);
      expect(logs[0].escalated).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getCaptainStats
  // ---------------------------------------------------------------------------
  describe('getCaptainStats', () => {
    it('returns zeroes when no logs', async () => {
      const stats = await getCaptainStats();
      expect(stats.totalDecisions).toBe(0);
      expect(stats.escalationCount).toBe(0);
      expect(stats.escalationRate).toBe(0);
      expect(stats.confidenceDistribution).toEqual({ high: 0, medium: 0, low: 0 });
    });

    it('computes correct stats', async () => {
      const bf = createTestBattlefield(db);
      const m = createTestMission(db, { battlefieldId: bf.id });

      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, confidence: 'high', escalated: 0 });
      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, confidence: 'high', escalated: 0 });
      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, confidence: 'medium', escalated: 1 });
      createTestCaptainLog(db, { missionId: m.id, battlefieldId: bf.id, confidence: 'low', escalated: 1 });

      const stats = await getCaptainStats();
      expect(stats.totalDecisions).toBe(4);
      expect(stats.escalationCount).toBe(2);
      expect(stats.escalationRate).toBe(0.5);
      expect(stats.confidenceDistribution).toEqual({ high: 2, medium: 1, low: 1 });
    });
  });
});
