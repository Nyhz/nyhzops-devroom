import simpleGit from 'simple-git';
import path from 'node:path';
import { realpath, readFile, writeFile, mkdir } from 'node:fs/promises';
import { getGitIdentity } from './git-identity';

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

  // Register `.devroom/` in the worktree's private exclude so the asset's
  // debrief file (written at end of mission) is never stageable by `git add`.
  // Per-worktree `info/exclude` is an official git mechanism — invisible to
  // the user's repo-level .gitignore, scoped to this worktree's lifetime.
  await addToWorktreeExclude(wtPath, '.devroom/');

  // Pre-configure the local git identity for this worktree so the asset's
  // first `git commit` doesn't trip on "Please tell me who you are." Some
  // agents react to that error by retrying with `-c user.email=… -c
  // user.name=… commit`, which works but is a wasted detour and obscures
  // what actually went wrong. Keep these scoped to the worktree config so
  // they never bleed into the user's global git identity. Identity comes
  // from `DEVROOM_GIT_USER` / `DEVROOM_GIT_EMAIL` (see git-identity.ts).
  const wtGit = simpleGit(wtPath);
  try {
    const id = getGitIdentity();
    await wtGit.addConfig('user.name', id.name, false, 'local');
    await wtGit.addConfig('user.email', id.email, false, 'local');
  } catch {
    // best-effort — agent will fall back to the inline-identity dance
  }

  return { path: wtPath, branch: opts.missionBranch };
}

/**
 * Resolve a worktree's private `info/exclude` path. Linked worktrees keep
 * their gitdir under `<main-repo>/.git/worktrees/<wt>/`; the common repo's
 * `info/exclude` applies to all worktrees, but the per-worktree path is
 * where scoped ignores belong.
 */
async function worktreeExcludePath(wtPath: string): Promise<string | null> {
  // The `.git` entry inside a linked worktree is a file containing
  // `gitdir: <absolute path>`. Resolve that, then `info/exclude` under it.
  try {
    const gitFile = path.join(wtPath, '.git');
    const raw = await readFile(gitFile, 'utf-8');
    const m = raw.match(/^gitdir:\s*(.+)$/m);
    if (!m) return null;
    return path.join(m[1].trim(), 'info', 'exclude');
  } catch {
    return null;
  }
}

async function addToWorktreeExclude(wtPath: string, pattern: string): Promise<void> {
  const excludePath = await worktreeExcludePath(wtPath);
  if (!excludePath) return; // best-effort — don't break worktree creation
  try {
    let existing = '';
    try { existing = await readFile(excludePath, 'utf-8'); } catch { /* new file */ }
    if (existing.split('\n').some((l) => l.trim() === pattern)) return;
    await mkdir(path.dirname(excludePath), { recursive: true });
    const next = existing.endsWith('\n') || existing.length === 0
      ? `${existing}${pattern}\n`
      : `${existing}\n${pattern}\n`;
    await writeFile(excludePath, next);
  } catch {
    // ignore — the asset instruction is still the primary safeguard
  }
}

export async function resetWorktreeToHead(worktreePath: string): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.reset(['--hard', 'HEAD']);
  await git.raw(['clean', '-fdx']);
}

export type RebaseResult =
  | { conflict: false; rebased: true }
  | { conflict: false; rebased: false }
  | { conflict: true; rebased: false; conflictFiles: string[] }
  | { conflict: false; rebased: false; error: string };

/**
 * Capture conflicting paths from `git status --porcelain` while the worktree
 * is still mid-rebase. After `git rebase --abort` runs, the index is reset and
 * these markers vanish — so this MUST be called before the abort.
 */
async function collectConflictFiles(worktreePath: string): Promise<string[]> {
  try {
    const git = simpleGit(worktreePath);
    const status = await git.raw(['status', '--porcelain']);
    const files: string[] = [];
    for (const line of status.split('\n')) {
      // XY codes for conflict states: UU, AA, DD, AU, UA, DU, UD.
      const m = line.match(/^(UU|AA|DD|AU|UA|DU|UD) (.+)$/);
      if (m) files.push(m[2]);
    }
    return files;
  } catch {
    return [];
  }
}

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
    const message = (err as Error).message;
    const isConflict = /conflict/i.test(message);
    // Snapshot conflict files BEFORE aborting — abort wipes the markers.
    const conflictFiles = isConflict ? await collectConflictFiles(worktreePath) : [];
    try {
      await git.rebase(['--abort']);
    } catch {
      // ignore
    }
    if (isConflict) return { rebased: false, conflict: true, conflictFiles };
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
  const id = getGitIdentity();
  await git
    .env('GIT_AUTHOR_NAME', id.name)
    .env('GIT_AUTHOR_EMAIL', id.email)
    .env('GIT_COMMITTER_NAME', id.name)
    .env('GIT_COMMITTER_EMAIL', id.email)
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
