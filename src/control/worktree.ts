import simpleGit from 'simple-git';
import path from 'node:path';
import { realpath } from 'node:fs/promises';

export function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function resolveIntendedPath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    try {
      const parent = await realpath(path.dirname(p));
      return path.join(parent, path.basename(p));
    } catch {
      return p;
    }
  }
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

export interface ParsedWorktreeEntry {
  path: string;
  branch: string | null;
  detached: boolean;
}

/**
 * Parse the output of `git worktree list --porcelain` into structured entries.
 * Blocks are separated by empty lines; each block starts with `worktree <path>`
 * and may contain `HEAD <sha>`, `branch refs/heads/<name>`, or `detached`.
 */
export function parseWorktreeList(output: string): ParsedWorktreeEntry[] {
  const entries: ParsedWorktreeEntry[] = [];
  let current: ParsedWorktreeEntry | null = null;
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '') {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length), branch: null, detached: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    } else if (line === 'detached') {
      current.detached = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

export async function createMissionWorktree(opts: CreateWorktreeOpts): Promise<WorktreeInfo> {
  const git = simpleGit(opts.repoPath);
  const wtPath = path.join(opts.repoPath, '.worktrees', sanitizeBranchForPath(opts.missionBranch));

  // Pre-flight: check whether wtPath is already registered as a worktree.
  // git reports realpath'd paths (e.g. /private/tmp on macOS), so normalize
  // wtPath through realpath when possible to compare reliably. If wtPath does
  // not exist yet, realpath its parent + rejoin the basename.
  const resolvedWtPath = await resolveIntendedPath(wtPath);
  const listOut = await git.raw(['worktree', 'list', '--porcelain']);
  const existing = parseWorktreeList(listOut).find((e) => e.path === resolvedWtPath);
  if (existing) {
    if (existing.branch === opts.missionBranch) {
      return { path: wtPath, branch: opts.missionBranch };
    }
    throw new Error(
      `Worktree path ${wtPath} already registered for branch ${
        existing.branch ?? '(detached)'
      }, expected ${opts.missionBranch}`,
    );
  }

  const branches = await git.branch();
  const branchAlreadyExists = branches.all.includes(opts.missionBranch);
  if (branchAlreadyExists) {
    await git.raw(['worktree', 'add', wtPath, opts.missionBranch]);
  } else {
    await git.raw(['worktree', 'add', '-b', opts.missionBranch, wtPath, opts.targetBranch]);
  }
  return { path: wtPath, branch: opts.missionBranch };
}

export async function resetWorktreeToHead(worktreePath: string): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.reset(['--hard', 'HEAD']);
  await git.raw(['clean', '-fdx']);
}

export type RebaseResult =
  | { conflict: false; rebased: true }
  | { conflict: false; rebased: false }
  | { conflict: true; rebased: false }
  | { conflict: false; rebased: false; error: string };

export async function rebaseOntoTarget(
  worktreePath: string,
  targetBranch: string,
): Promise<RebaseResult> {
  const git = simpleGit(worktreePath);
  try {
    // Fetch is best-effort — local fixture repos have no remote.
    try {
      await git.fetch();
    } catch {
      // ignore — proceed with local refs
    }
    const before = (await git.revparse(['HEAD'])).trim();
    await git.rebase([targetBranch]);
    const after = (await git.revparse(['HEAD'])).trim();
    return before !== after
      ? { rebased: true, conflict: false }
      : { rebased: false, conflict: false };
  } catch (err) {
    // Abort the rebase if it left the worktree mid-rebase.
    try {
      await git.rebase(['--abort']);
    } catch {
      // ignore
    }
    const message = (err as Error).message;
    if (/conflict/i.test(message)) return { rebased: false, conflict: true };
    return { rebased: false, conflict: false, error: message };
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
