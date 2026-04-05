import type { MissionStatus } from './status';
import type { MergeResultType } from './orchestrator';

// ---------------------------------------------------------------------------
// Field Check types
// ---------------------------------------------------------------------------
export type WorktreeState = 'active' | 'stale' | 'orphaned';

export interface WorktreeEntry {
  path: string;
  branch: string;
  linkedMission: { id: string; codename: string; status: MissionStatus } | null;
  age: number;
  diskUsage: number;
  state: WorktreeState;
}

export interface BranchStats {
  total: number;
  merged: number;
  unmerged: number;
  active: number;
}

export type BranchProblem = 'merged' | 'stale' | 'diverged';

export interface ProblemBranch {
  name: string;
  problem: BranchProblem;
  lastCommitAge: number;
  ahead?: number;
  behind?: number;
}

export interface QMLogEntry {
  missionId: string;
  missionCodename: string;
  sourceBranch: string;
  targetBranch: string;
  result: MergeResultType;
  conflictFiles: string[];
  resolutionSummary: string | null;
  timestamp: number;
}

export interface RepoVitals {
  repoSize: number;
  totalCommits: number;
  lastCommit: { message: string; timestamp: number } | null;
  worktreeDisk: number;
  mainBranch: string;
  isDirty: boolean;
}
