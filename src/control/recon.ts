import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import simpleGit, { type SimpleGit } from 'simple-git';

import { getDatabase } from '@/lib/db';
import { missions, missionAttempts, battlefields, followUpSuggestions } from '@/lib/db/schema';
import { extractNextActions } from '@/lib/utils/debrief-parser';
import {
  classifyExit as defaultClassifyExit,
  type Classification,
  type ExitContext,
  type ClassifierDeps,
} from './exit-classifier';
import { decideNextAction, nextInfraBackoffMs } from './retry-policy';
import { emitComm, emitMissionStatus } from './comms';
import { parseDebrief } from './debrief/parse';
import { getControlConfig } from './config';
import type {
  AssetRunResult,
  SpawnAssetOpts,
  OverseerConsultInput,
  OverseerVerdict,
} from './mission-runner';

/**
 * Recon mission lifecycle.
 *
 * Spec §7: recon produces a prose report only — no worktree, no commits, no
 * gates, no merge. The asset runs inside the repo root itself; CONTROL
 * verifies the working tree is clean after exit. Any write violates the
 * read-only contract → tree is reset and the mission is flagged.
 *
 * Retry policy matches combat (spec §7 bullet 5) for cases where the debrief
 * is missing or schema-invalid; OVERSEER consults on recon omit the gate
 * stderr and final-diff blocks (spec §7 final paragraph — handled by passing
 * null inputs through to `overseerConsult`).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconRunnerDeps {
  spawnAsset: (opts: SpawnAssetOpts) => Promise<AssetRunResult>;
  classifyExitFn: typeof defaultClassifyExit;
  overseerConsult: (input: OverseerConsultInput) => Promise<OverseerVerdict>;
  now: () => number;
  /** Invoked with pid once the subprocess is running. */
  onPidAssigned?: (pid: number) => void;
  /** Fallback classifier used when fast-path returns NEEDS_COMMANDER. */
  overseerClassifier?: ClassifierDeps['overseerClassify'];
  /** Resets the repo root when the recon asset wrote files. Default: real
   *  simple-git `git reset --hard HEAD && git clean -fdx`. */
  gitReset?: (repoPath: string) => Promise<void>;
  /** Sleep helper for INFRA / RATE_LIMIT backoffs. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Override for elevated L3 stdout-silence threshold (default: config). */
  reconStdoutSilenceMs?: number;
  infraMaxRetries?: number;
  infraBackoffMs?: number[];
  rateLimitBackoffMs?: number;
}

export interface RunReconResult {
  missionId: string;
  finalStatus: 'accomplished' | 'compromised' | 'abandoned';
  attemptCount: number;
  classification?: Classification;
  authPause?: boolean;
  violatedReadonly?: boolean;
}

type MissionRow = typeof missions.$inferSelect;
type BattlefieldRow = typeof battlefields.$inferSelect;

const DEFAULT_INFRA_BACKOFF = [30_000, 120_000, 600_000, 1_800_000];
const DEFAULT_RATE_LIMIT_BACKOFF = 60_000;
const DEFAULT_INFRA_MAX_RETRIES = 4;

type EndReason =
  | 'clean'
  | 'timeout'
  | 'silence-kill'
  | 'infrastructure'
  | 'rate-limit'
  | 'auth'
  | 'turn-limit'
  | 'gate-failure';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadMission(missionId: string): { mission: MissionRow; battlefield: BattlefieldRow } {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) throw new Error(`recon: mission ${missionId} not found`);
  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId))
    .get();
  if (!bf) throw new Error(`recon: battlefield ${mission.battlefieldId} not found`);
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

function recordAttempt(opts: {
  missionId: string;
  attemptNumber: number;
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
  classification?: Classification;
  sessionId?: string | null;
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
      gateResults: null,
      autoCommitted: 0,
      sessionId: opts.sessionId ?? null,
      targetHeadAtStart: null,
      durationMs: opts.endedAt - opts.startedAt,
      tokensInput: opts.usage?.input ?? 0,
      tokensOutput: opts.usage?.output ?? 0,
      tokensCache: opts.usage?.cache ?? 0,
      debriefSynthesized: opts.finalMessage ? 1 : 0,
    } as typeof missionAttempts.$inferInsert)
    .run();
  return id;
}

function persistReconFollowUps(opts: {
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

function countAttempts(missionId: string): number {
  const db = getDatabase();
  return db
    .select()
    .from(missionAttempts)
    .where(eq(missionAttempts.missionId, missionId))
    .all().length;
}

async function defaultGitReset(repoPath: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  await git.reset(['--hard', 'HEAD']);
  await git.clean('f', ['-d', '-x']);
}

async function probeWorkingTreeDirty(repoPath: string): Promise<boolean> {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return !status.isClean();
}

function tryReadReconSilence(): number {
  try {
    return getControlConfig().reconStdoutSilenceMs;
  } catch {
    return 600_000;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Drive a recon mission through its lifecycle. Implements spec §7: spawn in
 * repo root, enforce read-only, parse DEBRIEF, retry on missing summary with
 * combat-style retry budget (OVERSEER consult omits gate/diff blocks).
 */
export async function runReconMission(
  missionId: string,
  deps: ReconRunnerDeps,
): Promise<RunReconResult> {
  const { mission, battlefield } = loadMission(missionId);

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms).unref?.(); }));
  const infraMax = deps.infraMaxRetries ?? DEFAULT_INFRA_MAX_RETRIES;
  const infraSchedule = deps.infraBackoffMs ?? DEFAULT_INFRA_BACKOFF;
  const rateLimitDelay = deps.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF;
  const reconSilenceMs = deps.reconStdoutSilenceMs ?? tryReadReconSilence();
  const gitReset = deps.gitReset ?? defaultGitReset;
  const db = getDatabase();

  // --- DEPLOYING -----------------------------------------------------------
  transitionMission(missionId, 'deploying', deps.now());

  // --- IN_COMBAT -----------------------------------------------------------
  transitionMission(missionId, 'in_combat', deps.now());

  let sortieAttempt = 0;
  let infraRetryCount = 0;
  let overseerConsulted = false;
  let priorDiffHash: string | null = null;
  let lastDiffHash: string | null = null;
  let lastClassification: Classification | undefined;
  let lastSessionId: string | null = mission.sessionId ?? null;
  let redirectPrompt: string | null = null;
  let violatedReadonly = false;

  // Safety cap.
  for (let guard = 0; guard < 20; guard++) {
    const attemptNumber = countAttempts(missionId) + 1;
    const spawnStart = deps.now();
    const briefing = redirectPrompt ?? mission.briefing;

    let run: AssetRunResult;
    try {
      run = await deps.spawnAsset({
        missionId,
        // Recon runs in the repo root, NOT a worktree (spec §7 step 3).
        worktreePath: battlefield.repoPath,
        briefing,
        assetCodename: 'OPERATIVE',
        sessionId: lastSessionId ?? undefined,
        onPid: (pid) => deps.onPidAssigned?.(pid),
        // Elevated L3 threshold (spec §7 step 5).
        stdoutSilenceMs: reconSilenceMs,
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
      return {
        missionId,
        finalStatus: 'compromised',
        attemptCount: attemptNumber,
        violatedReadonly,
      };
    }

    // --- Enforce read-only contract BEFORE classification ------------------
    // Even on clean exits, the asset may have written files.
    try {
      const dirty = await probeWorkingTreeDirty(battlefield.repoPath);
      if (dirty) {
        violatedReadonly = true;
        emitComm({
          missionId,
          actor: 'CONTROL',
          message:
            '⚠ READ-ONLY VIOLATION: recon asset modified the working tree. Reverting and flagging mission.',
          level: 'warn',
        });
        try {
          await gitReset(battlefield.repoPath);
        } catch (err) {
          emitComm({
            missionId,
            message: `Read-only reset failed: ${(err as Error).message}`,
            level: 'error',
          });
        }
        db.update(missions)
          .set({ reconViolatedReadonly: 1, updatedAt: deps.now() })
          .where(eq(missions.id, missionId))
          .run();
      }
    } catch (err) {
      emitComm({
        missionId,
        message: `Dirty-check failed: ${(err as Error).message}`,
        level: 'warn',
      });
    }

    const exitCtx: ExitContext = {
      exitCode: run.exitCode,
      stderr: run.stderr,
      stdoutResultSubtype: run.stdoutResultSubtype,
      killedByControl: run.killedByControl,
      elapsedMs: run.elapsedMs,
      toolUseCount: run.toolUseCount,
      // Recon does NOT use git diff as a signal — force false so the
      // fast-path classifier's "fast-exit no-activity" branch behaves
      // correctly regardless of the probe's return.
      hasDiff: false,
    };
    const classification = await deps.classifyExitFn(exitCtx, {
      overseerClassify: deps.overseerClassifier,
    });
    lastClassification = classification;
    lastSessionId = run.sessionId ?? lastSessionId;
    emitComm({
      missionId,
      message: `Exit classified: ${classification.category} — ${classification.reasoning}`,
    });

    // ---- AUTH -------------------------------------------------------------
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
      return {
        missionId,
        finalStatus: 'compromised',
        attemptCount: attemptNumber,
        classification,
        authPause: true,
        violatedReadonly,
      };
    }

    // ---- NEEDS_COMMANDER --------------------------------------------------
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
        violatedReadonly,
      };
    }

    // ---- INFRASTRUCTURE / RATE_LIMIT --------------------------------------
    if (
      classification.category === 'INFRASTRUCTURE' ||
      classification.category === 'RATE_LIMIT'
    ) {
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
          violatedReadonly,
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
      lastSessionId = null;
      continue;
    }

    // ---- TIMEOUT ----------------------------------------------------------
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
          violatedReadonly,
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
          violatedReadonly,
        };
      }
      redirectPrompt = null;
      continue;
    }

    // ---- CLEAN / TURN_LIMIT → check for DEBRIEF --------------------------
    if (classification.category !== 'CLEAN' && classification.category !== 'TURN_LIMIT') {
      // Defensive fall-through.
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
        violatedReadonly,
      };
    }

    sortieAttempt += 1;

    const parsed = run.finalMessage ? parseDebrief(run.finalMessage) : null;

    // Diff-hash proxy: classification outcome + final message length. Gives
    // the retry policy's no-progress detection something to hash against
    // without a git diff (spec §7 omits diff context on retries).
    priorDiffHash = lastDiffHash;
    lastDiffHash = `${classification.category}:${(run.finalMessage ?? '').length}:${run.toolUseCount}`;

    if (parsed && parsed.ok) {
      const endedAt = deps.now();
      db.update(missions)
        .set({
          debriefStructured: JSON.stringify(parsed.data),
          debrief: parsed.data.summary,
          sessionId: run.sessionId ?? lastSessionId,
          completedAt: endedAt,
          updatedAt: endedAt,
          costInput: run.usage?.input ?? 0,
          costOutput: run.usage?.output ?? 0,
          costCacheHit: run.usage?.cache ?? 0,
        })
        .where(eq(missions.id, missionId))
        .run();
      recordAttempt({
        missionId,
        attemptNumber,
        startedAt: spawnStart,
        endedAt,
        endReason: 'clean',
        classification,
        sessionId: run.sessionId,
        usage: run.usage,
        finalMessage: run.finalMessage,
      });
      persistReconFollowUps({
        debrief: parsed.data.summary,
        missionId,
        campaignId: mission.campaignId ?? null,
        battlefieldId: mission.battlefieldId,
      });
      // Recon transitions directly from IN_COMBAT → ACCOMPLISHED (no merge).
      transitionMission(missionId, 'accomplished', endedAt);
      return {
        missionId,
        finalStatus: 'accomplished',
        attemptCount: attemptNumber,
        classification,
        violatedReadonly,
      };
    }

    // DEBRIEF missing or invalid → treat as gate-failure-equivalent.
    const endedAt = deps.now();
    recordAttempt({
      missionId,
      attemptNumber,
      startedAt: spawnStart,
      endedAt,
      endReason: 'gate-failure',
      classification,
      sessionId: run.sessionId,
      usage: run.usage,
      finalMessage: run.finalMessage,
    });
    const reason = parsed?.ok === false ? parsed.reason : 'no final message';
    emitComm({
      missionId,
      message: `Debrief missing/invalid on attempt ${sortieAttempt}: ${reason}`,
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
      redirectPrompt =
        'Your prior attempt did not emit a parseable <DEBRIEF>{...}</DEBRIEF> block. ' +
        'Produce your recon report and wrap the structured summary in <DEBRIEF>…</DEBRIEF> with fields ' +
        'summary, commits, files_touched, confidence.';
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
        violatedReadonly,
      };
    }
    // COMPROMISED.
    transitionMission(missionId, 'compromised', endedAt);
    return {
      missionId,
      finalStatus: 'compromised',
      attemptCount: attemptNumber,
      classification,
      violatedReadonly,
    };
  }

  // Safety fallthrough — never expected.
  transitionMission(missionId, 'compromised', deps.now());
  return {
    missionId,
    finalStatus: 'compromised',
    attemptCount: countAttempts(missionId),
    classification: lastClassification,
    violatedReadonly,
  };

  // -------------------------------------------------------------------------
  async function runOverseerConsult(): Promise<string | null> {
    try {
      const verdict = await deps.overseerConsult({
        missionId,
        briefing: mission.briefing,
        attemptHistory: [],
        // Recon OVERSEER consult: gate/diff blocks omitted — use empty
        // strings here (the consult prompt builder switches on null; callers
        // that adapt this signature to the prompt builder map "" → null).
        lastGateStderr: '',
        finalDiff: '',
        claudeMdExcerpt: null,
      });
      emitComm({
        missionId,
        message: `OVERSEER verdict: ${verdict.verdict} — ${verdict.reasoning}`,
      });
      if (verdict.verdict === 'redirect' && verdict.redirect) {
        return verdict.redirect.newPrompt;
      }
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
