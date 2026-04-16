import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDatabase } from '@/lib/db';
import { missions, missionAttempts, battlefields } from '@/lib/db/schema';
import type { runGates, GateManifest, GateRunResults } from './gates';
import type { classifyExit, ExitContext, Classification } from './exit-classifier';
import type {
  createMissionWorktree,
  resetWorktreeToHead,
  rebaseOntoTarget,
  autoCommitSweep,
  removeMissionWorktree,
} from './worktree';
import { emitComm } from './comms';

/**
 * Per-mission lifecycle state machine — Task 2.10 scaffold.
 *
 * The full state machine (retry policy, OVERSEER consults, QUARTERMASTER merge
 * conflict path, recon-specific behavior) is filled in by later tasks. This
 * scaffold wires the collaborators together and drives the happy-path
 * transitions DEPLOYING → IN_COMBAT → MERGING → ACCOMPLISHED so that
 * `control.ts` can hand missions off and the state machine can be unit tested
 * with mocked subprocess collaborators.
 */

export interface SpawnAssetOpts {
  missionId: string;
  worktreePath: string;
  sessionId?: string;
  briefing: string;
  assetCodename: string;
  onPid?: (pid: number) => void;
  onStdoutLine?: (line: string) => void;
}

export interface AssetRunResult {
  exitCode: number | null;
  stderr: string;
  stdoutResultSubtype: 'success' | 'error_max_turns' | 'error_during_execution' | null;
  finalMessage: string | null;
  toolUseCount: number;
  sessionId: string | null;
  hasDiff: boolean;
  killedByControl: boolean;
  pid?: number;
  elapsedMs: number;
  usage?: { input: number; output: number; cache: number };
}

export interface OverseerConsultInput {
  missionId: string;
  briefing: string;
  attemptHistory: unknown[];
  lastGateStderr: string;
  finalDiff: string;
  claudeMdExcerpt: string | null;
}

export interface OverseerVerdict {
  verdict: 'redirect' | 'escalate';
  reasoning: string;
  redirect?: { newPrompt: string; focusHint: string };
  escalate?: { question: string; options?: string[] };
}

export interface MergeOpts {
  missionId: string;
  repoPath: string;
  targetBranch: string;
  sourceBranch: string;
  worktreePath: string;
}

export interface MergeResult {
  status: 'clean' | 'conflict_resolved' | 'failed';
  reason?: string;
}

export interface WorktreeDeps {
  create: typeof createMissionWorktree;
  reset: typeof resetWorktreeToHead;
  rebase: typeof rebaseOntoTarget;
  sweep: typeof autoCommitSweep;
  remove: typeof removeMissionWorktree;
}

export interface MissionRunnerDeps {
  spawnAsset: (opts: SpawnAssetOpts) => Promise<AssetRunResult>;
  runGatesFn: typeof runGates;
  gateManifest: GateManifest;
  classifyExitFn: typeof classifyExit;
  worktree: WorktreeDeps;
  overseerConsult: (input: OverseerConsultInput) => Promise<OverseerVerdict>;
  mergeFn: (opts: MergeOpts) => Promise<MergeResult>;
  now: () => number;
  /** Invoked with pid once the subprocess is running; Control uses this to
   *  populate its live-pids map. */
  onPidAssigned?: (pid: number) => void;
}

export interface RunMissionResult {
  missionId: string;
  finalStatus: 'accomplished' | 'compromised' | 'abandoned';
  attemptCount: number;
  // Stubs — populated in later tasks.
  classification?: Classification;
  gateResults?: GateRunResults;
}

type MissionRow = typeof missions.$inferSelect;
type BattlefieldRow = typeof battlefields.$inferSelect;

function loadMission(missionId: string): { mission: MissionRow; battlefield: BattlefieldRow } {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) throw new Error(`mission-runner: mission ${missionId} not found`);
  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId))
    .get();
  if (!bf) throw new Error(`mission-runner: battlefield ${mission.battlefieldId} not found`);
  return { mission, battlefield: bf };
}

function transitionMission(missionId: string, status: string, now: number): void {
  const db = getDatabase();
  db.update(missions)
    .set({ status, updatedAt: now })
    .where(eq(missions.id, missionId))
    .run();
  emitComm({
    missionId,
    message: `Status → ${status.toUpperCase()}`,
  });
}

function recordAttempt(opts: {
  missionId: string;
  attemptNumber: number;
  startedAt: number;
  endedAt: number;
  endReason: 'clean' | 'timeout' | 'silence-kill' | 'infrastructure' | 'rate-limit' | 'auth' | 'turn-limit' | 'gate-failure';
  classification?: Classification;
  gateResults?: GateRunResults;
  sessionId?: string | null;
  targetHeadAtStart?: string | null;
  autoCommitted?: boolean;
}): string {
  const db = getDatabase();
  const id = ulid();
  db.insert(missionAttempts)
    .values({
      id,
      missionId: opts.missionId,
      attemptNumber: opts.attemptNumber,
      startedAt: opts.startedAt,
      endedAt: opts.endedAt,
      endReason: opts.endReason,
      classification: opts.classification ? JSON.stringify(opts.classification) : null,
      gateResults: opts.gateResults ? JSON.stringify(opts.gateResults) : null,
      autoCommitted: opts.autoCommitted ? 1 : 0,
      sessionId: opts.sessionId ?? null,
      targetHeadAtStart: opts.targetHeadAtStart ?? null,
      durationMs: opts.endedAt - opts.startedAt,
    } as typeof missionAttempts.$inferInsert)
    .run();
  return id;
}

function countAttempts(missionId: string): number {
  const db = getDatabase();
  return db
    .select()
    .from(missionAttempts)
    .where(eq(missionAttempts.missionId, missionId))
    .all().length;
}

/**
 * Drive a mission through its lifecycle. This is the scaffold implementation —
 * a single attempt, no retry policy, no OVERSEER consult, no QUARTERMASTER.
 * Later tasks expand `runAttempt`, add retry branches, and wire prompt-builder.
 */
export async function runMission(
  missionId: string,
  deps: MissionRunnerDeps,
): Promise<RunMissionResult> {
  const { mission, battlefield } = loadMission(missionId);

  // --- DEPLOYING -----------------------------------------------------------
  transitionMission(missionId, 'deploying', deps.now());

  const branch = mission.worktreeBranch ?? `devroom/${missionId}`;
  let worktreePath: string;
  try {
    const wt = await deps.worktree.create({
      repoPath: battlefield.repoPath,
      targetBranch: battlefield.defaultBranch ?? 'main',
      missionBranch: branch,
    });
    worktreePath = wt.path;
    await deps.worktree.rebase(worktreePath, battlefield.defaultBranch ?? 'main');
  } catch (err) {
    transitionMission(missionId, 'compromised', deps.now());
    emitComm({
      missionId,
      message: `Deployment failed: ${(err as Error).message}`,
      level: 'error',
    });
    return { missionId, finalStatus: 'compromised', attemptCount: 0 };
  }

  // --- IN_COMBAT -----------------------------------------------------------
  transitionMission(missionId, 'in_combat', deps.now());

  const attemptNumber = countAttempts(missionId) + 1;
  const attemptStart = deps.now();

  let run: AssetRunResult;
  try {
    run = await deps.spawnAsset({
      missionId,
      worktreePath,
      briefing: mission.briefing,
      assetCodename: 'OPERATIVE',
      sessionId: mission.sessionId ?? undefined,
      onPid: (pid) => deps.onPidAssigned?.(pid),
    });
  } catch (err) {
    const endedAt = deps.now();
    recordAttempt({
      missionId,
      attemptNumber,
      startedAt: attemptStart,
      endedAt,
      endReason: 'infrastructure',
    });
    transitionMission(missionId, 'compromised', endedAt);
    emitComm({
      missionId,
      message: `Spawn failed: ${(err as Error).message}`,
      level: 'error',
    });
    return { missionId, finalStatus: 'compromised', attemptCount: attemptNumber };
  }

  const exitCtx: ExitContext = {
    exitCode: run.exitCode,
    stderr: run.stderr,
    stdoutResultSubtype: run.stdoutResultSubtype,
    killedByControl: run.killedByControl,
    elapsedMs: run.elapsedMs,
    toolUseCount: run.toolUseCount,
    hasDiff: run.hasDiff,
  };
  const classification = await deps.classifyExitFn(exitCtx);
  emitComm({
    missionId,
    message: `Exit classified: ${classification.category} — ${classification.reasoning}`,
  });

  // --- Scaffold: handle CLEAN / TURN_LIMIT happy path; everything else is
  //     COMPROMISED for now. Later tasks introduce retry policy, INFRA backoff,
  //     RATE_LIMIT delay, AUTH pause, OVERSEER consult, etc.
  if (classification.category !== 'CLEAN' && classification.category !== 'TURN_LIMIT') {
    const endedAt = deps.now();
    recordAttempt({
      missionId,
      attemptNumber,
      startedAt: attemptStart,
      endedAt,
      endReason: classification.category === 'TIMEOUT' ? 'timeout' : 'infrastructure',
      classification,
      sessionId: run.sessionId,
    });
    transitionMission(missionId, 'compromised', endedAt);
    return {
      missionId,
      finalStatus: 'compromised',
      attemptCount: attemptNumber,
      classification,
    };
  }

  // Auto-commit sweep (combat) — combat only; recon handled in later tasks.
  let autoCommitted = false;
  try {
    const sweep = await deps.worktree.sweep(worktreePath, missionId);
    autoCommitted = sweep.swept;
    if (sweep.swept) {
      emitComm({
        missionId,
        message: `Auto-commit: ${sweep.filesChanged} files swept (agent did not commit).`,
      });
    }
  } catch (err) {
    emitComm({
      missionId,
      message: `Auto-commit sweep failed: ${(err as Error).message}`,
      level: 'warn',
    });
  }

  // Run gates.
  const gateResults = await deps.runGatesFn({
    manifest: deps.gateManifest,
    workingDir: worktreePath,
    perCommandTimeoutMs: 300_000,
    suiteTimeoutMs: 900_000,
  });

  if (gateResults.overallStatus !== 'pass') {
    const endedAt = deps.now();
    recordAttempt({
      missionId,
      attemptNumber,
      startedAt: attemptStart,
      endedAt,
      endReason: 'gate-failure',
      classification,
      gateResults,
      sessionId: run.sessionId,
      autoCommitted,
    });
    // Scaffold: any gate failure → COMPROMISED. Retry policy + OVERSEER
    // consult are wired in later tasks via `deps.overseerConsult`.
    transitionMission(missionId, 'compromised', endedAt);
    return {
      missionId,
      finalStatus: 'compromised',
      attemptCount: attemptNumber,
      classification,
      gateResults,
    };
  }

  // Gates pass → MERGING → merge via deps.mergeFn → ACCOMPLISHED/COMPROMISED.
  transitionMission(missionId, 'merging', deps.now());

  let merge: MergeResult;
  try {
    merge = await deps.mergeFn({
      missionId,
      repoPath: battlefield.repoPath,
      targetBranch: battlefield.defaultBranch ?? 'main',
      sourceBranch: branch,
      worktreePath,
    });
  } catch (err) {
    const endedAt = deps.now();
    recordAttempt({
      missionId,
      attemptNumber,
      startedAt: attemptStart,
      endedAt,
      endReason: 'clean',
      classification,
      gateResults,
      sessionId: run.sessionId,
      autoCommitted,
    });
    transitionMission(missionId, 'compromised', endedAt);
    emitComm({
      missionId,
      message: `Merge failed: ${(err as Error).message}`,
      level: 'error',
    });
    return {
      missionId,
      finalStatus: 'compromised',
      attemptCount: attemptNumber,
      classification,
      gateResults,
    };
  }

  const endedAt = deps.now();
  recordAttempt({
    missionId,
    attemptNumber,
    startedAt: attemptStart,
    endedAt,
    endReason: 'clean',
    classification,
    gateResults,
    sessionId: run.sessionId,
    autoCommitted,
  });

  if (merge.status === 'clean' || merge.status === 'conflict_resolved') {
    transitionMission(missionId, 'accomplished', endedAt);
    return {
      missionId,
      finalStatus: 'accomplished',
      attemptCount: attemptNumber,
      classification,
      gateResults,
    };
  }

  transitionMission(missionId, 'compromised', endedAt);
  return {
    missionId,
    finalStatus: 'compromised',
    attemptCount: attemptNumber,
    classification,
    gateResults,
  };
}
