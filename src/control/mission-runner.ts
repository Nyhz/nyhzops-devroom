import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import { getDatabase } from '@/lib/db';
import { missions, missionAttempts, battlefields } from '@/lib/db/schema';
import type { runGates, GateManifest, GateRunResults } from './gates';
import {
  classifyExit as defaultClassifyExit,
  type ExitContext,
  type Classification,
  type ClassifierDeps,
} from './exit-classifier';
import type {
  createMissionWorktree,
  resetWorktreeToHead,
  rebaseOntoTarget,
  autoCommitSweep,
  removeMissionWorktree,
} from './worktree';
import { decideNextAction, nextInfraBackoffMs, type RetryState } from './retry-policy';
import { emitComm } from './comms';

/**
 * Per-mission lifecycle state machine.
 *
 * Spec §5. Drives DEPLOYING → IN_COMBAT → (auto-sweep → gates → MERGING)
 * → ACCOMPLISHED / COMPROMISED, with a deterministic retry loop (up to 3
 * attempts), OVERSEER consult at attempt 4, plus classification-based
 * branches for TIMEOUT (reset + retry), INFRASTRUCTURE (free retry with
 * backoff), RATE_LIMIT (delayed retry), and AUTH (orchestrator-level pause).
 *
 * QUARTERMASTER conflict resolution and recon-specific behavior live in
 * later tasks; this runner accepts a pre-built mergeFn that may wrap QM.
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
  classifyExitFn: typeof defaultClassifyExit;
  worktree: WorktreeDeps;
  overseerConsult: (input: OverseerConsultInput) => Promise<OverseerVerdict>;
  mergeFn: (opts: MergeOpts) => Promise<MergeResult>;
  now: () => number;
  /** Invoked with pid once the subprocess is running; Control uses this to
   *  populate its live-pids map. */
  onPidAssigned?: (pid: number) => void;
  /** Fallback classifier used when fast-path classification returns
   *  NEEDS_COMMANDER. Optional — omission forces fast-path-only. */
  overseerClassifier?: ClassifierDeps['overseerClassify'];
  /** Sleep helper used for INFRA / RATE_LIMIT backoffs. Defaults to
   *  `setTimeout`-based wait; tests inject a no-op to stay fast. */
  sleep?: (ms: number) => Promise<void>;
  /** Max free INFRA retries before COMPROMISED. Default per spec = 4
   *  (30s → 2m → 10m → 30m → give up). */
  infraMaxRetries?: number;
  /** Backoff schedule for INFRA retries. Default [30s, 2m, 10m, 30m]. */
  infraBackoffMs?: number[];
  /** Delay for RATE_LIMIT retries (one free retry). Default 60s. */
  rateLimitBackoffMs?: number;
}

export interface RunMissionResult {
  missionId: string;
  finalStatus: 'accomplished' | 'compromised' | 'abandoned';
  attemptCount: number;
  classification?: Classification;
  gateResults?: GateRunResults;
  /** Set when final status = compromised because of an AUTH failure. */
  authPause?: boolean;
  /** Set when OVERSEER consult escalated. */
  overseerEscalation?: { question: string; options?: string[] };
}

type MissionRow = typeof missions.$inferSelect;
type BattlefieldRow = typeof battlefields.$inferSelect;

const DEFAULT_INFRA_BACKOFF = [30_000, 120_000, 600_000, 1_800_000];
const DEFAULT_RATE_LIMIT_BACKOFF = 60_000;
const DEFAULT_INFRA_MAX_RETRIES = 4;
const MAX_SORTIE_ATTEMPTS = 4; // 3 deterministic + 1 OVERSEER redirect

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

type EndReason =
  | 'clean'
  | 'timeout'
  | 'silence-kill'
  | 'infrastructure'
  | 'rate-limit'
  | 'auth'
  | 'turn-limit'
  | 'gate-failure';

function recordAttempt(opts: {
  missionId: string;
  attemptNumber: number;
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
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

function hashDiff(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function classificationToOutcome(cat: Classification['category']):
  | 'infrastructure'
  | 'rate-limit'
  | 'auth'
  | 'timeout'
  | 'turn-limit'
  | null {
  switch (cat) {
    case 'INFRASTRUCTURE':
    case 'AGENT_FAILURE':
      return 'infrastructure';
    case 'RATE_LIMIT':
      return 'rate-limit';
    case 'AUTH':
      return 'auth';
    case 'TIMEOUT':
      return 'timeout';
    case 'TURN_LIMIT':
      return 'turn-limit';
    default:
      return null;
  }
}

/**
 * Drive a mission through its lifecycle. Implements spec §5 retry loop:
 * deterministic retries 1–3, OVERSEER consult at attempt 4, plus
 * classification-specific branches for TIMEOUT, INFRASTRUCTURE, RATE_LIMIT,
 * and AUTH.
 */
export async function runMission(
  missionId: string,
  deps: MissionRunnerDeps,
): Promise<RunMissionResult> {
  const { mission, battlefield } = loadMission(missionId);

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms).unref?.(); }));
  const infraMax = deps.infraMaxRetries ?? DEFAULT_INFRA_MAX_RETRIES;
  const infraSchedule = deps.infraBackoffMs ?? DEFAULT_INFRA_BACKOFF;
  const rateLimitDelay = deps.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF;

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

  // Retry-loop state.
  let sortieAttempt = 0; // combat-asset spawns that count against 3-deterministic budget
  let infraRetryCount = 0;
  let overseerConsulted = false;
  let priorDiffHash: string | null = null;
  let lastDiffHash: string | null = null;
  let lastClassification: Classification | undefined;
  let lastGateResults: GateRunResults | undefined;
  let lastSessionId: string | null = mission.sessionId ?? null;
  let lastGateStderr = '';
  let redirectPrompt: string | null = null;

  const db = getDatabase();

  // Loop until we land on a terminal decision.
  // Safety cap to avoid runaway loops in pathological dep configurations.
  for (let guard = 0; guard < 20; guard++) {
    const attemptNumber = countAttempts(missionId) + 1;
    const isSortieAttempt = redirectPrompt !== null || sortieAttempt < MAX_SORTIE_ATTEMPTS;
    // Track whether this spawn uses the deterministic-retry prompt (sortie)
    const spawnStart = deps.now();

    const briefing = redirectPrompt ?? mission.briefing;
    let run: AssetRunResult;
    try {
      run = await deps.spawnAsset({
        missionId,
        worktreePath,
        briefing,
        assetCodename: 'OPERATIVE',
        sessionId: lastSessionId ?? undefined,
        onPid: (pid) => deps.onPidAssigned?.(pid),
      });
    } catch (err) {
      const endedAt = deps.now();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: 'infrastructure',
      });
      emitComm({
        missionId,
        message: `Spawn failed: ${(err as Error).message}`,
        level: 'error',
      });
      transitionMission(missionId, 'compromised', endedAt);
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
    const classification = await deps.classifyExitFn(exitCtx, { overseerClassify: deps.overseerClassifier });
    lastClassification = classification;
    lastSessionId = run.sessionId ?? lastSessionId;
    emitComm({
      missionId,
      message: `Exit classified: ${classification.category} — ${classification.reasoning}`,
    });

    // ---- AUTH: orchestrator pause, mission COMPROMISED ---------------------
    if (classification.category === 'AUTH') {
      const endedAt = deps.now();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: 'auth',
        classification,
        sessionId: run.sessionId,
      });
      emitComm({
        missionId,
        message: 'AUTH failure — claude CLI cannot authenticate. Orchestrator paused.',
        level: 'error',
      });
      transitionMission(missionId, 'compromised', endedAt);
      return {
        missionId,
        finalStatus: 'compromised',
        attemptCount: attemptNumber,
        classification,
        authPause: true,
      };
    }

    // ---- NEEDS_COMMANDER: fast fail ----------------------------------------
    if (classification.category === 'NEEDS_COMMANDER') {
      const endedAt = deps.now();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: 'infrastructure',
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

    // ---- INFRASTRUCTURE / RATE_LIMIT: free retries with backoff ------------
    if (classification.category === 'INFRASTRUCTURE' || classification.category === 'RATE_LIMIT') {
      const endedAt = deps.now();
      const isRate = classification.category === 'RATE_LIMIT';
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: isRate ? 'rate-limit' : 'infrastructure',
        classification,
        sessionId: run.sessionId,
      });

      if (infraRetryCount >= infraMax) {
        emitComm({
          missionId,
          message: `Infra retry budget exhausted after ${infraRetryCount} attempts.`,
          level: 'error',
        });
        transitionMission(missionId, 'compromised', endedAt);
        return {
          missionId,
          finalStatus: 'compromised',
          attemptCount: attemptNumber,
          classification,
        };
      }

      const delay = isRate
        ? rateLimitDelay
        : (nextInfraBackoffMs(infraRetryCount, infraSchedule) ?? 0);
      db.update(missions)
        .set({
          nextAttemptAt: endedAt + delay,
          infrastructureRetryCount: infraRetryCount + 1,
          updatedAt: endedAt,
        })
        .where(eq(missions.id, missionId))
        .run();
      emitComm({
        missionId,
        message: `${classification.category} — free retry in ${delay}ms (count=${infraRetryCount + 1}).`,
        level: 'warn',
      });
      infraRetryCount += 1;
      await sleep(delay);

      // Reset worktree, fresh session.
      try {
        await deps.worktree.reset(worktreePath);
      } catch (err) {
        emitComm({
          missionId,
          message: `Worktree reset failed: ${(err as Error).message}`,
          level: 'warn',
        });
      }
      lastSessionId = null;
      continue;
    }

    // ---- TIMEOUT: reset + deterministic retry (counts against budget) ------
    if (classification.category === 'TIMEOUT') {
      const endedAt = deps.now();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: run.killedByControl ? 'timeout' : 'silence-kill',
        classification,
        sessionId: run.sessionId,
      });
      sortieAttempt += 1;
      try {
        await deps.worktree.reset(worktreePath);
      } catch (err) {
        emitComm({
          missionId,
          message: `Worktree reset failed: ${(err as Error).message}`,
          level: 'warn',
        });
      }
      lastSessionId = null;

      const decision = decideNextAction({
        sortieAttempt,
        lastOutcome: 'timeout',
        lastDiffHash,
        priorDiffHash,
        overseerConsulted,
      });
      if (decision.action === 'COMPROMISED') {
        transitionMission(missionId, 'compromised', endedAt);
        return {
          missionId,
          finalStatus: 'compromised',
          attemptCount: attemptNumber,
          classification,
        };
      }
      if (decision.action === 'OVERSEER_CONSULT') {
        overseerConsulted = true;
        const verdict = await runOverseerConsult();
        if (verdict) {
          redirectPrompt = verdict;
          continue;
        }
        transitionMission(missionId, 'compromised', endedAt);
        return {
          missionId,
          finalStatus: 'compromised',
          attemptCount: attemptNumber,
          classification,
        };
      }
      redirectPrompt = null;
      continue;
    }

    // ---- CLEAN / TURN_LIMIT: auto-sweep → gates → merge --------------------
    if (classification.category !== 'CLEAN' && classification.category !== 'TURN_LIMIT') {
      // Defensive: should not reach here; classify fell through.
      const endedAt = deps.now();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: 'infrastructure',
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

    sortieAttempt += 1;

    // Auto-commit sweep.
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

    // Capture post-sweep diff hash for no-progress detection on retry-3.
    priorDiffHash = lastDiffHash;
    lastDiffHash = hashDiff(`${worktreePath}:${autoCommitted}:${run.elapsedMs}:${run.toolUseCount}`);

    const gateResults = await deps.runGatesFn({
      manifest: deps.gateManifest,
      workingDir: worktreePath,
      perCommandTimeoutMs: 300_000,
      suiteTimeoutMs: 900_000,
    });
    lastGateResults = gateResults;
    lastGateStderr = gateResults.results.map((r) => r.stderr).join('\n').trim();

    if (gateResults.overallStatus !== 'pass') {
      const endedAt = deps.now();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: 'gate-failure',
        classification,
        gateResults,
        sessionId: run.sessionId,
        autoCommitted,
      });
      emitComm({
        missionId,
        message: `Gates failed on attempt ${sortieAttempt}.`,
        level: 'warn',
      });

      const decision = decideNextAction({
        sortieAttempt,
        lastOutcome: 'gate-fail',
        lastDiffHash,
        priorDiffHash,
        overseerConsulted,
      });
      if (decision.action === 'DETERMINISTIC_RETRY') {
        // Build deterministic retry prompt — plain template for now.
        redirectPrompt = `Gates failed. Here is the stderr:\n\n${lastGateStderr}\n\nFix it.`;
        continue;
      }
      if (decision.action === 'OVERSEER_CONSULT') {
        overseerConsulted = true;
        const verdict = await runOverseerConsult();
        if (verdict) {
          redirectPrompt = verdict;
          continue;
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
      // COMPROMISED (budget exhausted after OVERSEER redirect failed)
      transitionMission(missionId, 'compromised', endedAt);
      return {
        missionId,
        finalStatus: 'compromised',
        attemptCount: attemptNumber,
        classification,
        gateResults,
      };
    }

    // Gates pass → MERGING.
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
        startedAt: spawnStart,
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
      startedAt: spawnStart,
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

  // Safety fallthrough — never expected.
  transitionMission(missionId, 'compromised', deps.now());
  return {
    missionId,
    finalStatus: 'compromised',
    attemptCount: countAttempts(missionId),
    classification: lastClassification,
    gateResults: lastGateResults,
  };

  // -------------------------------------------------------------------------
  // OVERSEER consult helper (closure over loop state).
  async function runOverseerConsult(): Promise<string | null> {
    try {
      const verdict = await deps.overseerConsult({
        missionId,
        briefing: mission.briefing,
        attemptHistory: [],
        lastGateStderr,
        finalDiff: lastDiffHash ?? '',
        claudeMdExcerpt: null,
      });
      emitComm({
        missionId,
        message: `OVERSEER verdict: ${verdict.verdict} — ${verdict.reasoning}`,
      });
      if (verdict.verdict === 'redirect' && verdict.redirect) {
        return verdict.redirect.newPrompt;
      }
      // escalate: mark the final result so caller can surface the question.
      // Fallthrough caller transitions COMPROMISED; we stash details by throwing
      // a tagged object would complicate types — instead attach via mission-level
      // note: we simply return null and the caller will compromise. Escalation
      // details are logged in the comms line above.
      return null;
    } catch (err) {
      emitComm({
        missionId,
        message: `OVERSEER consult failed: ${(err as Error).message}`,
        level: 'error',
      });
      return null;
    }
  }
}
