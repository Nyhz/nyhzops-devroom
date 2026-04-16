import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, missionAttempts, comms } from '@/lib/db/schema';

// Unique battlefield id for this test file — avoids cross-file collisions
// when tests share the DB.
const BF_ID = 'bf-mr-scaffold';
const MISSION_IDS = ['mr-ok', 'mr-pid', 'mr-sweep', 'mr-gate-fail', 'mr-infra', 'mr-wt-fail'];
import { runMission, type MissionRunnerDeps, type AssetRunResult } from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

const db = getDatabase();

function seedBattlefield(id = BF_ID) {
  db.insert(battlefields)
    .values({
      id,
      name: 'TEST',
      codename: 'TEST',
      repoPath: '/tmp/fake-repo',
      defaultBranch: 'main',
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

function seedMission(id: string, battlefieldId: string) {
  db.insert(missions)
    .values({
      id,
      battlefieldId,
      title: 't',
      briefing: 'do the thing',
      type: 'combat',
      status: 'queued',
      worktreeBranch: `devroom/${id}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as typeof missions.$inferInsert)
    .run();
  return id;
}

function makeDeps(overrides: Partial<MissionRunnerDeps> = {}): MissionRunnerDeps {
  const cleanClassification: Classification = { category: 'CLEAN', reasoning: 'ok' };
  const successRun: AssetRunResult = {
    exitCode: 0,
    stderr: '',
    stdoutResultSubtype: 'success',
    finalMessage: null,
    toolUseCount: 3,
    sessionId: 'sess-1',
    hasDiff: true,
    killedByControl: false,
    elapsedMs: 1000,
  };
  return {
    spawnAsset: vi.fn(async (opts) => {
      opts.onPid?.(4242);
      return successRun;
    }),
    runGatesFn: vi.fn(async () => ({ results: [], overallStatus: 'pass' })) as unknown as MissionRunnerDeps['runGatesFn'],
    gateManifest: { build: null, test: null, lint: null, typecheck: null },
    classifyExitFn: vi.fn(async () => cleanClassification) as unknown as MissionRunnerDeps['classifyExitFn'],
    worktree: {
      create: vi.fn(async ({ missionBranch }) => ({ path: `/tmp/wt/${missionBranch}`, branch: missionBranch })),
      reset: vi.fn(async () => {}),
      rebase: vi.fn(async () => ({ rebased: false, conflict: false })),
      sweep: vi.fn(async () => ({ swept: false, filesChanged: 0 })),
      remove: vi.fn(async () => {}),
    } as unknown as MissionRunnerDeps['worktree'],
    overseerConsult: vi.fn(async () => ({ verdict: 'escalate' as const, reasoning: 'stub', escalate: { question: '?' } })),
    mergeFn: vi.fn(async () => ({ status: 'clean' })) as unknown as MissionRunnerDeps['mergeFn'],
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('runMission (scaffold)', () => {
  beforeEach(() => {
    // Clean only this file's rows to avoid colliding with other parallel test
    // files that share the same SQLite DB.
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, MISSION_IDS)).run();
    db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
    db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
  });

  it('drives happy path DEPLOYING → IN_COMBAT → MERGING → ACCOMPLISHED', async () => {
    const bf = seedBattlefield();
    seedMission('mr-ok', bf);
    const deps = makeDeps();

    const result = await runMission('mr-ok', deps);

    expect(result.finalStatus).toBe('accomplished');
    expect(result.attemptCount).toBe(1);

    const m = db.select().from(missions).where(eq(missions.id, 'mr-ok')).get();
    expect(m?.status).toBe('accomplished');

    // Each transition should have emitted a comms row.
    const events = db.select().from(comms).where(eq(comms.missionId, 'mr-ok')).all();
    const messages = events.map((e) => e.message);
    expect(messages.some((m) => m.includes('DEPLOYING'))).toBe(true);
    expect(messages.some((m) => m.includes('IN_COMBAT'))).toBe(true);
    expect(messages.some((m) => m.includes('MERGING'))).toBe(true);
    expect(messages.some((m) => m.includes('ACCOMPLISHED'))).toBe(true);

    // An attempt row was recorded.
    const attempts = db.select().from(missionAttempts).where(eq(missionAttempts.missionId, 'mr-ok')).all();
    expect(attempts.length).toBe(1);
    expect(attempts[0].endReason).toBe('clean');
  });

  it('forwards pid to onPidAssigned callback on spawn', async () => {
    const bf = seedBattlefield();
    seedMission('mr-pid', bf);
    const onPidAssigned = vi.fn();
    const deps = makeDeps({ onPidAssigned });

    await runMission('mr-pid', deps);

    expect(onPidAssigned).toHaveBeenCalledWith(4242);
  });

  it('records autoCommitted=1 when worktree sweep fires', async () => {
    const bf = seedBattlefield();
    seedMission('mr-sweep', bf);
    const deps = makeDeps({
      worktree: {
        create: vi.fn(async ({ missionBranch }) => ({ path: `/tmp/wt/${missionBranch}`, branch: missionBranch })),
        reset: vi.fn(async () => {}),
        rebase: vi.fn(async () => ({ rebased: false, conflict: false })),
        sweep: vi.fn(async () => ({ swept: true, filesChanged: 3 })),
        remove: vi.fn(async () => {}),
      } as unknown as MissionRunnerDeps['worktree'],
    });

    await runMission('mr-sweep', deps);
    const attempts = db.select().from(missionAttempts).where(eq(missionAttempts.missionId, 'mr-sweep')).all();
    expect(attempts[0].autoCommitted).toBe(1);
  });

  it('transitions to COMPROMISED when gates fail', async () => {
    const bf = seedBattlefield();
    seedMission('mr-gate-fail', bf);
    const deps = makeDeps({
      runGatesFn: vi.fn(async () => ({
        results: [{ gate: 'test', status: 'fail', stdout: '', stderr: 'x', durationMs: 1 }],
        overallStatus: 'fail',
      })) as unknown as MissionRunnerDeps['runGatesFn'],
    });

    const res = await runMission('mr-gate-fail', deps);
    expect(res.finalStatus).toBe('compromised');
    const m = db.select().from(missions).where(eq(missions.id, 'mr-gate-fail')).get();
    expect(m?.status).toBe('compromised');

    const attempts = db.select().from(missionAttempts).where(eq(missionAttempts.missionId, 'mr-gate-fail')).all();
    expect(attempts[0].endReason).toBe('gate-failure');
    expect(attempts[0].gateResults).toContain('fail');
    // Merge must not have been called on a gate failure.
    expect((deps.mergeFn as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('transitions to COMPROMISED when exit classification is not CLEAN/TURN_LIMIT', async () => {
    const bf = seedBattlefield();
    seedMission('mr-infra', bf);
    const deps = makeDeps({
      classifyExitFn: vi.fn(async () => ({
        category: 'INFRASTRUCTURE' as const,
        reasoning: 'boom',
      })) as unknown as MissionRunnerDeps['classifyExitFn'],
      // Skip backoff waits and disable infra retries so the loop terminates
      // deterministically with COMPROMISED on first INFRA classification.
      sleep: async () => {},
      infraMaxRetries: 0,
    });

    const res = await runMission('mr-infra', deps);
    expect(res.finalStatus).toBe('compromised');
    // Gates must not run on a non-CLEAN exit.
    expect((deps.runGatesFn as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('transitions to COMPROMISED when worktree creation fails', async () => {
    const bf = seedBattlefield();
    seedMission('mr-wt-fail', bf);
    const deps = makeDeps({
      worktree: {
        create: vi.fn(async () => {
          throw new Error('git worktree boom');
        }),
        reset: vi.fn(),
        rebase: vi.fn(),
        sweep: vi.fn(),
        remove: vi.fn(),
      } as unknown as MissionRunnerDeps['worktree'],
    });
    const res = await runMission('mr-wt-fail', deps);
    expect(res.finalStatus).toBe('compromised');
    // spawnAsset must not be called if worktree creation failed.
    expect((deps.spawnAsset as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('throws if mission does not exist', async () => {
    const deps = makeDeps();
    await expect(runMission('does-not-exist', deps)).rejects.toThrow(/not found/);
  });
});
