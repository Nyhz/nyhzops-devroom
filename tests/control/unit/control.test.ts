import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, missionAttempts, comms, settings } from '@/lib/db/schema';
import { Control } from '@/control/control';
import { clearConfigCache } from '@/control/config';
import type { MissionRunnerDeps, AssetRunResult } from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

const db = getDatabase();

const BF_ID = 'bf-ctl-scaffold';
const MISSION_IDS = ['ctl-m1', 'ctl-m2', 'ctl-m3', 'ctl-m-once', 'ctl-mp', 'ctl-m-future', 'ctl-m-pid'];

function seedBattlefield(id = BF_ID) {
  db.insert(battlefields)
    .values({
      id,
      name: 'TEST',
      codename: 'TEST',
      repoPath: '/tmp/fake',
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

function seedQueuedMission(id: string, battlefieldId: string) {
  db.insert(missions)
    .values({
      id,
      battlefieldId,
      title: id,
      briefing: 'x',
      type: 'combat',
      status: 'queued',
      worktreeBranch: `devroom/${id}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as typeof missions.$inferInsert)
    .run();
}

function setMaxAgents(n: number) {
  db.insert(settings)
    .values({ key: 'devroom_max_agents', value: String(n), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(n), updatedAt: Date.now() },
    })
    .run();
  clearConfigCache();
}

function baseDeps(spawnImpl: MissionRunnerDeps['spawnAsset']): MissionRunnerDeps {
  const cleanClassification: Classification = { category: 'CLEAN', reasoning: 'ok' };
  return {
    spawnAsset: spawnImpl,
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
    overseerConsult: vi.fn(async () => ({ verdict: 'escalate' as const, reasoning: 's', escalate: { question: '?' } })),
    mergeFn: vi.fn(async () => ({ status: 'clean' })) as unknown as MissionRunnerDeps['mergeFn'],
    now: () => Date.now(),
  };
}

describe('Control dispatch loop (scaffold)', () => {
  beforeEach(() => {
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, MISSION_IDS)).run();
    db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
    db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
    db.delete(settings).where(eq(settings.key, 'devroom_max_agents')).run();
    clearConfigCache();
  });

  afterEach(() => {
    clearConfigCache();
  });

  it('dispatches up to maxAgents concurrent missions and no more', async () => {
    setMaxAgents(2);
    const bf = seedBattlefield();
    seedQueuedMission('ctl-m1', bf);
    seedQueuedMission('ctl-m2', bf);
    seedQueuedMission('ctl-m3', bf);

    // Spawn holds until we resolve — simulates an in-flight subprocess.
    const holds: Array<() => void> = [];
    const successRun: AssetRunResult = {
      exitCode: 0, stderr: '', stdoutResultSubtype: 'success', finalMessage: null,
      toolUseCount: 1, sessionId: 's', hasDiff: true, killedByControl: false, elapsedMs: 10,
    };
    const spawn = vi.fn<MissionRunnerDeps['spawnAsset']>(async (opts) => {
      opts.onPid?.(100 + holds.length);
      await new Promise<void>((res) => holds.push(res));
      return successRun;
    });

    const control = new Control({ missionDeps: baseDeps(spawn) });

    const dispatched = await control.tick();
    expect(dispatched).toBe(2);
    expect(control.live.size).toBe(2);
    // Let the runner's async path reach the spawn call.
    await new Promise((r) => setTimeout(r, 20));
    expect(spawn).toHaveBeenCalledTimes(2);

    // Second tick while two are in-flight → no additional dispatches.
    const dispatched2 = await control.tick();
    expect(dispatched2).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);

    // Release the in-flight missions; let microtasks drain.
    holds.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 10));

    // Live map should drain.
    expect(control.live.size).toBe(0);

    // Third tick picks up m3 now that slots are free.
    const dispatched3 = await control.tick();
    expect(dispatched3).toBe(1);
  });

  it('never dispatches the same mission twice within a single tick cycle', async () => {
    setMaxAgents(5);
    const bf = seedBattlefield();
    seedQueuedMission('ctl-m-once', bf);

    const seen: string[] = [];
    const spawn = vi.fn<MissionRunnerDeps['spawnAsset']>(async (opts) => {
      seen.push(opts.missionId);
      // Hold forever — we want to assert it was never picked twice.
      await new Promise<void>(() => {});
      return {
        exitCode: 0, stderr: '', stdoutResultSubtype: 'success', finalMessage: null,
        toolUseCount: 0, sessionId: null, hasDiff: false, killedByControl: false, elapsedMs: 0,
      };
    });

    const control = new Control({ missionDeps: baseDeps(spawn) });
    await control.tick();
    await control.tick();
    await control.tick();

    expect(seen).toEqual(['ctl-m-once']);
  });

  it('does not dispatch while paused', async () => {
    setMaxAgents(3);
    const bf = seedBattlefield();
    seedQueuedMission('ctl-mp', bf);

    const spawn = vi.fn<MissionRunnerDeps['spawnAsset']>(async () => ({
      exitCode: 0, stderr: '', stdoutResultSubtype: 'success', finalMessage: null,
      toolUseCount: 0, sessionId: null, hasDiff: false, killedByControl: false, elapsedMs: 0,
    }));

    const control = new Control({ missionDeps: baseDeps(spawn) });
    control.pauseAll('manual');
    expect(control.isPaused()).toBe(true);

    const d = await control.tick();
    expect(d).toBe(0);
    expect(spawn).not.toHaveBeenCalled();

    control.resumeAll();
    expect(control.isPaused()).toBe(false);
  });

  it('skips missions whose nextAttemptAt is in the future', async () => {
    setMaxAgents(3);
    const bf = seedBattlefield();
    const future = Date.now() + 3600_000;
    db.insert(missions)
      .values({
        id: 'ctl-m-future',
        battlefieldId: bf,
        title: 't',
        briefing: 'x',
        type: 'combat',
        status: 'queued',
        nextAttemptAt: future,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as typeof missions.$inferInsert)
      .run();

    const spawn = vi.fn<MissionRunnerDeps['spawnAsset']>(async () => ({
      exitCode: 0, stderr: '', stdoutResultSubtype: 'success', finalMessage: null,
      toolUseCount: 0, sessionId: null, hasDiff: false, killedByControl: false, elapsedMs: 0,
    }));
    const control = new Control({ missionDeps: baseDeps(spawn) });
    const d = await control.tick();
    expect(d).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('populates live pid when mission runner reports it', async () => {
    setMaxAgents(1);
    const bf = seedBattlefield();
    seedQueuedMission('ctl-m-pid', bf);

    const holds: Array<() => void> = [];
    const spawn = vi.fn<MissionRunnerDeps['spawnAsset']>(async (opts) => {
      opts.onPid?.(9999);
      await new Promise<void>((res) => holds.push(res));
      return {
        exitCode: 0, stderr: '', stdoutResultSubtype: 'success', finalMessage: null,
        toolUseCount: 0, sessionId: null, hasDiff: true, killedByControl: false, elapsedMs: 1,
      };
    });
    const control = new Control({ missionDeps: baseDeps(spawn) });
    await control.tick();
    // Give spawn's onPid callback a tick to run.
    await new Promise((r) => setTimeout(r, 5));
    expect(control.live.get('ctl-m-pid')).toBe(9999);

    holds.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 10));
    expect(control.live.has('ctl-m-pid')).toBe(false);
  });
});
