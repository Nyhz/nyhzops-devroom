import simpleGit from 'simple-git';
import { resolveConflicts } from './conflict-resolver';
import type { Mission, MergeResult } from '@/types';

/**
 * Attempt a git merge: stash, checkout target, merge source, restore stash.
 */
async function attemptMerge(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<MergeResult> {
  const git = simpleGit(repoPath);

  let stashed = false;
  const status = await git.status();
  if (status.modified.length > 0 || status.staged.length > 0 || status.not_added.length > 0) {
    await git.stash(['push', '-m', `devroom-pre-merge-${sourceBranch}`]);
    stashed = true;
  }

  try {
    await git.checkout(targetBranch);

    const headBefore = await git.revparse(['HEAD']);

    try {
      await git.merge([sourceBranch, '--no-ff']);
    } finally {
      if (stashed) {
        try {
          await git.stash(['pop']);
        } catch {
          console.warn(`[MergeExecutor] Stash pop failed after merging ${sourceBranch}. Changes saved in git stash.`);
        }
      }
    }

    // Verify the merge actually created a new commit
    const headAfter = await git.revparse(['HEAD']);
    if (headBefore === headAfter) {
      return {
        success: false,
        conflictResolved: false,
        error: `Merge produced no new commit. HEAD unchanged at ${headBefore.slice(0, 8)}. Branch may already be merged or empty.`,
      };
    }

    return { success: true, conflictResolved: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (errorMsg.includes('CONFLICTS') || errorMsg.includes('conflict')) {
      throw new ConflictError(errorMsg);
    }

    return { success: false, conflictResolved: false, error: errorMsg };
  }
}

class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a merge with conflict resolution retry logic.
 *
 * Flow:
 * 1. Attempt merge
 * 2. If conflict → spawn conflict resolution
 * 3. If resolution fails → wait 60s → fetch → attempt again
 * 4. If second attempt fails → return failure
 * 5. Only retry on conflict errors, not other git errors
 */
export async function executeMerge(params: {
  missionId: string;
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  mission: Mission;
  claudeMdPath?: string | null;
  onRetryScheduled?: (retryAt: number) => void;
}): Promise<MergeResult> {
  const { missionId, repoPath, sourceBranch, targetBranch, mission, claudeMdPath, onRetryScheduled } = params;
  const git = simpleGit(repoPath);

  // First attempt
  try {
    return await attemptMerge(repoPath, sourceBranch, targetBranch);
  } catch (err) {
    if (!(err instanceof ConflictError)) {
      return { success: false, conflictResolved: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Conflict detected — attempt resolution
    console.log(`[MergeExecutor] Conflict detected for mission ${missionId}, attempting resolution...`);

    // Capture conflicted files for logging
    const conflictStatus = await git.status();
    const conflictFiles = conflictStatus.conflicted;

    const resolved = await resolveConflicts({
      repoPath,
      sourceBranch,
      targetBranch,
      mission,
      claudeMdPath,
    });

    if (resolved) {
      return { success: true, conflictResolved: true, conflictFiles };
    }

    // Resolution failed — abort merge, schedule retry
    try {
      await git.merge(['--abort']);
    } catch {
      // May already be aborted
    }

    const retryAt = Date.now() + 60000;
    if (onRetryScheduled) {
      onRetryScheduled(retryAt);
    }

    console.log(`[MergeExecutor] Resolution failed for mission ${missionId}, retrying in 60s...`);
    await delay(60000);

    // Fetch latest before retry
    try {
      await git.fetch();
    } catch (fetchErr) {
      console.warn(`[MergeExecutor] Fetch before retry failed:`, fetchErr);
    }

    // Second attempt
    try {
      return await attemptMerge(repoPath, sourceBranch, targetBranch);
    } catch (retryErr) {
      if (retryErr instanceof ConflictError) {
        // Abort merge
        try {
          await git.merge(['--abort']);
        } catch {
          // May already be aborted
        }
        return {
          success: false,
          conflictResolved: false,
          error: 'Conflict resolution failed after retry. Branch preserved for manual review.',
        };
      }
      return {
        success: false,
        conflictResolved: false,
        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
      };
    }
  }
}
