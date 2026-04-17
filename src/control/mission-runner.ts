import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import simpleGit from 'simple-git';
import { createHash } from 'node:crypto';
import { getDatabase } from '@/lib/db';
import { missions, missionAttempts, battlefields, followUpSuggestions } from '@/lib/db/schema';
import { extractNextActions } from '@/lib/utils/debrief-parser';
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
import { decideNextAction, nextInfraBackoffMs } from './retry-policy';
import { emitComm, emitMissionStatus, formatCommsEvent } from './comms';

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
  /** Parsed stream-json event callback — used by the runner to format each
   *  event into a human-readable comm. If omitted, only status transitions
   *  and final exit classification are visible in the mission's COMMS feed. */
  onCommsEvent?: (ev: import('./spawn-asset').StreamJsonEvent) => void;
  /** Runtime override for the L3 stdout-silence watchdog (milliseconds).
   *  Recon uses this to raise the threshold per spec §7 step 5. */
  stdoutSilenceMs?: number;
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
  /** SHA of the target branch captured when the mission's worktree was
   *  created. Used by runMerge to detect whether target advanced during
   *  the mission — if it did, the worktree is rebased onto the new target
   *  before the final fast-forward merge. Must be captured at worktree
   *  creation, not at merge time, or the advance-detection check is a
   *  no-op and parallel missions produce "cannot fast-forward" errors. */
  targetHeadAtStart: string;
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
  const row = db.select().from(missions).where(eq(missions.id, missionId)).get();
  emitMissionStatus(missionId, status, {
    campaignId: row?.campaignId ?? null,
    compromiseReason: row?.compromiseReason ?? null,
  });
  emitComm({
    missionId,
    campaignId: row?.campaignId ?? undefined,
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

/**
 * Parse "## Recommended Next Actions" bullets from a mission debrief and
 * persist each as a follow-up suggestion. Surfaced on the mission detail
 * page and can be promoted to intel notes from the UI.
 */
function persistFollowUps(opts: {
  debrief: string;
  missionId: string;
  campaignId: string | null;
  battlefieldId: string;
}): void {
  const actions = extractNextActions(opts.debrief);
  if (actions.length === 0) return;
  const db = getDatabase();
  const now = Date.now();
  for (const suggestion of actions) {
    db.insert(followUpSuggestions)
      .values({
        id: ulid(),
        battlefieldId: opts.battlefieldId,
        missionId: opts.missionId,
        campaignId: opts.campaignId,
        suggestion,
        status: 'pending',
        intelNoteId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

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
  usage?: { input: number; output: number; cache: number };
  finalMessage?: string | null;
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
      tokensInput: opts.usage?.input ?? 0,
      tokensOutput: opts.usage?.output ?? 0,
      tokensCache: opts.usage?.cache ?? 0,
      debriefSynthesized: opts.finalMessage ? 1 : 0,
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
  const targetBranch = battlefield.defaultBranch ?? 'main';
  let worktreePath: string;
  let targetHeadAtStart = '';
  try {
    const wt = await deps.worktree.create({
      repoPath: battlefield.repoPath,
      targetBranch,
      missionBranch: branch,
    });
    worktreePath = wt.path;
    // Persist the branch name on the mission row so later operations
    // (acceptAndMerge, recovery, inspection) can find the worktree branch
    // without reconstructing it from convention.
    if (!mission.worktreeBranch) {
      getDatabase()
        .update(missions)
        .set({ worktreeBranch: branch, updatedAt: deps.now() })
        .where(eq(missions.id, missionId))
        .run();
    }
    await deps.worktree.rebase(worktreePath, targetBranch);
    // Capture target HEAD AFTER the initial rebase so runMerge can detect
    // whether target advanced during the mission. Captured at merge time
    // instead would always equal currentTarget → advance-detection no-op →
    // parallel missions fail with "cannot fast-forward".
    try {
      targetHeadAtStart = (await simpleGit(battlefield.repoPath).revparse([targetBranch])).trim();
    } catch {
      targetHeadAtStart = '';
    }
  } catch (err) {
    transitionMission(missionId, 'compromised', deps.now());
    emitComm({
      missionId,
      message: `Deployment failed: ${(err as Error).message}`,
      level: 'error',
    });
    return { missionId, finalStatus: 'compromised', attemptCount: 0 };
  }

  // Retry-loop state — declared outside the try block below so the
  // runOverseerConsult closure (declared at the end of runMission) can
  // still capture them.
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

  // Worktree is live from here on — wrap the remainder in try/finally so
  // cleanup always runs, whether the mission ACCOMPLISHED, COMPROMISED, or
  // the loop threw unexpectedly. The watchdog sweep is still the
  // belt-and-suspenders backstop, but the happy path must not depend on it.
  try {
  // --- IN_COMBAT -----------------------------------------------------------
  transitionMission(missionId, 'in_combat', deps.now());

  // Loop until we land on a terminal decision.
  // Safety cap to avoid runaway loops in pathological dep configurations.
  for (let guard = 0; guard < 20; guard++) {
    const attemptNumber = countAttempts(missionId) + 1;
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
        onCommsEvent: (ev) => {
          const message = formatCommsEvent(ev);
          if (message) {
            emitComm({ missionId, actor: 'OPERATIVE', message });
          }
        },
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
        usage: run.usage,
        finalMessage: run.finalMessage,
      });
      emitComm({
        missionId,
        message: 'AUTH failure — claude CLI cannot authenticate. Orchestrator paused.',
        level: 'error',
      });
      transitionMission(missionId, 'compromised', endedAt);

      // Notify Commander via Telegram (fire-and-forget; failure must not break CONTROL).
      import('@/lib/telegram/notifier')
        .then(({ notifyAuthPause }) => notifyAuthPause())
        .catch((err) => console.error('[CONTROL] notifyAuthPause failed:', err));

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
        usage: run.usage,
        finalMessage: run.finalMessage,
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
        usage: run.usage,
        finalMessage: run.finalMessage,
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
        usage: run.usage,
        finalMessage: run.finalMessage,
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
        // Snapshot pre-consult classification and finalMessage so that if the
        // consult throws (DB error, subprocess crash), we can still record an
        // attempt annotated with the original classification — not null, not
        // a generic "consult failed" that erases what actually happened.
        const preConsultClassification = classification;
        const preConsultFinalMessage = run.finalMessage;
        let verdict: string | null;
        try {
          verdict = await runOverseerConsult();
        } catch (err) {
          const consultFailedAt = deps.now();
          const errMsg = (err as Error).message;
          emitComm({
            missionId,
            message: `OVERSEER consult failed: ${errMsg}`,
            level: 'error',
          });
          recordAttempt({
            missionId,
            attemptNumber: countAttempts(missionId) + 1,
            startedAt: endedAt,
            endedAt: consultFailedAt,
            endReason: run.killedByControl ? 'timeout' : 'silence-kill',
            classification: preConsultClassification,
            sessionId: run.sessionId,
            usage: run.usage,
            finalMessage: `${preConsultFinalMessage ?? ''}\n(consult failed: ${errMsg})`.trim(),
          });
          transitionMission(missionId, 'compromised', consultFailedAt);
          return {
            missionId,
            finalStatus: 'compromised',
            attemptCount: countAttempts(missionId),
            classification: preConsultClassification,
          };
        }
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
        usage: run.usage,
        finalMessage: run.finalMessage,
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
        usage: run.usage,
        finalMessage: run.finalMessage,
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
        // Snapshot pre-consult classification and finalMessage so that if the
        // consult throws (DB error, subprocess crash), we can still record an
        // attempt annotated with the original classification — not null, not
        // a generic "consult failed" that erases what actually happened.
        const preConsultClassification = classification;
        const preConsultFinalMessage = run.finalMessage;
        let verdict: string | null;
        try {
          verdict = await runOverseerConsult();
        } catch (err) {
          const consultFailedAt = deps.now();
          const errMsg = (err as Error).message;
          emitComm({
            missionId,
            message: `OVERSEER consult failed: ${errMsg}`,
            level: 'error',
          });
          recordAttempt({
            missionId,
            attemptNumber: countAttempts(missionId) + 1,
            startedAt: endedAt,
            endedAt: consultFailedAt,
            endReason: 'gate-failure',
            classification: preConsultClassification,
            gateResults,
            sessionId: run.sessionId,
            autoCommitted,
            usage: run.usage,
            finalMessage: `${preConsultFinalMessage ?? ''}\n(consult failed: ${errMsg})`.trim(),
          });
          transitionMission(missionId, 'compromised', consultFailedAt);
          return {
            missionId,
            finalStatus: 'compromised',
            attemptCount: countAttempts(missionId),
            classification: preConsultClassification,
            gateResults,
          };
        }
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
        targetBranch,
        sourceBranch: branch,
        worktreePath,
        targetHeadAtStart,
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
        usage: run.usage,
        finalMessage: run.finalMessage,
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
      usage: run.usage,
      finalMessage: run.finalMessage,
    });

    if (merge.status === 'clean' || merge.status === 'conflict_resolved') {
      // Persist the asset's final message as the mission debrief, plus token
      // usage, before flipping status. Phase + campaign debriefs compose
      // `totalTokens` from missions.cost_* columns; mission detail + logistics
      // pages read the same. Without this write the UI shows Tokens: 0 and
      // "(no debrief)" even for successful missions.
      const dbForMission = getDatabase();
      dbForMission
        .update(missions)
        .set({
          ...(run.finalMessage ? { debrief: run.finalMessage } : {}),
          costInput: run.usage?.input ?? 0,
          costOutput: run.usage?.output ?? 0,
          costCacheHit: run.usage?.cache ?? 0,
          updatedAt: endedAt,
        })
        .where(eq(missions.id, missionId))
        .run();
      // Extract "Recommended Next Actions" bullets from the debrief and
      // persist them as follow-up suggestions (surfaced on the mission page
      // and the intel board "Add as note" prompts).
      if (run.finalMessage) {
        persistFollowUps({
          debrief: run.finalMessage,
          missionId,
          campaignId: mission.campaignId ?? null,
          battlefieldId: mission.battlefieldId,
        });
      }
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
  } finally {
    // Best-effort worktree cleanup — never rethrow. The watchdog sweep
    // handles any leaks this misses.
    try {
      // Keep the branch for Commander inspection — the worktree directory is
      // what leaks onto disk. Watchdog sweep handles branch cleanup later.
      await deps.worktree.remove({
        repoPath: battlefield.repoPath,
        worktreePath,
        branch,
        deleteBranch: false,
      });
    } catch (err) {
      console.error('[CONTROL] worktree cleanup failed for', missionId, err);
    }
  }

  // -------------------------------------------------------------------------
  // OVERSEER consult helper (closure over loop state).
  async function runOverseerConsult(): Promise<string | null> {
    // Note: this deliberately does NOT catch errors. Call sites capture the
    // pre-consult classification/finalMessage before awaiting and record a
    // consult-phase attempt annotated with the consult error when this throws.
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
    // escalate: caller transitions COMPROMISED. Escalation details are logged
    // in the comms line above.
    return null;
  }
}
