/**
 * Integration tests for the rewritten mission Server Actions (Phase 8.1).
 *
 * These tests use the real SQLite DB (via getDatabase()). Each test suite
 * seeds into a namespaced battlefield ID and cleans up via inArray —
 * safe for parallel Vitest workers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import {
  battlefields,
  missions,
  assets,
  intelNotes,
  comms,
} from '@/lib/db/schema';
import {
  createMission,
  createAndDeployMission,
  deployMission,
  abandonMission,
  tacticalOverride,
  acceptMergeOverride,
  answerEscalation,
  continueMission,
} from '@/actions/mission';

// ---------------------------------------------------------------------------
// Shared test battlefield
// ---------------------------------------------------------------------------
const BF_ID = 'bf-mission-actions-test-8-1';
const db = getDatabase();

function cleanDb(): void {
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
  db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
}

function seedBattlefield(): void {
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'mission-actions-bf',
      codename: 'MAT',
      repoPath: '/tmp/nonexistent-mat',
      defaultBranch: 'main',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function insertMission(overrides: Partial<typeof missions.$inferInsert> & { id: string }) {
  const now = Date.now();
  return db
    .insert(missions)
    .values({
      battlefieldId: BF_ID,
      title: 'Test mission',
      briefing: 'Test briefing content',
      status: 'standby',
      priority: 'routine',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as typeof missions.$inferInsert)
    .returning()
    .get();
}

function getMissionById(id: string) {
  return db.select().from(missions).where(eq(missions.id, id)).get();
}

function getCommsForMission(missionId: string) {
  return db.select().from(comms).where(eq(comms.missionId, missionId)).all();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mission-actions integration — Phase 8.1', () => {
  beforeEach(() => {
    cleanDb();
    seedBattlefield();
  });

  afterEach(() => {
    cleanDb();
  });

  // =========================================================================
  // createMission
  // =========================================================================
  describe('createMission', () => {
    it('creates a STANDBY mission in the DB', async () => {
      const result = await createMission({
        battlefieldId: BF_ID,
        briefing: '# Fix the auth module\n\nDetails here',
      });

      expect(result.status).toBe('standby');
      expect(result.battlefieldId).toBe(BF_ID);
      expect(result.title).toBe('Fix the auth module');
      expect(result.briefing).toBe('# Fix the auth module\n\nDetails here');
      expect(result.priority).toBe('routine');

      const row = getMissionById(result.id);
      expect(row?.status).toBe('standby');
    });

    it('auto-creates an intel note for board visibility', async () => {
      const result = await createMission({
        battlefieldId: BF_ID,
        briefing: 'Plain briefing without header',
      });

      const notes = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, result.id))
        .all();
      expect(notes).toHaveLength(1);
      expect(notes[0].column).toBe('tasked');
    });

    it('emits a CONTROL comm after creation', async () => {
      const result = await createMission({
        battlefieldId: BF_ID,
        briefing: 'Briefing for comm test',
      });

      const missionComms = getCommsForMission(result.id);
      expect(missionComms.length).toBeGreaterThan(0);
      expect(missionComms[0].actor).toBe('CONTROL');
    });

    it('does NOT set status to queued — CONTROL polls', async () => {
      const result = await createMission({
        battlefieldId: BF_ID,
        briefing: 'Mission for poll test',
      });
      expect(result.status).toBe('standby');
    });
  });

  // =========================================================================
  // createAndDeployMission
  // =========================================================================
  describe('createAndDeployMission', () => {
    it('creates a QUEUED mission when assetId provided', async () => {
      // Insert a dummy asset with unique codename to avoid conflicts with shared real DB
      const assetId = `asset-mat-phase81-${Date.now()}`;
      const assetCodename = `RECON-MAT-${Date.now()}`;
      db.insert(assets)
        .values({
          id: assetId,
          codename: assetCodename,
          specialty: 'testing',
          status: 'active',
          createdAt: Date.now(),
        })
        .run();

      const result = await createAndDeployMission({
        battlefieldId: BF_ID,
        briefing: 'Immediate deploy mission',
        assetId,
      });

      expect(result.status).toBe('queued');
      expect(result.assetId).toBe(assetId);

      // Asset cleanup happens implicitly when the missions referencing it are cleaned
      // in afterEach → cleanDb. The asset row with unique id/codename is harmless.
      db.update(missions)
        .set({ assetId: null })
        .where(eq(missions.id, result.id))
        .run();
      db.delete(assets).where(eq(assets.id, assetId)).run();
    });

    it('throws when no assetId provided', async () => {
      await expect(
        createAndDeployMission({
          battlefieldId: BF_ID,
          briefing: 'No asset briefing',
        }),
      ).rejects.toThrow('An asset must be selected');
    });
  });

  // =========================================================================
  // deployMission
  // =========================================================================
  describe('deployMission', () => {
    it('transitions standby → queued', async () => {
      const m = insertMission({ id: 'dm-1', status: 'standby' });

      const result = await deployMission(m.id);

      expect(result.status).toBe('queued');
      const row = getMissionById(m.id);
      expect(row?.status).toBe('queued');
    });

    it('throws when mission is not standby', async () => {
      const m = insertMission({ id: 'dm-2', status: 'queued' });
      await expect(deployMission(m.id)).rejects.toThrow('cannot be deployed');
    });

    it('throws when mission not found', async () => {
      await expect(deployMission('nonexistent-id')).rejects.toThrow('not found');
    });

    it('emits a CONTROL comm after deploy', async () => {
      const m = insertMission({ id: 'dm-3', status: 'standby' });
      await deployMission(m.id);
      const missionComms = getCommsForMission(m.id);
      expect(missionComms.length).toBeGreaterThan(0);
      expect(missionComms.some((c) => c.actor === 'CONTROL')).toBe(true);
    });
  });

  // =========================================================================
  // abandonMission
  // =========================================================================
  describe('abandonMission', () => {
    it('transitions standby → abandoned', async () => {
      const m = insertMission({ id: 'ab-1', status: 'standby' });

      await abandonMission(m.id);

      const row = getMissionById(m.id);
      expect(row?.status).toBe('abandoned');
    });

    it('transitions queued → abandoned', async () => {
      const m = insertMission({ id: 'ab-2', status: 'queued' });
      await abandonMission(m.id);
      expect(getMissionById(m.id)?.status).toBe('abandoned');
    });

    it('emits a COMMANDER comm on abandon', async () => {
      const m = insertMission({ id: 'ab-3', status: 'standby' });
      await abandonMission(m.id);
      const missionComms = getCommsForMission(m.id);
      expect(missionComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
    });

    it('sets compromiseReason to commander-abandon', async () => {
      const m = insertMission({ id: 'ab-4', status: 'standby' });
      await abandonMission(m.id);
      const row = getMissionById(m.id);
      expect(row?.compromiseReason).toBe('commander-abandon');
    });

    it('throws when mission not found', async () => {
      await expect(abandonMission('nonexistent-id')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // tacticalOverride
  // =========================================================================
  describe('tacticalOverride', () => {
    it('updates briefing and resets to queued with 0 sortie attempts', async () => {
      const m = insertMission({
        id: 'to-1',
        status: 'compromised',
        currentSortieAttempts: 3,
        briefing: 'Original briefing',
      });

      await tacticalOverride(m.id, 'Updated briefing — new orders');

      const row = getMissionById(m.id);
      expect(row?.briefing).toBe('Updated briefing — new orders');
      expect(row?.status).toBe('queued');
      expect(row?.currentSortieAttempts).toBe(0);
      expect(row?.compromiseReason).toBeNull();
    });

    it('emits a COMMANDER comm', async () => {
      const m = insertMission({ id: 'to-2', status: 'compromised' });
      await tacticalOverride(m.id, 'New briefing for COMMANDER comm test');
      const missionComms = getCommsForMission(m.id);
      expect(missionComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
    });

    it('throws when mission not found', async () => {
      await expect(
        tacticalOverride('nonexistent-id', 'briefing'),
      ).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // acceptMergeOverride
  // =========================================================================
  describe('acceptMergeOverride', () => {
    it('throws when mission is not compromised', async () => {
      const m = insertMission({ id: 'am-1', status: 'standby' });
      await expect(acceptMergeOverride(m.id)).rejects.toThrow('not compromised');
    });

    it('transitions compromised (no worktreeBranch) → accomplished', async () => {
      // With no worktreeBranch, acceptAndMerge skips git and marks accomplished.
      const m = insertMission({
        id: 'am-2',
        status: 'compromised',
        worktreeBranch: null,
      });

      await acceptMergeOverride(m.id);

      const row = getMissionById(m.id);
      expect(row?.status).toBe('accomplished');
    });

    it('throws when mission not found', async () => {
      await expect(acceptMergeOverride('nonexistent-id')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // answerEscalation
  // =========================================================================
  describe('answerEscalation', () => {
    it('appends guidance section to briefing', async () => {
      const m = insertMission({
        id: 'ae-1',
        status: 'compromised',
        briefing: 'Original briefing',
        compromiseReason: 'escalated',
        currentSortieAttempts: 2,
      });

      await answerEscalation(m.id, 'Try using the legacy API endpoint instead');

      const row = getMissionById(m.id);
      expect(row?.briefing).toContain('Original briefing');
      expect(row?.briefing).toContain('Commander Guidance (escalation answer)');
      expect(row?.briefing).toContain('Try using the legacy API endpoint instead');
    });

    it('resets currentSortieAttempts to 0 and status → queued', async () => {
      const m = insertMission({
        id: 'ae-2',
        status: 'compromised',
        briefing: 'Original briefing',
        compromiseReason: 'escalated',
        currentSortieAttempts: 5,
      });

      await answerEscalation(m.id, 'Use a different strategy');

      const row = getMissionById(m.id);
      expect(row?.status).toBe('queued');
      expect(row?.currentSortieAttempts).toBe(0);
      expect(row?.compromiseReason).toBeNull();
    });

    it('emits a COMMANDER comm with answer excerpt', async () => {
      const m = insertMission({
        id: 'ae-3',
        status: 'compromised',
        briefing: 'Test briefing',
        compromiseReason: 'escalated',
      });

      await answerEscalation(m.id, 'My escalation answer text');

      const missionComms = getCommsForMission(m.id);
      expect(missionComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
      const cmdComm = missionComms.find((c) => c.actor === 'COMMANDER');
      expect(cmdComm?.message).toContain('My escalation answer text');
    });

    it('throws when mission not found', async () => {
      await expect(
        answerEscalation('nonexistent-id', 'answer'),
      ).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // continueMission
  // =========================================================================
  describe('continueMission', () => {
    it('creates a new QUEUED mission reusing sessionId from accomplished original', async () => {
      const original = insertMission({
        id: 'cm-orig-1',
        status: 'accomplished',
        sessionId: 'sess-abc-123',
        assetId: null,
        priority: 'urgent',
      });

      const newMission = await continueMission(original.id, '# Follow-up work\n\nDo more things');

      expect(newMission.status).toBe('queued');
      expect(newMission.sessionId).toBe('sess-abc-123');
      expect(newMission.priority).toBe('urgent');
      expect(newMission.battlefieldId).toBe(BF_ID);
      expect(newMission.title).toBe('Follow-up work');
    });

    it('carries over worktreeBranch from compromised original', async () => {
      const original = insertMission({
        id: 'cm-orig-2',
        status: 'compromised',
        sessionId: 'sess-xyz-456',
        worktreeBranch: 'mission/cm-orig-2',
      });

      const newMission = await continueMission(original.id, 'Retry with different approach');

      expect(newMission.worktreeBranch).toBe('mission/cm-orig-2');
    });

    it('does NOT carry worktreeBranch from accomplished original', async () => {
      const original = insertMission({
        id: 'cm-orig-3',
        status: 'accomplished',
        sessionId: 'sess-def-789',
        worktreeBranch: 'mission/cm-orig-3',
      });

      const newMission = await continueMission(original.id, 'Additional cleanup');

      expect(newMission.worktreeBranch).toBeNull();
    });

    it('auto-creates an intel note for the new mission', async () => {
      const original = insertMission({
        id: 'cm-orig-4',
        status: 'accomplished',
        sessionId: 'sess-ghi-000',
      });

      const newMission = await continueMission(original.id, 'New follow-up briefing');

      const notes = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, newMission.id))
        .all();
      expect(notes).toHaveLength(1);
    });

    it('throws when original is not accomplished or compromised', async () => {
      const m = insertMission({
        id: 'cm-bad-1',
        status: 'standby',
        sessionId: 'sess-bad',
      });
      await expect(continueMission(m.id, 'briefing')).rejects.toThrow(
        'Can only continue accomplished or compromised missions',
      );
    });

    it('throws when original has no sessionId', async () => {
      const m = insertMission({
        id: 'cm-bad-2',
        status: 'accomplished',
        sessionId: null,
      });
      await expect(continueMission(m.id, 'briefing')).rejects.toThrow(
        'Cannot continue mission without a session ID',
      );
    });

    it('throws when original mission not found', async () => {
      await expect(continueMission('nonexistent-id', 'briefing')).rejects.toThrow(
        'not found',
      );
    });

    it('emits a CONTROL comm for the new mission', async () => {
      const original = insertMission({
        id: 'cm-orig-5',
        status: 'accomplished',
        sessionId: 'sess-comm-test',
      });

      const newMission = await continueMission(original.id, 'Follow-up comm test');

      const missionComms = getCommsForMission(newMission.id);
      expect(missionComms.some((c) => c.actor === 'CONTROL')).toBe(true);
    });
  });

  // =========================================================================
  // Removed stubs — deleted in Phase 10 cutover
  // =========================================================================
  describe('removed stub actions', () => {
    it('removeMission is no longer exported', async () => {
      const mod = await import('@/actions/mission');
      expect((mod as Record<string, unknown>).removeMission).toBeUndefined();
    });

    it('retryMerge is no longer exported', async () => {
      const mod = await import('@/actions/mission');
      expect((mod as Record<string, unknown>).retryMerge).toBeUndefined();
    });

    it('retryReview is no longer exported', async () => {
      const mod = await import('@/actions/mission');
      expect((mod as Record<string, unknown>).retryReview).toBeUndefined();
    });

    it('overrideApprove is no longer exported', async () => {
      const mod = await import('@/actions/mission');
      expect((mod as Record<string, unknown>).overrideApprove).toBeUndefined();
    });
  });
});
