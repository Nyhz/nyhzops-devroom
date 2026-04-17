import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, missionAttempts, comms } from '@/lib/db/schema';
import { runMission, type MissionRunnerDeps, type AssetRunResult } from '@/control/mission-runner';
import type { Classification } from '@/control/exit-classifier';

// Unique battlefield/mission ids for this file.
const BF_ID = 'bf-mr-ov-throw';
const MISSION_IDS = ['mr-ov-throw-gate', 'mr-ov-throw-timeout'];

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
    finalMessage: 'agent said hello',
    toolUseCount: 3,
    sessionId: 'sess-1',
    hasDiff: true,
    killedByControl: false,
    elapsedMs: 1000,
  };
  return {
    spawnAsset: vi.fn(async () => successRun),
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
    sleep: async () => {},
    ...overrides,
  };
}

describe('runMission — overseer consult throw preserves classification', () => {
  beforeEach(() => {
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, MISSION_IDS)).run();
    db.delete(comms).where(inArray(comms.missionId, MISSION_IDS)).run();
    db.delete(missions).where(inArray(missions.id, MISSION_IDS)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
  });

  it('gate-failure path: consult throw records attempt with pre-consult classification + annotated finalMessage', async () => {
    const bf = seedBattlefield();
    seedMission('mr-ov-throw-gate', bf);

    const preConsultClassification: Classification = {
      category: 'CLEAN',
      reasoning: 'agent exited cleanly but gates rejected output',
    };

    const gateFail = {
      results: [{ gate: 'test', status: 'fail' as const, stdout: '', stderr: 'boom', durationMs: 1 }],
      overallStatus: 'fail' as const,
    };

    const deps = makeDeps({
      classifyExitFn: vi.fn(async () => preConsultClassification) as unknown as MissionRunnerDeps['classifyExitFn'],
      runGatesFn: vi.fn(async () => gateFail) as unknown as MissionRunnerDeps['runGatesFn'],
      // Same diff across attempts → OVERSEER_CONSULT is triggered at attempt 2.
      worktree: {
        create: vi.fn(async ({ missionBranch }) => ({ path: `/tmp/wt/${missionBranch}`, branch: missionBranch })),
        reset: vi.fn(async () => {}),
        rebase: vi.fn(async () => ({ rebased: false, conflict: false })),
        sweep: vi.fn(async () => ({ swept: false, filesChanged: 0 })),
        remove: vi.fn(async () => {}),
      } as unknown as MissionRunnerDeps['worktree'],
      overseerConsult: vi.fn(async () => {
        throw new Error('overseer DB exploded');
      }),
    });

    const res = await runMission('mr-ov-throw-gate', deps);

    expect(res.finalStatus).toBe('compromised');

    const mission = db.select().from(missions).where(eq(missions.id, 'mr-ov-throw-gate')).get();
    expect(mission?.status).toBe('compromised');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, 'mr-ov-throw-gate'))
      .all();

    // Two gate-failure attempts (1, 2) plus a distinct consult-phase record
    // written in the consult-throw catch. Without the fix there are only
    // two rows and no explicit consult-phase audit.
    expect(attempts.length).toBe(3);
    const consultAttempt = attempts[attempts.length - 1];
    expect(consultAttempt.classification).not.toBeNull();
    const parsed = JSON.parse(consultAttempt.classification as string) as Classification;
    expect(parsed.category).toBe('CLEAN');
    expect(parsed.reasoning).toBe('agent exited cleanly but gates rejected output');
    // debriefSynthesized flips to 1 when the consult-failed annotated
    // finalMessage is recorded.
    expect(consultAttempt.debriefSynthesized).toBe(1);

    // The consult error text is surfaced in comms for Commander visibility.
    const commsRows = db
      .select()
      .from(comms)
      .where(eq(comms.missionId, 'mr-ov-throw-gate'))
      .all();
    const consultMsg = commsRows.find((c) => /consult failed/i.test(c.message));
    expect(consultMsg).toBeTruthy();
    expect(consultMsg?.message).toContain('overseer DB exploded');
  });

  it('timeout path: consult throw records attempt with pre-consult TIMEOUT classification', async () => {
    const bf = seedBattlefield();
    seedMission('mr-ov-throw-timeout', bf);

    const timeoutClassification: Classification = {
      category: 'TIMEOUT',
      reasoning: 'silence-kill at L3',
    };

    const timeoutRun: AssetRunResult = {
      exitCode: null,
      stderr: '',
      stdoutResultSubtype: null,
      finalMessage: null,
      toolUseCount: 0,
      sessionId: 'sess-t',
      hasDiff: false,
      killedByControl: true,
      elapsedMs: 1000,
    };

    const deps = makeDeps({
      spawnAsset: vi.fn(async () => timeoutRun),
      classifyExitFn: vi.fn(async () => timeoutClassification) as unknown as MissionRunnerDeps['classifyExitFn'],
      overseerConsult: vi.fn(async () => {
        throw new Error('overseer subprocess crashed');
      }),
    });

    const res = await runMission('mr-ov-throw-timeout', deps);

    expect(res.finalStatus).toBe('compromised');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, 'mr-ov-throw-timeout'))
      .all();

    // Two timeout attempts (1, 2) plus the consult-phase record.
    expect(attempts.length).toBe(3);
    const consultAttempt = attempts[attempts.length - 1];
    expect(consultAttempt.classification).not.toBeNull();
    const parsed = JSON.parse(consultAttempt.classification as string) as Classification;
    expect(parsed.category).toBe('TIMEOUT');
    expect(parsed.reasoning).toBe('silence-kill at L3');
    expect(consultAttempt.debriefSynthesized).toBe(1);

    const commsRows = db
      .select()
      .from(comms)
      .where(eq(comms.missionId, 'mr-ov-throw-timeout'))
      .all();
    const consultMsg = commsRows.find((c) => /consult failed/i.test(c.message));
    expect(consultMsg?.message).toContain('overseer subprocess crashed');
  });
});
