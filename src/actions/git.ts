'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import simpleGit from 'simple-git';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import type {
  FileEntry,
  CommitEntry,
  GitStatusResult,
  GitLogResult,
  GitBranchesResult,
} from '@/types';

// ---------------------------------------------------------------------------
// Helper: resolve repoPath from battlefieldId
// ---------------------------------------------------------------------------
async function getRepoPath(battlefieldId: string): Promise<string> {
  const db = getDatabase();
  const battlefield = db
    .select({ repoPath: battlefields.repoPath })
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield) {
    throw new Error(`Battlefield ${battlefieldId} not found`);
  }

  return battlefield.repoPath;
}

// ---------------------------------------------------------------------------
// 1. getGitStatus
// ---------------------------------------------------------------------------
export async function getGitStatus(battlefieldId: string): Promise<GitStatusResult> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  const status = await git.status();

  const staged: FileEntry[] = status.staged.map((filePath) => {
    // Determine status from the individual file arrays
    let fileStatus = 'staged';
    if (status.created.includes(filePath)) fileStatus = 'added';
    else if (status.deleted.includes(filePath)) fileStatus = 'deleted';
    else if (status.renamed.some((r) => r.to === filePath)) fileStatus = 'renamed';
    else fileStatus = 'modified';
    return { path: filePath, status: fileStatus };
  });

  const modified: FileEntry[] = status.modified
    .filter((filePath) => !status.staged.includes(filePath))
    .map((filePath) => ({ path: filePath, status: 'modified' }));

  // Add deleted files that are not staged
  const unstagedDeleted: FileEntry[] = status.deleted
    .filter((filePath) => !status.staged.includes(filePath))
    .map((filePath) => ({ path: filePath, status: 'deleted' }));

  const untracked: FileEntry[] = status.not_added.map((filePath) => ({
    path: filePath,
    status: 'untracked',
  }));

  return {
    staged,
    modified: [...modified, ...unstagedDeleted],
    untracked,
  };
}

// ---------------------------------------------------------------------------
// 2. stageFile
// ---------------------------------------------------------------------------
export async function stageFile(battlefieldId: string, filePath: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.add(filePath);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 3. unstageFile
// ---------------------------------------------------------------------------
export async function unstageFile(battlefieldId: string, filePath: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.reset(['HEAD', '--', filePath]);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 4. stageAll
// ---------------------------------------------------------------------------
export async function stageAll(battlefieldId: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.add('-A');
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 5. unstageAll
// ---------------------------------------------------------------------------
export async function unstageAll(battlefieldId: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.reset(['HEAD']);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 6. commitChanges
// ---------------------------------------------------------------------------
export async function commitChanges(battlefieldId: string, message: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.commit(message);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 7. getGitLog
// ---------------------------------------------------------------------------
export async function getGitLog(
  battlefieldId: string,
  limit = 50,
  offset = 0,
): Promise<GitLogResult> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);

  const log = await git.log({ maxCount: limit + offset });

  const commits: CommitEntry[] = log.all
    .slice(offset, offset + limit)
    .map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      refs: entry.refs,
    }));

  return { commits };
}

// ---------------------------------------------------------------------------
// 8. getBranches
// ---------------------------------------------------------------------------
export async function getBranches(battlefieldId: string): Promise<GitBranchesResult> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  const branchSummary = await git.branchLocal();

  return {
    current: branchSummary.current,
    local: branchSummary.all.map((name) => ({
      name,
      current: name === branchSummary.current,
    })),
  };
}

// ---------------------------------------------------------------------------
// 9. checkoutBranch
// ---------------------------------------------------------------------------
export async function checkoutBranch(battlefieldId: string, branch: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.checkout(branch);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 10. deleteBranch
// ---------------------------------------------------------------------------
export async function deleteBranch(battlefieldId: string, branch: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.branch(['-d', branch]);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 11. createBranch
// ---------------------------------------------------------------------------
export async function createBranch(battlefieldId: string, name: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.branch([name]);
  revalidatePath(`/projects/${battlefieldId}/git`);
}

// ---------------------------------------------------------------------------
// 12. getFileDiff
// ---------------------------------------------------------------------------
export async function getFileDiff(battlefieldId: string, filePath: string): Promise<string> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);

  // Try unstaged diff first
  let diff = await git.diff([filePath]);

  // If no unstaged diff, try staged diff
  if (!diff) {
    diff = await git.diff(['--cached', filePath]);
  }

  return diff;
}
