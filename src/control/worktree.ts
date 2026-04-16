import simpleGit from 'simple-git';
import path from 'node:path';

export function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface CreateWorktreeOpts {
  repoPath: string;
  targetBranch: string;
  missionBranch: string;
}

export async function createMissionWorktree(opts: CreateWorktreeOpts): Promise<WorktreeInfo> {
  const git = simpleGit(opts.repoPath);
  const wtPath = path.join(opts.repoPath, '.worktrees', sanitizeBranchForPath(opts.missionBranch));
  const branches = await git.branch();
  const alreadyExists = branches.all.includes(opts.missionBranch);
  try {
    if (alreadyExists) {
      await git.raw(['worktree', 'add', wtPath, opts.missionBranch]);
    } else {
      await git.raw(['worktree', 'add', '-b', opts.missionBranch, wtPath, opts.targetBranch]);
    }
  } catch (err) {
    // If the path is already registered, ignore; else rethrow.
    if (!(err as Error).message.includes('already')) throw err;
  }
  return { path: wtPath, branch: opts.missionBranch };
}

export async function resetWorktreeToHead(worktreePath: string): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.reset(['--hard', 'HEAD']);
  await git.raw(['clean', '-fdx']);
}

export async function rebaseOntoTarget(
  worktreePath: string,
  targetBranch: string,
): Promise<{ rebased: boolean; conflict: boolean }> {
  const git = simpleGit(worktreePath);
  try {
    await git.fetch();
    const before = (await git.revparse(['HEAD'])).trim();
    await git.rebase([targetBranch]);
    const after = (await git.revparse(['HEAD'])).trim();
    return { rebased: before !== after, conflict: false };
  } catch (err) {
    // Abort the rebase if it left the worktree mid-rebase.
    try {
      await git.rebase(['--abort']);
    } catch {
      // ignore
    }
    if (/conflict/i.test((err as Error).message)) return { rebased: false, conflict: true };
    throw err;
  }
}

export async function autoCommitSweep(
  worktreePath: string,
  missionId: string,
): Promise<{ swept: boolean; filesChanged: number }> {
  const git = simpleGit(worktreePath);
  const status = await git.status();
  if (status.files.length === 0) return { swept: false, filesChanged: 0 };
  await git.add('.');
  await git
    .env('GIT_AUTHOR_NAME', 'DEVROOM')
    .env('GIT_AUTHOR_EMAIL', 'devroom@local')
    .env('GIT_COMMITTER_NAME', 'DEVROOM')
    .env('GIT_COMMITTER_EMAIL', 'devroom@local')
    .raw(['commit', '--no-verify', '-m', `chore(mission): sweep uncommitted work [${missionId}]`]);
  return { swept: true, filesChanged: status.files.length };
}

export async function removeMissionWorktree(opts: {
  repoPath: string;
  worktreePath: string;
  branch: string;
  deleteBranch: boolean;
}): Promise<void> {
  const git = simpleGit(opts.repoPath);
  try {
    await git.raw(['worktree', 'remove', '--force', opts.worktreePath]);
  } catch {
    // ignore — best-effort cleanup
  }
  if (opts.deleteBranch) {
    try {
      await git.raw(['branch', '-D', opts.branch]);
    } catch {
      // ignore — branch may not exist
    }
  }
}
