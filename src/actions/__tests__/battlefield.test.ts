import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestMission,
  createTestCampaign,
  createTestPhase,
  createTestAsset,
} from '@/lib/test/fixtures';
import type { DB } from '@/lib/db/index';

// Mock getDatabase to return our test db
let testDb: DB;
let testSqlite: Database.Database;

vi.mock('@/lib/db/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/index')>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

// Mock simple-git
const mockGitAdd = vi.fn().mockResolvedValue(undefined);
const mockGitCommit = vi.fn().mockResolvedValue(undefined);
const mockGitInit = vi.fn().mockResolvedValue(undefined);
const mockGitBranchLocal = vi.fn().mockResolvedValue({ current: 'main', all: ['main'] });

vi.mock('simple-git', () => ({
  default: () => ({
    add: mockGitAdd,
    commit: mockGitCommit,
    init: mockGitInit,
    branchLocal: mockGitBranchLocal,
  }),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('# Test content'),
  },
}));

// Mock config
vi.mock('@/lib/config', () => ({
  config: {
    devBasePath: '/tmp/dev',
  },
}));

// Mock scheduler/cron
vi.mock('@/lib/scheduler/cron', () => ({
  getNextRun: vi.fn().mockReturnValue(Date.now() + 86400000),
}));

// Mock utils — keep real implementations but control generateId for predictability
vi.mock('@/lib/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...original,
    generateId: original.generateId,
  };
});

// Import actions after mocks
import {
  createBattlefield,
  getBattlefield,
  listBattlefields,
  updateBattlefield,
  archiveBattlefield,
  deleteBattlefield,
  approveBootstrap,
  regenerateBootstrap,
  abandonBootstrap,
  writeBootstrapFile,
  readBootstrapFile,
} from '@/actions/battlefield';

import fs from 'fs';

describe('battlefield actions', () => {
  beforeEach(() => {
    const { db, sqlite } = getTestDb();
    testDb = db;
    testSqlite = sqlite;
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeTestDb(testSqlite);
  });

  // -------------------------------------------------------------------------
  // createBattlefield
  // -------------------------------------------------------------------------
  describe('createBattlefield', () => {
    it('creates a battlefield with repoPath (link flow)', async () => {
      // Need an asset for bootstrap mission
      createTestAsset(testDb, { codename: 'INTEL' });

      const result = await createBattlefield({
        name: 'Test Project',
        codename: 'TESTPROJ',
        repoPath: '/tmp/existing-repo',
        skipBootstrap: true,
      });

      expect(result.name).toBe('Test Project');
      expect(result.codename).toBe('TESTPROJ');
      expect(result.repoPath).toBe('/tmp/existing-repo');
      expect(result.status).toBe('active');
    });

    it('creates battlefield with initialBriefing and triggers bootstrap', async () => {
      const _asset = createTestAsset(testDb, { codename: 'INTEL' });

      const result = await createBattlefield({
        name: 'Bootstrap Test',
        codename: 'BOOTTEST',
        repoPath: '/tmp/boot-repo',
        initialBriefing: 'Set up the project',
      });

      expect(result.status).toBe('initializing');
      expect(result.bootstrapMissionId).toBeTruthy();
      expect(globalThis.orchestrator?.onMissionQueued).toHaveBeenCalledWith(
        result.bootstrapMissionId,
      );
    });

    it('does not trigger orchestrator when scaffoldCommand is present', async () => {
      createTestAsset(testDb, { codename: 'INTEL' });

      const result = await createBattlefield({
        name: 'Scaffold Test',
        codename: 'SCAFFTEST',
        repoPath: '/tmp/scaff-repo',
        initialBriefing: 'Set up the project',
        scaffoldCommand: 'npx create-next-app',
      });

      expect(result.status).toBe('initializing');
      expect(result.bootstrapMissionId).toBeTruthy();
      expect(globalThis.orchestrator?.onMissionQueued).not.toHaveBeenCalled();
    });

    it('creates battlefield without bootstrap when skipBootstrap is true', async () => {
      const result = await createBattlefield({
        name: 'Skip Boot',
        codename: 'SKIPBOOT',
        repoPath: '/tmp/skip-repo',
        skipBootstrap: true,
        claudeMdPath: '/tmp/skip-repo/CLAUDE.md',
        specMdPath: '/tmp/skip-repo/SPEC.md',
      });

      expect(result.status).toBe('active');
      expect(result.claudeMdPath).toBe('/tmp/skip-repo/CLAUDE.md');
      expect(result.specMdPath).toBe('/tmp/skip-repo/SPEC.md');
      expect(result.bootstrapMissionId).toBeNull();
    });

    it('creates new project directory when no repoPath given', async () => {
      createTestAsset(testDb, { codename: 'INTEL' });

      // New project: directory should NOT exist yet
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await createBattlefield({
        name: 'New Project',
        codename: 'NEWPROJ',
        skipBootstrap: true,
      });

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(result.repoPath).toBe('/tmp/dev/new-project');
    });

    it('throws when directory already exists for new project', async () => {
      // existsSync returns true for the directory check
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await expect(
        createBattlefield({
          name: 'Dup Project',
          codename: 'DUPPROJ',
        }),
      ).rejects.toThrow('directory already exists');
    });

    it('throws when repoPath is not a valid git repo', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).endsWith('.git')) return false;
        return true;
      });

      await expect(
        createBattlefield({
          name: 'Bad Repo',
          codename: 'BADREPO',
          repoPath: '/tmp/not-a-repo',
        }),
      ).rejects.toThrow('not a valid git repository');
    });

    it('throws when no active asset is available for bootstrap', async () => {
      // existsSync returns true so link flow validation passes
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // No assets in DB
      await expect(
        createBattlefield({
          name: 'No Asset',
          codename: 'NOASSET',
          repoPath: '/tmp/no-asset-repo',
          initialBriefing: 'Needs an asset',
        }),
      ).rejects.toThrow('INTEL asset required for bootstrap');
    });

    it('seeds maintenance tasks', async () => {
      createTestAsset(testDb, { codename: 'INTEL' });

      // existsSync returns true so link flow validation passes
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = await createBattlefield({
        name: 'Maint Test',
        codename: 'MAINTTEST',
        repoPath: '/tmp/maint-repo',
        skipBootstrap: true,
      });

      const { scheduledTasks } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const tasks = testDb
        .select()
        .from(scheduledTasks)
        .where(eq(scheduledTasks.battlefieldId, result.id))
        .all();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe('WORKTREE SWEEP');
    });
  });

  // -------------------------------------------------------------------------
  // getBattlefield
  // -------------------------------------------------------------------------
  describe('getBattlefield', () => {
    it('returns battlefield with counts', async () => {
      const bf = createTestBattlefield(testDb);
      createTestMission(testDb, { battlefieldId: bf.id });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'in_combat' });
      createTestCampaign(testDb, { battlefieldId: bf.id });

      const result = await getBattlefield(bf.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(bf.id);
      expect(result!.missionCount).toBe(2);
      expect(result!.campaignCount).toBe(1);
      expect(result!.activeMissionCount).toBe(1);
    });

    it('returns null for non-existent battlefield', async () => {
      const result = await getBattlefield('non-existent-id');
      expect(result).toBeNull();
    });

    it('counts active missions correctly (queued, deploying, in_combat)', async () => {
      const bf = createTestBattlefield(testDb);
      createTestMission(testDb, { battlefieldId: bf.id, status: 'queued' });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'deploying' });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'in_combat' });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'accomplished' });
      createTestMission(testDb, { battlefieldId: bf.id, status: 'standby' });

      const result = await getBattlefield(bf.id);
      expect(result!.activeMissionCount).toBe(3);
      expect(result!.missionCount).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // listBattlefields
  // -------------------------------------------------------------------------
  describe('listBattlefields', () => {
    it('returns battlefields ordered by updatedAt desc', async () => {
      const _older = createTestBattlefield(testDb, {
        name: 'Older',
        updatedAt: 1000,
      });
      const _newer = createTestBattlefield(testDb, {
        name: 'Newer',
        updatedAt: 2000,
      });

      const result = await listBattlefields();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Newer');
      expect(result[1].name).toBe('Older');
    });

    it('returns empty array when no battlefields exist', async () => {
      const result = await listBattlefields();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // updateBattlefield
  // -------------------------------------------------------------------------
  describe('updateBattlefield', () => {
    it('updates name and codename', async () => {
      const bf = createTestBattlefield(testDb);

      const result = await updateBattlefield(bf.id, {
        name: 'Updated Name',
        codename: 'UPDATED',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.codename).toBe('UPDATED');
    });

    it('converts autoStartDevServer boolean to integer', async () => {
      const bf = createTestBattlefield(testDb);

      const result = await updateBattlefield(bf.id, {
        autoStartDevServer: true,
      });

      expect(result.autoStartDevServer).toBe(1);
    });

    it('throws for non-existent battlefield', async () => {
      await expect(
        updateBattlefield('non-existent', { name: 'Nope' }),
      ).rejects.toThrow('not found');
    });

    it('updates description and devServerCommand', async () => {
      const bf = createTestBattlefield(testDb);

      const result = await updateBattlefield(bf.id, {
        description: 'New desc',
        devServerCommand: 'pnpm dev',
      });

      expect(result.description).toBe('New desc');
      expect(result.devServerCommand).toBe('pnpm dev');
    });
  });

  // -------------------------------------------------------------------------
  // archiveBattlefield
  // -------------------------------------------------------------------------
  describe('archiveBattlefield', () => {
    it('changes status to archived', async () => {
      const bf = createTestBattlefield(testDb, { status: 'active' });

      await archiveBattlefield(bf.id);

      const result = await getBattlefield(bf.id);
      expect(result!.status).toBe('archived');
    });

    it('throws for non-existent battlefield', async () => {
      await expect(archiveBattlefield('non-existent')).rejects.toThrow(
        'not found',
      );
    });

    it('throws when battlefield is already archived', async () => {
      const bf = createTestBattlefield(testDb, { status: 'archived' });

      await expect(archiveBattlefield(bf.id)).rejects.toThrow(
        'already archived',
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteBattlefield
  // -------------------------------------------------------------------------
  describe('deleteBattlefield', () => {
    it('deletes battlefield and all related entities', async () => {
      const bf = createTestBattlefield(testDb);
      const mission = createTestMission(testDb, { battlefieldId: bf.id });
      const campaign = createTestCampaign(testDb, { battlefieldId: bf.id });
      createTestPhase(testDb, { campaignId: campaign.id });

      // Add a mission log
      const { missionLogs } = await import('@/lib/db/schema');
      const { ulid } = await import('ulid');
      testDb
        .insert(missionLogs)
        .values({
          id: ulid(),
          missionId: mission.id,
          timestamp: Date.now(),
          type: 'comms',
          content: 'test log',
        })
        .run();

      await deleteBattlefield(bf.id);

      const result = await getBattlefield(bf.id);
      expect(result).toBeNull();
    });

    it('handles battlefield with no related entities', async () => {
      const bf = createTestBattlefield(testDb);

      await deleteBattlefield(bf.id);

      const result = await getBattlefield(bf.id);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // approveBootstrap
  // -------------------------------------------------------------------------
  describe('approveBootstrap', () => {
    it('commits files and activates battlefield', async () => {
      const bf = createTestBattlefield(testDb, {
        status: 'initializing',
        repoPath: '/tmp/approve-repo',
      });

      await approveBootstrap(bf.id);

      expect(mockGitAdd).toHaveBeenCalledWith(['CLAUDE.md', 'SPEC.md']);
      expect(mockGitCommit).toHaveBeenCalledWith(
        'Bootstrap: add CLAUDE.md and SPEC.md',
      );

      const result = await getBattlefield(bf.id);
      expect(result!.status).toBe('active');
      expect(result!.claudeMdPath).toBe('/tmp/approve-repo/CLAUDE.md');
      expect(result!.specMdPath).toBe('/tmp/approve-repo/SPEC.md');
    });

    it('throws when battlefield not found', async () => {
      await expect(approveBootstrap('non-existent')).rejects.toThrow(
        'not found or not in initializing state',
      );
    });

    it('throws when battlefield is not in initializing state', async () => {
      const bf = createTestBattlefield(testDb, { status: 'active' });

      await expect(approveBootstrap(bf.id)).rejects.toThrow(
        'not found or not in initializing state',
      );
    });
  });

  // -------------------------------------------------------------------------
  // regenerateBootstrap
  // -------------------------------------------------------------------------
  describe('regenerateBootstrap', () => {
    it('deletes files, creates new mission, and triggers orchestrator', async () => {
      const _asset = createTestAsset(testDb, { codename: 'INTEL' });
      const bf = createTestBattlefield(testDb, {
        status: 'initializing',
        repoPath: '/tmp/regen-repo',
      });

      // Create existing bootstrap mission
      const oldMission = createTestMission(testDb, {
        battlefieldId: bf.id,
        type: 'bootstrap',
      });

      // Update battlefield with bootstrap mission id
      const { battlefields } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      testDb
        .update(battlefields)
        .set({ bootstrapMissionId: oldMission.id })
        .where(eq(battlefields.id, bf.id))
        .run();

      await regenerateBootstrap(bf.id, 'New briefing content');

      // Should have deleted the old files
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);

      // Should have updated briefing
      const updated = await getBattlefield(bf.id);
      expect(updated!.bootstrapMissionId).not.toBe(oldMission.id);

      // Should have triggered orchestrator
      expect(globalThis.orchestrator?.onMissionQueued).toHaveBeenCalled();
    });

    it('throws when battlefield is not in initializing state', async () => {
      const bf = createTestBattlefield(testDb, { status: 'active' });

      await expect(
        regenerateBootstrap(bf.id, 'New briefing'),
      ).rejects.toThrow('not found or not in initializing state');
    });

    it('throws when battlefield not found', async () => {
      await expect(
        regenerateBootstrap('non-existent', 'New briefing'),
      ).rejects.toThrow('not found or not in initializing state');
    });
  });

  // -------------------------------------------------------------------------
  // abandonBootstrap
  // -------------------------------------------------------------------------
  describe('abandonBootstrap', () => {
    it('deletes files and removes battlefield', async () => {
      const bf = createTestBattlefield(testDb, {
        status: 'initializing',
        repoPath: '/tmp/abandon-repo',
      });

      await abandonBootstrap(bf.id);

      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);

      const result = await getBattlefield(bf.id);
      expect(result).toBeNull();
    });

    it('throws when battlefield is not in initializing state', async () => {
      const bf = createTestBattlefield(testDb, { status: 'active' });

      await expect(abandonBootstrap(bf.id)).rejects.toThrow(
        'not found or not in initializing state',
      );
    });

    it('throws when battlefield not found', async () => {
      await expect(abandonBootstrap('non-existent')).rejects.toThrow(
        'not found or not in initializing state',
      );
    });
  });

  // -------------------------------------------------------------------------
  // writeBootstrapFile
  // -------------------------------------------------------------------------
  describe('writeBootstrapFile', () => {
    it('writes CLAUDE.md to disk', async () => {
      const bf = createTestBattlefield(testDb, {
        status: 'initializing',
        repoPath: '/tmp/write-repo',
      });

      await writeBootstrapFile(bf.id, 'CLAUDE.md', '# My CLAUDE.md');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/write-repo/CLAUDE.md',
        '# My CLAUDE.md',
        'utf-8',
      );
    });

    it('writes SPEC.md to disk', async () => {
      const bf = createTestBattlefield(testDb, {
        status: 'initializing',
        repoPath: '/tmp/write-repo',
      });

      await writeBootstrapFile(bf.id, 'SPEC.md', '# My SPEC');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/write-repo/SPEC.md',
        '# My SPEC',
        'utf-8',
      );
    });

    it('throws for disallowed filenames', async () => {
      const bf = createTestBattlefield(testDb, {
        status: 'initializing',
      });

      await expect(
        writeBootstrapFile(bf.id, 'README.md', 'content'),
      ).rejects.toThrow('only CLAUDE.md and SPEC.md are allowed');
    });

    it('throws when battlefield not in initializing state', async () => {
      const bf = createTestBattlefield(testDb, { status: 'active' });

      await expect(
        writeBootstrapFile(bf.id, 'CLAUDE.md', 'content'),
      ).rejects.toThrow('not found or not in initializing state');
    });

    it('throws when battlefield not found', async () => {
      await expect(
        writeBootstrapFile('non-existent', 'CLAUDE.md', 'content'),
      ).rejects.toThrow('not found or not in initializing state');
    });
  });

  // -------------------------------------------------------------------------
  // readBootstrapFile
  // -------------------------------------------------------------------------
  describe('readBootstrapFile', () => {
    it('reads CLAUDE.md from disk', async () => {
      const bf = createTestBattlefield(testDb, {
        repoPath: '/tmp/read-repo',
      });

      const result = await readBootstrapFile(bf.id, 'CLAUDE.md');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        '/tmp/read-repo/CLAUDE.md',
        'utf-8',
      );
      expect(result).toBe('# Test content');
    });

    it('returns empty string when file does not exist', async () => {
      vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const bf = createTestBattlefield(testDb, {
        repoPath: '/tmp/read-repo',
      });

      const result = await readBootstrapFile(bf.id, 'CLAUDE.md');
      expect(result).toBe('');
    });

    it('throws for disallowed filenames', async () => {
      const bf = createTestBattlefield(testDb);

      await expect(
        readBootstrapFile(bf.id, 'package.json'),
      ).rejects.toThrow('only CLAUDE.md and SPEC.md are allowed');
    });

    it('throws when battlefield not found', async () => {
      await expect(
        readBootstrapFile('non-existent', 'CLAUDE.md'),
      ).rejects.toThrow('not found');
    });
  });
});
