import simpleGit from 'simple-git';
import { rebaseOntoTarget } from '@/control/worktree';
import {
  runGates as defaultRunGates,
  type GateManifest,
  type GateRunResults,
  type RunGatesOptions,
} from '@/control/gates';

/**
 * Input passed to the caller-supplied QUARTERMASTER resolution callback.
 * The merge module itself does not spawn QUARTERMASTER — Task 6.2 will wire
 * up the real spawn. Tests inject a stub.
 */
export interface QuartermasterInput {
  worktreePath: string;
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  briefing: string;
  debrief: string;
  conflictDiff: string;
  logSourceToTarget: string;
  logTargetToSource: string;
  claudeMdExcerpt: string;
}

export interface QuartermasterResult {
  resolved: boolean;
  stderr?: string;
  /** Short reason code when `resolved: false` (e.g. 'unresolved-conflict',
   *  'timeout', 'no-commit'). */
  reason?: string;
  /** SHA of the commit QUARTERMASTER produced when `resolved: true`. */
  commitSha?: string;
}

export type QuartermasterCallback = (
  input: QuartermasterInput,
) => Promise<QuartermasterResult>;

export interface RunMergeOptions {
  battlefieldId: string;
  repoPath: string;
  targetBranch: string;
  /** The mission/worktree branch being merged into target. */
  sourceBranch: string;
  /** Full SHA of the target branch HEAD when the mission attempt began. */
  targetHeadAtStart: string;
  manifest: GateManifest;
  /** Path to the mission worktree. Used for rebase + post-rebase gate execution. */
  worktreePath: string;
  onQuartermaster?: QuartermasterCallback;
  /** Briefing passed through to QUARTERMASTER (if invoked). */
  briefing?: string;
  /** Debrief passed through to QUARTERMASTER (if invoked). */
  debrief?: string;
  /** CLAUDE.md excerpt passed through to QUARTERMASTER (if invoked). */
  claudeMdExcerpt?: string;
  /** Override for tests — inject a custom runGates implementation. */
  runGates?: (opts: RunGatesOptions) => Promise<GateRunResults>;
  /** Per-command timeout for the post-rebase / post-QM gate suite. */
  perCommandTimeoutMs?: number;
  /** Total suite timeout for the post-rebase / post-QM gate suite. */
  suiteTimeoutMs?: number;
}

export type MergeStatus = 'accomplished' | 'compromised';

export type MergeFailureReason =
  | 'merge-conflict'
  | 'post-rebase-gate-failure'
  | 'post-qm-gate-failure';

export interface MergeResult {
  status: MergeStatus;
  reason?: MergeFailureReason;
}

/**
 * Per-battlefield mutual-exclusion wrapper. Calls sharing the same
 * battlefieldId are serialized; calls with different battlefieldIds run
 * in parallel. Implementation uses a Map<battlefieldId, Promise<void>>:
 * each acquisition awaits any in-flight promise on that key, installs its
 * own, and releases it in a finally block.
 */
export class MergeLockManager {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(battlefieldId: string, fn: () => Promise<T>): Promise<T> {
    // Drain any chain of pending locks for this battlefield before taking our turn.
    while (this.locks.has(battlefieldId)) {
      // eslint-disable-next-line no-await-in-loop
      await this.locks.get(battlefieldId);
    }
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(battlefieldId, lock);
    try {
      return await fn();
    } finally {
      this.locks.delete(battlefieldId);
      release();
    }
  }
}

const defaultLockManager = new MergeLockManager();

/**
 * Executes the merge path per spec §6.2/§6.3.
 *
 *  1. Acquire per-battlefield merge lock.
 *  2. Read current target HEAD.
 *  3. If the target did not advance → checkout target + fast-forward merge source.
 *  4. Otherwise rebase the worktree branch onto the latest target:
 *     - Clean rebase → re-run gate suite on rebased state. Pass → ff-merge; fail → COMPROMISED (post-rebase-gate-failure).
 *     - Conflict → if onQuartermaster provided, await resolution. Resolved cleanly → re-run gates → pass → ff-merge;
 *       fail → COMPROMISED (post-qm-gate-failure). Unresolved or missing callback → COMPROMISED (merge-conflict).
 */
export async function runMerge(
  opts: RunMergeOptions,
  lockManager: MergeLockManager = defaultLockManager,
): Promise<MergeResult> {
  return lockManager.acquire(opts.battlefieldId, async () => {
    const git = simpleGit(opts.repoPath);
    const currentTarget = (await git.revparse([opts.targetBranch])).trim();
    const targetAdvanced = currentTarget !== opts.targetHeadAtStart;

    const runGatesFn = opts.runGates ?? defaultRunGates;
    const perCommandTimeoutMs = opts.perCommandTimeoutMs ?? 300_000;
    const suiteTimeoutMs = opts.suiteTimeoutMs ?? 900_000;

    const fastForward = async (): Promise<MergeResult> => {
      await git.checkout(opts.targetBranch);
      await git.merge(['--ff-only', opts.sourceBranch]);
      return { status: 'accomplished' };
    };

    if (!targetAdvanced) {
      return fastForward();
    }

    const rebase = await rebaseOntoTarget(opts.worktreePath, opts.targetBranch);

    if (rebase.conflict) {
      const onQuartermaster =
        opts.onQuartermaster ?? (await resolveDefaultQuartermaster());
      if (!onQuartermaster) {
        return { status: 'compromised', reason: 'merge-conflict' };
      }
      const conflictDiff = await safeCollectConflictDiff(opts.worktreePath);
      const logSourceToTarget = await safeGitLogRange(
        opts.repoPath,
        `${opts.targetBranch}..${opts.sourceBranch}`,
      );
      const logTargetToSource = await safeGitLogRange(
        opts.repoPath,
        `${opts.sourceBranch}..${opts.targetBranch}`,
      );
      const qm = await onQuartermaster({
        worktreePath: opts.worktreePath,
        repoPath: opts.repoPath,
        sourceBranch: opts.sourceBranch,
        targetBranch: opts.targetBranch,
        briefing: opts.briefing ?? '',
        debrief: opts.debrief ?? '',
        conflictDiff,
        logSourceToTarget,
        logTargetToSource,
        claudeMdExcerpt: opts.claudeMdExcerpt ?? '',
      });
      if (!qm.resolved) {
        return { status: 'compromised', reason: 'merge-conflict' };
      }
      const gates = await runGatesFn({
        manifest: opts.manifest,
        workingDir: opts.worktreePath,
        perCommandTimeoutMs,
        suiteTimeoutMs,
      });
      if (gates.overallStatus !== 'pass') {
        return { status: 'compromised', reason: 'post-qm-gate-failure' };
      }
      return fastForward();
    }

    // Clean rebase (rebased or no-op). Re-run gates on the rebased state.
    const gates = await runGatesFn({
      manifest: opts.manifest,
      workingDir: opts.worktreePath,
      perCommandTimeoutMs,
      suiteTimeoutMs,
    });
    if (gates.overallStatus !== 'pass') {
      return { status: 'compromised', reason: 'post-rebase-gate-failure' };
    }
    return fastForward();
  });
}

async function safeCollectConflictDiff(worktreePath: string): Promise<string> {
  try {
    const git = simpleGit(worktreePath);
    // Best-effort: if the rebase was aborted (which our helper does on
    // conflict), the diff markers are no longer in the tree. Fall back to
    // the status snapshot so QUARTERMASTER at least sees which files clashed.
    const diff = await git.raw(['diff', '--no-color']);
    if (diff && diff.trim().length > 0) return diff;
    return await git.raw(['status', '--porcelain']);
  } catch {
    return '';
  }
}

/**
 * Lazy-load the real QUARTERMASTER spawn. We import dynamically so that:
 *   - `merge.ts` remains usable in pure-unit contexts that never touch the DB,
 *   - the import cycle between `merge.ts` and `merge/quartermaster.ts` (the
 *     callee imports `QuartermasterInput` / `QuartermasterResult` from here)
 *     stays resolvable.
 * Returns `null` if the module fails to load — callers fall back to the
 * legacy 'merge-conflict' compromise.
 */
async function resolveDefaultQuartermaster(): Promise<QuartermasterCallback | null> {
  try {
    const mod = await import('./merge/quartermaster');
    return (input: QuartermasterInput) => mod.spawnQuartermaster(input);
  } catch {
    return null;
  }
}

async function safeGitLogRange(repoPath: string, range: string): Promise<string> {
  try {
    const git = simpleGit(repoPath);
    return await git.raw(['log', '--oneline', range]);
  } catch {
    return '';
  }
}
