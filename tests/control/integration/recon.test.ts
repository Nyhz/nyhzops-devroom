import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import fs from 'node:fs';
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
  runReconMission,
  type ReconRunnerDeps,
} from '@/control/recon';
import { classifyExit } from '@/control/exit-classifier';
import {
  spawnAsset,
  type AssetDefinition,
  type SpawnAssetExtendedOpts,
} from '@/control/spawn-asset';
import type {
  SpawnAssetOpts,
  AssetRunResult,
} from '@/control/mission-runner';
import { materializeRepo } from '@/../tests/control/fixtures/repos/materialize';

// ---------------------------------------------------------------------------
// Scripted-claude wiring (mirrors combat-lifecycle.test.ts)
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

function scriptedSpawnAsset(
  scenarioPath: string,
  opts?: { hardTimeoutMs?: number },
): (o: SpawnAssetOpts) => Promise<AssetRunResult> {
  return async (o: SpawnAssetOpts): Promise<AssetRunResult> => {
    const extOpts: SpawnAssetExtendedOpts = {
      ...o,
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'test-roe',
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: { SCRIPTED_CLAUDE_SCENARIO: scenarioPath },
      // Recon's caller passes stdoutSilenceMs via the base opts; honor it.
      // Fall back to a tight 5s for tests that don't override.
      stdoutSilenceMs: o.stdoutSilenceMs ?? 5_000,
      hardTimeoutMs: opts?.hardTimeoutMs ?? 10_000,
    };
    return spawnAsset(extOpts);
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const BF_ID = 'bf-recon-lifecycle';
const db = getDatabase();

async function insertBattlefield(repoPath: string): Promise<string> {
  const defaultBranch = (await simpleGit(repoPath).branch()).current;
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'recon-lifecycle-bf',
      codename: 'RLB',
      repoPath,
      defaultBranch,
      gateManifest: JSON.stringify({
        build: null,
        test: null,
        lint: null,
        typecheck: null,
      }),
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return defaultBranch;
}

function insertReconMission(id: string): void {
  db.insert(missions)
    .values({
      id,
      battlefieldId: BF_ID,
      title: 'recon-mission',
      briefing: 'scout the layout',
      type: 'recon',
      status: 'queued',
      useWorktree: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as typeof missions.$inferInsert)
    .run();
}

function cleanDb(): void {
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
// Dep builder
// ---------------------------------------------------------------------------

interface BuildDepsArgs {
  scenarioPath: string;
  overseerConsult?: ReconRunnerDeps['overseerConsult'];
  infraMaxRetries?: number;
}

function buildDeps(args: BuildDepsArgs): ReconRunnerDeps {
  return {
    spawnAsset: scriptedSpawnAsset(args.scenarioPath),
    classifyExitFn: classifyExit,
    overseerConsult:
      args.overseerConsult ??
      (async () => ({
        verdict: 'escalate' as const,
        reasoning: 'stub',
        escalate: { question: 'stub' },
      })),
    now: () => Date.now(),
    sleep: async () => {},
    infraMaxRetries: args.infraMaxRetries ?? 0,
    reconStdoutSilenceMs: 5_000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recon mission lifecycle — integration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => {
    cleanDb();
  });

  afterEach(async () => {
    cleanDb();
    while (cleanups.length) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Happy recon — DEBRIEF parses → ACCOMPLISHED.
  // -------------------------------------------------------------------------
  it('happy recon: DEBRIEF parses → ACCOMPLISHED with debriefStructured populated, no violation', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);
    await insertBattlefield(repo.path);
    const missionId = 'm-recon-happy';
    insertReconMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'recon-happy.json'),
    });

    const result = await runReconMission(missionId, deps);

    expect(result.finalStatus).toBe('accomplished');
    expect(result.violatedReadonly).toBe(false);

    const m = db.select().from(missions).where(eq(missions.id, missionId)).get();
    expect(m?.status).toBe('accomplished');
    expect(m?.reconViolatedReadonly).toBe(0);
    expect(m?.debriefStructured).toBeTruthy();
    const parsed = JSON.parse(m!.debriefStructured!);
    expect(parsed.summary).toBe('report');
    expect(parsed.confidence).toBe('high');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    expect(attempts.length).toBe(1);
    expect(attempts[0].endReason).toBe('clean');
    // Recon records no gateResults or targetHeadAtStart.
    expect(attempts[0].gateResults).toBeNull();
    expect(attempts[0].targetHeadAtStart).toBeNull();
  }, 30_000);

  // -------------------------------------------------------------------------
  // 2. Read-only violation — asset writes a file. CONTROL resets + flags.
  // -------------------------------------------------------------------------
  it('readonly violation: asset writes a file → tree reset + reconViolatedReadonly=1', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);
    await insertBattlefield(repo.path);
    const missionId = 'm-recon-violation';
    insertReconMission(missionId);

    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'recon-readonly-violation.json'),
    });

    const result = await runReconMission(missionId, deps);

    // Mission still accomplishes on the DEBRIEF, but the violation is flagged.
    expect(result.finalStatus).toBe('accomplished');
    expect(result.violatedReadonly).toBe(true);

    const m = db.select().from(missions).where(eq(missions.id, missionId)).get();
    expect(m?.reconViolatedReadonly).toBe(1);

    // File must have been reverted.
    const leakedPath = path.join(repo.path, 'recon-leak.txt');
    expect(fs.existsSync(leakedPath)).toBe(false);

    // Working tree must be clean post-reset.
    const status = await simpleGit(repo.path).status();
    expect(status.isClean()).toBe(true);

    // A warning comm was emitted.
    const warnings = db
      .select()
      .from(comms)
      .where(eq(comms.missionId, missionId))
      .all()
      .filter((c) => c.level === 'warn' && /READ-ONLY/.test(c.message));
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 3. No DEBRIEF → retry policy fires → budget exhausted → COMPROMISED.
  // -------------------------------------------------------------------------
  it('no DEBRIEF: retry budget exhausts → OVERSEER escalate → COMPROMISED', async () => {
    const repo = await materializeRepo('ts-with-tests');
    cleanups.push(repo.cleanup);
    await insertBattlefield(repo.path);
    const missionId = 'm-recon-no-debrief';
    insertReconMission(missionId);

    let overseerCalled = 0;
    let lastGateStderr: string | null = null;
    let lastFinalDiff: string | null = null;
    const deps = buildDeps({
      scenarioPath: path.join(SCENARIO_DIR, 'recon-no-debrief.json'),
      overseerConsult: async (input) => {
        overseerCalled += 1;
        lastGateStderr = input.lastGateStderr;
        lastFinalDiff = input.finalDiff;
        return {
          verdict: 'escalate',
          reasoning: 'cannot produce report',
          escalate: { question: 'What should recon produce?' },
        };
      },
    });

    const result = await runReconMission(missionId, deps);

    expect(result.finalStatus).toBe('compromised');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, missionId))
      .all();
    // At least one gate-failure attempt; OVERSEER consulted.
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts.every((a) => a.endReason === 'gate-failure')).toBe(true);
    expect(overseerCalled).toBeGreaterThanOrEqual(1);

    // Spec §7: OVERSEER consult on recon omits gate/diff — we pass empty
    // strings through, caller's prompt builder treats that as "no content".
    expect(lastGateStderr).toBe('');
    expect(lastFinalDiff).toBe('');

    const m = db.select().from(missions).where(eq(missions.id, missionId)).get();
    expect(m?.status).toBe('compromised');
    expect(m?.debriefStructured).toBeNull();
  }, 30_000);
});
