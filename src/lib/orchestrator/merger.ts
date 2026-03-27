import { spawn } from 'child_process';
import fs from 'fs';
import simpleGit from 'simple-git';
import { config } from '@/lib/config';
import type { Mission, MergeResult } from '@/types';

/**
 * Merge a mission's branch into the target branch.
 * On conflict: attempts auto-resolution via Claude Code.
 * Returns MergeResult indicating success/failure.
 */
export async function mergeBranch(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  mission: Mission,
  claudeMdPath?: string | null,
): Promise<MergeResult> {
  const git = simpleGit(repoPath);

  try {
    // Switch to target branch
    await git.checkout(targetBranch);

    // Attempt merge
    await git.merge([sourceBranch, '--no-ff']);

    return { success: true, conflictResolved: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Check if this is a merge conflict
    if (errorMsg.includes('CONFLICTS') || errorMsg.includes('conflict')) {
      // Attempt auto-resolution via Claude Code
      const resolved = await resolveConflicts(
        repoPath, sourceBranch, targetBranch, mission, claudeMdPath,
      );

      if (resolved) {
        return { success: true, conflictResolved: true };
      } else {
        // Abort the failed merge
        try {
          await git.merge(['--abort']);
        } catch {
          // May already be aborted
        }
        return {
          success: false,
          conflictResolved: false,
          error: 'Conflict resolution failed. Branch preserved for manual review.',
        };
      }
    }

    // Non-conflict git error
    return { success: false, conflictResolved: false, error: errorMsg };
  }
}

/**
 * Spawn Claude Code to resolve merge conflicts.
 * Returns true if conflicts were resolved and committed.
 */
async function resolveConflicts(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  mission: Mission,
  claudeMdPath?: string | null,
): Promise<boolean> {
  const git = simpleGit(repoPath);

  // Get the conflict diff with markers
  let conflictDiff = '';
  try {
    conflictDiff = await git.diff();
  } catch {
    conflictDiff = 'Unable to retrieve conflict diff.';
  }

  // Build the conflict resolution prompt
  const sections: string[] = [];

  // CLAUDE.md if available
  if (claudeMdPath) {
    try {
      const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
      sections.push(claudeMd);
    } catch {
      // Skip if not readable
    }
  }

  // Conflict resolution instructions
  const instructions = [
    '## Merge Conflict Resolution',
    '',
    `Branch \`${sourceBranch}\` into \`${targetBranch}\`.`,
    '',
    '### Context',
    mission.debrief || 'No debrief available.',
    '',
    '### Conflicts',
    '```',
    conflictDiff,
    '```',
    '',
    '### Orders',
    '1. Analyze both sides of each conflict.',
    '2. Resolve preserving both intents.',
    '3. If incompatible, prefer source (new work). Note losses.',
    '4. Run tests if a test command is available.',
    `5. Commit: "Merge ${sourceBranch}: resolve conflicts"`,
    '6. Report to the Commander.',
  ].join('\n');
  sections.push(instructions);

  const prompt = sections.join('\n\n---\n\n');

  // Spawn Claude Code for conflict resolution
  // Uses --print (plain text) — this is intentional.
  // Conflict resolution is a synchronous fire-and-forget operation.
  // No streaming, no real-time UI, no token tracking needed.
  return new Promise<boolean>((resolve) => {
    const proc = spawn(config.claudePath, [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', '20',
    ], {
      cwd: repoPath,
    });

    // We don't need stdout — just the exit code tells us if resolution succeeded
    proc.stdout?.resume(); // Drain stdout to prevent backpressure

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
