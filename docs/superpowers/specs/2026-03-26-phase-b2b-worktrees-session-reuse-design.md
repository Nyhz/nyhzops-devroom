# Phase B2b: Worktrees + Session Reuse — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** B2b (Worktrees + Session Reuse)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase B2a (Orchestrator + Execution) — complete

---

## Overview

Phase B2b adds git worktree isolation for all missions, automatic merging with conflict resolution, and session reuse (Continue Mission + Redeploy). After B2b, every mission runs in its own isolated worktree, changes merge back automatically, and the Commander can continue or re-run completed missions.

---

## 1. Worktree Manager

**File:** `src/lib/orchestrator/worktree.ts`

Manages the git worktree lifecycle using `simple-git`.

### Functions

#### `createWorktree(repoPath, mission, battlefield): Promise<string>`

Returns the worktree directory path.

**Flow:**
1. Generate branch name: `devroom/${battlefield.codename.toLowerCase().replace(/\s+/g, '-')}/${mission.id.slice(-12)}`
   - Uses last 12 characters of the ULID for negligible collision probability
2. Create branch from default branch: `git.branch([branchName, battlefield.defaultBranch || 'main'])`
3. Compute worktree path: `${repoPath}/.worktrees/${branchName.replace(/\//g, '-')}/`
4. Create worktree: `git.raw(['worktree', 'add', worktreePath, branchName])`
5. Ensure `.worktrees/` is in the repo's `.gitignore` (check if present, append if not)
6. Update mission record: set `worktreeBranch = branchName`, `useWorktree = 1`
7. Return worktree path

**Branch naming examples:**
- Battlefield "OPERATION THUNDER", mission ID `01KMNC1SH7Z585EP` → `devroom/operation-thunder/h7z585epqz2p`
- Battlefield "OPERATION BLOG", mission ID `01KMNC2AB3DEF789` → `devroom/operation-blog/2ab3def78901`

**Worktree directory structure:**
```
/dev/my-blog-engine/                    ← battlefield repo (clean)
├── .git/
├── .gitignore                          ← includes .worktrees/
├── .worktrees/                         ← worktrees for this battlefield
│   ├── devroom-operation-blog-abc12/   ← mission 1 worktree
│   └── devroom-operation-blog-def34/   ← mission 2 worktree
├── src/
└── ...
```

Each battlefield has its own `.worktrees/` directory inside its repo path. DEVROOM's own project directory is never affected.

#### `removeWorktree(repoPath, worktreePath, branch): Promise<void>`

**Flow:**
1. Remove worktree: `git.raw(['worktree', 'remove', worktreePath, '--force'])`
2. Delete branch: `git.branch(['-D', branch])`
3. Prune worktree metadata: `git.raw(['worktree', 'prune'])`

#### `cleanOrphanedWorktrees(repoPath, activeMissionIds): Promise<number>`

For future use by Phase D's scheduled WORKTREE SWEEP task.

**Flow:**
1. List all local branches matching `devroom/*`
2. For each: extract mission ID suffix from branch name
3. If mission ID not in `activeMissionIds`: it's orphaned
4. Remove worktree (if exists) and delete branch
5. Return count of cleaned worktrees

---

## 2. Merger

**File:** `src/lib/orchestrator/merger.ts`

Handles post-mission merge and conflict resolution.

### Function

```typescript
async function mergeBranch(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  mission: Mission,
): Promise<MergeResult>

interface MergeResult {
  success: boolean;
  conflictResolved: boolean;
  error?: string;
}
```

### Flow

1. Create a `simpleGit` instance for `repoPath` (the main repo, not the worktree)
2. Checkout target branch: `git.checkout(targetBranch)`
3. Attempt merge: `git.merge([sourceBranch, '--no-ff'])`
4. **If success:** return `{ success: true, conflictResolved: false }`
5. **If conflict:**
   a. Get the conflict diff: `git.diff()`
   b. Get the mission's debrief for context
   c. Read CLAUDE.md from battlefield if available
   d. Spawn a Claude Code conflict resolution process:
      - Uses `config.claudePath` with `--print --dangerously-skip-permissions --max-turns 20`
      - `cwd`: the repo root (where the conflict exists)
      - Prompt from SPEC.md §14.3 (see below)
   e. If Claude resolves successfully (exit code 0): return `{ success: true, conflictResolved: true }`
   f. If Claude fails: abort merge (`git.merge(['--abort'])`), return `{ success: false, error: 'Conflict resolution failed' }`
6. **If other git error:** return `{ success: false, error: errorMessage }`

### Conflict Resolution Prompt

```
{BATTLEFIELD_CLAUDE_MD}

---

## Merge Conflict Resolution

Branch `{sourceBranch}` into `{targetBranch}`.

### Context
{mission.debrief}

### Conflicts
{gitDiffWithConflictMarkers}

### Orders
1. Analyze both sides.
2. Resolve preserving both intents.
3. If incompatible, prefer source (new work). Note losses.
4. Run tests.
5. Commit: "Merge {sourceBranch}: resolve conflicts"
6. Report to the Commander.
```

The conflict resolution process runs as a simple `spawn` with `--prompt` — it does NOT go through the orchestrator or create a mission record. It's an internal maintenance operation.

> **Note:** This intentionally uses `--print` (plain text output) instead of `--output-format stream-json`. Conflict resolution is a synchronous, fire-and-forget operation — we only care about exit code (resolved or not). No streaming, no real-time UI, no token tracking needed. Simpler invocation for a simpler purpose.

---

## 3. Executor Integration

**Modify:** `src/lib/orchestrator/executor.ts`

### Changes to `executeMission`

**Before building prompt (after DEPLOYING status):**

```
if (mission.type !== 'bootstrap') {
  try {
    worktreePath = await createWorktree(battlefield.repoPath, mission, battlefield);
    workingDirectory = worktreePath;
  } catch (err) {
    // Worktree creation failed (disk full, git error, etc.)
    // Fall back to repo root with a warning
    console.warn(`[Executor] Worktree creation failed for mission ${mission.id}, falling back to repo root:`, err);
    storeMissionLog('status', `Worktree creation failed: ${err}. Running on repo root.`);
    workingDirectory = battlefield.repoPath;
  }
} else {
  workingDirectory = battlefield.repoPath;
}
```

**Fallback behavior:** If worktree creation fails, the mission runs on the repo root (same as B2a behavior). A warning is logged so the Commander knows isolation was not achieved. The mission still executes — the work is not lost, just not isolated.

**Claude Code spawns with:** `cwd: workingDirectory` (already parameterized)

**On ACCOMPLISHED:**
1. Call `mergeBranch(battlefield.repoPath, mission.worktreeBranch, battlefield.defaultBranch, mission)`
2. If merge succeeds: call `removeWorktree(battlefield.repoPath, worktreePath, branch)` — immediate cleanup
3. If merge fails (conflict not resolved):
   - Update mission status to `compromised`
   - Debrief: append merge failure details
   - Leave worktree + branch intact for Commander inspection
   - Emit `mission:status` with updated status

**On COMPROMISED (execution failed):**
- Leave worktree and branch intact — Commander may want to inspect the partial work
- Note in debrief: "Branch `{branch}` preserved for inspection"

**On ABANDONED:**
- Clean up worktree immediately: `removeWorktree(...)` — no need to preserve abandoned work

### Default Worktree Behavior

- All missions use worktrees by default. No user-facing toggle.
- The `useWorktree` field in the schema defaults to `1` (true). It's an internal implementation detail.
- **Exception:** Bootstrap missions (`mission.type === 'bootstrap'`) skip worktrees — they operate on the repo root.
- Campaign worktree modes (`none`, `phase`, `mission`) will be implemented in Phase C.

### `.gitignore` Management

On first worktree creation for a battlefield, check if `.worktrees/` is in the repo's `.gitignore`. If not, append it. This prevents git from tracking worktree directories.

---

## 4. Session Reuse

### New Server Actions in `src/actions/mission.ts`

#### `continueMission(missionId: string, briefing: string): Promise<Mission>`

1. Get completed mission — validate status is `accomplished` or `compromised`
2. Validate it has a `sessionId` (can't continue without prior session)
3. Create new mission:
   - Same `battlefieldId`, `assetId`
   - New `briefing` from Commander
   - `sessionId` copied from original (Claude resumes context)
   - Auto-generated title from new briefing
   - If original was `compromised` AND has a `worktreeBranch` (branch preserved):
     - Copy `worktreeBranch` to new mission — the executor will detect this and reuse the existing worktree/branch instead of creating a new one
   - Status: `queued`

> **Continue from compromised missions:** When the original mission was `compromised`, its worktree and branch are preserved (per §3). The continued mission reuses that same branch so Claude's session context and the filesystem state are in sync. The executor checks if `mission.worktreeBranch` already exists and skips `createWorktree` if so, using the existing worktree path instead.
4. Trigger orchestrator: `globalThis.orchestrator?.onMissionQueued(newMission.id)`
5. Emit `activity:event`
6. `revalidatePath`
7. Return new mission

#### `redeployMission(missionId: string): Promise<Mission>`

1. Get original mission — validate status is terminal (`accomplished`, `compromised`, `abandoned`)
2. Create new mission:
   - Same `battlefieldId`, `assetId`, `title`, `briefing`, `priority`
   - NO `sessionId` — fresh start
   - Status: `queued`
3. Increment `iterations` on the **original** mission record

> **Note on `iterations` field:** The CLAUDE.md domain model defines `iterations` as the redeploy count. B2a's executor currently writes `numTurns` (Claude Code's turn count) to this field, which is incorrect. During B2b implementation, fix the executor to stop writing `numTurns` to `iterations`. The turn count is already captured in the `result` message and included in the debrief. `iterations` should only track redeploy count (default 0, incremented by `redeployMission`).
4. Trigger orchestrator: `globalThis.orchestrator?.onMissionQueued(newMission.id)`
5. Emit `activity:event`
6. `revalidatePath`
7. Return new mission

### UI: Mission Actions

**Modify:** `src/components/mission/mission-actions.tsx`

Update `MissionActionsProps` interface to include new fields:
```typescript
interface MissionActionsProps {
  missionId: string;
  status: string;
  battlefieldId: string;
  sessionId: string | null;        // NEW — needed for Continue button visibility
  worktreeBranch: string | null;   // NEW — passed to continueMission for compromised branch reuse
}
```

Add two buttons for completed missions:

**`[CONTINUE MISSION]`** (primary/amber variant):
- Shown when status is `accomplished` or `compromised` AND `sessionId` is not null
- On click: expands an inline textarea for new instructions
- On submit: calls `continueMission(missionId, briefing)`, redirects to new mission detail page
- Label: "CONTINUE MISSION"

**`[REDEPLOY]`** (ghost variant):
- Shown when status is any terminal state (`accomplished`, `compromised`, `abandoned`)
- On click: calls `redeployMission(missionId)`, redirects to new mission detail page
- No confirmation needed (creates a new mission, not destructive)
- Label: "REDEPLOY"

Both disabled during processing (pending state).

---

## 5. New Types

**Added to `src/types/index.ts`:**

```typescript
// Merge result from worktree merger
export interface MergeResult {
  success: boolean;
  conflictResolved: boolean;
  error?: string;
}
```

---

## 6. SPEC.md Updates

The following SPEC.md references need updating to reflect design decisions:

- **§11.5 Cleanup:** Change from "Every 10 minutes: remove worktrees for missions terminal > 1 hour" to "Worktrees cleaned up immediately after successful merge. Orphaned worktrees cleaned by daily scheduled WORKTREE SWEEP task (Phase D). `cleanOrphanedWorktrees` utility available for manual/scheduled use."
- **§13.1 Orchestrator Loop:** Change from polling `setInterval` to event-driven model with `onMissionQueued` triggered by Server Actions and `drainQueue` on mission completion.

These are documentation updates only — the code follows the design spec, not SPEC.md where they conflict.

---

## 7. What Is NOT Built in Phase B2b

- Worktree sweep scheduler (Phase D — tracked in memory)
- Manual "CLEAN OPS" button on Git dashboard (Phase D)
- Campaign worktree modes (none/phase/mission) — Phase C
- Full mission form with worktree toggle — not needed, all missions use worktrees by default
- Startup sweep of queued missions — deferred by design

---

## 8. End State

After Phase B2b is complete:
1. Every mission runs in an isolated git worktree (except bootstrap)
2. Changes automatically merge back to default branch on success
3. Merge conflicts auto-resolved by Claude Code when possible
4. Failed conflict resolution → mission compromised, branch preserved for inspection
5. Worktrees cleaned up immediately after successful merge
6. Abandoned missions have their worktrees cleaned up
7. `cleanOrphanedWorktrees` utility ready for Phase D's scheduled sweep
8. Commander can Continue Mission (new instructions, same Claude session/context)
9. Commander can Redeploy (fresh re-run of same mission)
10. `.worktrees/` automatically added to battlefield `.gitignore`
