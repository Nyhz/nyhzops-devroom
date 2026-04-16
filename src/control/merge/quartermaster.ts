/**
 * QUARTERMASTER conflict resolution spawn.
 *
 * Spec §6.3 / §11 (CONTROL reliability refactor). Invoked by `runMerge` when a
 * rebase produces conflicts: spawns a one-shot Claude subprocess driven by the
 * QUARTERMASTER asset profile, pipes the conflict-resolution prompt via stdin,
 * and on exit inspects the worktree:
 *
 *   - dirty tree or unresolved conflict markers  → `{ resolved: false, reason: 'unresolved-conflict' }`
 *   - subprocess killed by CONTROL (timeout / silence / abort) → `{ resolved: false, reason: 'timeout' | 'killed' }`
 *   - non-zero exit / no new commit            → `{ resolved: false, reason: '...' }`
 *   - clean index with a commit beyond the pre-spawn HEAD → `{ resolved: true, commitSha }`
 *
 * QUARTERMASTER is a `isSystem: 1` asset, so per `buildClaudeArgs` the Rules of
 * Engagement are NOT prepended — the asset's bare systemPrompt is used verbatim.
 */

import { eq } from 'drizzle-orm';
import simpleGit from 'simple-git';

import { getDatabase } from '@/lib/db';
import { assets } from '@/lib/db/schema';
import { getControlConfig } from '@/control/config';
import { buildQuartermasterPrompt } from '@/control/prompt-builder';
import { spawnAsset, type AssetDefinition } from '@/control/spawn-asset';
import type {
  QuartermasterInput,
  QuartermasterResult,
} from '@/control/merge';

export interface SpawnQuartermasterOptions {
  /** Override the `claude` binary. Used by tests to point at scripted-claude. */
  claudeBinary?: string;
  /** Args prepended before the asset-derived args (e.g. the scripted-claude
   *  script path when `claudeBinary` is `tsx`). */
  claudeArgsPrefix?: string[];
  /** Extra env vars merged into the subprocess environment. */
  env?: Record<string, string>;
  /** Override the hard timeout (defaults to `getControlConfig().quartermasterTimeoutMs`). */
  hardTimeoutMs?: number;
  /** Override stdout-silence watchdog. */
  stdoutSilenceMs?: number;
  /** AbortSignal propagated to the subprocess. */
  signal?: AbortSignal;
}

interface AssetRow {
  codename: string;
  model: string | null;
  maxTurns: number | null;
  effort: string | null;
  isSystem: number | null;
  systemPrompt: string | null;
  skills: string | null;
  mcpServers: string | null;
}

function loadQuartermasterAsset(): AssetDefinition {
  const db = getDatabase();
  const row = db
    .select()
    .from(assets)
    .where(eq(assets.codename, 'QUARTERMASTER'))
    .get() as AssetRow | undefined;

  if (!row) {
    throw new Error(
      'spawnQuartermaster: QUARTERMASTER asset not found in DB — run seed.',
    );
  }

  const parsedSkills: string[] = row.skills
    ? (JSON.parse(row.skills) as string[])
    : [];
  const parsedMcp: unknown[] = row.mcpServers
    ? (JSON.parse(row.mcpServers) as unknown[])
    : [];

  return {
    codename: row.codename,
    model: row.model ?? 'claude-sonnet-4-6',
    maxTurns: row.maxTurns ?? 15,
    effort: row.effort ?? 'medium',
    isSystem: row.isSystem ?? 1,
    systemPrompt: row.systemPrompt ?? '',
    skills: parsedSkills,
    mcpServers: parsedMcp,
  };
}

function tryReadConfig(): { quartermasterTimeoutMs: number } {
  try {
    return { quartermasterTimeoutMs: getControlConfig().quartermasterTimeoutMs };
  } catch {
    return { quartermasterTimeoutMs: 600_000 };
  }
}

async function hasUnresolvedConflictMarkers(worktreePath: string): Promise<boolean> {
  try {
    const git = simpleGit(worktreePath);
    const status = await git.raw(['status', '--porcelain']);
    // `UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD` are the conflict XY codes.
    return status.split('\n').some((line) => /^(UU|AA|DD|AU|UA|DU|UD) /.test(line));
  } catch {
    return false;
  }
}

async function readHeadSha(worktreePath: string): Promise<string | null> {
  try {
    const git = simpleGit(worktreePath);
    return (await git.revparse(['HEAD'])).trim();
  } catch {
    return null;
  }
}

async function isIndexClean(worktreePath: string): Promise<boolean> {
  try {
    const git = simpleGit(worktreePath);
    const status = await git.raw(['status', '--porcelain']);
    return status.trim().length === 0;
  } catch {
    return false;
  }
}

/**
 * Spawn the QUARTERMASTER asset to resolve a rebase conflict in the worktree.
 *
 * Never rejects on a subprocess failure — all outcomes (success, killed,
 * non-zero exit, unresolved conflict) are returned as a `QuartermasterResult`.
 * May reject if DB lookup of the QUARTERMASTER asset fails or if spawn-time
 * I/O (HOME directory creation) fails — those are programming / environment
 * errors, not conflict-resolution outcomes.
 */
export async function spawnQuartermaster(
  input: QuartermasterInput,
  opts: SpawnQuartermasterOptions = {},
): Promise<QuartermasterResult> {
  const asset = loadQuartermasterAsset();
  const cfg = tryReadConfig();
  const hardTimeoutMs = opts.hardTimeoutMs ?? cfg.quartermasterTimeoutMs;

  const briefing = buildQuartermasterPrompt({
    briefing: input.briefing,
    debrief: input.debrief,
    conflictDiff: input.conflictDiff,
    logSourceToTarget: input.logSourceToTarget,
    logTargetToSource: input.logTargetToSource,
    claudeMdExcerpt: input.claudeMdExcerpt,
  });

  // Snapshot HEAD before the spawn so we can detect new commits.
  const headBefore = await readHeadSha(input.worktreePath);

  // QUARTERMASTER is a system asset (isSystem: 1). Per cli-builder, RoE is
  // NOT prepended for system assets — pass a bare placeholder that won't be
  // used.
  const run = await spawnAsset({
    missionId: `quartermaster-${Date.now()}`,
    worktreePath: input.worktreePath,
    briefing,
    assetCodename: asset.codename,
    asset,
    rulesOfEngagement: '',
    claudeBinary: opts.claudeBinary,
    claudeArgsPrefix: opts.claudeArgsPrefix,
    env: opts.env,
    outputFormat: 'print',
    extraFlags: ['--print'],
    signal: opts.signal,
    hardTimeoutMs,
    stdoutSilenceMs: opts.stdoutSilenceMs,
    probeGitDiff: false,
  });

  // 1. Killed by CONTROL (timeout / silence / abort).
  if (run.killedByControl) {
    const reason = run.stderr.includes('timeout')
      ? 'timeout'
      : run.stderr.includes('silence-kill')
        ? 'silence-kill'
        : 'killed';
    return { resolved: false, stderr: run.stderr, reason };
  }

  // 2. Non-zero exit.
  if (run.exitCode !== 0) {
    return {
      resolved: false,
      stderr: run.stderr,
      reason: `exit-${run.exitCode ?? 'unknown'}`,
    };
  }

  // 3. Worktree still has conflict markers.
  if (await hasUnresolvedConflictMarkers(input.worktreePath)) {
    return {
      resolved: false,
      stderr: run.stderr,
      reason: 'unresolved-conflict',
    };
  }

  // 4. Worktree has uncommitted changes (QM wrote but didn't commit).
  if (!(await isIndexClean(input.worktreePath))) {
    return {
      resolved: false,
      stderr: run.stderr,
      reason: 'index-dirty',
    };
  }

  // 5. No new commit produced.
  const headAfter = await readHeadSha(input.worktreePath);
  if (!headAfter || headAfter === headBefore) {
    return {
      resolved: false,
      stderr: run.stderr,
      reason: 'no-commit',
    };
  }

  return { resolved: true, commitSha: headAfter };
}
