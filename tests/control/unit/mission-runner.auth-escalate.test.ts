import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import {
  missions,
  battlefields,
  missionAttempts,
  comms,
  notifications,
} from '@/lib/db/schema';
import {
  runMission,
  type MissionRunnerDeps,
  type AssetRunResult,
} from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

// Unique battlefield id for this test file — avoids cross-file collisions
// when tests share the DB.
const BF_ID = 'bf-mr-auth-escalate';
const MISSION_IDS = ['mr-auth-ctx', 'mr-auth-await'];

const db = getDatabase();

function seedBattlefield(id = BF_ID): string {
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

function seedMission(id: string, battlefieldId: string): string {
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

function makeAuthDeps(overrides: Partial<MissionRunnerDeps> = {}): MissionRunnerDeps {
  const authClassification: Classification = {
    category: 'AUTH',
    reasoning: 'auth denied',
  };
  const authRun: AssetRunResult = {
    exitCode: 1,
    stderr: 'auth error',
    stdoutResultSubtype: 'error',
    finalMessage: 'OAuth token expired',
    toolUseCount: 0,
    sessionId: 'sess-auth',
    hasDiff: false,
    killedByControl: false,
    elapsedMs: 100,
  };
  return {
    spawnAsset: vi.fn(async () => authRun),
    runGatesFn: vi.fn(async () => ({ results: [], overallStatus: 'pass' })) as unknown as MissionRunnerDeps['runGatesFn'],
    gateManifest: { build: null, test: null, lint: null, typecheck: null },
    classifyExitFn: vi.fn(async () => authClassification) as unknown as MissionRunnerDeps['classifyExitFn'],
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
      reasoning: 'stub',
      escalate: { question: '?' },
    })),
    mergeFn: vi.fn(async () => ({ status: 'clean' })) as unknown as MissionRunnerDeps['mergeFn'],
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('runMission — AUTH escalation', () => {
  beforeEach(() => {
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, MISSION_IDS)).run();
    db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
    db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
    // Clear any prior notifications tied to this test's missions so the
    // assertions below start from a clean slate.
    for (const id of MISSION_IDS) {
      db.delete(notifications).where(eq(notifications.entityId, id)).run();
    }
    // Belt-and-braces: telegramEnabled() must be false so escalate skips
    // the Telegram network branch. The test env does not set this var,
    // but be explicit in case a dev runs with it exported.
    delete process.env.DEVROOM_TELEGRAM_ENABLED;
  });

  it('AUTH classification persists a notification tied to the mission', async () => {
    const bf = seedBattlefield();
    seedMission('mr-auth-ctx', bf);
    const deps = makeAuthDeps();

    const result = await runMission('mr-auth-ctx', deps);

    expect(result.finalStatus).toBe('compromised');
    expect(result.authPause).toBe(true);
    expect(result.classification?.category).toBe('AUTH');

    const rows = db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, 'mr-auth-ctx'))
      .all();
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.entityType).toBe('mission');
    expect(row.entityId).toBe('mr-auth-ctx');
    expect(row.battlefieldId).toBe(BF_ID);
    expect(row.level).toBe('critical');
    expect(row.title).toMatch(/AUTH FAILURE/);
    // finalMessage snippet should be threaded through as the trigger line.
    expect(row.detail).toContain('OAuth token expired');
  });

  it('awaits notification persistence before returning from runMission', async () => {
    const bf = seedBattlefield();
    seedMission('mr-auth-await', bf);

    // Wrap the classifyExit result so the AUTH branch fires, then use a
    // spy on notifications to enforce ordering. We rely on escalate's real
    // DB insert: as long as runMission awaits notifyAuthPause, the row
    // MUST exist by the time runMission's Promise resolves. If the old
    // fire-and-forget path survived, the row would only appear after a
    // microtask tick.
    const deps = makeAuthDeps();

    // Patch classifyExitFn to insert a 20ms artificial delay INSIDE the
    // async boundary the AUTH branch crosses — ensures the test cannot
    // pass by luck on a fast machine if runMission ever stops awaiting.
    const origClassify = deps.classifyExitFn;
    deps.classifyExitFn = (async (ctx, o) => {
      const r = await origClassify(ctx, o);
      await new Promise<void>((res) => {
        setTimeout(res, 20).unref?.();
      });
      return r;
    }) as MissionRunnerDeps['classifyExitFn'];

    await runMission('mr-auth-await', deps);

    // Immediately after the await resolves, the notification row MUST
    // already be in the DB. No setTimeout, no microtask drain.
    const rows = db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, 'mr-auth-await'))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].level).toBe('critical');
    expect(rows[0].entityType).toBe('mission');
    expect(rows[0].battlefieldId).toBe(BF_ID);
  });
});
