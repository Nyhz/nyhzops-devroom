import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestAsset, createTestMission } from '@/lib/test/fixtures';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

let db: DB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => ({
  getDatabase: () => db,
}));

const { getGlobalStats, getCostByBattlefield, getCostByAsset, getDailyUsage, getRateLimitStatus } =
  await import('@/actions/logistics');

describe('logistics actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // getGlobalStats
  // ---------------------------------------------------------------------------
  describe('getGlobalStats', () => {
    it('returns zeroes when no missions exist', async () => {
      const stats = await getGlobalStats();
      expect(stats.totalMissions).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalCacheTokens).toBe(0);
      expect(stats.totalCostUsd).toBe(0);
      expect(stats.cacheHitPercent).toBe(0);
    });

    it('aggregates token usage across missions', async () => {
      const bf = createTestBattlefield(db);
      createTestMission(db, {
        battlefieldId: bf.id,
        status: 'accomplished',
        costInput: 1000,
        costOutput: 500,
        costCacheHit: 200,
      });
      createTestMission(db, {
        battlefieldId: bf.id,
        status: 'accomplished',
        costInput: 2000,
        costOutput: 1000,
        costCacheHit: 300,
      });

      const stats = await getGlobalStats();
      expect(stats.totalMissions).toBe(2);
      expect(stats.totalInputTokens).toBe(3000);
      expect(stats.totalOutputTokens).toBe(1500);
      expect(stats.totalCacheTokens).toBe(500);
      expect(stats.accomplished).toBe(2);
    });

    it('counts missions by status', async () => {
      const bf = createTestBattlefield(db);
      createTestMission(db, { battlefieldId: bf.id, status: 'standby' });
      createTestMission(db, { battlefieldId: bf.id, status: 'queued' });
      createTestMission(db, { battlefieldId: bf.id, status: 'in_combat' });
      createTestMission(db, { battlefieldId: bf.id, status: 'accomplished' });
      createTestMission(db, { battlefieldId: bf.id, status: 'compromised' });
      createTestMission(db, { battlefieldId: bf.id, status: 'abandoned' });

      const stats = await getGlobalStats();
      expect(stats.totalMissions).toBe(6);
      expect(stats.standby).toBe(1);
      expect(stats.queued).toBe(1);
      expect(stats.inCombat).toBe(1);
      expect(stats.accomplished).toBe(1);
      expect(stats.compromised).toBe(1);
      expect(stats.abandoned).toBe(1);
    });

    it('calculates cache hit percentage', async () => {
      const bf = createTestBattlefield(db);
      createTestMission(db, {
        battlefieldId: bf.id,
        status: 'accomplished',
        costInput: 800,
        costCacheHit: 200,
      });

      const stats = await getGlobalStats();
      // cacheHitPercent = round(200 / (800 + 200) * 100) = 20
      expect(stats.cacheHitPercent).toBe(20);
    });

    it('calculates cost correctly', async () => {
      const bf = createTestBattlefield(db);
      createTestMission(db, {
        battlefieldId: bf.id,
        status: 'accomplished',
        costInput: 1_000_000,
        costOutput: 1_000_000,
        costCacheHit: 1_000_000,
      });

      const stats = await getGlobalStats();
      // cost = (1M * 3 + 1M * 15 + 1M * 0.3) / 1M = 18.3
      expect(stats.totalCostUsd).toBeCloseTo(18.3, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // getCostByBattlefield
  // ---------------------------------------------------------------------------
  describe('getCostByBattlefield', () => {
    it('returns empty when no missions', async () => {
      const result = await getCostByBattlefield();
      expect(result).toEqual([]);
    });

    it('groups cost by battlefield', async () => {
      const bf1 = createTestBattlefield(db, { codename: 'ALPHA-BF' });
      const bf2 = createTestBattlefield(db, { codename: 'BRAVO-BF' });
      createTestMission(db, { battlefieldId: bf1.id, costInput: 100, costOutput: 50 });
      createTestMission(db, { battlefieldId: bf1.id, costInput: 200, costOutput: 100 });
      createTestMission(db, { battlefieldId: bf2.id, costInput: 500, costOutput: 250 });

      const result = await getCostByBattlefield();
      expect(result).toHaveLength(2);

      const alpha = result.find((r) => r.codename === 'ALPHA-BF');
      const bravo = result.find((r) => r.codename === 'BRAVO-BF');
      expect(alpha).toBeDefined();
      expect(alpha!.missionCount).toBe(2);
      expect(alpha!.totalInputTokens).toBe(300);
      expect(alpha!.totalOutputTokens).toBe(150);
      expect(bravo!.missionCount).toBe(1);
      expect(bravo!.totalInputTokens).toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // getCostByAsset
  // ---------------------------------------------------------------------------
  describe('getCostByAsset', () => {
    it('returns empty when no missions with assets', async () => {
      const result = await getCostByAsset();
      expect(result).toEqual([]);
    });

    it('groups cost by asset', async () => {
      const bf = createTestBattlefield(db);
      const a1 = createTestAsset(db, { codename: 'RECON' });
      const a2 = createTestAsset(db, { codename: 'STRIKE' });
      createTestMission(db, { battlefieldId: bf.id, assetId: a1.id, costInput: 100, costOutput: 50 });
      createTestMission(db, { battlefieldId: bf.id, assetId: a2.id, costInput: 300, costOutput: 150 });
      createTestMission(db, { battlefieldId: bf.id, assetId: a2.id, costInput: 200, costOutput: 100 });

      const result = await getCostByAsset();
      expect(result).toHaveLength(2);

      const recon = result.find((r) => r.codename === 'RECON');
      const strike = result.find((r) => r.codename === 'STRIKE');
      expect(recon!.missionCount).toBe(1);
      expect(recon!.totalInputTokens).toBe(100);
      expect(strike!.missionCount).toBe(2);
      expect(strike!.totalInputTokens).toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // getDailyUsage
  // ---------------------------------------------------------------------------
  describe('getDailyUsage', () => {
    it('returns empty when no missions', async () => {
      const result = await getDailyUsage();
      expect(result).toEqual([]);
    });

    it('aggregates usage by day', async () => {
      const bf = createTestBattlefield(db);
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      createTestMission(db, {
        battlefieldId: bf.id,
        costInput: 100,
        costOutput: 50,
        costCacheHit: 10,
        createdAt: now,
        updatedAt: now,
      });
      createTestMission(db, {
        battlefieldId: bf.id,
        costInput: 200,
        costOutput: 100,
        costCacheHit: 20,
        createdAt: now,
        updatedAt: now,
      });
      createTestMission(db, {
        battlefieldId: bf.id,
        costInput: 50,
        costOutput: 25,
        costCacheHit: 5,
        createdAt: oneDayAgo,
        updatedAt: oneDayAgo,
      });

      const result = await getDailyUsage(7);
      expect(result.length).toBeGreaterThanOrEqual(1);

      const totalInput = result.reduce((sum, r) => sum + r.inputTokens, 0);
      expect(totalInput).toBe(350);
    });

    it('excludes missions older than N days', async () => {
      const bf = createTestBattlefield(db);
      const ancient = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago

      createTestMission(db, {
        battlefieldId: bf.id,
        costInput: 999,
        createdAt: ancient,
        updatedAt: ancient,
      });

      const result = await getDailyUsage(30);
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getRateLimitStatus
  // ---------------------------------------------------------------------------
  describe('getRateLimitStatus', () => {
    it('returns null when no rate limit data', async () => {
      globalThis.orchestrator = { latestRateLimit: null } as unknown as typeof globalThis.orchestrator;
      const result = await getRateLimitStatus();
      expect(result).toBeNull();
    });

    it('returns rate limit info when available', async () => {
      const rl = {
        status: 'limited',
        resetsAt: Date.now() + 60000,
        rateLimitType: 'tokens',
        lastUpdated: Date.now(),
      };
      globalThis.orchestrator = { latestRateLimit: rl } as unknown as typeof globalThis.orchestrator;

      const result = await getRateLimitStatus();
      expect(result).toEqual(rl);
    });
  });
});
