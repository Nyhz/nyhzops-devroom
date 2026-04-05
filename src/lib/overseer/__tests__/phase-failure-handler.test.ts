import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import type { DB } from '@/lib/db/index';
import { eq, and } from 'drizzle-orm';
import { overseerLogs } from '@/lib/db/schema';
import { storeOverseerLog } from '@/lib/overseer/overseer-db';

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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  const { db, sqlite } = getTestDb();
  testDb = db;
  testSqlite = sqlite;
});

afterEach(() => {
  closeTestDb(testSqlite);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phase retry counting via decision_type column', () => {
  const campaignId = 'test-campaign-phase-retry';
  const battlefieldId = 'test-bf-phase';
  const missionId = 'test-mission-phase';

  it('counts only phase-retry decisions for the given campaign via decisionType column', () => {
    storeOverseerLog({
      missionId,
      campaignId,
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: retry.',
      reasoning: 'retry once',
      confidence: 'high',
      escalated: 0,
      decisionType: 'phase-retry',
    });
    storeOverseerLog({
      missionId,
      campaignId,
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: skip.',
      reasoning: 'skip the second',
      confidence: 'high',
      escalated: 0,
      decisionType: 'phase-skip',
    });
    storeOverseerLog({
      missionId,
      campaignId: 'other-campaign',
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: retry.',
      reasoning: 'different campaign',
      confidence: 'high',
      escalated: 0,
      decisionType: 'phase-retry',
    });

    const phaseRetries = testDb
      .select()
      .from(overseerLogs)
      .where(and(
        eq(overseerLogs.campaignId, campaignId),
        eq(overseerLogs.decisionType, 'phase-retry'),
      ))
      .all();

    expect(phaseRetries.length).toBe(1);
  });

  it('returns zero when no phase-retry logs exist for the campaign', () => {
    storeOverseerLog({
      missionId,
      campaignId,
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: escalate.',
      reasoning: 'critical failure',
      confidence: 'low',
      escalated: 1,
      decisionType: 'phase-escalate',
    });

    const phaseRetries = testDb
      .select()
      .from(overseerLogs)
      .where(and(
        eq(overseerLogs.campaignId, campaignId),
        eq(overseerLogs.decisionType, 'phase-retry'),
      ))
      .all();

    expect(phaseRetries.length).toBe(0);
  });

  it('stores decisionType as null when not provided', () => {
    storeOverseerLog({
      missionId,
      campaignId,
      battlefieldId,
      question: '[DEBRIEF_REVIEW] Mission: some title',
      answer: 'Approved',
      reasoning: 'all good',
      confidence: 'high',
      escalated: 0,
    });

    const allLogs = testDb.select().from(overseerLogs).all();
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0].decisionType).toBeNull();
  });
});
