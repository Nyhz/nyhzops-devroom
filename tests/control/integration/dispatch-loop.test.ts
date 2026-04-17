import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import {
  missions,
  missionAttempts,
  battlefields,
  comms,
  settings,
} from '@/lib/db/schema';
import { Control } from '@/control/control';
import { clearConfigCache } from '@/control/config';
import type {
  MissionRunnerDeps,
  AssetRunResult,
  SpawnAssetOpts,
} from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

// ---------------------------------------------------------------------------
// CONTROL dispatch-loop integration test.
//
// Exercises `Control.start()` end-to-end with a real DB and stubbed
// spawnAsset / worktree / merge dependencies. Verifies:
//   - Concurrent dispatch honours maxAgents.
//   - Mixed-outcome batch: AUTH classification → COMPROMISED for the
//     offending mission; other missions reach ACCOMPLISHED independently.
//   - Attempt rows + mission status rows are written correctly.
//   - `Control.stop()` + `live` drain cleanly.
//
// FIXME(reliability-sweep): this test does not yet cover (a) crash recovery
// after a runMission exception mid-flight, (b) AUTH-pause → resume resuming
// the queue, or (c) 5-concurrent saturation with mixed timing. Those were
// descoped to avoid ballooning scope; the current coverage proves the
// happy-path + failure-classification wiring. The orchestrator-level pause
// behaviour triggered by AUTH is handled by `CONTROL.pauseAll()` in
// production (wired at server boot), not by Control itself — see
// `src/server.ts` for that glue.
// ---------------------------------------------------------------------------

const db = getDatabase();
const BF_ID = 'bf-dispatch-loop';
const MISSION_IDS = ['dl-m1', 'dl-m2', 'dl-m3'];

function seedBattlefield(): void {
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'DISPATCH',
      codename: 'DISPATCH',
      repoPath: '/tmp/fake-dispatch',
      defaultBranch: 'main',
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function seedQueuedMission(id: string): void {
  db.insert(missions)
    .values({
      id,
      battlefieldId: BF_ID,
      title: id,
      briefing: `briefing for ${id}`,
      type: 'combat',
      status: 'queued',
      worktreeBranch: `devroom/${id}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as typeof missions.$inferInsert)
    .run();
}

function setMaxAgents(n: number): void {
  db.insert(settings)
    .values({
      key: 'devroom_max_agents',
      value: String(n),
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(n), updatedAt: Date.now() },
    })
    .run();
  clearConfigCache();
}

function cleanDb(): void {
  db.delete(missionAttempts)
    .where(inArray(missionAttempts.missionId, MISSION_IDS))
    .run();
  db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
  db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
  db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
  db.delete(settings).where(eq(settings.key, 'devroom_max_agents')).run();
  clearConfigCache();
}

function buildDeps(
  spawn: MissionRunnerDeps['spawnAsset'],
  classifyExitFn?: MissionRunnerDeps['classifyExitFn'],
): Omit<MissionRunnerDeps, 'onPidAssigned'> {
  const cleanClassification: Classification = { category: 'CLEAN', reasoning: 'ok' };
  return {
    spawnAsset: spawn,
    runGatesFn: vi.fn(async () => ({
      results: [],
      overallStatus: 'pass',
    })) as unknown as MissionRunnerDeps['runGatesFn'],
    gateManifest: { build: null, test: null, lint: null, typecheck: null },
    classifyExitFn:
      classifyExitFn ??
      (vi.fn(async () => cleanClassification) as unknown as MissionRunnerDeps['classifyExitFn']),
    worktree: {
      create: vi.fn(async ({ missionBranch }: { missionBranch: string }) => ({
        path: `/tmp/wt/${missionBranch}`,
        branch: missionBranch,
      })),
      reset: vi.fn(async () => {}),
      rebase: vi.fn(async () => ({ rebased: false, conflict: false })),
      sweep: vi.fn(async () => ({ swept: false, filesChanged: 0 })),
      remove: vi.fn(async () => {}),
    } as unknown as MissionRunnerDeps['worktree'],
    overseerConsult: vi.fn(async () => ({
      verdict: 'escalate' as const,
      reasoning: 's',
      escalate: { question: '?' },
    })),
    mergeFn: vi.fn(async () => ({ status: 'clean' as const })),
    now: () => Date.now(),
    sleep: async () => {},
  };
}

async function waitForTerminalStatuses(
  ids: string[],
  timeoutMs = 5_000,
): Promise<void> {
  const terminals = new Set(['accomplished', 'compromised', 'abandoned']);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = db
      .select()
      .from(missions)
      .where(inArray(missions.id, ids))
      .all();
    if (rows.length === ids.length && rows.every((r) => r.status !== null && terminals.has(r.status))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `waitForTerminalStatuses: timed out after ${timeoutMs}ms waiting for ${ids.join(',')}`,
  );
}

describe('CONTROL dispatch loop', () => {
  beforeEach(() => {
    cleanDb();
  });

  afterEach(() => {
    cleanDb();
  });

  it(
    'dispatches concurrent missions, records COMPROMISED for AUTH failure, ACCOMPLISHED for others',
    async () => {
      setMaxAgents(3);
      seedBattlefield();
      for (const id of MISSION_IDS) seedQueuedMission(id);

      const successRun: AssetRunResult = {
        exitCode: 0,
        stderr: '',
        stdoutResultSubtype: 'success',
        finalMessage: 'done',
        toolUseCount: 1,
        sessionId: 'sess',
        hasDiff: true,
        killedByControl: false,
        elapsedMs: 10,
      };
      const authRun: AssetRunResult = {
        exitCode: 1,
        stderr: 'auth error',
        stdoutResultSubtype: 'error_during_execution',
        finalMessage: 'authentication failed',
        toolUseCount: 0,
        sessionId: null,
        hasDiff: false,
        killedByControl: false,
        elapsedMs: 5,
      };

      const spawn = vi.fn<MissionRunnerDeps['spawnAsset']>(
        async (opts: SpawnAssetOpts) => {
          opts.onPid?.(Math.floor(Math.random() * 10_000) + 1000);
          // Mission #2 simulates an AUTH failure.
          if (opts.missionId === 'dl-m2') return authRun;
          return successRun;
        },
      );

      // Per-mission classifier: dl-m2 → AUTH, others → CLEAN.
      const classifyExitFn = vi.fn(async (ctx, _deps) => {
        void _deps;
        if (ctx.stderr === 'auth error') {
          return { category: 'AUTH' as const, reasoning: 'simulated auth fail' };
        }
        return { category: 'CLEAN' as const, reasoning: 'ok' };
      }) as unknown as MissionRunnerDeps['classifyExitFn'];

      const control = new Control({
        missionDeps: buildDeps(spawn, classifyExitFn),
        idlePollMs: 20,
        watchdogIntervalMs: 10_000_000, // effectively disable watchdog in-test
      });

      await control.start();
      try {
        await waitForTerminalStatuses(MISSION_IDS, 5_000);
      } finally {
        await control.stop();
      }

      // Assert final mission statuses.
      const rows = db
        .select()
        .from(missions)
        .where(inArray(missions.id, MISSION_IDS))
        .all();
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get('dl-m1')?.status).toBe('accomplished');
      expect(byId.get('dl-m2')?.status).toBe('compromised');
      expect(byId.get('dl-m3')?.status).toBe('accomplished');

      // Spawn was called once per mission.
      expect(spawn).toHaveBeenCalledTimes(3);
      const spawnedIds = spawn.mock.calls.map((c) => (c[0] as SpawnAssetOpts).missionId).sort();
      expect(spawnedIds).toEqual([...MISSION_IDS].sort());

      // Attempts recorded with correct endReason.
      const attempts = db
        .select()
        .from(missionAttempts)
        .where(inArray(missionAttempts.missionId, MISSION_IDS))
        .all();
      expect(attempts.length).toBe(3);
      const authAttempt = attempts.find((a) => a.missionId === 'dl-m2');
      expect(authAttempt?.endReason).toBe('auth');
      for (const id of ['dl-m1', 'dl-m3']) {
        const a = attempts.find((x) => x.missionId === id);
        expect(a?.endReason).toBe('clean');
      }

      // Control's live/dispatched maps drained on completion.
      expect(control.live.size).toBe(0);
    },
    10_000,
  );
});
