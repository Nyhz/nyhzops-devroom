'use server';

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import simpleGit from 'simple-git';
import { eq, desc, and, isNotNull, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields } from '@/lib/db/schema';
import { getRepoPath } from '@/actions/_helpers';
import { removeWorktree } from '@/lib/orchestrator/worktree';
import type {
  WorktreeEntry,
  WorktreeState,
  BranchStats,
  ProblemBranch,
  QMLogEntry,
  RepoVitals,
  MissionStatus,
  MergeResultType,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: MissionStatus[] = [
  'standby',
  'queued',
  'deploying',
  'in_combat',
  'reviewing',
  'approved',
  'merging',
];

const DONE_STATUSES: MissionStatus[] = [
  'accomplished',
  'compromised',
  'abandoned',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get directory size in bytes using `du -sk`.
 * Returns 0 on error.
 */
function getDirSize(dirPath: string): number {
  try {
    const output = execSync(`du -sk "${dirPath}" 2>/dev/null`, {
      encoding: 'utf-8',
    }).trim();
    const kb = parseInt(output.split('\t')[0], 10);
    return isNaN(kb) ? 0 : kb * 1024;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Worktree Status
// ---------------------------------------------------------------------------

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Excludes the main (bare) worktree.
 */
async function parseWorktreeList(
  repoPath: string,
): Promise<Array<{ path: string; branch: string }>> {
  const git = simpleGit(repoPath);
  const raw = await git.raw(['worktree', 'list', '--porcelain']);

  const entries: Array<{ path: string; branch: string }> = [];
  let currentPath = '';
  let currentBranch = '';
  let isBare = false;

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
      currentBranch = '';
      isBare = false;
    } else if (line.startsWith('branch ')) {
      // e.g. "branch refs/heads/devroom/foo/bar"
      const ref = line.slice('branch '.length).trim();
      currentBranch = ref.replace('refs/heads/', '');
    } else if (line === 'bare') {
      isBare = true;
    } else if (line === '') {
      if (currentPath && currentBranch && !isBare) {
        // Skip the main repo path (it equals repoPath)
        if (currentPath !== repoPath) {
          entries.push({ path: currentPath, branch: currentBranch });
        }
      }
      currentPath = '';
      currentBranch = '';
      isBare = false;
    }
  }

  // Handle trailing entry with no trailing newline
  if (currentPath && currentBranch && !isBare && currentPath !== repoPath) {
    entries.push({ path: currentPath, branch: currentBranch });
  }

  return entries;
}

export async function getWorktreeStatus(
  battlefieldId: string,
): Promise<WorktreeEntry[]> {
  const repoPath = await getRepoPath(battlefieldId);
  const db = getDatabase();

  const worktrees = await parseWorktreeList(repoPath);

  if (worktrees.length === 0) return [];

  // Fetch all missions linked to these branches
  const branches = worktrees.map((w) => w.branch);
  const linkedMissions = db
    .select({
      id: missions.id,
      codename: missions.title, // title serves as codename in mission records
      status: missions.status,
      worktreeBranch: missions.worktreeBranch,
    })
    .from(missions)
    .where(inArray(missions.worktreeBranch, branches))
    .all();

  const missionByBranch = new Map(
    linkedMissions.map((m) => [m.worktreeBranch, m]),
  );

  return worktrees.map((wt) => {
    const mission = missionByBranch.get(wt.branch) ?? null;

    let state: WorktreeState;
    if (!mission) {
      state = 'orphaned';
    } else if (ACTIVE_STATUSES.includes(mission.status as MissionStatus)) {
      state = 'active';
    } else {
      state = 'stale';
    }

    // Age: seconds since last modification of the worktree directory
    let age = 0;
    try {
      const stat = fs.statSync(wt.path);
      age = Math.floor((Date.now() - stat.mtimeMs) / 1000);
    } catch {
      age = 0;
    }

    const diskUsage = getDirSize(wt.path);

    return {
      path: wt.path,
      branch: wt.branch,
      linkedMission: mission
        ? {
            id: mission.id,
            codename: mission.codename,
            status: mission.status as MissionStatus,
          }
        : null,
      age,
      diskUsage,
      state,
    };
  });
}

export async function cleanupWorktree(
  battlefieldId: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  await removeWorktree(repoPath, worktreePath, branch);
}

export async function cleanupAllStale(
  battlefieldId: string,
): Promise<{ cleaned: number }> {
  const worktrees = await getWorktreeStatus(battlefieldId);
  const staleOrOrphaned = worktrees.filter(
    (wt) => wt.state === 'stale' || wt.state === 'orphaned',
  );

  let cleaned = 0;
  for (const wt of staleOrOrphaned) {
    try {
      await cleanupWorktree(battlefieldId, wt.path, wt.branch);
      cleaned++;
    } catch {
      // Log and continue — partial cleanup is acceptable
    }
  }

  return { cleaned };
}

// ---------------------------------------------------------------------------
// Branch Hygiene
// ---------------------------------------------------------------------------

export async function getBranchHygiene(battlefieldId: string): Promise<{
  stats: BranchStats;
  problems: ProblemBranch[];
}> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  const db = getDatabase();

  const branchResult = await git.branchLocal();
  const allBranches = branchResult.all;

  // Branches merged into HEAD
  let mergedRaw = '';
  try {
    mergedRaw = await git.raw(['branch', '--merged']);
  } catch {
    mergedRaw = '';
  }
  const mergedBranches = new Set(
    mergedRaw
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean),
  );

  // Fetch active branches from missions table
  const activeMissions = db
    .select({ worktreeBranch: missions.worktreeBranch })
    .from(missions)
    .where(inArray(missions.status, ACTIVE_STATUSES))
    .all();

  const activeBranchSet = new Set(
    activeMissions
      .map((m) => m.worktreeBranch)
      .filter((b): b is string => b !== null),
  );

  const currentBranch = branchResult.current;

  const problems: ProblemBranch[] = [];

  for (const branch of allBranches) {
    // Skip the current branch and main/master
    if (
      branch === currentBranch ||
      branch === 'main' ||
      branch === 'master'
    ) {
      continue;
    }

    const isMerged = mergedBranches.has(branch);
    const isActive = activeBranchSet.has(branch);

    if (isMerged && !isActive) {
      // Branch is merged but not deleted
      let lastCommitAge = 0;
      try {
        const logResult = await git.log({
          maxCount: 1,
          from: branch,
          to: branch,
        });
        const dateStr = logResult.latest?.date;
        if (dateStr) {
          lastCommitAge = Math.floor(
            (Date.now() - new Date(dateStr).getTime()) / 1000,
          );
        }
      } catch {
        lastCommitAge = 0;
      }

      problems.push({
        name: branch,
        problem: 'merged',
        lastCommitAge,
      });
    } else if (!isMerged && !isActive) {
      // Diverged with no linked mission
      let ahead = 0;
      let behind = 0;
      let lastCommitAge = 0;

      try {
        const revList = await git.raw([
          'rev-list',
          '--left-right',
          '--count',
          `${currentBranch}...${branch}`,
        ]);
        const parts = revList.trim().split(/\s+/);
        behind = parseInt(parts[0] ?? '0', 10);
        ahead = parseInt(parts[1] ?? '0', 10);
      } catch {
        // ignore
      }

      try {
        const logResult = await git.log({
          maxCount: 1,
          from: branch,
          to: branch,
        });
        const dateStr = logResult.latest?.date;
        if (dateStr) {
          lastCommitAge = Math.floor(
            (Date.now() - new Date(dateStr).getTime()) / 1000,
          );
        }
      } catch {
        lastCommitAge = 0;
      }

      problems.push({
        name: branch,
        problem: 'diverged',
        lastCommitAge,
        ahead,
        behind,
      });
    }
  }

  const mergedCount = allBranches.filter((b) => mergedBranches.has(b)).length;
  const stats: BranchStats = {
    total: allBranches.length,
    merged: mergedCount,
    unmerged: allBranches.length - mergedCount,
    active: activeBranchSet.size,
  };

  return { stats, problems };
}

export async function deleteBranch(
  battlefieldId: string,
  branch: string,
): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.branch(['-d', branch]);
}

export async function pruneAllMerged(
  battlefieldId: string,
): Promise<{ pruned: number }> {
  const { problems } = await getBranchHygiene(battlefieldId);
  const mergedProblems = problems.filter((p) => p.problem === 'merged');

  let pruned = 0;
  for (const p of mergedProblems) {
    try {
      await deleteBranch(battlefieldId, p.name);
      pruned++;
    } catch {
      // Continue on failure — partial pruning is acceptable
    }
  }

  return { pruned };
}

// ---------------------------------------------------------------------------
// Quartermaster Log
// ---------------------------------------------------------------------------

export async function getQuartermasterLog(
  battlefieldId: string,
  limit = 50,
): Promise<QMLogEntry[]> {
  const db = getDatabase();

  const rows = db
    .select({
      id: missions.id,
      title: missions.title,
      worktreeBranch: missions.worktreeBranch,
      mergeResult: missions.mergeResult,
      mergeConflictFiles: missions.mergeConflictFiles,
      mergeTimestamp: missions.mergeTimestamp,
    })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        isNotNull(missions.mergeResult),
      ),
    )
    .orderBy(desc(missions.mergeTimestamp))
    .limit(limit)
    .all()
    .filter((r) => r.mergeResult !== null);

  // Fetch battlefield default branch for targetBranch
  const bf = db
    .select({ defaultBranch: battlefields.defaultBranch })
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  const targetBranch = bf?.defaultBranch ?? 'main';

  return rows.map((row) => {
    let conflictFiles: string[] = [];
    if (row.mergeConflictFiles) {
      try {
        conflictFiles = JSON.parse(row.mergeConflictFiles) as string[];
      } catch {
        conflictFiles = [];
      }
    }

    return {
      missionId: row.id,
      missionCodename: row.title,
      sourceBranch: row.worktreeBranch ?? '',
      targetBranch,
      result: row.mergeResult as MergeResultType,
      conflictFiles,
      resolutionSummary: null,
      timestamp: row.mergeTimestamp ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Repo Vitals
// ---------------------------------------------------------------------------

export async function getRepoVitals(battlefieldId: string): Promise<RepoVitals> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);

  // Repo size — size of .git directory
  const gitDir = path.join(repoPath, '.git');
  const repoSize = getDirSize(gitDir);

  // Total commits
  let totalCommits = 0;
  try {
    const countRaw = await git.raw(['rev-list', '--count', 'HEAD']);
    totalCommits = parseInt(countRaw.trim(), 10) || 0;
  } catch {
    totalCommits = 0;
  }

  // Last commit
  let lastCommit: RepoVitals['lastCommit'] = null;
  try {
    const logResult = await git.log({ maxCount: 1 });
    if (logResult.latest) {
      lastCommit = {
        message: logResult.latest.message,
        timestamp: new Date(logResult.latest.date).getTime(),
      };
    }
  } catch {
    lastCommit = null;
  }

  // Worktree disk total
  const worktreesDir = path.join(repoPath, '.worktrees');
  const worktreeDisk = fs.existsSync(worktreesDir)
    ? getDirSize(worktreesDir)
    : 0;

  // Current branch name (main branch of repo)
  let mainBranch = 'main';
  try {
    const branchResult = await git.branchLocal();
    mainBranch = branchResult.current || 'main';
  } catch {
    mainBranch = 'main';
  }

  // Dirty status
  let isDirty = false;
  try {
    const status = await git.status();
    isDirty = !status.isClean();
  } catch {
    isDirty = false;
  }

  return {
    repoSize,
    totalCommits,
    lastCommit,
    worktreeDisk,
    mainBranch,
    isDirty,
  };
}
