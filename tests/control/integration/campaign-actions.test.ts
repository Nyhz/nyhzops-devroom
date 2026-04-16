/**
 * Integration tests for the rewritten campaign Server Actions (Phase 8.2).
 *
 * Uses the real SQLite DB (via getDatabase()). Each test suite seeds into a
 * namespaced battlefield ID and cleans up via inArray — safe for parallel
 * Vitest workers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import {
  battlefields,
  campaigns,
  phases,
  missions,
  intelNotes,
  comms,
} from '@/lib/db/schema';
import {
  createCampaign,
  launchCampaign,
  abandonCampaign,
  acceptCampaign,
  completeCampaign,
  redeployCampaign,
  resumeCampaign,
} from '@/actions/campaign';

// ---------------------------------------------------------------------------
// Shared test battlefield
// ---------------------------------------------------------------------------
const BF_ID = 'bf-campaign-actions-test-8-2';
const db = getDatabase();

function cleanDb(): void {
  const campaignIds = db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.battlefieldId, BF_ID))
    .all()
    .map((c) => c.id);

  const phaseIds = campaignIds.length
    ? db
        .select({ id: phases.id })
        .from(phases)
        .where(inArray(phases.campaignId, campaignIds))
        .all()
        .map((p) => p.id)
    : [];

  const missionIds = db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.battlefieldId, BF_ID))
    .all()
    .map((m) => m.id);

  if (missionIds.length) {
    db.delete(comms).where(inArray(comms.missionId, missionIds)).run();
    db.delete(intelNotes).where(inArray(intelNotes.missionId, missionIds)).run();
    db.delete(missions).where(inArray(missions.id, missionIds)).run();
  }
  if (campaignIds.length) {
    db.delete(comms).where(inArray(comms.campaignId, campaignIds)).run();
    db.delete(intelNotes).where(inArray(intelNotes.campaignId, campaignIds)).run();
  }
  if (phaseIds.length) {
    db.delete(phases).where(inArray(phases.id, phaseIds)).run();
  }
  if (campaignIds.length) {
    db.delete(campaigns).where(inArray(campaigns.id, campaignIds)).run();
  }
  db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
}

function seedBattlefield(): void {
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'campaign-actions-bf',
      codename: 'CAT',
      repoPath: '/tmp/nonexistent-cat',
      defaultBranch: 'main',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

/**
 * Insert a campaign in the given status with phases+missions so it's ready
 * for launchCampaign (requires status = 'planning').
 */
function seedCampaignWithPlan(
  campaignId: string,
  status: string,
  opts: { numPhases?: number; missionsPerPhase?: number } = {},
): void {
  const numPhases = opts.numPhases ?? 1;
  const missionsPerPhase = opts.missionsPerPhase ?? 2;
  const now = Date.now();

  db.insert(campaigns)
    .values({
      id: campaignId,
      battlefieldId: BF_ID,
      name: 'test-campaign',
      objective: 'test objective',
      status,
      currentPhase: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (let pi = 0; pi < numPhases; pi++) {
    const phaseId = `${campaignId}-p${pi + 1}`;
    db.insert(phases)
      .values({
        id: phaseId,
        campaignId,
        phaseNumber: pi + 1,
        name: `Phase ${pi + 1}`,
        status: 'standby',
        createdAt: now,
      })
      .run();

    for (let mi = 0; mi < missionsPerPhase; mi++) {
      const missionId = `${campaignId}-p${pi + 1}-m${mi + 1}`;
      db.insert(missions)
        .values({
          id: missionId,
          battlefieldId: BF_ID,
          campaignId,
          phaseId,
          title: `Mission ${pi + 1}.${mi + 1}`,
          briefing: `briefing for mission ${pi + 1}.${mi + 1}`,
          type: 'combat',
          status: 'standby',
          dependsOn: null,
          useWorktree: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}

function getCampaignById(id: string) {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).get();
}

function getCommsForCampaign(campaignId: string) {
  return db.select().from(comms).where(eq(comms.campaignId, campaignId)).all();
}

function getMissionsForCampaign(campaignId: string) {
  return db.select().from(missions).where(eq(missions.campaignId, campaignId)).all();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('campaign-actions integration — Phase 8.2', () => {
  beforeEach(() => {
    cleanDb();
    seedBattlefield();
  });

  afterEach(() => {
    cleanDb();
  });

  // =========================================================================
  // createCampaign
  // =========================================================================
  describe('createCampaign', () => {
    it('creates a DRAFT campaign row in the DB', async () => {
      const result = await createCampaign(BF_ID, 'Operation Nightfall', 'Capture the flag');

      expect(result.status).toBe('draft');
      expect(result.battlefieldId).toBe(BF_ID);
      expect(result.name).toBe('Operation Nightfall');
      expect(result.objective).toBe('Capture the flag');

      const row = getCampaignById(result.id);
      expect(row?.status).toBe('draft');
    });

    it('emits a CONTROL comm after creation', async () => {
      const result = await createCampaign(BF_ID, 'Comm Test Campaign', 'test');

      const campaignComms = getCommsForCampaign(result.id);
      expect(campaignComms.length).toBeGreaterThan(0);
      expect(campaignComms[0].actor).toBe('CONTROL');
    });

    it('throws when battlefield not found', async () => {
      await expect(
        createCampaign('nonexistent-bf', 'Name', 'Objective'),
      ).rejects.toThrow('Battlefield not found');
    });
  });

  // =========================================================================
  // launchCampaign
  // =========================================================================
  describe('launchCampaign', () => {
    it('transitions campaign to ACTIVE via executor', async () => {
      seedCampaignWithPlan('launch-1', 'planning');

      await launchCampaign('launch-1');

      const row = getCampaignById('launch-1');
      expect(row?.status).toBe('active');
    });

    it('phase 1 becomes ACTIVE after launch', async () => {
      seedCampaignWithPlan('launch-2', 'planning');

      await launchCampaign('launch-2');

      const phaseRow = db
        .select()
        .from(phases)
        .where(eq(phases.campaignId, 'launch-2'))
        .get();
      expect(phaseRow?.status).toBe('active');
    });

    it('phase 1 missions dispatched to QUEUED (no deps)', async () => {
      seedCampaignWithPlan('launch-3', 'planning', { numPhases: 1, missionsPerPhase: 2 });

      await launchCampaign('launch-3');

      const campaignMissions = getMissionsForCampaign('launch-3');
      for (const m of campaignMissions) {
        expect(m.status).toBe('queued');
      }
    });

    it('phase 2 missions remain STANDBY while phase 1 is active', async () => {
      seedCampaignWithPlan('launch-4', 'planning', { numPhases: 2, missionsPerPhase: 1 });

      await launchCampaign('launch-4');

      const campaignMissions = getMissionsForCampaign('launch-4');
      const p1Mission = campaignMissions.find((m) => m.phaseId === 'launch-4-p1');
      const p2Mission = campaignMissions.find((m) => m.phaseId === 'launch-4-p2');

      expect(p1Mission?.status).toBe('queued');
      expect(p2Mission?.status).toBe('standby');
    });

    it('throws when campaign has no phases', async () => {
      const now = Date.now();
      db.insert(campaigns)
        .values({
          id: 'launch-nophases',
          battlefieldId: BF_ID,
          name: 'no phases',
          objective: 'test',
          status: 'planning',
          currentPhase: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      await expect(launchCampaign('launch-nophases')).rejects.toThrow('no phases');
    });

    it('emits a CONTROL comm after launch', async () => {
      seedCampaignWithPlan('launch-5', 'planning');

      await launchCampaign('launch-5');

      const campaignComms = getCommsForCampaign('launch-5');
      expect(campaignComms.length).toBeGreaterThan(0);
      expect(campaignComms.some((c) => c.actor === 'CONTROL')).toBe(true);
    });
  });

  // =========================================================================
  // abandonCampaign
  // =========================================================================
  describe('abandonCampaign', () => {
    it('sets campaign status → abandoned', async () => {
      seedCampaignWithPlan('abandon-1', 'active');

      await abandonCampaign('abandon-1');

      const row = getCampaignById('abandon-1');
      expect(row?.status).toBe('abandoned');
    });

    it('sets all non-terminal missions → abandoned', async () => {
      seedCampaignWithPlan('abandon-2', 'active', { numPhases: 1, missionsPerPhase: 3 });
      // Set mixed statuses
      const ms = getMissionsForCampaign('abandon-2');
      db.update(missions).set({ status: 'queued' }).where(eq(missions.id, ms[0].id)).run();
      db.update(missions).set({ status: 'in_combat' }).where(eq(missions.id, ms[1].id)).run();
      db.update(missions).set({ status: 'accomplished' }).where(eq(missions.id, ms[2].id)).run();

      await abandonCampaign('abandon-2');

      const updated = getMissionsForCampaign('abandon-2');
      const queued = updated.find((m) => m.id === ms[0].id);
      const inCombat = updated.find((m) => m.id === ms[1].id);
      const accomplished = updated.find((m) => m.id === ms[2].id);

      expect(queued?.status).toBe('abandoned');
      expect(inCombat?.status).toBe('abandoned');
      // Terminal mission is NOT affected
      expect(accomplished?.status).toBe('accomplished');
    });

    it('emits a COMMANDER comm at campaign level', async () => {
      seedCampaignWithPlan('abandon-3', 'active');

      await abandonCampaign('abandon-3');

      const campaignComms = getCommsForCampaign('abandon-3');
      expect(campaignComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
    });

    it('throws when campaign not found', async () => {
      await expect(abandonCampaign('nonexistent-campaign')).rejects.toThrow('not found');
    });

    it('leaves merging and compromised missions untouched', async () => {
      const campaignId = 'abandon-merging-comp';
      const now = Date.now();

      db.insert(campaigns)
        .values({
          id: campaignId,
          battlefieldId: BF_ID,
          name: 'merging-comp-test',
          objective: 'test',
          status: 'active',
          currentPhase: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const phaseId = `${campaignId}-p1`;
      db.insert(phases)
        .values({
          id: phaseId,
          campaignId,
          phaseNumber: 1,
          name: 'Phase 1',
          status: 'active',
          createdAt: now,
        })
        .run();

      const mergingId = `${campaignId}-merging`;
      const compromisedId = `${campaignId}-compromised`;
      const queuedId = `${campaignId}-queued`;

      for (const [mId, mStatus] of [
        [mergingId, 'merging'],
        [compromisedId, 'compromised'],
        [queuedId, 'queued'],
      ] as const) {
        db.insert(missions)
          .values({
            id: mId,
            battlefieldId: BF_ID,
            campaignId,
            phaseId,
            title: `mission-${mStatus}`,
            briefing: 'briefing',
            type: 'combat',
            status: mStatus,
            dependsOn: null,
            useWorktree: 0,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      await abandonCampaign(campaignId);

      const all = getMissionsForCampaign(campaignId);
      expect(all.find((m) => m.id === mergingId)?.status).toBe('merging');
      expect(all.find((m) => m.id === compromisedId)?.status).toBe('compromised');
      expect(all.find((m) => m.id === queuedId)?.status).toBe('abandoned');

      const row = getCampaignById(campaignId);
      expect(row?.status).toBe('abandoned');
    });

    // NOTE: 'continues after a single mission failure' is deliberately omitted.
    // The try/catch around executorAbandonMission was audited manually in the
    // source. Triggering a mid-loop throw in an integration test requires either
    // (a) a vi.mock of the executor — which would break the real-executor
    //     launchCampaign tests in this same file, or
    // (b) deleting a mission row between the SELECT and the loop — impossible
    //     from outside a single synchronous function call.
    // Per spec guidance ("if stubbing is ugly, skip this test and note it in the
    // report"), this case is covered by code review only.

    it('no-ops on already-terminal campaign', async () => {
      // Seed with an accomplished campaign whose missions are already in
      // terminal states — the executor abandon loop will have nothing to do,
      // so settleCampaign is never triggered and the status guard is the
      // sole line of defence.
      const campaignId = 'abandon-terminal';
      const now = Date.now();

      db.insert(campaigns)
        .values({
          id: campaignId,
          battlefieldId: BF_ID,
          name: 'terminal-test',
          objective: 'test',
          status: 'accomplished',
          currentPhase: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const phaseId = `${campaignId}-p1`;
      db.insert(phases)
        .values({
          id: phaseId,
          campaignId,
          phaseNumber: 1,
          name: 'Phase 1',
          status: 'secured',
          createdAt: now,
        })
        .run();

      // All missions already accomplished — no non-terminal missions for the loop
      db.insert(missions)
        .values({
          id: `${campaignId}-m1`,
          battlefieldId: BF_ID,
          campaignId,
          phaseId,
          title: 'done-mission',
          briefing: 'briefing',
          type: 'combat',
          status: 'accomplished',
          dependsOn: null,
          useWorktree: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      await abandonCampaign(campaignId);

      const row = getCampaignById(campaignId);
      // Status must remain accomplished — the guard in the .where() prevents overwrite
      expect(row?.status).toBe('accomplished');
    });
  });

  // =========================================================================
  // acceptCampaign
  // =========================================================================
  describe('acceptCampaign', () => {
    it('sets campaign status → accomplished', async () => {
      seedCampaignWithPlan('accept-1', 'active');

      await acceptCampaign('accept-1');

      const row = getCampaignById('accept-1');
      expect(row?.status).toBe('accomplished');
    });

    it('does NOT modify individual mission states', async () => {
      seedCampaignWithPlan('accept-2', 'active', { numPhases: 1, missionsPerPhase: 2 });
      const ms = getMissionsForCampaign('accept-2');
      db.update(missions).set({ status: 'in_combat' }).where(eq(missions.id, ms[0].id)).run();
      db.update(missions).set({ status: 'queued' }).where(eq(missions.id, ms[1].id)).run();

      await acceptCampaign('accept-2');

      const updated = getMissionsForCampaign('accept-2');
      // Mission statuses untouched — Commander handles them separately
      expect(updated.find((m) => m.id === ms[0].id)?.status).toBe('in_combat');
      expect(updated.find((m) => m.id === ms[1].id)?.status).toBe('queued');
    });

    it('emits a COMMANDER comm', async () => {
      seedCampaignWithPlan('accept-3', 'active');

      await acceptCampaign('accept-3');

      const campaignComms = getCommsForCampaign('accept-3');
      expect(campaignComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
    });

    it('throws when campaign not found', async () => {
      await expect(acceptCampaign('nonexistent-campaign')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // completeCampaign — alias for acceptCampaign
  // =========================================================================
  describe('completeCampaign', () => {
    it('delegates to acceptCampaign — sets status → accomplished', async () => {
      seedCampaignWithPlan('complete-1', 'active');

      await completeCampaign('complete-1');

      const row = getCampaignById('complete-1');
      expect(row?.status).toBe('accomplished');
    });
  });

  // =========================================================================
  // Deprecated stubs
  // =========================================================================
  describe('deprecated stub actions', () => {
    it('redeployCampaign throws deprecation error', async () => {
      await expect(redeployCampaign('any-id')).rejects.toThrow('Deprecated');
    });

    it('resumeCampaign throws deprecation error', async () => {
      await expect(resumeCampaign('any-id')).rejects.toThrow('Deprecated');
    });
  });
});
