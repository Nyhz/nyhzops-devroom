import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, missionAttempts, comms } from '@/lib/db/schema';
import { runMission, type MissionRunnerDeps, type AssetRunResult } from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

// Unique battlefield id and mission ids for this test file — avoids
// cross-file collisions when tests share the DB.
const BF_ID = 'bf-mr-cleanup';
const MISSION_IDS = ['mr-cleanup-ok', 'mr-cleanup-fail', 'mr-cleanup-throw'];

const db = getDatabase();

function seedBattlefield(id = BF_ID) {
  db.insert(battlefields)
    .values({
      id,
      name: 'CLEANUP',
      codename: 'CLEANUP',
      repoPath: '/tmp/fake-repo-cleanup',
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

describe('runMission worktree cleanup', () => {
  beforeEach(() => {
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, MISSION_IDS)).run();
    db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
    db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
  });

  it('calls worktree.remove after ACCOMPLISHED path', async () => {
    const bf = seedBattlefield();
    seedMission('mr-cleanup-ok', bf);
    const deps = makeDeps();

    const result = await runMission('mr-cleanup-ok', deps);

    expect(result.finalStatus).toBe('accomplished');
    const remove = deps.worktree.remove as unknown as ReturnType<typeof vi.fn>;
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('calls worktree.remove after COMPROMISED path (gate failure)', async () => {
    const bf = seedBattlefield();
    seedMission('mr-cleanup-fail', bf);
    const deps = makeDeps({
      runGatesFn: vi.fn(async () => ({
        results: [{ gate: 'test', status: 'fail', stdout: '', stderr: 'x', durationMs: 1 }],
        overallStatus: 'fail',
      })) as unknown as MissionRunnerDeps['runGatesFn'],
    });

    const res = await runMission('mr-cleanup-fail', deps);
    expect(res.finalStatus).toBe('compromised');
    const remove = deps.worktree.remove as unknown as ReturnType<typeof vi.fn>;
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('calls worktree.remove even when retry loop throws unexpectedly', async () => {
    const bf = seedBattlefield();
    seedMission('mr-cleanup-throw', bf);
    // runGatesFn is not wrapped in try/catch inside runMission — making it
    // throw simulates an unexpected late-path failure that would otherwise
    // leak the worktree.
    const deps = makeDeps({
      runGatesFn: vi.fn(async () => {
        throw new Error('gates exploded');
      }) as unknown as MissionRunnerDeps['runGatesFn'],
    });

    await expect(runMission('mr-cleanup-throw', deps)).rejects.toThrow(/gates exploded/);
    const remove = deps.worktree.remove as unknown as ReturnType<typeof vi.fn>;
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
