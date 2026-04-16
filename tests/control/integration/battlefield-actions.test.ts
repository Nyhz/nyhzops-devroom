/**
 * Integration tests for the rewritten battlefield Server Actions (Phase 8.3).
 *
 * Uses the real SQLite DB (via getDatabase()). Each suite seeds into a
 * namespaced battlefield ID and cleans up via inArray — safe for parallel
 * Vitest workers.
 *
 * Bootstrap and runGates are injected via deps so tests do not shell out.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';

import { getDatabase } from '@/lib/db';
import {
  battlefields,
  missions,
  campaigns,
  phases,
  comms,
  missionLogs,
  scheduledTasks,
  commandLogs,
  briefingSessions,
  briefingMessages,
  overseerLogs,
  notifications,
  generalSessions,
  generalMessages,
  testRuns,
  followUpSuggestions,
  intelNotes,
} from '@/lib/db/schema';
import {
  createBattlefield,
  establishGates,
  updateGateManifest,
  toggleMainRedOverride,
  pruneForensicBranches,
} from '@/actions/battlefield';
import type { BootstrapOpts } from '@/control/bootstrap/bootstrap';
import type { GateManifest, GateRunResults, RunGatesOptions } from '@/control/gates';

// ---------------------------------------------------------------------------
// Shared test DB handle
// ---------------------------------------------------------------------------
const db = getDatabase();

// Unique battlefield ID prefixes per suite to avoid cross-suite collisions.
const BF_CREATE   = 'bf-bat-actions-create-8-3';
const BF_GATES    = 'bf-bat-actions-gates-8-3';
const BF_MANIFEST = 'bf-bat-actions-manifest-8-3';
const BF_OVERRIDE = 'bf-bat-actions-override-8-3';
const BF_PRUNE    = 'bf-bat-actions-prune-8-3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertBattlefield(id: string, repoPath = '/tmp/nonexistent-bf-test'): void {
  db.insert(battlefields)
    .values({
      id,
      name: `test-bf-${id}`,
      codename: 'TBAT',
      repoPath,
      defaultBranch: 'main',
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function getBattlefieldRow(id: string) {
  return db.select().from(battlefields).where(eq(battlefields.id, id)).get();
}

function getCommsForBattlefield(battlefieldId: string) {
  return db.select().from(comms).where(eq(comms.battlefieldId, battlefieldId)).all();
}

/** Wipe everything belonging to the given battlefield IDs. */
function cleanDb(...ids: string[]): void {
  for (const id of ids) {
    const missionIds = db
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.battlefieldId, id))
      .all()
      .map((m) => m.id);

    const campaignIds = db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.battlefieldId, id))
      .all()
      .map((c) => c.id);

    const briefingIds = campaignIds.length
      ? db
          .select({ id: briefingSessions.id })
          .from(briefingSessions)
          .where(inArray(briefingSessions.campaignId, campaignIds))
          .all()
          .map((b) => b.id)
      : [];

    const generalSessionIds = db
      .select({ id: generalSessions.id })
      .from(generalSessions)
      .where(eq(generalSessions.battlefieldId, id))
      .all()
      .map((g) => g.id);

    if (briefingIds.length) {
      db.delete(briefingMessages).where(inArray(briefingMessages.briefingId, briefingIds)).run();
    }
    if (generalSessionIds.length) {
      db.delete(generalMessages).where(inArray(generalMessages.sessionId, generalSessionIds)).run();
    }
    if (missionIds.length) {
      db.delete(missionLogs).where(inArray(missionLogs.missionId, missionIds)).run();
    }

    db.delete(followUpSuggestions).where(eq(followUpSuggestions.battlefieldId, id)).run();
    db.delete(overseerLogs).where(eq(overseerLogs.battlefieldId, id)).run();
    db.delete(intelNotes).where(eq(intelNotes.battlefieldId, id)).run();
    db.delete(testRuns).where(eq(testRuns.battlefieldId, id)).run();

    if (briefingIds.length) {
      db.delete(briefingSessions).where(inArray(briefingSessions.id, briefingIds)).run();
    }
    if (generalSessionIds.length) {
      db.delete(generalSessions).where(inArray(generalSessions.id, generalSessionIds)).run();
    }

    db.delete(notifications).where(eq(notifications.battlefieldId, id)).run();
    db.delete(missions).where(eq(missions.battlefieldId, id)).run();

    if (campaignIds.length) {
      db.delete(phases).where(inArray(phases.campaignId, campaignIds)).run();
    }

    db.delete(scheduledTasks).where(eq(scheduledTasks.battlefieldId, id)).run();
    db.delete(campaigns).where(eq(campaigns.battlefieldId, id)).run();
    db.delete(commandLogs).where(eq(commandLogs.battlefieldId, id)).run();
    db.delete(comms).where(eq(comms.battlefieldId, id)).run();
    db.delete(battlefields).where(eq(battlefields.id, id)).run();
  }
}

// ---------------------------------------------------------------------------
// Stub bootstrap that records invocations and does nothing else.
// ---------------------------------------------------------------------------
function makeBootstrapStub(
  invocations: BootstrapOpts[],
  outcome: 'resolve' | 'reject' = 'resolve',
): (opts: BootstrapOpts) => Promise<void> {
  return async (opts: BootstrapOpts): Promise<void> => {
    invocations.push(opts);
    if (outcome === 'reject') throw new Error('stub-bootstrap-error');
  };
}

// ---------------------------------------------------------------------------
// Stub runGates
// ---------------------------------------------------------------------------
function makeRunGatesStub(
  overallStatus: 'pass' | 'fail',
): (opts: RunGatesOptions) => Promise<GateRunResults> {
  return async (): Promise<GateRunResults> => {
    const gates: Array<GateManifest[keyof GateManifest] extends string | null ? keyof GateManifest : never> =
      ['build', 'test', 'lint', 'typecheck'] as const;
    const results = gates.map((gate) => ({
      gate: gate as 'build' | 'test' | 'lint' | 'typecheck',
      status: overallStatus === 'pass' ? ('pass' as const) : ('fail' as const),
      stdout: '',
      stderr: '',
      durationMs: 0,
    }));
    return { results, overallStatus };
  };
}

// ===========================================================================
// createBattlefield
// ===========================================================================
describe('createBattlefield — Phase 8.3', () => {
  beforeEach(() => cleanDb(BF_CREATE));
  afterEach(() => cleanDb(BF_CREATE));

  it('creates the battlefield row with status=initializing when bootstrap is not skipped', async () => {
    const invocations: BootstrapOpts[] = [];

    // We need a valid git repo path — use a tmp directory.
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'bf-create-test-'));
    const git = simpleGit(tmpDir);
    await git.init();
    // Need at least a HEAD so simple-git.branchLocal() doesn't throw.
    try { await git.raw(['branch', '-m', 'main']); } catch { /* ok */ }

    const cleanupTmp = () => rm(tmpDir, { recursive: true, force: true });
    let createdId: string | null = null;

    try {
      const result = await createBattlefield(
        {
          name: `bf-create-test-${BF_CREATE}`,
          codename: 'TBAT',
          repoPath: tmpDir,
        },
        { runBootstrap: makeBootstrapStub(invocations) },
      );
      createdId = result.id;

      const row = getBattlefieldRow(result.id);
      expect(row).not.toBeNull();
      // Default (no skipBootstrap) should be 'initializing'.
      expect(row?.status).toBe('initializing');
      expect(row?.needsGateManifest).toBe(1);
    } finally {
      if (createdId) cleanDb(createdId);
      await cleanupTmp();
    }
  });

  it('emits a CONTROL comm after creation', async () => {
    const invocations: BootstrapOpts[] = [];
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'bf-create-comm-'));
    const git = simpleGit(tmpDir);
    await git.init();
    try { await git.raw(['branch', '-m', 'main']); } catch { /* ok */ }

    const cleanupTmp = () => rm(tmpDir, { recursive: true, force: true });

    try {
      const result = await createBattlefield(
        {
          name: `bf-create-comm-${BF_CREATE}`,
          codename: 'TBAT',
          repoPath: tmpDir,
        },
        { runBootstrap: makeBootstrapStub(invocations) },
      );

      const bfComms = getCommsForBattlefield(result.id);
      expect(bfComms.length).toBeGreaterThan(0);
      expect(bfComms.some((c) => c.actor === 'CONTROL')).toBe(true);

      // Cleanup the dynamically-generated ID.
      cleanDb(result.id);
    } finally {
      await cleanupTmp();
    }
  });

  it('calls the bootstrap dep (fire-and-forget) when not skipBootstrap', async () => {
    const invocations: BootstrapOpts[] = [];
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'bf-bootstrap-trigger-'));
    const git = simpleGit(tmpDir);
    await git.init();
    try { await git.raw(['branch', '-m', 'main']); } catch { /* ok */ }

    const cleanupTmp = () => rm(tmpDir, { recursive: true, force: true });

    try {
      const result = await createBattlefield(
        {
          name: `bf-bootstrap-trigger-${BF_CREATE}`,
          codename: 'TBAT',
          repoPath: tmpDir,
        },
        { runBootstrap: makeBootstrapStub(invocations) },
      );

      // Give the fire-and-forget promise a tick to settle.
      await new Promise((r) => setTimeout(r, 10));

      expect(invocations.length).toBe(1);
      expect(invocations[0].battlefieldId).toBe(result.id);

      cleanDb(result.id);
    } finally {
      await cleanupTmp();
    }
  });

  it('sets status=active and needsGateManifest=0 when skipBootstrap=true', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'bf-skip-bootstrap-'));
    const git = simpleGit(tmpDir);
    await git.init();
    try { await git.raw(['branch', '-m', 'main']); } catch { /* ok */ }

    const cleanupTmp = () => rm(tmpDir, { recursive: true, force: true });

    try {
      const result = await createBattlefield(
        {
          name: `bf-skip-${BF_CREATE}`,
          codename: 'TBAT',
          repoPath: tmpDir,
          skipBootstrap: true,
        },
        { runBootstrap: makeBootstrapStub([]) },
      );

      const row = getBattlefieldRow(result.id);
      expect(row?.status).toBe('active');
      expect(row?.needsGateManifest).toBe(0);

      cleanDb(result.id);
    } finally {
      await cleanupTmp();
    }
  });
});

// ===========================================================================
// establishGates
// ===========================================================================
describe('establishGates — Phase 8.3', () => {
  beforeEach(() => {
    cleanDb(BF_GATES);
    insertBattlefield(BF_GATES);
  });
  afterEach(() => cleanDb(BF_GATES));

  it('sets needsGateManifest=1 immediately', async () => {
    const invocations: BootstrapOpts[] = [];
    await establishGates(BF_GATES, { runBootstrap: makeBootstrapStub(invocations) });

    const row = getBattlefieldRow(BF_GATES);
    expect(row?.needsGateManifest).toBe(1);
  });

  it('emits a CONTROL comm', async () => {
    const invocations: BootstrapOpts[] = [];
    await establishGates(BF_GATES, { runBootstrap: makeBootstrapStub(invocations) });

    const bfComms = getCommsForBattlefield(BF_GATES);
    expect(bfComms.some((c) => c.actor === 'CONTROL')).toBe(true);
  });

  it('kicks off the bootstrap dep', async () => {
    const invocations: BootstrapOpts[] = [];
    await establishGates(BF_GATES, { runBootstrap: makeBootstrapStub(invocations) });

    // Allow any async microtask queue to drain.
    await new Promise((r) => setTimeout(r, 10));

    expect(invocations.length).toBe(1);
    expect(invocations[0].battlefieldId).toBe(BF_GATES);
  });

  it('throws when battlefield not found', async () => {
    await expect(
      establishGates('nonexistent-bf', { runBootstrap: makeBootstrapStub([]) }),
    ).rejects.toThrow('not found');
  });
});

// ===========================================================================
// updateGateManifest
// ===========================================================================
describe('updateGateManifest — Phase 8.3', () => {
  const MANIFEST: GateManifest = {
    build: 'pnpm build',
    test: 'pnpm test',
    lint: 'pnpm lint',
    typecheck: 'pnpm typecheck',
  };

  beforeEach(() => {
    cleanDb(BF_MANIFEST);
    insertBattlefield(BF_MANIFEST);
    // Pre-set needsGateManifest=1 to verify it gets cleared on persist.
    db.update(battlefields)
      .set({ needsGateManifest: 1 })
      .where(eq(battlefields.id, BF_MANIFEST))
      .run();
  });
  afterEach(() => cleanDb(BF_MANIFEST));

  it('verify=false: persists manifest unconditionally and clears needsGateManifest', async () => {
    const result = await updateGateManifest(BF_MANIFEST, MANIFEST, { verify: false });

    expect(result.persisted).toBe(true);
    expect(result.verifyResults).toBeUndefined();

    const row = getBattlefieldRow(BF_MANIFEST);
    expect(row?.needsGateManifest).toBe(0);
    expect(JSON.parse(row!.gateManifest!)).toEqual(MANIFEST);
  });

  it('verify=false: emits a COMMANDER comm', async () => {
    await updateGateManifest(BF_MANIFEST, MANIFEST, { verify: false });

    const bfComms = getCommsForBattlefield(BF_MANIFEST);
    expect(bfComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
  });

  it('verify=true, all-green: persists manifest and returns verifyResults', async () => {
    const result = await updateGateManifest(
      BF_MANIFEST,
      MANIFEST,
      { verify: true },
      { runGates: makeRunGatesStub('pass') },
    );

    expect(result.persisted).toBe(true);
    expect(result.verifyResults).toBeDefined();
    expect(result.verifyResults!.overallStatus).toBe('pass');

    const row = getBattlefieldRow(BF_MANIFEST);
    expect(row?.needsGateManifest).toBe(0);
    expect(JSON.parse(row!.gateManifest!)).toEqual(MANIFEST);
  });

  it('verify=true, one-red: persisted=false and manifest unchanged in DB', async () => {
    // Set an initial manifest so we can confirm it stays unchanged.
    const originalManifest: GateManifest = {
      build: 'npm run build',
      test: null,
      lint: null,
      typecheck: null,
    };
    db.update(battlefields)
      .set({ gateManifest: JSON.stringify(originalManifest) })
      .where(eq(battlefields.id, BF_MANIFEST))
      .run();

    const result = await updateGateManifest(
      BF_MANIFEST,
      MANIFEST,
      { verify: true },
      { runGates: makeRunGatesStub('fail') },
    );

    expect(result.persisted).toBe(false);
    expect(result.verifyResults).toBeDefined();
    expect(result.verifyResults!.overallStatus).toBe('fail');

    const row = getBattlefieldRow(BF_MANIFEST);
    // Manifest should still be the original one.
    expect(JSON.parse(row!.gateManifest!)).toEqual(originalManifest);
  });

  it('verify=true, one-red: emits a warn COMMANDER comm', async () => {
    await updateGateManifest(
      BF_MANIFEST,
      MANIFEST,
      { verify: true },
      { runGates: makeRunGatesStub('fail') },
    );

    const bfComms = getCommsForBattlefield(BF_MANIFEST);
    const warnComm = bfComms.find((c) => c.actor === 'COMMANDER' && c.level === 'warn');
    expect(warnComm).toBeDefined();
  });

  it('throws when battlefield not found', async () => {
    await expect(
      updateGateManifest('nonexistent-bf', MANIFEST),
    ).rejects.toThrow('not found');
  });
});

// ===========================================================================
// toggleMainRedOverride
// ===========================================================================
describe('toggleMainRedOverride — Phase 8.3', () => {
  beforeEach(() => {
    cleanDb(BF_OVERRIDE);
    insertBattlefield(BF_OVERRIDE);
  });
  afterEach(() => cleanDb(BF_OVERRIDE));

  it('sets overrideMainRedGuard=1 when enabled=true', async () => {
    await toggleMainRedOverride(BF_OVERRIDE, true);

    const row = getBattlefieldRow(BF_OVERRIDE);
    expect(row?.overrideMainRedGuard).toBe(1);
  });

  it('sets overrideMainRedGuard=0 when enabled=false', async () => {
    // First enable, then disable.
    db.update(battlefields)
      .set({ overrideMainRedGuard: 1 })
      .where(eq(battlefields.id, BF_OVERRIDE))
      .run();

    await toggleMainRedOverride(BF_OVERRIDE, false);

    const row = getBattlefieldRow(BF_OVERRIDE);
    expect(row?.overrideMainRedGuard).toBe(0);
  });

  it('emits a COMMANDER comm (enable)', async () => {
    await toggleMainRedOverride(BF_OVERRIDE, true);

    const bfComms = getCommsForBattlefield(BF_OVERRIDE);
    const comm = bfComms.find(
      (c) => c.actor === 'COMMANDER' && c.message.includes('enabled'),
    );
    expect(comm).toBeDefined();
  });

  it('emits a COMMANDER comm (disable)', async () => {
    await toggleMainRedOverride(BF_OVERRIDE, false);

    const bfComms = getCommsForBattlefield(BF_OVERRIDE);
    const comm = bfComms.find(
      (c) => c.actor === 'COMMANDER' && c.message.includes('disabled'),
    );
    expect(comm).toBeDefined();
  });

  it('throws when battlefield not found', async () => {
    await expect(
      toggleMainRedOverride('nonexistent-bf', true),
    ).rejects.toThrow('not found');
  });
});

// ===========================================================================
// pruneForensicBranches
// ===========================================================================
describe('pruneForensicBranches — Phase 8.3', () => {
  let tmpDir: string;

  /**
   * Set up a fixture repo with:
   *   forensic/recent — HEAD commit has today's timestamp (keep)
   *   forensic/ancient — HEAD commit has timestamp 40 days ago (prune)
   *
   * Strategy: create two commits on two separate orphan branches so each
   * branch tip has a distinct committer date, avoiding the checkout-to-main
   * race that caused failures.
   */
  beforeEach(async () => {
    cleanDb(BF_PRUNE);

    tmpDir = await mkdtemp(path.join(tmpdir(), 'bf-prune-test-'));
    const fsmod = await import('node:fs/promises');
    const { execSync } = await import('node:child_process');

    // Init repo with git identity.
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@local"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });

    // Create initial commit on main.
    await fsmod.writeFile(path.join(tmpDir, 'README.md'), '# prune test\n');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });
    // Rename to main in case default is master.
    try { execSync('git branch -m main', { cwd: tmpDir }); } catch { /* already main */ }

    // forensic/recent — branched from main tip, inherits today's date.
    execSync('git branch forensic/recent', { cwd: tmpDir });

    // forensic/ancient — create a new empty commit backdated 40 days.
    const ancientDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    execSync('git checkout -b forensic/ancient', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "ancient"', {
      cwd: tmpDir,
      env: {
        ...process.env,
        GIT_COMMITTER_DATE: ancientDate,
        GIT_AUTHOR_DATE: ancientDate,
      },
    });
    // Back to main.
    execSync('git checkout main', { cwd: tmpDir });

    insertBattlefield(BF_PRUNE, tmpDir);
  });

  afterEach(async () => {
    cleanDb(BF_PRUNE);
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('prunes forensic branches older than daysOld and keeps recent ones', async () => {
    const { pruned } = await pruneForensicBranches(BF_PRUNE, 30);

    expect(pruned).toContain('forensic/ancient');
    expect(pruned).not.toContain('forensic/recent');
  });

  it('emits a COMMANDER comm listing pruned branches', async () => {
    const { pruned } = await pruneForensicBranches(BF_PRUNE, 30);

    const bfComms = getCommsForBattlefield(BF_PRUNE);
    const comm = bfComms.find((c) => c.actor === 'COMMANDER');
    expect(comm).toBeDefined();

    if (pruned.length > 0) {
      expect(comm?.message).toContain('forensic/ancient');
    }
  });

  it('returns empty pruned array when no branches are old enough', async () => {
    // 100 days — neither branch is that old.
    const { pruned } = await pruneForensicBranches(BF_PRUNE, 100);
    expect(pruned).toHaveLength(0);
  });

  it('emits a COMMANDER comm when nothing is pruned', async () => {
    await pruneForensicBranches(BF_PRUNE, 100);

    const bfComms = getCommsForBattlefield(BF_PRUNE);
    expect(bfComms.some((c) => c.actor === 'COMMANDER')).toBe(true);
  });

  it('throws when battlefield not found', async () => {
    await expect(
      pruneForensicBranches('nonexistent-bf', 30),
    ).rejects.toThrow('not found');
  });
});
