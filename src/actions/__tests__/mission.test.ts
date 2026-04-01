import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestMission, createTestAsset } from '@/lib/test/fixtures';
import { missions, intelNotes, missionLogs, overseerLogs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createMockDbModule } from '@/lib/test/mock-db';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

// ---------------------------------------------------------------------------
// Mock the database module to inject our test DB
// ---------------------------------------------------------------------------
let testDb: DB;
let testSqlite: Database.Database;

vi.mock('@/lib/db/index', () => createMockDbModule(() => testDb));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    generateId: actual.generateId,
  };
});

// Import actions AFTER mocks are set up
const {
  createMission,
  createAndDeployMission,
  getMission,
  listMissions,
  deployMission,
  abandonMission,
  continueMission,
  removeMission,
} = await import('@/actions/mission');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Mission Server Actions', () => {
  beforeEach(() => {
    const t = getTestDb();
    testDb = t.db;
    testSqlite = t.sqlite;
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeTestDb(testSqlite);
  });

  // =========================================================================
  // createMission
  // =========================================================================
  describe('createMission', () => {
    it('creates a mission with STANDBY status', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: 'Test briefing for the mission',
      });

      expect(result.status).toBe('standby');
      expect(result.battlefieldId).toBe(bf.id);
      expect(result.briefing).toBe('Test briefing for the mission');
      expect(result.title).toBe('Test briefing for the mission');
      expect(result.priority).toBe('normal');
    });

    it('extracts title from first line of briefing', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: '# My Mission Title\n\nSome details here',
      });

      expect(result.title).toBe('My Mission Title');
    });

    it('uses provided title over extracted one', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: '# Extracted Title\nDetails',
        title: 'Custom Title',
      });

      expect(result.title).toBe('Custom Title');
    });

    it('truncates title to 80 characters', async () => {
      const bf = createTestBattlefield(testDb);
      const longTitle = 'A'.repeat(100);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: longTitle,
      });

      expect(result.title!.length).toBe(80);
    });

    it('assigns the given priority', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: 'Critical mission',
        priority: 'critical',
      });

      expect(result.priority).toBe('critical');
    });

    it('assigns an asset when assetId is provided', async () => {
      const bf = createTestBattlefield(testDb);
      const asset = createTestAsset(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: 'Mission with asset',
        assetId: asset.id,
      });

      expect(result.assetId).toBe(asset.id);
    });

    it('creates an intel note for board visibility', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: 'Mission with intel note',
      });

      const notes = testDb
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, result.id))
        .all();

      expect(notes).toHaveLength(1);
      expect(notes[0].column).toBe('backlog');
      expect(notes[0].battlefieldId).toBe(bf.id);
    });

    it('does NOT call orchestrator.onMissionQueued for standby', async () => {
      const bf = createTestBattlefield(testDb);
      await createMission({
        battlefieldId: bf.id,
        briefing: 'Standby mission',
      });

      expect(globalThis.orchestrator?.onMissionQueued).not.toHaveBeenCalled();
    });

    it('throws when battlefield does not exist', async () => {
      await expect(
        createMission({
          battlefieldId: 'nonexistent-id',
          briefing: 'No battlefield',
        }),
      ).rejects.toThrow('not found');
    });

    it('uses "Untitled Mission" for empty briefing first line', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createMission({
        battlefieldId: bf.id,
        briefing: '\n\nSome content below',
      });

      expect(result.title).toBe('Untitled Mission');
    });
  });

  // =========================================================================
  // createAndDeployMission
  // =========================================================================
  describe('createAndDeployMission', () => {
    it('creates a mission with QUEUED status', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createAndDeployMission({
        battlefieldId: bf.id,
        briefing: 'Deploy immediately',
      });

      expect(result.status).toBe('queued');
    });

    it('calls orchestrator.onMissionQueued', async () => {
      const bf = createTestBattlefield(testDb);
      const result = await createAndDeployMission({
        battlefieldId: bf.id,
        briefing: 'Queue this mission',
      });

      expect(globalThis.orchestrator?.onMissionQueued).toHaveBeenCalledWith(result.id);
    });

    it('emits Socket.IO activity event with QUEUED detail', async () => {
      const bf = createTestBattlefield(testDb);
      await createAndDeployMission({
        battlefieldId: bf.id,
        briefing: 'Socket test',
      });

      expect(globalThis.io?.to).toHaveBeenCalledWith('hq:activity');
    });
  });

  // =========================================================================
  // getMission
  // =========================================================================
  describe('getMission', () => {
    it('returns mission with joined battlefield codename', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      const result = await getMission(mission.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(mission.id);
      expect(result!.battlefieldCodename).toBe(bf.codename);
    });

    it('returns asset codename when asset is assigned', async () => {
      const bf = createTestBattlefield(testDb);
      const asset = createTestAsset(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        assetId: asset.id,
      });

      const result = await getMission(mission.id);

      expect(result!.assetCodename).toBe(asset.codename);
      expect(result!.assetSpecialty).toBe(asset.specialty);
    });

    it('returns null asset fields when no asset assigned', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      const result = await getMission(mission.id);

      expect(result!.assetCodename).toBeNull();
      expect(result!.assetSpecialty).toBeNull();
    });

    it('returns log count', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      // Insert some logs
      const { ulid } = await import('ulid');
      for (let i = 0; i < 3; i++) {
        testDb
          .insert(missionLogs)
          .values({
            id: ulid(),
            missionId: mission.id,
            timestamp: Date.now(),
            type: 'log',
            content: `Log entry ${i}`,
          })
          .run();
      }

      const result = await getMission(mission.id);
      expect(result!.logCount).toBe(3);
    });

    it('returns null for nonexistent mission', async () => {
      const result = await getMission('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // listMissions
  // =========================================================================
  describe('listMissions', () => {
    it('lists missions for a battlefield', async () => {
      const bf = createTestBattlefield(testDb);
      createTestMission(testDb, { battlefieldId: bf.id, title: 'Mission A' });
      createTestMission(testDb, { battlefieldId: bf.id, title: 'Mission B' });

      const results = await listMissions(bf.id);

      expect(results).toHaveLength(2);
    });

    it('does not return missions from other battlefields', async () => {
      const bf1 = createTestBattlefield(testDb);
      const bf2 = createTestBattlefield(testDb);
      createTestMission(testDb, { battlefieldId: bf1.id });
      createTestMission(testDb, { battlefieldId: bf2.id });

      const results = await listMissions(bf1.id);
      expect(results).toHaveLength(1);
      expect(results[0].battlefieldId).toBe(bf1.id);
    });

    it('orders by status priority (in_combat first)', async () => {
      const bf = createTestBattlefield(testDb);
      createTestMission(testDb, { battlefieldId: bf.id, status: 'accomplished', title: 'Done' });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'in_combat', title: 'Active' });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'standby', title: 'Waiting' });

      const results = await listMissions(bf.id);

      expect(results[0].status).toBe('in_combat');
      expect(results[1].status).toBe('standby');
      expect(results[2].status).toBe('accomplished');
    });

    it('filters by search term', async () => {
      const bf = createTestBattlefield(testDb);
      createTestMission(testDb, { battlefieldId: bf.id, title: 'Deploy frontend' });
      createTestMission(testDb, { battlefieldId: bf.id, title: 'Fix backend bug' });

      const results = await listMissions(bf.id, { search: 'frontend' });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Deploy frontend');
    });

    it('includes asset codename in results', async () => {
      const bf = createTestBattlefield(testDb);
      const asset = createTestAsset(testDb);
      createTestMission(testDb, { battlefieldId: bf.id, assetId: asset.id });

      const results = await listMissions(bf.id);

      expect(results[0].assetCodename).toBe(asset.codename);
    });

    it('returns empty array for battlefield with no missions', async () => {
      const bf = createTestBattlefield(testDb);
      const results = await listMissions(bf.id);
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // deployMission
  // =========================================================================
  describe('deployMission', () => {
    it('transitions STANDBY → QUEUED', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
      });

      const result = await deployMission(mission.id);

      expect(result.status).toBe('queued');
      expect(result.updatedAt).toBeGreaterThanOrEqual(mission.updatedAt!);
    });

    it('calls orchestrator.onMissionQueued', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
      });

      await deployMission(mission.id);

      expect(globalThis.orchestrator?.onMissionQueued).toHaveBeenCalledWith(mission.id);
    });

    it('emits Socket.IO activity event', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
      });

      await deployMission(mission.id);

      expect(globalThis.io?.to).toHaveBeenCalledWith('hq:activity');
    });

    it('throws for non-standby missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'queued',
      });

      await expect(deployMission(mission.id)).rejects.toThrow(
        /cannot be deployed from status 'queued'/,
      );
    });

    it('throws for accomplished missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
      });

      await expect(deployMission(mission.id)).rejects.toThrow(
        /cannot be deployed from status 'accomplished'/,
      );
    });

    it('throws for nonexistent mission', async () => {
      await expect(deployMission('nonexistent')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // abandonMission
  // =========================================================================
  describe('abandonMission', () => {
    it('transitions STANDBY → ABANDONED', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
      });

      const result = await abandonMission(mission.id);

      expect(result.status).toBe('abandoned');
      expect(result.completedAt).toBeGreaterThan(0);
    });

    it('transitions QUEUED → ABANDONED', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'queued',
      });

      const result = await abandonMission(mission.id);

      expect(result.status).toBe('abandoned');
    });

    it('delegates IN_COMBAT to orchestrator abort and returns current mission', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'in_combat',
      });

      const result = await abandonMission(mission.id);

      expect(globalThis.orchestrator?.onMissionAbort).toHaveBeenCalledWith(mission.id);
      // Returns current mission (not updated — executor updates asynchronously)
      expect(result.status).toBe('in_combat');
    });

    it('throws for ACCOMPLISHED missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
      });

      await expect(abandonMission(mission.id)).rejects.toThrow(
        /cannot be abandoned from status 'accomplished'/,
      );
    });

    it('throws for COMPROMISED missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'compromised',
      });

      await expect(abandonMission(mission.id)).rejects.toThrow(
        /cannot be abandoned from status 'compromised'/,
      );
    });

    it('throws for ABANDONED missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'abandoned',
      });

      await expect(abandonMission(mission.id)).rejects.toThrow(
        /cannot be abandoned from status 'abandoned'/,
      );
    });

    it('emits Socket.IO activity event for non-in_combat', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
      });

      await abandonMission(mission.id);

      expect(globalThis.io?.to).toHaveBeenCalledWith('hq:activity');
    });

    it('throws for nonexistent mission', async () => {
      await expect(abandonMission('nonexistent')).rejects.toThrow('not found');
    });
  });

  // =========================================================================
  // continueMission
  // =========================================================================
  describe('continueMission', () => {
    it('creates a follow-up mission from an accomplished mission', async () => {
      const bf = createTestBattlefield(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: 'session-abc',
      });

      const result = await continueMission(original.id, 'Continue the work');

      expect(result.status).toBe('queued');
      expect(result.sessionId).toBe('session-abc');
      expect(result.battlefieldId).toBe(bf.id);
      expect(result.title).toBe('Continue the work');
      expect(result.useWorktree).toBe(1);
    });

    it('creates a follow-up from a compromised mission with worktree branch', async () => {
      const bf = createTestBattlefield(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'compromised',
        sessionId: 'session-xyz',
        worktreeBranch: 'fix/broken-thing',
      });

      const result = await continueMission(original.id, 'Fix the failure');

      expect(result.worktreeBranch).toBe('fix/broken-thing');
      expect(result.sessionId).toBe('session-xyz');
    });

    it('does NOT carry worktree branch from accomplished missions', async () => {
      const bf = createTestBattlefield(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: 'session-123',
        worktreeBranch: 'feature/old-branch',
      });

      const result = await continueMission(original.id, 'New work');

      expect(result.worktreeBranch).toBeNull();
    });

    it('calls orchestrator.onMissionQueued for the new mission', async () => {
      const bf = createTestBattlefield(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: 'session-456',
      });

      const result = await continueMission(original.id, 'Continue');

      expect(globalThis.orchestrator?.onMissionQueued).toHaveBeenCalledWith(result.id);
    });

    it('creates an intel note for the new mission', async () => {
      const bf = createTestBattlefield(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: 'session-789',
      });

      const result = await continueMission(original.id, 'Intel note test');

      const notes = testDb
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, result.id))
        .all();

      expect(notes).toHaveLength(1);
    });

    it('throws for standby missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
        sessionId: 'session-aaa',
      });

      await expect(continueMission(mission.id, 'Nope')).rejects.toThrow(
        'Can only continue accomplished or compromised missions',
      );
    });

    it('throws for missions without sessionId', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: null,
      });

      await expect(continueMission(mission.id, 'No session')).rejects.toThrow(
        'Cannot continue mission without a session ID',
      );
    });

    it('extracts title from briefing markdown header', async () => {
      const bf = createTestBattlefield(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: 'session-bbb',
      });

      const result = await continueMission(
        original.id,
        '## Fix the bug\n\nDetails here',
      );

      expect(result.title).toBe('Fix the bug');
    });

    it('carries over priority and assetId from original', async () => {
      const bf = createTestBattlefield(testDb);
      const asset = createTestAsset(testDb);
      const original = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'accomplished',
        sessionId: 'session-ccc',
        priority: 'critical',
        assetId: asset.id,
      });

      const result = await continueMission(original.id, 'Continue critical');

      expect(result.priority).toBe('critical');
      expect(result.assetId).toBe(asset.id);
    });
  });

  // =========================================================================
  // removeMission
  // =========================================================================
  describe('removeMission', () => {
    it('deletes mission and returns battlefieldId', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      const result = await removeMission(mission.id);

      expect(result.battlefieldId).toBe(bf.id);

      // Verify mission is gone
      const found = testDb
        .select()
        .from(missions)
        .where(eq(missions.id, mission.id))
        .get();
      expect(found).toBeUndefined();
    });

    it('deletes related intel notes', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = await createMission({
        battlefieldId: bf.id,
        briefing: 'Mission with intel note',
      });

      // Verify intel note exists before deletion
      const notesBefore = testDb
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, mission.id))
        .all();
      expect(notesBefore).toHaveLength(1);

      await removeMission(mission.id);

      const notesAfter = testDb
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, mission.id))
        .all();
      expect(notesAfter).toHaveLength(0);
    });

    it('deletes related mission logs', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      const { ulid } = await import('ulid');
      testDb
        .insert(missionLogs)
        .values({
          id: ulid(),
          missionId: mission.id,
          timestamp: Date.now(),
          type: 'log',
          content: 'Test log',
        })
        .run();

      await removeMission(mission.id);

      const logs = testDb
        .select()
        .from(missionLogs)
        .where(eq(missionLogs.missionId, mission.id))
        .all();
      expect(logs).toHaveLength(0);
    });

    it('deletes related overseer logs', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      const { ulid } = await import('ulid');
      testDb
        .insert(overseerLogs)
        .values({
          id: ulid(),
          missionId: mission.id,
          battlefieldId: bf.id,
          question: 'test?',
          answer: 'yes',
          reasoning: 'because',
          confidence: 'high',
          timestamp: Date.now(),
        })
        .run();

      await removeMission(mission.id);

      const logs = testDb
        .select()
        .from(overseerLogs)
        .where(eq(overseerLogs.missionId, mission.id))
        .all();
      expect(logs).toHaveLength(0);
    });

    it('calls orchestrator.onMissionAbort for in_combat missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'in_combat',
      });

      await removeMission(mission.id);

      expect(globalThis.orchestrator?.onMissionAbort).toHaveBeenCalledWith(mission.id);
    });

    it('does not call orchestrator.onMissionAbort for non-in_combat missions', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, {
        battlefieldId: bf.id,
        status: 'standby',
      });

      await removeMission(mission.id);

      expect(globalThis.orchestrator?.onMissionAbort).not.toHaveBeenCalled();
    });

    it('emits Socket.IO activity event', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });

      await removeMission(mission.id);

      expect(globalThis.io?.to).toHaveBeenCalledWith('hq:activity');
    });

    it('throws for nonexistent mission', async () => {
      await expect(removeMission('nonexistent')).rejects.toThrow('not found');
    });
  });
});
