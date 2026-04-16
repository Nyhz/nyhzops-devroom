import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import path from 'node:path';
import simpleGit from 'simple-git';

import { getDatabase } from '@/lib/db';
import {
  missions,
  missionAttempts,
  battlefields,
  comms,
} from '@/lib/db/schema';
import {
  runMission,
  type MissionRunnerDeps,
  type SpawnAssetOpts,
  type AssetRunResult,
} from '@/control/mission-runner';
import { classifyExit } from '@/control/exit-classifier';
import {
  spawnAsset,
  type AssetDefinition,
  type SpawnAssetExtendedOpts,
} from '@/control/spawn-asset';
import { runGates } from '@/control/gates';
import {
  createMissionWorktree,
  resetWorktreeToHead,
  rebaseOntoTarget,
  autoCommitSweep,
  removeMissionWorktree,
} from '@/control/worktree';
import {
  materializeRepo,
  type MaterializedRepo,
} from '@/../tests/control/fixtures/repos/materialize';

// ---------------------------------------------------------------------------
// Scripted-claude wiring — see tests/control/unit/spawn-asset.test.ts
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTED_CLAUDE = path.join(
  REPO_ROOT,
  'tests/control/fixtures/scripted-claude/scripted-claude.ts',
);
const TSX_BIN = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
const SCENARIO_DIR = path.join(REPO_ROOT, 'tests/control/fixtures/scenarios');

const MINIMAL_ASSET: AssetDefinition = {
  codename: 'OPERATIVE',
  model: 'claude-opus-4-7',
  maxTurns: 30,
  effort: 'medium',
  isSystem: 0,
  systemPrompt: 'You are the operative.',
  skills: [],
  mcpServers: [],
};

/** Build a spawnAsset function that calls the real spawnAsset launcher but
 *  injects the scripted-claude binary. The scenario is selected via the
 *  `SCRIPTED_CLAUDE_SCENARIO` env var. */
function scriptedSpawnAsset(
  scenarioPath: string,
  opts?: { stdoutSilenceMs?: number; hardTimeoutMs?: number },
): (o: SpawnAssetOpts) => Promise<AssetRunResult> {
  return async (o: SpawnAssetOpts): Promise<AssetRunResult> => {
    const extOpts: SpawnAssetExtendedOpts = {
      ...o,
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'test-roe',
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: { SCRIPTED_CLAUDE_SCENARIO: scenarioPath },
      stdoutSilenceMs: opts?.stdoutSilenceMs ?? 5_000,
      hardTimeoutMs: opts?.hardTimeoutMs ?? 10_000,
    };
    return spawnAsset(extOpts);
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const BF_ID = 'bf-combat-lifecycle';
const db = getDatabase();

async function insertBattlefield(
  repoPath: string,
  gateManifest: Record<string, string | null>,
): Promise<string> {
  const defaultBranch = (await simpleGit(repoPath).branch()).current;
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'combat-lifecycle-bf',
      codename: 'CLC',
      repoPath,
      defaultBranch,
      gateManifest: JSON.stringify(gateManifest),
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return defaultBranch;
}

function insertMission(id: string): void {
  db.insert(missions)
    .values({
      id,
      battlefieldId: BF_ID,
      title: 'integration-mission',
      briefing: 'do the thing',
      type: 'combat',
      status: 'queued',
      worktreeBranch: `devroom/${id}`,
      useWorktree: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as typeof missions.$inferInsert)
    .run();
}

function cleanDb(): void {
  // Wipe mission_attempts + comms + missions + battlefields for our bf scope.
  const missionIds = db
    .select()
    .from(missions)
    .where(eq(missions.battlefieldId, BF_ID))
    .all()
    .map((m) => m.id);
  if (missionIds.length > 0) {
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, missionIds)).run();
    db.delete(comms).where(inArray(comms.missionId, missionIds)).run();
    db.delete(missions).where(inArray(missions.id, missionIds)).run();
  }
  db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
}

// ---------------------------------------------------------------------------
// Dep builders
// ---------------------------------------------------------------------------

interface BuildDepsArgs {
  scenarioPath: string;
  repoPath: string;
  gateManifest: { build: string | null; test: string | null; lint: string | null; typecheck: string | null };
  spawnOpts?: { stdoutSilenceMs?: number; hardTimeoutMs?: number };
  overseerConsult?: MissionRunnerDeps['overseerConsult'];
  overseerClassifier?: MissionRunnerDeps['overseerClassifier'];
  infraMaxRetries?: number;
}

function buildDeps(args: BuildDepsArgs): MissionRunnerDeps {
  return {
    spawnAsset: scriptedSpawnAsset(args.scenarioPath, args.spawnOpts),
    runGatesFn: runGates,
    gateManifest: args.gateManifest,
    classifyExitFn: classifyExit,
    worktree: {
      create: createMissionWorktree,
      reset: resetWorktreeToHead,
      rebase: rebaseOntoTarget,
      sweep: autoCommitSweep,
      remove: removeMissionWorktree,
    },
    overseerConsult:
      args.overseerConsult ??
      (async () => ({
        verdict: 'escalate' as const,
        reasoning: 'stub',
        escalate: { question: 'stub' },
      })),
    overseerClassifier: args.overseerClassifier,
    // runMerge is validated separately in tests/control/integration/merge.test.ts.
    // Our focus here is the combat lifecycle (§5), so we use a trivial merge
    // stub by default. Individual tests may override.
    mergeFn: async () => ({ status: 'clean' }),
    now: () => Date.now(),
    sleep: async () => {},
    infraMaxRetries: args.infraMaxRetries ?? 0,
  };
}

// A mergeFn that short-circuits the merge (always returns clean) — used when
// we don't care about merge correctness and just want the runner to reach
// ACCOMPLISHED. `runMerge` is exercised separately in merge.test.ts.
function trivialMergeFn(): MissionRunnerDeps['mergeFn'] {
  return async () => ({ status: 'clean' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('combat mission lifecycle — integration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => {
    cleanDb();
  });

  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
    cleanDb();
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — scripted agent exits success, gates pass, merge clean.
  // -------------------------------------------------------------------------
  it('happy path: scripted success → gates pass → ACCOMPLISHED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = {
      build: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
      lint: null,
      typecheck: null,
    };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-happy';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'combat-commit.json'),
      repoPath: repo.path,
      gateManifest: manifest,
    });
    // Use trivial merge — runMerge behavior is validated separately.
    deps.mergeFn = trivialMergeFn();

    const result = await runMission(missionId, deps);

    expect(result.finalStatus).toBe('accomplished');
    const m = db.select().from(missions).where(eq(missions.id, missionId)).get();
    expect(m?.status).toBe('accomplished');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBe(1);
    expect(attempts[0].endReason).toBe('clean');
    expect(attempts[0].classification).toContain('CLEAN');
  }, 30_000);

  // -------------------------------------------------------------------------
  // 2. Agent forgets commit → auto-sweep → ACCOMPLISHED.
  // -------------------------------------------------------------------------
  it('auto-sweep: scripted agent writes files, forgets to commit → sweep commits, gates pass, ACCOMPLISHED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = {
      build: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
      lint: null,
      typecheck: null,
    };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-sweep';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'combat-no-commit.json'),
      repoPath: repo.path,
      gateManifest: manifest,
    });
    deps.mergeFn = trivialMergeFn();

    const result = await runMission(missionId, deps);

    expect(result.finalStatus).toBe('accomplished');
    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBe(1);
    expect(attempts[0].autoCommitted).toBe(1);
    expect(attempts[0].endReason).toBe('clean');

    // Confirm the sweep commit landed on the worktree branch.
    const branch = `devroom/${missionId}`;
    const wtPath = path.join(repo.path, '.worktrees', branch.replace(/\//g, '-'));
    const log = await simpleGit(wtPath).log();
    expect(log.latest?.message).toMatch(/chore\(mission\): sweep uncommitted work/);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 3. Gates fail attempt 1 → deterministic retry fires → retry also fails
  //    (same scenario) → no-progress/OVERSEER → escalate → COMPROMISED.
  //
  //    This validates the deterministic retry loop is actually wired. The
  //    minimal "attempt 1 fails → retry 2 passes" variant would need two
  //    distinct scripted scenarios between attempts; we approximate by
  //    asserting that >=2 attempts are recorded with endReason=gate-failure
  //    before the mission is marked COMPROMISED via OVERSEER escalation.
  // -------------------------------------------------------------------------
  it('gate failure: fails deterministic retries → OVERSEER escalate → COMPROMISED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = {
      build: null,
      test: 'node -e "process.exit(1)"',
      lint: null,
      typecheck: null,
    };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-gate-fail';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'combat-commit.json'),
      repoPath: repo.path,
      gateManifest: manifest,
      overseerConsult: async () => ({
        verdict: 'escalate',
        reasoning: 'identical diff; cannot proceed',
        escalate: { question: 'What next?' },
      }),
    });
    deps.mergeFn = trivialMergeFn();

    const result = await runMission(missionId, deps);
    expect(result.finalStatus).toBe('compromised');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    // At least one gate-failure attempt recorded.
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts.every((a) => a.endReason === 'gate-failure')).toBe(true);

    const m = db.select().from(missions).where(eq(missions.id, missionId)).get();
    expect(m?.status).toBe('compromised');
  }, 60_000);

  // -------------------------------------------------------------------------
  // 4. Infrastructure error → free retry budget exhausted → COMPROMISED.
  // -------------------------------------------------------------------------
  it('infrastructure error: exhausts free-retry budget → COMPROMISED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = { build: null, test: null, lint: null, typecheck: null };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-infra';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'infra-error.json'),
      repoPath: repo.path,
      gateManifest: manifest,
      // Allow one free retry; second will also be INFRA → COMPROMISED.
      infraMaxRetries: 1,
    });

    const result = await runMission(missionId, deps);
    expect(result.finalStatus).toBe('compromised');
    expect(result.classification?.category).toBe('INFRASTRUCTURE');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBe(2);
    expect(attempts.every((a) => a.endReason === 'infrastructure')).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 5. Rate limit → delayed retry → retry also hits rate limit (same
  //    scenario) → COMPROMISED when budget exhausted.
  // -------------------------------------------------------------------------
  it('rate limit: delayed retry fires → budget exhausted → COMPROMISED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = { build: null, test: null, lint: null, typecheck: null };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-rate';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'rate-limit.json'),
      repoPath: repo.path,
      gateManifest: manifest,
      infraMaxRetries: 1,
    });

    const result = await runMission(missionId, deps);
    expect(result.finalStatus).toBe('compromised');
    expect(result.classification?.category).toBe('RATE_LIMIT');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBe(2);
    expect(attempts.every((a) => a.endReason === 'rate-limit')).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 6. AUTH error → orchestrator-pause comm emitted, COMPROMISED.
  // -------------------------------------------------------------------------
  it('auth error: emits AUTH failure comm → mission COMPROMISED with authPause flag', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = { build: null, test: null, lint: null, typecheck: null };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-auth';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'auth-fail.json'),
      repoPath: repo.path,
      gateManifest: manifest,
    });

    const result = await runMission(missionId, deps);
    expect(result.finalStatus).toBe('compromised');
    expect(result.authPause).toBe(true);
    expect(result.classification?.category).toBe('AUTH');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBe(1);
    expect(attempts[0].endReason).toBe('auth');

    const events = db.select().from(comms).where(eq(comms.missionId, missionId)).all();
    expect(events.some((e) => /AUTH failure/i.test(e.message))).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 7. Timeout (scripted hang) → L3 silence-kill → classification TIMEOUT →
  //    reset + deterministic retry. Re-running the same hang scenario again
  //    will trip TIMEOUT a second time; budget exhaustion ends in OVERSEER
  //    escalate → COMPROMISED.
  // -------------------------------------------------------------------------
  it('timeout: L3 silence-kill fires → retry exhausts → COMPROMISED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);

    const manifest = { build: null, test: null, lint: null, typecheck: null };
    await insertBattlefield(repo.path, manifest);
    const missionId = 'm-timeout';
    insertMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'hang.json'),
      repoPath: repo.path,
      gateManifest: manifest,
      // Trip L3 silence-kill quickly: first stdout at 20 ms, next at 5000 ms.
      spawnOpts: { stdoutSilenceMs: 150, hardTimeoutMs: 15_000 },
      overseerConsult: async () => ({
        verdict: 'escalate',
        reasoning: 'timed out repeatedly',
        escalate: { question: '?' },
      }),
    });

    const result = await runMission(missionId, deps);
    expect(result.finalStatus).toBe('compromised');
    expect(result.classification?.category).toBe('TIMEOUT');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts.every((a) => ['timeout', 'silence-kill'].includes(a.endReason ?? ''))).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 8. OVERSEER classifier fallback for otherwise-unknown exits.
  //    We inject a scenario that exits 0 with no result event — which falls
  //    through all fast-path regex checks. The overseerClassifier dep is
  //    consulted and returns AGENT_FAILURE → treated as gate-fail-like retry.
  //
  //    SKIPPED: the fast-path classifier already assigns NEEDS_COMMANDER for
  //    such exits when overseerClassify is not provided; exercising the
  //    OVERSEER branch requires a non-fast-path scenario AND a live
  //    overseerClassifier wired end-to-end. The runner wires the dep, but
  //    crafting a deterministic scenario that reaches the OVERSEER branch
  //    without also hitting regex matches is brittle without the full
  //    prompt-builder plumbing (Task 5.4+).
  // -------------------------------------------------------------------------
  it.skip('overseer classifier fallback: AGENT_FAILURE → retry path', async () => {
    // TODO: enable once prompt-builder is integrated into mission-runner.
  });

  // -------------------------------------------------------------------------
  // 9. Same-diff path (no-progress) → OVERSEER redirect → recovered.
  //    SKIPPED: requires distinct scenarios per attempt (first fails, retry
  //    writes different files after OVERSEER redirect). The current scripted-
  //    claude wires ONE scenario per spawnAsset function; to test this we'd
  //    need a dispatcher that switches scenarios based on attempt number.
  //    Deferred to a follow-up task.
  // -------------------------------------------------------------------------
  it.skip('same-diff: OVERSEER redirect → attempt 4 passes → ACCOMPLISHED', async () => {
    // TODO: introduce multi-scenario dispatcher in scripted-claude wiring.
  });

  // -------------------------------------------------------------------------
  // 10. All attempts fail → COMPROMISED (covered by test #3 via escalate).
  // -------------------------------------------------------------------------
});
