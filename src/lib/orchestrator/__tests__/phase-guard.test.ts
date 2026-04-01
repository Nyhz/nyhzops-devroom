import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestCampaign, createTestPhase } from '@/lib/test/fixtures';
import { phases } from '@/lib/db/schema';
import type Database from 'better-sqlite3';
import type { TestDB } from '@/lib/test/db';

/**
 * Replicates the atomic guard logic from campaign-executor.ts onPhaseComplete().
 * The guard uses an UPDATE WHERE completingAt IS NULL to atomically claim phase processing.
 */
function claimPhaseCompletion(db: TestDB, phaseId: string): number {
  const result = db
    .update(phases)
    .set({ completingAt: Date.now() })
    .where(and(eq(phases.id, phaseId), isNull(phases.completingAt)))
    .run();
  return result.changes;
}

describe('Phase Completion DB Guard', () => {
  let db: TestDB;
  let sqlite: Database.Database;
  let phaseId: string;

  beforeEach(() => {
    ({ db, sqlite } = getTestDb());

    const battlefield = createTestBattlefield(db);
    const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
    const phase = createTestPhase(db, { campaignId: campaign.id, phaseNumber: 1 });
    phaseId = phase.id;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  it('first claim succeeds — changes === 1', () => {
    const changes = claimPhaseCompletion(db, phaseId);
    expect(changes).toBe(1);
  });

  it('second claim on the same phase fails — changes === 0', () => {
    // First claim
    claimPhaseCompletion(db, phaseId);
    // Second claim on the same phase
    const changes = claimPhaseCompletion(db, phaseId);
    expect(changes).toBe(0);
  });

  it('claim on a phase with completingAt already set fails — changes === 0', () => {
    // Pre-set completingAt directly to simulate a phase already claimed
    db.update(phases).set({ completingAt: Date.now() - 5000 }).where(eq(phases.id, phaseId)).run();

    const changes = claimPhaseCompletion(db, phaseId);
    expect(changes).toBe(0);
  });

  it('claim on a different phase is independent — succeeds', () => {
    const battlefield = createTestBattlefield(db);
    const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
    const otherPhase = createTestPhase(db, { campaignId: campaign.id, phaseNumber: 1 });

    // Claim the first phase
    claimPhaseCompletion(db, phaseId);

    // Claim on a different phase should still succeed
    const changes = claimPhaseCompletion(db, otherPhase.id);
    expect(changes).toBe(1);
  });

  it('completingAt is persisted after first claim', () => {
    const before = Date.now();
    claimPhaseCompletion(db, phaseId);
    const after = Date.now();

    const phase = db.select().from(phases).where(eq(phases.id, phaseId)).get();
    expect(phase?.completingAt).not.toBeNull();
    expect(phase?.completingAt).toBeGreaterThanOrEqual(before);
    expect(phase?.completingAt).toBeLessThanOrEqual(after);
  });
});
