import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions } from '@/lib/db/schema';
import type { Mission, Battlefield } from '@/types';

/**
 * Create a worktree for a mission.
 * Returns the worktree directory path.
 */
export async function createWorktree(
  repoPath: string,
  mission: Mission,
  battlefield: Battlefield,
): Promise<string> {
  const git = simpleGit(repoPath);
  const db = getDatabase();

  // Generate branch name: devroom/{codename-slug}/{mission-id-last-12}
  const codeSlug = (battlefield.codename || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '-');
  const idSuffix = mission.id.slice(-12).toLowerCase();
  const branchName = `devroom/${codeSlug}/${idSuffix}`;

  // Worktree path inside the battlefield repo
  const worktreeDir = path.join(repoPath, '.worktrees', branchName.replace(/\//g, '-'));

  // Ensure .worktrees/ is in .gitignore
  await ensureGitignore(repoPath);

  // Create branch from default branch
  const defaultBranch = battlefield.defaultBranch || 'main';
  await git.branch([branchName, defaultBranch]);

  // Create worktree (git creates the directory automatically)
  await git.raw(['worktree', 'add', worktreeDir, branchName]);

  // Update mission record
  db.update(missions)
    .set({ worktreeBranch: branchName, useWorktree: 1, updatedAt: Date.now() })
    .where(eq(missions.id, mission.id))
    .run();

  return worktreeDir;
}

/**
 * Remove a worktree and its branch.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(repoPath);

  try {
    await git.raw(['worktree', 'remove', worktreePath, '--force']);
  } catch {
    // Worktree may already be removed — try to clean up the directory
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  try {
    await git.branch(['-D', branch]);
  } catch {
    // Branch may already be deleted
  }

  await git.raw(['worktree', 'prune']);
}

/**
 * Find and remove orphaned worktrees.
 * A worktree is orphaned if its branch matches devroom/* but the
 * corresponding mission ID is not in activeMissionIds.
 * Returns count of cleaned worktrees.
 */
export async function cleanOrphanedWorktrees(
  repoPath: string,
  activeMissionIds: string[],
): Promise<number> {
  const git = simpleGit(repoPath);
  let cleaned = 0;

  // List all local branches
  const branches = await git.branchLocal();
  const devroomBranches = Object.keys(branches.branches)
    .filter(b => b.startsWith('devroom/'));

  for (const branch of devroomBranches) {
    // Extract mission ID suffix (last segment of branch name)
    const parts = branch.split('/');
    const idSuffix = parts[parts.length - 1];

    // Check if any active mission ID ends with this suffix
    const isActive = activeMissionIds.some(id =>
      id.slice(-12).toLowerCase() === idSuffix
    );

    if (!isActive) {
      // Find worktree path for this branch
      const worktreeDir = path.join(
        repoPath, '.worktrees', branch.replace(/\//g, '-')
      );

      await removeWorktree(repoPath, worktreeDir, branch);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Ensure .worktrees/ is in the repo's .gitignore.
 */
export async function ensureGitignore(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  const entry = '.worktrees/';

  let content = '';
  try {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    // No .gitignore exists
  }

  if (!content.includes(entry)) {
    const newContent = content
      ? (content.endsWith('\n') ? content : content + '\n') + entry + '\n'
      : entry + '\n';
    fs.writeFileSync(gitignorePath, newContent);
  }
}
