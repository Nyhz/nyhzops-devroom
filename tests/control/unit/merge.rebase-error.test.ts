import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, missionAttempts, comms } from '@/lib/db/schema';
import { runMission, type MissionRunnerDeps, type AssetRunResult } from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

// Unique battlefield id for this test file — avoids collisions with other
// parallel test files that share the same SQLite DB.
const BF_ID = 'bf-mr-rebase-error';
const MISSION_IDS = ['mr-rebase-err'];

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

describe('runMission — merge rebase-error detail threading', () => {
  beforeEach(() => {
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, MISSION_IDS)).run();
    db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
    db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
  });

  it('surfaces rebase-error detail into comms when merge fails hard', async () => {
    const bf = seedBattlefield();
    seedMission('mr-rebase-err', bf);

    const detailText = 'fatal: needed a single revision';
    const deps = makeDeps({
      mergeFn: vi.fn(async () => ({
        status: 'failed',
        reason: 'rebase-error',
        detail: detailText,
      })) as unknown as MissionRunnerDeps['mergeFn'],
    });

    const res = await runMission('mr-rebase-err', deps);
    expect(res.finalStatus).toBe('compromised');

    const m = db.select().from(missions).where(eq(missions.id, 'mr-rebase-err')).get();
    expect(m?.status).toBe('compromised');

    const events = db.select().from(comms).where(eq(comms.missionId, 'mr-rebase-err')).all();
    const messages = events.map((e) => e.message);
    // The merge-failure comm must carry both the short reason code AND the
    // free-form detail so Commander sees the underlying git error.
    const failMsg = messages.find((msg) => msg.includes('merge failed'));
    expect(failMsg).toBeDefined();
    expect(failMsg).toContain('rebase-error');
    expect(failMsg).toContain(detailText);
  });
});
