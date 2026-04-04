# FIELD CHECK & TELEMETRY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `/git` and `/console` pages with FIELD CHECK (repository hygiene dashboard) and TELEMETRY (system diagnostics center).

**Architecture:** Two new page routes under `/battlefields/[id]/`. FIELD CHECK is server-rendered with client-side actions for cleanup operations. TELEMETRY has live Socket.IO subscriptions for active processes and service health. Both pages use the existing `TacCard`, `TacButton`, `PageWrapper` component patterns. A DB migration adds merge metadata columns to the missions table. The Quartermaster is updated to persist merge results.

**Tech Stack:** Next.js App Router, Drizzle ORM, simple-git, Socket.IO, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-04-05-field-check-telemetry-design.md`

---

## Task 1: Database Migration — Add Merge Metadata to Missions

**Files:**
- Modify: `src/lib/db/schema.ts:29-58` (missions table)
- Create: `src/lib/db/migrations/0015_field_check_telemetry.sql`

- [ ] **Step 1: Add columns to missions schema**

In `src/lib/db/schema.ts`, add three new columns to the `missions` table definition, after the `mergeRetryAt` column:

```typescript
  mergeResult: text('merge_result'),           // 'clean' | 'conflict_resolved' | 'failed' | null
  mergeConflictFiles: text('merge_conflict_files'), // JSON array of file paths
  mergeTimestamp: integer('merge_timestamp'),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`

Expected: A new migration SQL file created in `src/lib/db/migrations/`. Verify it contains three `ALTER TABLE missions ADD COLUMN` statements.

- [ ] **Step 3: Apply the migration**

Run: `pnpm dev` (migrations auto-apply on startup) or check that the migration applies.

Verify by running: `pnpm drizzle-kit push` if needed.

- [ ] **Step 4: Add types to types/index.ts**

In `src/types/index.ts`, add the merge result type and the new page types after the existing Git Dashboard types section. Replace the Git Dashboard types section entirely:

```typescript
// ---------------------------------------------------------------------------
// Merge result metadata
// ---------------------------------------------------------------------------
export type MergeResultType = 'clean' | 'conflict_resolved' | 'failed';

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

// ---------------------------------------------------------------------------
// Telemetry types
// ---------------------------------------------------------------------------
export interface ProcessEntry {
  missionId: string;
  missionCodename: string;
  asset: string;
  pid: number;
  startedAt: number;
  status: MissionStatus;
  memoryRss: number;
  lastOutputAt: number;
}

export interface ResourceMetrics {
  agentSlots: { active: number; max: number };
  worktreeDisk: number;
  tempDisk: number;
  dbSize: number;
  socketConnections: number;
}

export type FailureType = 'timeout' | 'auth_failure' | 'cli_error' | 'stall_killed' | 'killed' | 'unknown';

export interface ExitEntry {
  missionId: string;
  missionCodename: string;
  exitCode: number | null;
  duration: number;
  failureType: FailureType | null;
  timestamp: number;
}

export interface ServiceHealthStatus {
  scheduler: {
    status: 'running' | 'stalled';
    lastTick: number | null;
    nextFire: number | null;
    missedRuns: number;
  };
  overseer: {
    pendingReviews: number;
    avgReviewTime: number | null;
    lastReview: number | null;
  };
  quartermaster: {
    pendingMerges: number;
    lastMerge: number | null;
  };
  stallDetection: {
    count24h: number;
    lastStall: {
      missionCodename: string;
      timestamp: number;
      overseerDecision: string;
    } | null;
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/ src/types/index.ts
git commit -m "feat: add merge metadata columns and field-check/telemetry types"
```

---

## Task 2: Update Quartermaster to Persist Merge Metadata

**Files:**
- Modify: `src/lib/quartermaster/quartermaster.ts`
- Modify: `src/lib/quartermaster/merge-executor.ts`

- [ ] **Step 1: Extend MergeResult type**

In `src/types/index.ts`, update the existing `MergeResult` interface to include conflict file tracking:

```typescript
export interface MergeResult {
  success: boolean;
  conflictResolved: boolean;
  conflictFiles?: string[];
  error?: string;
}
```

- [ ] **Step 2: Track conflict files in merge-executor.ts**

In `src/lib/quartermaster/merge-executor.ts`, after the `attemptMerge` function catches a `ConflictError` (around line 88-98), capture the list of conflicted files from git status before calling `resolveConflicts`. Add this before the `resolveConflicts` call:

```typescript
    // Capture conflicted files for logging
    const conflictStatus = await git.status();
    const conflictFiles = conflictStatus.conflicted;
```

When `resolveConflicts` returns `true`, return:

```typescript
      return { success: true, conflictResolved: true, conflictFiles };
```

- [ ] **Step 3: Persist merge metadata in quartermaster.ts**

In `src/lib/quartermaster/quartermaster.ts`, after `executeMerge` returns (line 130-145), persist the merge result to the missions table. After `const result = await executeMerge(...)`:

```typescript
  // Persist merge metadata for Field Check page
  const mergeResult: MergeResultType = result.success
    ? (result.conflictResolved ? 'conflict_resolved' : 'clean')
    : 'failed';

  db.update(missions)
    .set({
      mergeResult,
      mergeConflictFiles: result.conflictFiles ? JSON.stringify(result.conflictFiles) : null,
      mergeTimestamp: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(missions.id, missionId))
    .run();
```

Add the import at the top:

```typescript
import type { Mission, MergeResultType } from '@/types';
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/quartermaster/quartermaster.ts src/lib/quartermaster/merge-executor.ts src/types/index.ts
git commit -m "feat: persist merge metadata in Quartermaster for Field Check page"
```

---

## Task 3: Field Check Server Actions

**Files:**
- Create: `src/actions/field-check.ts`

- [ ] **Step 1: Write tests for field-check actions**

Create `src/actions/__tests__/field-check.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock simple-git
const mockGit = {
  raw: vi.fn(),
  branch: vi.fn(),
  log: vi.fn(),
  status: vi.fn(),
};
vi.mock('simple-git', () => ({
  default: () => mockGit,
}));

// Mock DB
const mockGet = vi.fn();
const mockAll = vi.fn();
vi.mock('@/lib/db/index', () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: mockGet,
          all: mockAll,
          orderBy: () => ({
            limit: () => ({
              all: mockAll,
            }),
          }),
        }),
      }),
    }),
  }),
}));

// Mock _helpers
vi.mock('@/actions/_helpers', () => ({
  getRepoPath: vi.fn().mockResolvedValue('/fake/repo'),
}));

describe('field-check actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWorktreeStatus', () => {
    it('returns empty array when no worktrees exist', async () => {
      mockGit.raw.mockResolvedValue('');
      const { getWorktreeStatus } = await import('../field-check');
      const result = await getWorktreeStatus('bf-1');
      expect(result).toEqual([]);
    });
  });

  describe('getBranchHygiene', () => {
    it('returns stats with zero problems when branches are clean', async () => {
      mockGit.branch.mockResolvedValue({
        all: ['main'],
        current: 'main',
        branches: { main: { current: true, name: 'main', commit: 'abc', label: '' } },
      });
      mockGit.raw.mockResolvedValue('');
      mockAll.mockReturnValue([]);
      const { getBranchHygiene } = await import('../field-check');
      const result = await getBranchHygiene('bf-1');
      expect(result.stats.total).toBeGreaterThanOrEqual(0);
      expect(result.problems).toEqual([]);
    });
  });

  describe('getRepoVitals', () => {
    it('returns repo vitals', async () => {
      mockGit.log.mockResolvedValue({
        total: 42,
        latest: { hash: 'abc', message: 'test', date: '2026-04-05' },
        all: [],
      });
      mockGit.status.mockResolvedValue({ isClean: () => true });
      mockGit.raw.mockResolvedValue('main');
      const { getRepoVitals } = await import('../field-check');
      const result = await getRepoVitals('bf-1');
      expect(result.totalCommits).toBe(42);
      expect(result.isDirty).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/actions/__tests__/field-check.test.ts`

Expected: FAIL — module `../field-check` not found.

- [ ] **Step 3: Implement field-check.ts**

Create `src/actions/field-check.ts`:

```typescript
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
// Helpers
// ---------------------------------------------------------------------------

function getDirSize(dirPath: string): number {
  try {
    const output = execSync(`du -sk "${dirPath}" 2>/dev/null`, { encoding: 'utf-8' });
    const kb = parseInt(output.split('\t')[0], 10);
    return isNaN(kb) ? 0 : kb * 1024;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Worktree Status
// ---------------------------------------------------------------------------

export async function getWorktreeStatus(battlefieldId: string): Promise<WorktreeEntry[]> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  const db = getDatabase();

  // Parse worktree list
  const raw = await git.raw(['worktree', 'list', '--porcelain']);
  if (!raw.trim()) return [];

  const entries: WorktreeEntry[] = [];
  const blocks = raw.trim().split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n');
    const wtPath = lines.find(l => l.startsWith('worktree '))?.slice(9);
    const branch = lines.find(l => l.startsWith('branch '))?.slice(7)?.replace('refs/heads/', '');

    // Skip the main worktree (the repo itself)
    if (!wtPath || !branch || wtPath === repoPath) continue;

    // Find linked mission by worktreeBranch
    const linked = db
      .select({
        id: missions.id,
        title: missions.title,
        status: missions.status,
      })
      .from(missions)
      .where(eq(missions.worktreeBranch, branch))
      .get();

    // Determine state
    let state: WorktreeState = 'orphaned';
    if (linked) {
      const activeStatuses: MissionStatus[] = ['standby', 'queued', 'deploying', 'in_combat', 'reviewing', 'approved', 'merging'];
      state = activeStatuses.includes(linked.status as MissionStatus) ? 'active' : 'stale';
    }

    const diskUsage = getDirSize(wtPath);

    // Approximate age from directory creation
    let age = 0;
    try {
      const stat = fs.statSync(wtPath);
      age = Date.now() - stat.birthtimeMs;
    } catch { /* directory may not exist */ }

    entries.push({
      path: wtPath,
      branch,
      linkedMission: linked
        ? { id: linked.id, codename: linked.title, status: linked.status as MissionStatus }
        : null,
      age,
      diskUsage,
      state,
    });
  }

  return entries;
}

export async function cleanupWorktree(battlefieldId: string, worktreePath: string, branch: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  await removeWorktree(repoPath, worktreePath, branch);
}

export async function cleanupAllStale(battlefieldId: string): Promise<{ cleaned: number }> {
  const worktrees = await getWorktreeStatus(battlefieldId);
  const stale = worktrees.filter(w => w.state === 'stale' || w.state === 'orphaned');

  for (const wt of stale) {
    await cleanupWorktree(battlefieldId, wt.path, wt.branch);
  }

  return { cleaned: stale.length };
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
  const allBranches = Object.keys(branchResult.branches);
  const defaultBranch = branchResult.current || 'main';

  // Get merged branches
  const mergedRaw = await git.raw(['branch', '--merged', defaultBranch]);
  const mergedBranches = new Set(
    mergedRaw
      .split('\n')
      .map(b => b.trim().replace('* ', ''))
      .filter(b => b && b !== defaultBranch),
  );

  // Get active mission branches
  const activeMissions = db
    .select({ worktreeBranch: missions.worktreeBranch })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        isNotNull(missions.worktreeBranch),
        inArray(missions.status, ['standby', 'queued', 'deploying', 'in_combat', 'reviewing', 'approved', 'merging']),
      ),
    )
    .all();

  const activeBranchNames = new Set(activeMissions.map(m => m.worktreeBranch).filter(Boolean));

  const problems: ProblemBranch[] = [];
  let merged = 0;
  let unmerged = 0;
  let active = 0;

  for (const name of allBranches) {
    if (name === defaultBranch) continue;

    if (activeBranchNames.has(name)) {
      active++;
      continue;
    }

    if (mergedBranches.has(name)) {
      merged++;
      // Get age of last commit on branch
      let lastCommitAge = 0;
      try {
        const log = await git.log({ maxCount: 1, from: name });
        if (log.latest?.date) {
          lastCommitAge = Date.now() - new Date(log.latest.date).getTime();
        }
      } catch { /* skip */ }
      problems.push({ name, problem: 'merged', lastCommitAge });
    } else {
      unmerged++;
      // Check divergence
      try {
        const ahead = await git.raw(['rev-list', '--count', `${defaultBranch}..${name}`]);
        const behind = await git.raw(['rev-list', '--count', `${name}..${defaultBranch}`]);
        const log = await git.log({ maxCount: 1, from: name });
        const lastCommitAge = log.latest?.date
          ? Date.now() - new Date(log.latest.date).getTime()
          : 0;

        // Only flag as problem if stale (no linked mission) and diverged
        if (!activeBranchNames.has(name)) {
          problems.push({
            name,
            problem: 'diverged',
            lastCommitAge,
            ahead: parseInt(ahead.trim(), 10),
            behind: parseInt(behind.trim(), 10),
          });
        }
      } catch { /* skip */ }
    }
  }

  return {
    stats: {
      total: allBranches.length,
      merged,
      unmerged,
      active,
    },
    problems,
  };
}

export async function deleteBranch(battlefieldId: string, branch: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);
  await git.branch(['-d', branch]);
}

export async function pruneAllMerged(battlefieldId: string): Promise<{ pruned: number }> {
  const { problems } = await getBranchHygiene(battlefieldId);
  const merged = problems.filter(p => p.problem === 'merged');

  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);

  for (const branch of merged) {
    try {
      await git.branch(['-d', branch.name]);
    } catch (err) {
      console.warn(`[FieldCheck] Failed to delete branch ${branch.name}:`, err);
    }
  }

  return { pruned: merged.length };
}

// ---------------------------------------------------------------------------
// Quartermaster Activity Log
// ---------------------------------------------------------------------------

export async function getQuartermasterLog(
  battlefieldId: string,
  limit = 20,
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
      debrief: missions.debrief,
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
    .all();

  const bf = db
    .select({ defaultBranch: battlefields.defaultBranch })
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  const targetBranch = bf?.defaultBranch || 'main';

  return rows.map(row => ({
    missionId: row.id,
    missionCodename: row.title,
    sourceBranch: row.worktreeBranch || 'unknown',
    targetBranch,
    result: row.mergeResult as MergeResultType,
    conflictFiles: row.mergeConflictFiles ? JSON.parse(row.mergeConflictFiles) : [],
    resolutionSummary: null, // Could extract from debrief in future
    timestamp: row.mergeTimestamp || 0,
  }));
}

// ---------------------------------------------------------------------------
// Repo Vitals
// ---------------------------------------------------------------------------

export async function getRepoVitals(battlefieldId: string): Promise<RepoVitals> {
  const repoPath = await getRepoPath(battlefieldId);
  const git = simpleGit(repoPath);

  const gitDir = path.join(repoPath, '.git');
  const repoSize = getDirSize(gitDir);

  const log = await git.log();
  const totalCommits = log.total;

  const lastCommit = log.latest
    ? { message: log.latest.message, timestamp: new Date(log.latest.date).getTime() }
    : null;

  const worktreeDir = path.join(repoPath, '.worktrees');
  const worktreeDisk = fs.existsSync(worktreeDir) ? getDirSize(worktreeDir) : 0;

  const defaultBranchRaw = await git.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
  const mainBranch = defaultBranchRaw.trim();

  const status = await git.status();
  const isDirty = !status.isClean();

  return {
    repoSize,
    totalCommits,
    lastCommit,
    worktreeDisk,
    mainBranch,
    isDirty,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/actions/__tests__/field-check.test.ts`

Expected: Tests should pass (or adjust mocks as needed for the implementation).

- [ ] **Step 5: Commit**

```bash
git add src/actions/field-check.ts src/actions/__tests__/field-check.test.ts
git commit -m "feat: add field-check server actions with tests"
```

---

## Task 4: Field Check Page & Components

**Files:**
- Create: `src/app/(hq)/battlefields/[id]/field-check/page.tsx`
- Create: `src/app/(hq)/battlefields/[id]/field-check/loading.tsx`
- Create: `src/components/field-check/worktree-board.tsx`
- Create: `src/components/field-check/branch-hygiene.tsx`
- Create: `src/components/field-check/quartermaster-log.tsx`
- Create: `src/components/field-check/repo-vitals.tsx`

- [ ] **Step 1: Create the page component**

Create `src/app/(hq)/battlefields/[id]/field-check/page.tsx`:

```typescript
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import {
  getWorktreeStatus,
  getBranchHygiene,
  getQuartermasterLog,
  getRepoVitals,
} from '@/actions/field-check';
import { WorktreeBoard } from '@/components/field-check/worktree-board';
import { BranchHygiene } from '@/components/field-check/branch-hygiene';
import { QuartermasterLog } from '@/components/field-check/quartermaster-log';
import { RepoVitals } from '@/components/field-check/repo-vitals';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function FieldCheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [worktrees, hygiene, qmLog, vitals] = await Promise.all([
    getWorktreeStatus(id),
    getBranchHygiene(id),
    getQuartermasterLog(id),
    getRepoVitals(id),
  ]);

  const db = getDatabase();
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'FIELD CHECK']}
      title="FIELD CHECK"
      className="space-y-4"
    >
      <WorktreeBoard battlefieldId={id} initialWorktrees={worktrees} />
      <BranchHygiene battlefieldId={id} initialData={hygiene} />
      <QuartermasterLog entries={qmLog} battlefieldId={id} />
      <RepoVitals vitals={vitals} />
    </PageWrapper>
  );
}
```

- [ ] **Step 2: Create loading skeleton**

Create `src/app/(hq)/battlefields/[id]/field-check/loading.tsx`:

```typescript
export default function FieldCheckLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="h-3 w-40 bg-dr-elevated animate-pulse mb-1" />
        <div className="h-5 w-32 bg-dr-elevated animate-pulse" />
      </div>

      {/* Worktree Board */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-4 w-48 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
      </div>

      {/* Branch Hygiene */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-4 w-40 bg-dr-elevated animate-pulse" />
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 w-24 bg-dr-bg border border-dr-border animate-pulse" />
          ))}
        </div>
      </div>

      {/* QM Log */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-4 w-52 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
      </div>

      {/* Repo Vitals */}
      <div className="bg-dr-surface border border-dr-border p-4">
        <div className="h-4 w-32 bg-dr-elevated animate-pulse mb-3" />
        <div className="flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 w-32 bg-dr-bg border border-dr-border animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create WorktreeBoard component**

Create `src/components/field-check/worktree-board.tsx`:

```typescript
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { useConfirm } from '@/hooks/use-confirm';
import { cleanupWorktree, cleanupAllStale } from '@/actions/field-check';
import { cn } from '@/lib/utils';
import type { WorktreeEntry, WorktreeState } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const STATE_STYLES: Record<WorktreeState, { label: string; color: string }> = {
  active: { label: 'ACTIVE', color: 'text-dr-green' },
  stale: { label: 'STALE', color: 'text-dr-amber' },
  orphaned: { label: 'ORPHANED', color: 'text-dr-red' },
};

interface WorktreeBoardProps {
  battlefieldId: string;
  initialWorktrees: WorktreeEntry[];
}

export function WorktreeBoard({ battlefieldId, initialWorktrees }: WorktreeBoardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  const staleCount = initialWorktrees.filter(w => w.state === 'stale' || w.state === 'orphaned').length;

  async function handleCleanup(wt: WorktreeEntry) {
    const ok = await confirm(`Remove worktree ${wt.branch}?`);
    if (!ok) return;
    startTransition(async () => {
      await cleanupWorktree(battlefieldId, wt.path, wt.branch);
      router.refresh();
    });
  }

  async function handleCleanupAll() {
    const ok = await confirm(`Remove ${staleCount} stale/orphaned worktree(s)?`);
    if (!ok) return;
    startTransition(async () => {
      await cleanupAllStale(battlefieldId);
      router.refresh();
    });
  }

  return (
    <TacCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-dr-text text-xs font-tactical tracking-wider">WORKTREE STATUS</h3>
        {staleCount > 0 && (
          <TacButton
            variant="danger"
            size="sm"
            onClick={handleCleanupAll}
            disabled={pending}
          >
            CLEANUP ALL STALE ({staleCount})
          </TacButton>
        )}
      </div>

      {initialWorktrees.length === 0 ? (
        <p className="text-dr-dim text-xs font-mono">NO WORKTREES — All clean.</p>
      ) : (
        <div className="space-y-1">
          {initialWorktrees.map((wt) => {
            const style = STATE_STYLES[wt.state];
            return (
              <div
                key={wt.path}
                className="flex items-center gap-3 px-2 py-1.5 text-xs font-mono bg-dr-bg border border-dr-border"
              >
                <span className={cn('shrink-0', style.color)}>● {style.label}</span>
                <span className="text-dr-muted truncate flex-1" title={wt.branch}>
                  {wt.branch}
                </span>
                {wt.linkedMission && (
                  <Link
                    href={`/battlefields/${battlefieldId}/missions/${wt.linkedMission.id}`}
                    className="text-dr-amber hover:underline shrink-0"
                  >
                    {wt.linkedMission.codename}
                  </Link>
                )}
                <span className="text-dr-dim shrink-0">{formatAge(wt.age)}</span>
                <span className="text-dr-dim shrink-0">{formatBytes(wt.diskUsage)}</span>
                {wt.state !== 'active' && (
                  <TacButton
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCleanup(wt)}
                    disabled={pending}
                  >
                    CLEANUP
                  </TacButton>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog />
    </TacCard>
  );
}
```

- [ ] **Step 4: Create BranchHygiene component**

Create `src/components/field-check/branch-hygiene.tsx`:

```typescript
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { useConfirm } from '@/hooks/use-confirm';
import { deleteBranch, pruneAllMerged } from '@/actions/field-check';
import { cn } from '@/lib/utils';
import type { BranchStats, ProblemBranch } from '@/types';

function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

interface BranchHygieneProps {
  battlefieldId: string;
  initialData: { stats: BranchStats; problems: ProblemBranch[] };
}

export function BranchHygiene({ battlefieldId, initialData }: BranchHygieneProps) {
  const { stats, problems } = initialData;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  const mergedCount = problems.filter(p => p.problem === 'merged').length;

  async function handleDelete(branch: string) {
    const ok = await confirm(`Delete branch ${branch}?`);
    if (!ok) return;
    startTransition(async () => {
      await deleteBranch(battlefieldId, branch);
      router.refresh();
    });
  }

  async function handlePruneAll() {
    const ok = await confirm(`Delete ${mergedCount} merged branch(es)?`);
    if (!ok) return;
    startTransition(async () => {
      await pruneAllMerged(battlefieldId);
      router.refresh();
    });
  }

  const statItems = [
    { label: 'TOTAL', value: stats.total, color: 'text-dr-text' },
    { label: 'MERGED', value: stats.merged, color: 'text-dr-amber' },
    { label: 'UNMERGED', value: stats.unmerged, color: 'text-dr-muted' },
    { label: 'ACTIVE', value: stats.active, color: 'text-dr-green' },
  ];

  return (
    <TacCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-dr-text text-xs font-tactical tracking-wider">BRANCH HYGIENE</h3>
        {mergedCount > 0 && (
          <TacButton
            variant="danger"
            size="sm"
            onClick={handlePruneAll}
            disabled={pending}
          >
            PRUNE MERGED ({mergedCount})
          </TacButton>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex gap-3 mb-3">
        {statItems.map(s => (
          <div key={s.label} className="bg-dr-bg border border-dr-border px-3 py-2 text-center">
            <div className={cn('text-sm font-mono', s.color)}>{s.value}</div>
            <div className="text-dr-dim text-[10px] tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Problem list */}
      {problems.length === 0 ? (
        <p className="text-dr-green text-xs font-mono">✓ ALL BRANCHES CLEAN</p>
      ) : (
        <div className="space-y-1">
          {problems.map(p => (
            <div
              key={p.name}
              className="flex items-center gap-3 px-2 py-1.5 text-xs font-mono bg-dr-bg border border-dr-border"
            >
              <span className="text-dr-muted truncate flex-1">{p.name}</span>
              <span className={cn(
                'shrink-0',
                p.problem === 'merged' ? 'text-dr-green' : 'text-dr-amber',
              )}>
                {p.problem === 'merged'
                  ? 'MERGED — SAFE TO DELETE'
                  : `DIVERGED — ${p.ahead} ahead, ${p.behind} behind`}
              </span>
              <span className="text-dr-dim shrink-0">{formatAge(p.lastCommitAge)}</span>
              <TacButton
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(p.name)}
                disabled={pending}
              >
                DELETE
              </TacButton>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog />
    </TacCard>
  );
}
```

- [ ] **Step 5: Create QuartermasterLog component**

Create `src/components/field-check/quartermaster-log.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { QMLogEntry, MergeResultType } from '@/types';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const RESULT_STYLES: Record<MergeResultType, { label: string; icon: string; color: string }> = {
  clean: { label: 'CLEAN MERGE', icon: '✓', color: 'text-dr-green' },
  conflict_resolved: { label: 'CONFLICT RESOLVED', icon: '⚡', color: 'text-dr-amber' },
  failed: { label: 'MERGE FAILED', icon: '✗', color: 'text-dr-red' },
};

interface QuartermasterLogProps {
  entries: QMLogEntry[];
  battlefieldId: string;
}

export function QuartermasterLog({ entries, battlefieldId }: QuartermasterLogProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <TacCard>
      <h3 className="text-dr-text text-xs font-tactical tracking-wider mb-3">
        QUARTERMASTER ACTIVITY
      </h3>

      {entries.length === 0 ? (
        <p className="text-dr-dim text-xs font-mono">NO MERGE ACTIVITY YET</p>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => {
            const style = RESULT_STYLES[entry.result];
            const isExpanded = expanded === entry.missionId;
            const hasDetail = entry.result !== 'clean' && entry.conflictFiles.length > 0;

            return (
              <div key={`${entry.missionId}-${entry.timestamp}`}>
                <button
                  type="button"
                  onClick={() => hasDetail && setExpanded(isExpanded ? null : entry.missionId)}
                  className={cn(
                    'flex items-center gap-3 px-2 py-1.5 text-xs font-mono bg-dr-bg border border-dr-border w-full text-left',
                    hasDetail && 'cursor-pointer hover:bg-dr-elevated',
                  )}
                  disabled={!hasDetail}
                >
                  <Link
                    href={`/battlefields/${battlefieldId}/missions/${entry.missionId}`}
                    className="text-dr-amber hover:underline shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    {entry.missionCodename}
                  </Link>
                  <span className="text-dr-dim truncate flex-1">
                    {entry.sourceBranch} → {entry.targetBranch}
                  </span>
                  <span className={cn('shrink-0', style.color)}>
                    {style.icon} {style.label}
                  </span>
                  <span className="text-dr-dim shrink-0">{formatTime(entry.timestamp)}</span>
                </button>

                {isExpanded && hasDetail && (
                  <div className="px-4 py-2 bg-dr-bg border border-t-0 border-dr-border text-xs font-mono">
                    <p className="text-dr-muted mb-1">Conflicted files:</p>
                    {entry.conflictFiles.map(f => (
                      <p key={f} className="text-dr-text pl-2">{f}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </TacCard>
  );
}
```

- [ ] **Step 6: Create RepoVitals component**

Create `src/components/field-check/repo-vitals.tsx`:

```typescript
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { RepoVitals as RepoVitalsType } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface RepoVitalsProps {
  vitals: RepoVitalsType;
}

export function RepoVitals({ vitals }: RepoVitalsProps) {
  const items = [
    { label: 'REPO SIZE', value: formatBytes(vitals.repoSize) },
    { label: 'TOTAL COMMITS', value: String(vitals.totalCommits) },
    {
      label: 'LAST COMMIT',
      value: vitals.lastCommit ? formatTime(vitals.lastCommit.timestamp) : 'N/A',
      sub: vitals.lastCommit?.message.slice(0, 40),
    },
    { label: 'WORKTREE DISK', value: formatBytes(vitals.worktreeDisk) },
    {
      label: 'MAIN BRANCH',
      value: vitals.mainBranch,
      sub: vitals.isDirty ? 'DIRTY' : 'CLEAN',
      subColor: vitals.isDirty ? 'text-dr-amber' : 'text-dr-green',
    },
  ];

  return (
    <TacCard>
      <h3 className="text-dr-text text-xs font-tactical tracking-wider mb-3">REPO VITALS</h3>
      <div className="flex flex-wrap gap-3">
        {items.map(item => (
          <div
            key={item.label}
            className="bg-dr-bg border border-dr-border px-3 py-2 min-w-[120px]"
          >
            <div className="text-dr-text text-sm font-mono">{item.value}</div>
            <div className="text-dr-dim text-[10px] tracking-wider">{item.label}</div>
            {item.sub && (
              <div className={cn('text-[10px] truncate max-w-[140px]', item.subColor ?? 'text-dr-dim')}>
                {item.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </TacCard>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/\(hq\)/battlefields/\[id\]/field-check/ src/components/field-check/
git commit -m "feat: add FIELD CHECK page with worktree, branch, QM log, and vitals sections"
```

---

## Task 5: Telemetry Server Actions

**Files:**
- Create: `src/actions/telemetry.ts`

- [ ] **Step 1: Write tests for telemetry actions**

Create `src/actions/__tests__/telemetry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockAll = vi.fn();
vi.mock('@/lib/db/index', () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: mockGet,
          all: mockAll,
          orderBy: () => ({
            limit: () => ({
              all: mockAll,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/actions/_helpers', () => ({
  getRepoPath: vi.fn().mockResolvedValue('/fake/repo'),
}));

describe('telemetry actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset globalThis mocks
    (globalThis as Record<string, unknown>).orchestrator = undefined;
    (globalThis as Record<string, unknown>).devServerManager = undefined;
    (globalThis as Record<string, unknown>).io = undefined;
  });

  describe('getActiveProcesses', () => {
    it('returns empty array when orchestrator is not initialized', async () => {
      const { getActiveProcesses } = await import('../telemetry');
      const result = await getActiveProcesses('bf-1');
      expect(result).toEqual([]);
    });
  });

  describe('getResourceUsage', () => {
    it('returns metrics with zero agent slots when orchestrator missing', async () => {
      const { getResourceUsage } = await import('../telemetry');
      const result = await getResourceUsage('bf-1');
      expect(result.agentSlots).toEqual({ active: 0, max: 5 });
      expect(result.socketConnections).toBe(0);
    });
  });

  describe('classifyFailure', () => {
    it('classifies timeout correctly', async () => {
      const { classifyFailure } = await import('../telemetry');
      expect(classifyFailure('compromised', 'timeout', null)).toBe('timeout');
    });

    it('returns null for accomplished missions', async () => {
      const { classifyFailure } = await import('../telemetry');
      expect(classifyFailure('accomplished', null, null)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/actions/__tests__/telemetry.test.ts`

Expected: FAIL — module `../telemetry` not found.

- [ ] **Step 3: Implement telemetry.ts**

Create `src/actions/telemetry.ts`:

```typescript
'use server';

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { eq, and, desc, inArray, sql, gte } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields, scheduledTasks, overseerLogs, notifications } from '@/lib/db/schema';
import { getRepoPath } from '@/actions/_helpers';
import { config } from '@/lib/config';
import type {
  ProcessEntry,
  ResourceMetrics,
  ExitEntry,
  FailureType,
  ServiceHealthStatus,
  MissionStatus,
} from '@/types';

// Re-export dev server actions
export {
  startDevServer,
  stopDevServer,
  restartDevServer,
  getDevServerStatus,
} from '@/actions/console';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDirSize(dirPath: string): number {
  try {
    const output = execSync(`du -sk "${dirPath}" 2>/dev/null`, { encoding: 'utf-8' });
    const kb = parseInt(output.split('\t')[0], 10);
    return isNaN(kb) ? 0 : kb * 1024;
  } catch {
    return 0;
  }
}

export function classifyFailure(
  status: string,
  compromiseReason: string | null,
  debrief: string | null,
): FailureType | null {
  if (status === 'accomplished') return null;
  if (compromiseReason === 'timeout') return 'timeout';
  if (compromiseReason === 'escalated') return 'stall_killed';
  if (compromiseReason === 'merge-failed') return null; // merge failure, not process failure

  // Check debrief/reason for auth clues
  const text = `${compromiseReason ?? ''} ${debrief ?? ''}`.toLowerCase();
  if (text.includes('auth') || text.includes('token') || text.includes('unauthorized')) {
    return 'auth_failure';
  }

  if (status === 'abandoned') return 'killed';
  if (status === 'compromised') return 'cli_error';

  return null;
}

// ---------------------------------------------------------------------------
// Active Processes
// ---------------------------------------------------------------------------

export async function getActiveProcesses(battlefieldId: string): Promise<ProcessEntry[]> {
  const orchestrator = globalThis.orchestrator;
  if (!orchestrator) return [];

  const db = getDatabase();
  const activeMissions = db
    .select({
      id: missions.id,
      title: missions.title,
      status: missions.status,
      assetId: missions.assetId,
      startedAt: missions.startedAt,
    })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        inArray(missions.status, ['deploying', 'in_combat', 'reviewing']),
      ),
    )
    .all();

  return activeMissions.map(m => ({
    missionId: m.id,
    missionCodename: m.title,
    asset: m.assetId ?? 'unknown',
    pid: 0, // PID not tracked in current orchestrator — placeholder for future
    startedAt: m.startedAt ?? Date.now(),
    status: m.status as MissionStatus,
    memoryRss: 0, // Not available without pidusage
    lastOutputAt: Date.now(), // Approximation — would need stream tracking
  }));
}

export async function killProcess(battlefieldId: string, missionId: string): Promise<void> {
  const orchestrator = globalThis.orchestrator;
  if (!orchestrator) throw new Error('Orchestrator not initialized');
  await orchestrator.onMissionAbort(missionId);
}

export async function killAllProcesses(battlefieldId: string): Promise<{ killed: number }> {
  const processes = await getActiveProcesses(battlefieldId);
  const orchestrator = globalThis.orchestrator;
  if (!orchestrator) return { killed: 0 };

  for (const proc of processes) {
    await orchestrator.onMissionAbort(proc.missionId);
  }
  return { killed: processes.length };
}

// ---------------------------------------------------------------------------
// Resource Usage
// ---------------------------------------------------------------------------

export async function getResourceUsage(battlefieldId: string): Promise<ResourceMetrics> {
  const orchestrator = globalThis.orchestrator;
  const io = globalThis.io;

  const active = orchestrator?.getWorkingCount() ?? 0;
  const max = config.maxAgents;

  // Worktree disk
  let worktreeDisk = 0;
  try {
    const repoPath = await getRepoPath(battlefieldId);
    const wtDir = path.join(repoPath, '.worktrees');
    worktreeDisk = fs.existsSync(wtDir) ? getDirSize(wtDir) : 0;
  } catch { /* battlefield may not exist */ }

  // Temp disk
  const tempDir = '/tmp/claude-config';
  const tempDisk = fs.existsSync(tempDir) ? getDirSize(tempDir) : 0;

  // DB size
  const dbPath = config.dbPath;
  let dbSize = 0;
  try {
    const dbStat = fs.statSync(dbPath);
    dbSize = dbStat.size;
    // Add WAL size if exists
    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      dbSize += fs.statSync(walPath).size;
    }
  } catch { /* ok */ }

  // Socket connections
  const socketConnections = io?.engine?.clientsCount ?? 0;

  return {
    agentSlots: { active, max },
    worktreeDisk,
    tempDisk,
    dbSize,
    socketConnections,
  };
}

// ---------------------------------------------------------------------------
// Recent Exits
// ---------------------------------------------------------------------------

export async function getRecentExits(
  battlefieldId: string,
  filter?: string,
): Promise<ExitEntry[]> {
  const db = getDatabase();

  const terminalStatuses: MissionStatus[] = ['accomplished', 'compromised', 'abandoned'];
  let statusFilter = terminalStatuses;

  if (filter === 'crashes') statusFilter = ['compromised'];
  if (filter === 'killed') statusFilter = ['abandoned'];

  const rows = db
    .select({
      id: missions.id,
      title: missions.title,
      status: missions.status,
      compromiseReason: missions.compromiseReason,
      debrief: missions.debrief,
      startedAt: missions.startedAt,
      completedAt: missions.completedAt,
      durationMs: missions.durationMs,
    })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        inArray(missions.status, statusFilter),
      ),
    )
    .orderBy(desc(missions.completedAt))
    .limit(20)
    .all();

  return rows.map(row => {
    const failureType = classifyFailure(row.status!, row.compromiseReason, row.debrief);

    // Approximate exit code from status
    let exitCode: number | null = null;
    if (row.status === 'accomplished') exitCode = 0;
    else if (row.status === 'compromised') exitCode = 1;
    else if (row.status === 'abandoned') exitCode = null;

    return {
      missionId: row.id,
      missionCodename: row.title,
      exitCode,
      duration: row.durationMs ?? 0,
      failureType,
      timestamp: row.completedAt ?? 0,
    };
  });
}

export async function getExitContext(missionId: string): Promise<string[]> {
  const db = getDatabase();
  const { missionLogs } = await import('@/lib/db/schema');

  const logs = db
    .select({ content: missionLogs.content })
    .from(missionLogs)
    .where(eq(missionLogs.missionId, missionId))
    .orderBy(desc(missionLogs.timestamp))
    .limit(20)
    .all();

  return logs.reverse().map(l => l.content);
}

// ---------------------------------------------------------------------------
// Service Health
// ---------------------------------------------------------------------------

export async function getServiceHealth(battlefieldId: string): Promise<ServiceHealthStatus> {
  const db = getDatabase();
  const now = Date.now();

  // Scheduler
  const scheduler = globalThis.scheduler;
  const schedulerRunning = !!scheduler;
  const lastTick = (scheduler as Record<string, unknown>)?.lastTickAt as number | null ?? null;
  const schedulerStalled = lastTick ? (now - lastTick > 120000) : false;

  // Next fire for this battlefield
  const nextTask = db
    .select({ nextRunAt: scheduledTasks.nextRunAt })
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.battlefieldId, battlefieldId),
        eq(scheduledTasks.enabled, 1),
      ),
    )
    .orderBy(scheduledTasks.nextRunAt)
    .limit(1)
    .all();

  const nextFire = nextTask[0]?.nextRunAt ?? null;

  // Overseer queue
  const pendingReviews = db
    .select({ total: sql<number>`count(*)` })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        eq(missions.status, 'reviewing'),
      ),
    )
    .all();

  // Last overseer review
  const lastReviewRow = db
    .select({ timestamp: overseerLogs.timestamp })
    .from(overseerLogs)
    .where(eq(overseerLogs.battlefieldId, battlefieldId))
    .orderBy(desc(overseerLogs.timestamp))
    .limit(1)
    .all();

  // Quartermaster queue
  const pendingMerges = db
    .select({ total: sql<number>`count(*)` })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        inArray(missions.status, ['approved', 'merging']),
      ),
    )
    .all();

  // Last merge
  const lastMergeRow = db
    .select({ mergeTimestamp: missions.mergeTimestamp })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        sql`${missions.mergeTimestamp} IS NOT NULL`,
      ),
    )
    .orderBy(desc(missions.mergeTimestamp))
    .limit(1)
    .all();

  // Stall detection (last 24h)
  const dayAgo = now - 86400000;
  const stalls = db
    .select({ total: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.battlefieldId, battlefieldId),
        gte(notifications.createdAt, dayAgo),
        sql`${notifications.title} LIKE '%stall%'`,
      ),
    )
    .all();

  // Last stall
  const lastStallRow = db
    .select({
      entityId: notifications.entityId,
      createdAt: notifications.createdAt,
      detail: notifications.detail,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.battlefieldId, battlefieldId),
        sql`${notifications.title} LIKE '%stall%'`,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1)
    .all();

  let lastStall: ServiceHealthStatus['stallDetection']['lastStall'] = null;
  if (lastStallRow[0]) {
    // Get mission codename
    const stallMission = lastStallRow[0].entityId
      ? db
          .select({ title: missions.title })
          .from(missions)
          .where(eq(missions.id, lastStallRow[0].entityId))
          .get()
      : null;

    lastStall = {
      missionCodename: stallMission?.title ?? 'Unknown',
      timestamp: lastStallRow[0].createdAt,
      overseerDecision: lastStallRow[0].detail,
    };
  }

  return {
    scheduler: {
      status: schedulerRunning && !schedulerStalled ? 'running' : 'stalled',
      lastTick,
      nextFire,
      missedRuns: 0, // Would need tracking in scheduler
    },
    overseer: {
      pendingReviews: pendingReviews[0]?.total ?? 0,
      avgReviewTime: null, // Could compute from timestamps
      lastReview: lastReviewRow[0]?.timestamp ?? null,
    },
    quartermaster: {
      pendingMerges: pendingMerges[0]?.total ?? 0,
      lastMerge: lastMergeRow[0]?.mergeTimestamp ?? null,
    },
    stallDetection: {
      count24h: stalls[0]?.total ?? 0,
      lastStall,
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/actions/__tests__/telemetry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/actions/telemetry.ts src/actions/__tests__/telemetry.test.ts
git commit -m "feat: add telemetry server actions with tests"
```

---

## Task 6: Telemetry Socket.IO Room

**Files:**
- Modify: `src/lib/socket/server.ts`

- [ ] **Step 1: Add telemetry room to Socket.IO setup**

In `src/lib/socket/server.ts`, add the subscribe/unsubscribe handlers after the existing `tests:unsubscribe` handler (around line 55):

```typescript
    socket.on('telemetry:subscribe', (battlefieldId: string) => {
      socket.join(`telemetry:${battlefieldId}`);
    });

    socket.on('telemetry:unsubscribe', (battlefieldId: string) => {
      socket.leave(`telemetry:${battlefieldId}`);
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/socket/server.ts
git commit -m "feat: register telemetry Socket.IO room"
```

---

## Task 7: Telemetry Page & Components

**Files:**
- Create: `src/app/(hq)/battlefields/[id]/telemetry/page.tsx`
- Create: `src/app/(hq)/battlefields/[id]/telemetry/loading.tsx`
- Create: `src/components/telemetry/active-processes.tsx`
- Create: `src/components/telemetry/resource-usage.tsx`
- Create: `src/components/telemetry/recent-exits.tsx`
- Create: `src/components/telemetry/service-health.tsx`

- [ ] **Step 1: Create the page component**

Create `src/app/(hq)/battlefields/[id]/telemetry/page.tsx`:

```typescript
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import {
  getActiveProcesses,
  getDevServerStatus,
  getResourceUsage,
  getRecentExits,
  getServiceHealth,
} from '@/actions/telemetry';
import { ActiveProcesses } from '@/components/telemetry/active-processes';
import { ResourceUsage } from '@/components/telemetry/resource-usage';
import { RecentExits } from '@/components/telemetry/recent-exits';
import { ServiceHealth } from '@/components/telemetry/service-health';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function TelemetryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [processes, devServer, resources, exits, health] = await Promise.all([
    getActiveProcesses(id),
    getDevServerStatus(id),
    getResourceUsage(id),
    getRecentExits(id),
    getServiceHealth(id),
  ]);

  const db = getDatabase();
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'TELEMETRY']}
      title="TELEMETRY"
      className="space-y-4"
    >
      <ActiveProcesses
        battlefieldId={id}
        initialProcesses={processes}
        initialDevServer={{
          status: devServer.running ? 'running' : 'stopped',
          port: devServer.port,
          pid: devServer.pid,
        }}
      />
      <ResourceUsage metrics={resources} />
      <RecentExits battlefieldId={id} initialExits={exits} />
      <ServiceHealth health={health} />
    </PageWrapper>
  );
}
```

- [ ] **Step 2: Create loading skeleton**

Create `src/app/(hq)/battlefields/[id]/telemetry/loading.tsx`:

```typescript
export default function TelemetryLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="h-3 w-40 bg-dr-elevated animate-pulse mb-1" />
        <div className="h-5 w-32 bg-dr-elevated animate-pulse" />
      </div>

      {/* Active Processes */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-4 w-44 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
      </div>

      {/* Resource Usage */}
      <div className="bg-dr-surface border border-dr-border p-4">
        <div className="h-4 w-40 bg-dr-elevated animate-pulse mb-3" />
        <div className="flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 w-32 bg-dr-bg border border-dr-border animate-pulse" />
          ))}
        </div>
      </div>

      {/* Recent Exits */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-4 w-36 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
        <div className="h-8 w-full bg-dr-bg border border-dr-border animate-pulse" />
      </div>

      {/* Service Health */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-4 w-52 bg-dr-elevated animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-dr-bg border border-dr-border animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ActiveProcesses component**

Create `src/components/telemetry/active-processes.tsx`:

```typescript
'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { useConfirm } from '@/hooks/use-confirm';
import { useDevServer } from '@/hooks/use-dev-server';
import {
  killProcess,
  killAllProcesses,
  startDevServer,
  stopDevServer,
  restartDevServer,
} from '@/actions/telemetry';
import { cn } from '@/lib/utils';
import type { ProcessEntry } from '@/types';

function formatRuntime(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const secs = Math.floor(ms / 1000) % 60;
  const mins = Math.floor(ms / 60000);
  return `${mins}m ${secs}s`;
}

const STATUS_COLORS: Record<string, string> = {
  deploying: 'text-dr-amber',
  in_combat: 'text-dr-amber',
  reviewing: 'text-dr-blue',
};

interface ActiveProcessesProps {
  battlefieldId: string;
  initialProcesses: ProcessEntry[];
  initialDevServer: { status: 'running' | 'stopped' | 'crashed'; port: number | null; pid: number | null };
}

export function ActiveProcesses({
  battlefieldId,
  initialProcesses,
  initialDevServer,
}: ActiveProcessesProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const [tick, setTick] = useState(0);
  const { status: dsStatus, port: dsPort, pid: dsPid } = useDevServer(battlefieldId, initialDevServer);

  // Tick every second to update runtime counters
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleKill(missionId: string) {
    const ok = await confirm('Kill this process?');
    if (!ok) return;
    startTransition(async () => {
      await killProcess(battlefieldId, missionId);
      router.refresh();
    });
  }

  async function handleKillAll() {
    const ok = await confirm(`Kill ${initialProcesses.length} process(es)?`);
    if (!ok) return;
    startTransition(async () => {
      await killAllProcesses(battlefieldId);
      router.refresh();
    });
  }

  return (
    <TacCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-dr-text text-xs font-tactical tracking-wider">ACTIVE PROCESSES</h3>
        {initialProcesses.length > 0 && (
          <TacButton
            variant="danger"
            size="sm"
            onClick={handleKillAll}
            disabled={pending}
          >
            KILL ALL ({initialProcesses.length})
          </TacButton>
        )}
      </div>

      {/* Process table */}
      {initialProcesses.length === 0 ? (
        <p className="text-dr-dim text-xs font-mono mb-4">NO ACTIVE PROCESSES</p>
      ) : (
        <div className="space-y-1 mb-4">
          {initialProcesses.map(proc => (
            <div
              key={proc.missionId}
              className="flex items-center gap-3 px-2 py-1.5 text-xs font-mono bg-dr-bg border border-dr-border"
            >
              <Link
                href={`/battlefields/${battlefieldId}/missions/${proc.missionId}`}
                className="text-dr-amber hover:underline shrink-0"
              >
                {proc.missionCodename}
              </Link>
              <span className="text-dr-muted shrink-0">{proc.asset}</span>
              <span className={cn('shrink-0', STATUS_COLORS[proc.status] ?? 'text-dr-muted')}>
                {proc.status.replace('_', ' ').toUpperCase()}
              </span>
              <span className="text-dr-text shrink-0">{formatRuntime(proc.startedAt)}</span>
              <span className="flex-1" />
              <TacButton
                variant="danger"
                size="sm"
                onClick={() => handleKill(proc.missionId)}
                disabled={pending}
              >
                KILL
              </TacButton>
            </div>
          ))}
        </div>
      )}

      {/* Dev Server Widget */}
      <div className="border-t border-dr-border pt-3">
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className={cn(
            dsStatus === 'running' ? 'text-dr-green' : 'text-dr-dim',
          )}>
            ● DEV SERVER
          </span>
          <span className="text-dr-muted">
            {dsStatus === 'running'
              ? `Running on port ${dsPort ?? '...'} (PID ${dsPid ?? '...'})`
              : 'STOPPED'}
          </span>
          <span className="flex-1" />
          {dsStatus === 'running' ? (
            <>
              <TacButton
                variant="danger"
                size="sm"
                onClick={() => startTransition(() => stopDevServer(battlefieldId))}
                disabled={pending}
              >
                STOP
              </TacButton>
              <TacButton
                variant="primary"
                size="sm"
                onClick={() => startTransition(() => restartDevServer(battlefieldId))}
                disabled={pending}
              >
                RESTART
              </TacButton>
            </>
          ) : (
            <TacButton
              variant="success"
              size="sm"
              onClick={() => startTransition(() => startDevServer(battlefieldId))}
              disabled={pending}
            >
              START
            </TacButton>
          )}
        </div>
      </div>
      <ConfirmDialog />
    </TacCard>
  );
}
```

- [ ] **Step 4: Create ResourceUsage component**

Create `src/components/telemetry/resource-usage.tsx`:

```typescript
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { ResourceMetrics } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type Health = 'green' | 'amber' | 'red';

function getSlotHealth(active: number, max: number): Health {
  const pct = active / max;
  if (pct >= 1) return 'red';
  if (pct >= 0.8) return 'amber';
  return 'green';
}

function getDiskHealth(bytes: number, amberThreshold: number, redThreshold: number): Health {
  if (bytes > redThreshold) return 'red';
  if (bytes > amberThreshold) return 'amber';
  return 'green';
}

const HEALTH_COLORS: Record<Health, string> = {
  green: 'text-dr-green',
  amber: 'text-dr-amber',
  red: 'text-dr-red',
};

interface ResourceUsageProps {
  metrics: ResourceMetrics;
}

export function ResourceUsage({ metrics }: ResourceUsageProps) {
  const items = [
    {
      label: 'AGENT SLOTS',
      value: `${metrics.agentSlots.active} / ${metrics.agentSlots.max}`,
      health: getSlotHealth(metrics.agentSlots.active, metrics.agentSlots.max),
    },
    {
      label: 'WORKTREE DISK',
      value: formatBytes(metrics.worktreeDisk),
      health: getDiskHealth(metrics.worktreeDisk, 500 * 1024 * 1024, 1024 * 1024 * 1024),
    },
    {
      label: 'TEMP DISK',
      value: formatBytes(metrics.tempDisk),
      health: getDiskHealth(metrics.tempDisk, 200 * 1024 * 1024, 500 * 1024 * 1024),
    },
    {
      label: 'DB SIZE',
      value: formatBytes(metrics.dbSize),
      health: getDiskHealth(metrics.dbSize, 50 * 1024 * 1024, 200 * 1024 * 1024),
    },
    {
      label: 'SOCKET.IO',
      value: String(metrics.socketConnections),
      health: 'green' as Health,
    },
  ];

  return (
    <TacCard>
      <h3 className="text-dr-text text-xs font-tactical tracking-wider mb-3">RESOURCE USAGE</h3>
      <div className="flex flex-wrap gap-3">
        {items.map(item => (
          <div
            key={item.label}
            className="bg-dr-bg border border-dr-border px-3 py-2 min-w-[120px]"
          >
            <div className="flex items-center gap-2">
              <span className={cn('text-sm', HEALTH_COLORS[item.health])}>●</span>
              <span className="text-dr-text text-sm font-mono">{item.value}</span>
            </div>
            <div className="text-dr-dim text-[10px] tracking-wider">{item.label}</div>
          </div>
        ))}
      </div>
    </TacCard>
  );
}
```

- [ ] **Step 5: Create RecentExits component**

Create `src/components/telemetry/recent-exits.tsx`:

```typescript
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { getRecentExits, getExitContext } from '@/actions/telemetry';
import { cn } from '@/lib/utils';
import type { ExitEntry, FailureType } from '@/types';

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000) % 60;
  const mins = Math.floor(ms / 60000);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const EXIT_STYLES: Record<string, { icon: string; color: string }> = {
  success: { icon: '✓ 0', color: 'text-dr-green' },
  timeout: { icon: '⏱ TIMEOUT', color: 'text-dr-amber' },
  killed: { icon: '☠ KILLED', color: 'text-dr-red' },
  stall_killed: { icon: '☠ STALL', color: 'text-dr-red' },
  error: { icon: '✗ 1', color: 'text-dr-red' },
};

type FilterKey = 'all' | 'crashes' | 'timeouts' | 'killed';

interface RecentExitsProps {
  battlefieldId: string;
  initialExits: ExitEntry[];
}

export function RecentExits({ battlefieldId, initialExits }: RecentExitsProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [exits, setExits] = useState(initialExits);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [context, setContext] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function handleFilter(key: FilterKey) {
    setFilter(key);
    startTransition(async () => {
      const filterParam = key === 'all' ? undefined : key;
      const result = await getRecentExits(battlefieldId, filterParam);
      setExits(result);
    });
  }

  async function handleExpand(missionId: string) {
    if (expanded === missionId) {
      setExpanded(null);
      return;
    }
    setExpanded(missionId);
    const lines = await getExitContext(missionId);
    setContext(lines);
  }

  function getExitStyle(entry: ExitEntry) {
    if (entry.exitCode === 0) return EXIT_STYLES.success;
    if (entry.failureType === 'timeout') return EXIT_STYLES.timeout;
    if (entry.failureType === 'killed' || entry.failureType === 'stall_killed') return EXIT_STYLES.killed;
    return EXIT_STYLES.error;
  }

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'ALL' },
    { key: 'crashes', label: 'CRASHES' },
    { key: 'timeouts', label: 'TIMEOUTS' },
    { key: 'killed', label: 'KILLED' },
  ];

  return (
    <TacCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-dr-text text-xs font-tactical tracking-wider">RECENT EXITS</h3>
        <div className="flex gap-1">
          {filters.map(f => (
            <TacButton
              key={f.key}
              variant={filter === f.key ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleFilter(f.key)}
              disabled={pending}
            >
              {f.label}
            </TacButton>
          ))}
        </div>
      </div>

      {exits.length === 0 ? (
        <p className="text-dr-dim text-xs font-mono">NO EXITS RECORDED</p>
      ) : (
        <div className="space-y-1">
          {exits.map(entry => {
            const style = getExitStyle(entry);
            const isExpanded = expanded === entry.missionId;

            return (
              <div key={`${entry.missionId}-${entry.timestamp}`}>
                <button
                  type="button"
                  onClick={() => handleExpand(entry.missionId)}
                  className="flex items-center gap-3 px-2 py-1.5 text-xs font-mono bg-dr-bg border border-dr-border w-full text-left hover:bg-dr-elevated cursor-pointer"
                >
                  <Link
                    href={`/battlefields/${battlefieldId}/missions/${entry.missionId}`}
                    className="text-dr-amber hover:underline shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    {entry.missionCodename}
                  </Link>
                  <span className={cn('shrink-0', style.color)}>{style.icon}</span>
                  {entry.failureType && (
                    <span className="text-dr-red shrink-0">
                      {entry.failureType.toUpperCase().replace('_', ' ')}
                    </span>
                  )}
                  <span className="text-dr-muted shrink-0">{formatDuration(entry.duration)}</span>
                  <span className="flex-1" />
                  <span className="text-dr-dim shrink-0">{formatTime(entry.timestamp)}</span>
                </button>

                {isExpanded && (
                  <div className="bg-dr-bg border border-t-0 border-dr-border p-2 text-[11px] font-mono text-dr-muted max-h-48 overflow-y-auto">
                    {context.length === 0 ? (
                      <p className="text-dr-dim">No log output captured.</p>
                    ) : (
                      context.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </TacCard>
  );
}
```

- [ ] **Step 6: Create ServiceHealth component**

Create `src/components/telemetry/service-health.tsx`:

```typescript
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { ServiceHealthStatus } from '@/types';

function formatTime(ts: number | null): string {
  if (!ts) return 'N/A';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatFuture(ts: number | null): string {
  if (!ts) return 'NONE SCHEDULED';
  const diff = ts - Date.now();
  if (diff <= 0) return 'OVERDUE';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `in ${hours}h`;
}

interface ServiceHealthProps {
  health: ServiceHealthStatus;
}

export function ServiceHealth({ health }: ServiceHealthProps) {
  return (
    <TacCard>
      <h3 className="text-dr-text text-xs font-tactical tracking-wider mb-3">
        BACKGROUND SERVICES
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Scheduler */}
        <div className="bg-dr-bg border border-dr-border p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={cn(
              health.scheduler.status === 'running' ? 'text-dr-green' : 'text-dr-red',
            )}>●</span>
            <span className="text-dr-text">SCHEDULER</span>
          </div>
          <div className="text-[10px] text-dr-muted font-mono space-y-0.5 pl-4">
            <p>Last tick: {formatTime(health.scheduler.lastTick)}</p>
            <p>Next fire: {formatFuture(health.scheduler.nextFire)}</p>
            {health.scheduler.missedRuns > 0 && (
              <p className="text-dr-amber">Missed runs: {health.scheduler.missedRuns}</p>
            )}
          </div>
        </div>

        {/* Overseer */}
        <div className="bg-dr-bg border border-dr-border p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={cn(
              health.overseer.pendingReviews > 3 ? 'text-dr-amber' : 'text-dr-green',
            )}>●</span>
            <span className="text-dr-text">OVERSEER</span>
          </div>
          <div className="text-[10px] text-dr-muted font-mono space-y-0.5 pl-4">
            <p>Pending reviews: {health.overseer.pendingReviews}</p>
            <p>Last review: {formatTime(health.overseer.lastReview)}</p>
          </div>
        </div>

        {/* Quartermaster */}
        <div className="bg-dr-bg border border-dr-border p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={cn(
              health.quartermaster.pendingMerges > 3 ? 'text-dr-amber' : 'text-dr-green',
            )}>●</span>
            <span className="text-dr-text">QUARTERMASTER</span>
          </div>
          <div className="text-[10px] text-dr-muted font-mono space-y-0.5 pl-4">
            <p>Pending merges: {health.quartermaster.pendingMerges}</p>
            <p>Last merge: {formatTime(health.quartermaster.lastMerge)}</p>
          </div>
        </div>

        {/* Stall Detection */}
        <div className="bg-dr-bg border border-dr-border p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={cn(
              health.stallDetection.count24h > 5 ? 'text-dr-red'
                : health.stallDetection.count24h > 0 ? 'text-dr-amber'
                : 'text-dr-green',
            )}>●</span>
            <span className="text-dr-text">STALL DETECTION</span>
          </div>
          <div className="text-[10px] text-dr-muted font-mono space-y-0.5 pl-4">
            <p>Stalls (24h): {health.stallDetection.count24h}</p>
            {health.stallDetection.lastStall && (
              <p>
                Last: {health.stallDetection.lastStall.missionCodename}{' '}
                ({formatTime(health.stallDetection.lastStall.timestamp)})
              </p>
            )}
          </div>
        </div>
      </div>
    </TacCard>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/\(hq\)/battlefields/\[id\]/telemetry/ src/components/telemetry/
git commit -m "feat: add TELEMETRY page with processes, resources, exits, and service health"
```

---

## Task 8: Update Sidebar & Remove Old Pages

**Files:**
- Modify: `src/components/layout/sidebar-nav.tsx`
- Remove: `src/app/(hq)/battlefields/[id]/git/` (directory)
- Remove: `src/app/(hq)/battlefields/[id]/console/` (directory)
- Remove: `src/components/git/` (directory)
- Remove: `src/components/console/` (directory)
- Remove: `src/actions/git.ts`
- Remove: `src/hooks/use-command-output.ts`

- [ ] **Step 1: Update sidebar nav items**

In `src/components/layout/sidebar-nav.tsx`, replace the GIT and CONSOLE entries in `OPS_TOOLS_ITEMS` (lines 22-23):

Replace:
```typescript
  { icon: "◆", label: "GIT", segment: "git" },
  { icon: "▶", label: "CONSOLE", segment: "console" },
```

With:
```typescript
  { icon: "◆", label: "FIELD CHECK", segment: "field-check" },
  { icon: "▶", label: "TELEMETRY", segment: "telemetry" },
```

- [ ] **Step 2: Remove old git page directory**

Run: `rm -rf src/app/\(hq\)/battlefields/\[id\]/git`

- [ ] **Step 3: Remove old console page directory**

Run: `rm -rf src/app/\(hq\)/battlefields/\[id\]/console`

- [ ] **Step 4: Remove old git components**

Run: `rm -rf src/components/git`

- [ ] **Step 5: Remove old console components**

Run: `rm -rf src/components/console`

- [ ] **Step 6: Remove old git actions**

Run: `rm src/actions/git.ts`

Note: `src/actions/console.ts` is kept — its dev server actions are re-exported by telemetry. The quick command and history actions are dead code but harmless. If you want a clean removal, delete only `runQuickCommand`, `getPackageScripts`, and `getCommandHistory` from that file, keeping the dev server functions.

- [ ] **Step 7: Remove use-command-output hook**

Run: `rm src/hooks/use-command-output.ts`

- [ ] **Step 8: Remove old Git Dashboard types from types/index.ts**

In `src/types/index.ts`, remove the Git Dashboard types section (lines 272-304): `FileEntry`, `CommitEntry`, `BranchEntry`, `GitStatusResult`, `GitLogResult`, `GitBranchesResult`. These are no longer used.

- [ ] **Step 9: Remove old git action tests if they exist**

Run: `rm -f src/actions/__tests__/git.test.ts`

- [ ] **Step 10: Verify no broken imports**

Run: `pnpm tsc --noEmit`

Expected: No errors related to removed files. If there are imports of the old git/console components elsewhere, update or remove them.

- [ ] **Step 11: Run all tests**

Run: `pnpm test`

Expected: All tests pass. If any tests import removed files, delete those test files.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: replace /git and /console with FIELD CHECK and TELEMETRY

- Update sidebar: GIT → FIELD CHECK, CONSOLE → TELEMETRY
- Remove old git page, components, actions, and types
- Remove old console page and components
- Keep dev server actions (re-exported by telemetry)
- Remove use-command-output hook"
```

---

## Task 9: Smoke Test & Verify

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

Expected: Server starts without errors.

- [ ] **Step 2: Navigate to FIELD CHECK**

Open `/battlefields/{any-id}/field-check` in the browser.

Expected: Page loads with 4 sections. Worktree board shows any active worktrees. Branch hygiene shows stats and problems. QM log may be empty if no merges have happened since the migration. Repo vitals shows repo stats.

- [ ] **Step 3: Navigate to TELEMETRY**

Open `/battlefields/{any-id}/telemetry` in the browser.

Expected: Page loads with 4 sections. Active processes shows running missions (if any). Dev server widget shows status with start/stop controls. Resource usage shows current metrics with health indicators. Recent exits shows completed/failed missions. Service health shows scheduler, overseer, quartermaster status.

- [ ] **Step 4: Verify sidebar navigation**

Expected: OPS TOOLS section shows FIELD CHECK and TELEMETRY instead of GIT and CONSOLE. Clicking them navigates correctly. Active state highlighting works.

- [ ] **Step 5: Verify old routes are gone**

Navigate to `/battlefields/{any-id}/git` — should 404.
Navigate to `/battlefields/{any-id}/console` — should 404.

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`

Expected: All tests pass.

- [ ] **Step 7: Commit any fixes**

If any fixes were needed during smoke testing, commit them:

```bash
git add -A
git commit -m "fix: address smoke test issues for field-check and telemetry"
```
