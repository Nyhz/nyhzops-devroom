# Phase B2b: Worktrees + Session Reuse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git worktree isolation for all missions (auto-create, auto-merge, auto-cleanup), conflict resolution via Claude Code, and session reuse (Continue Mission + Redeploy) so the Commander can iterate on completed work.

**Architecture:** Worktree manager handles git lifecycle via `simple-git`. Merger handles post-execution merge with auto-conflict resolution. Executor modified to use worktrees by default. Two new Server Actions for session reuse. UI buttons on mission detail page.

**Tech Stack:** simple-git, child_process.spawn (for conflict resolution), Drizzle ORM, Next.js Server Actions

**Spec:** `docs/superpowers/specs/2026-03-26-phase-b2b-worktrees-session-reuse-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Types:**
- `src/types/index.ts` (modified — add MergeResult)

**Task 2 — Worktree Manager:**
- `src/lib/orchestrator/worktree.ts`

**Task 3 — Merger:**
- `src/lib/orchestrator/merger.ts`

**Task 4 — Executor Integration:**
- `src/lib/orchestrator/executor.ts` (modified — add worktree + merge flow)

**Task 5 — Session Reuse Server Actions:**
- `src/actions/mission.ts` (modified — add continueMission + redeployMission)

**Task 6 — Session Reuse UI:**
- `src/components/mission/mission-actions.tsx` (modified — add Continue + Redeploy buttons)

**Task 7 — Fix Iterations Field:**
- `src/lib/orchestrator/executor.ts` (modified — stop writing numTurns to iterations)

**Task 8 — Integration Verification:**
- Various fixes, final commit

---

## Task 1: Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add MergeResult type**

Append to `src/types/index.ts`:

```typescript
// Merge result from worktree merger
export interface MergeResult {
  success: boolean;
  conflictResolved: boolean;
  error?: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add MergeResult type for B2b"
```

---

## Task 2: Worktree Manager

**Files:**
- Create: `src/lib/orchestrator/worktree.ts`

- [ ] **Step 1: Create worktree manager**

Create `src/lib/orchestrator/worktree.ts` with three functions:

```typescript
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
async function ensureGitignore(repoPath: string): Promise<void> {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/worktree.ts
git commit -m "feat: add worktree manager with create, remove, and orphan cleanup"
```

---

## Task 3: Merger

**Files:**
- Create: `src/lib/orchestrator/merger.ts`

- [ ] **Step 1: Create merger**

Create `src/lib/orchestrator/merger.ts`:

```typescript
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
    return { success: false, error: errorMsg };
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
      '--prompt', prompt,
    ], {
      cwd: repoPath,
    });

    // We don't need stdout — just the exit code tells us if resolution succeeded
    proc.stdout?.resume(); // Drain stdout to prevent backpressure

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/merger.ts
git commit -m "feat: add merger with auto-conflict resolution via Claude Code"
```

---

## Task 4: Executor Integration

**Files:**
- Modify: `src/lib/orchestrator/executor.ts`

- [ ] **Step 1: Add worktree + merge flow to executor**

Read the existing `src/lib/orchestrator/executor.ts`. Make these changes:

**Add imports at the top:**
```typescript
import { createWorktree, removeWorktree } from './worktree';
import { mergeBranch } from './merger';
```

**After the DEPLOYING step (after `const battlefield = ...` query), add worktree creation:**

Insert between prompt building and Claude Code spawn:

```typescript
// Worktree setup (all missions except bootstrap)
let workingDirectory = battlefield.repoPath;
let worktreePath: string | null = null;
let worktreeBranch: string | null = mission.worktreeBranch;

if (mission.type !== 'bootstrap') {
  // Check if mission already has a worktree (e.g., continued from compromised)
  if (worktreeBranch) {
    // Reuse existing worktree
    const existingPath = path.join(
      battlefield.repoPath, '.worktrees',
      worktreeBranch.replace(/\//g, '-')
    );
    if (fs.existsSync(existingPath)) {
      worktreePath = existingPath;
      workingDirectory = existingPath;
      storeLog('status', `Reusing existing worktree: ${worktreeBranch}`);
    } else {
      // Worktree was cleaned up — create a fresh one
      worktreeBranch = null;
    }
  }

  if (!worktreeBranch) {
    try {
      worktreePath = await createWorktree(battlefield.repoPath, mission, battlefield);
      workingDirectory = worktreePath;
      // Re-read worktreeBranch — createWorktree sets it in the DB internally
      // We need it for the merge step after execution completes
      const updated = db.select({ worktreeBranch: missions.worktreeBranch })
        .from(missions).where(eq(missions.id, mission.id)).get();
      worktreeBranch = updated?.worktreeBranch || null;
    } catch (err) {
      console.warn(`[Executor] Worktree creation failed for mission ${mission.id}, falling back to repo root:`, err);
      storeLog('status', `Worktree creation failed: ${err}. Running on repo root.`);
      workingDirectory = battlefield.repoPath;
    }
  }
}
```

**Change the `spawn` call** to use `workingDirectory` instead of `battlefield.repoPath`:
```typescript
const proc = spawn(config.claudePath, args, {
  cwd: workingDirectory,  // was: battlefield.repoPath
  signal: abortController.signal,
});
```

**Add `import path from 'path'` and `import fs from 'fs'` at the top.**

**After the ACCOMPLISHED status update (inside the `if (streamResult)` block), add merge + cleanup:**

After the existing `emitActivity` call for accomplished:

```typescript
// Merge worktree branch back to default branch
if (worktreeBranch && worktreePath && finalStatus === 'accomplished') {
  storeLog('status', `Merging ${worktreeBranch} into ${battlefield.defaultBranch || 'main'}...`);
  io.to(room).emit('mission:log', {
    missionId: mission.id,
    timestamp: Date.now(),
    type: 'status',
    content: `Merging ${worktreeBranch} into ${battlefield.defaultBranch || 'main'}...\n`,
  });

  const mergeResult = await mergeBranch(
    battlefield.repoPath,
    worktreeBranch,
    battlefield.defaultBranch || 'main',
    { ...mission, debrief: r.result } as Mission,
    battlefield.claudeMdPath,
  );

  if (mergeResult.success) {
    // Clean up worktree immediately
    await removeWorktree(battlefield.repoPath, worktreePath, worktreeBranch);
    storeLog('status', mergeResult.conflictResolved
      ? 'Merge complete (conflicts auto-resolved). Worktree cleaned up.'
      : 'Merge complete. Worktree cleaned up.');
  } else {
    // Merge failed — downgrade to compromised
    db.update(missions).set({
      status: 'compromised',
      debrief: r.result + `\n\n---\n\nMERGE FAILED: ${mergeResult.error}\nBranch \`${worktreeBranch}\` preserved for inspection.`,
      updatedAt: Date.now(),
    }).where(eq(missions.id, mission.id)).run();

    io.to(room).emit('mission:status', {
      missionId: mission.id, status: 'compromised', timestamp: Date.now(),
    });
    storeLog('error', `Merge failed: ${mergeResult.error}. Branch preserved.`);
    emitActivity('mission:compromised', `Mission compromised (merge failed): ${mission.title}`);
  }
}
```

**For COMPROMISED missions** (in the `else` block after `if (streamResult)`), add a note about preserved branch:

```typescript
if (worktreeBranch) {
  // Append branch preservation note to debrief
  const currentDebrief = `Process exited with code ${exitCode}. ...`;
  db.update(missions).set({
    debrief: currentDebrief + `\nBranch \`${worktreeBranch}\` preserved for inspection.`,
  }).where(eq(missions.id, mission.id)).run();
}
```

**For ABANDONED missions** (in the catch block where `isAbort === true`), clean up worktree:

```typescript
if (isAbort && worktreePath && worktreeBranch) {
  try {
    await removeWorktree(battlefield.repoPath, worktreePath, worktreeBranch);
  } catch {
    // Best effort cleanup
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "feat: integrate worktrees into executor with merge and cleanup"
```

---

## Task 5: Session Reuse Server Actions

**Files:**
- Modify: `src/actions/mission.ts`

- [ ] **Step 1: Add continueMission and redeployMission**

Read the existing `src/actions/mission.ts`. Add two new exported Server Actions:

**`continueMission`:**
```typescript
export async function continueMission(missionId: string, briefing: string): Promise<Mission> {
  const db = getDatabase();

  // Get the original mission
  const original = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!original) throw new Error('Mission not found');
  if (original.status !== 'accomplished' && original.status !== 'compromised') {
    throw new Error('Can only continue accomplished or compromised missions');
  }
  if (!original.sessionId) {
    throw new Error('Cannot continue mission without a session ID');
  }

  const now = Date.now();
  const id = generateId();

  // Auto-generate title from new briefing
  let title = briefing.split('\n')[0].replace(/^#+\s*/, '').trim();
  if (title.length > 80) title = title.slice(0, 80) + '...';
  if (!title) title = 'Continued mission';

  // Build the new mission — carries over sessionId for context preservation
  const newMission: typeof missions.$inferInsert = {
    id,
    battlefieldId: original.battlefieldId,
    title,
    briefing,
    status: 'queued',
    priority: original.priority || 'normal',
    assetId: original.assetId,
    sessionId: original.sessionId,  // KEY: reuse session for context
    // If original was compromised and has a preserved branch, reuse it
    worktreeBranch: original.status === 'compromised' ? original.worktreeBranch : null,
    useWorktree: 1,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(missions).values(newMission).run();

  // Emit activity
  const bf = db.select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, original.battlefieldId))
    .get();

  globalThis.io?.to('hq:activity').emit('activity:event', {
    type: 'mission:created',
    battlefieldCodename: bf?.codename || 'UNKNOWN',
    missionTitle: title,
    timestamp: now,
    detail: `Continued from mission: ${original.title}. Status: QUEUED`,
  });

  revalidatePath(`/projects/${original.battlefieldId}`);

  // Trigger orchestrator
  globalThis.orchestrator?.onMissionQueued(id);

  return db.select().from(missions).where(eq(missions.id, id)).get() as Mission;
}
```

**`redeployMission`:**
```typescript
export async function redeployMission(missionId: string): Promise<Mission> {
  const db = getDatabase();

  // Get the original mission
  const original = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!original) throw new Error('Mission not found');
  if (!['accomplished', 'compromised', 'abandoned'].includes(original.status!)) {
    throw new Error('Can only redeploy terminal missions');
  }

  const now = Date.now();
  const id = generateId();

  // Create new mission — same briefing, fresh start (no sessionId)
  const newMission: typeof missions.$inferInsert = {
    id,
    battlefieldId: original.battlefieldId,
    title: original.title,
    briefing: original.briefing,
    status: 'queued',
    priority: original.priority || 'normal',
    assetId: original.assetId,
    // No sessionId — fresh start
    useWorktree: 1,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(missions).values(newMission).run();

  // Increment iterations on the ORIGINAL mission
  db.update(missions).set({
    iterations: (original.iterations || 0) + 1,
    updatedAt: now,
  }).where(eq(missions.id, missionId)).run();

  // Emit activity
  const bf = db.select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, original.battlefieldId))
    .get();

  globalThis.io?.to('hq:activity').emit('activity:event', {
    type: 'mission:created',
    battlefieldCodename: bf?.codename || 'UNKNOWN',
    missionTitle: original.title,
    timestamp: now,
    detail: `Redeployed. Status: QUEUED`,
  });

  revalidatePath(`/projects/${original.battlefieldId}`);

  // Trigger orchestrator
  globalThis.orchestrator?.onMissionQueued(id);

  return db.select().from(missions).where(eq(missions.id, id)).get() as Mission;
}
```

**Note:** These functions need `import { battlefields } from '@/lib/db/schema'` if not already imported, and `import { revalidatePath } from 'next/cache'`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/mission.ts
git commit -m "feat: add continueMission and redeployMission server actions"
```

---

## Task 6: Session Reuse UI

**Files:**
- Modify: `src/components/mission/mission-actions.tsx`

- [ ] **Step 1: Update MissionActions component**

Read the existing `src/components/mission/mission-actions.tsx`. Make these changes:

**Update props interface:**
```typescript
interface MissionActionsProps {
  missionId: string;
  status: string;
  battlefieldId: string;
  sessionId: string | null;
  worktreeBranch: string | null;
}
```

**Add Continue Mission button:**
- Shown when status is `accomplished` or `compromised` AND `sessionId` exists
- On click: toggle an inline textarea for new instructions
- On submit: call `continueMission(missionId, briefing)`, then `router.push` to new mission detail page

**Add Redeploy button:**
- Shown when status is `accomplished`, `compromised`, or `abandoned`
- On click: call `redeployMission(missionId)`, then `router.push` to new mission detail page

**Layout:**
```
[ABANDON]  [CONTINUE MISSION]  [REDEPLOY]
```

When Continue is clicked and the textarea expands:
```
[ABANDON]  [REDEPLOY]

CONTINUE MISSION
[textarea: "Describe what to do next..."]
[DEPLOY]  [CANCEL]
```

**Import the new actions:**
```typescript
import { abandonMission, continueMission, redeployMission } from '@/actions/mission';
```

**Also update the parent component** that passes props to MissionActions — this is `MissionComms` in `src/components/mission/mission-comms.tsx`. It needs to pass `sessionId` and `worktreeBranch` down. Read the component to see where MissionActions is rendered and add the new props. The initial values come from the mission data passed by the Server Component page.

- [ ] **Step 2: Update MissionComms props**

Read `src/components/mission/mission-comms.tsx`. Add `initialSessionId: string | null` and `initialWorktreeBranch: string | null` to `MissionCommsProps`. Pass them through to `MissionActions`.

- [ ] **Step 3: Update mission detail page**

Read `src/app/projects/[id]/missions/[missionId]/page.tsx`. Pass `sessionId` and `worktreeBranch` from the mission data to `MissionComms`:

```tsx
<MissionComms
  ...existing props...
  initialSessionId={mission.sessionId || null}
  initialWorktreeBranch={mission.worktreeBranch || null}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/ src/app/projects/[id]/missions/
git commit -m "feat: add Continue Mission and Redeploy buttons with session reuse"
```

---

## Task 7: Fix Iterations Field

**Files:**
- Modify: `src/lib/orchestrator/executor.ts`

- [ ] **Step 1: Remove numTurns → iterations mapping**

In `src/lib/orchestrator/executor.ts`, find the line in the "Step 6: Process complete" section that sets `iterations`:

```typescript
iterations: r.numTurns,
```

Remove it (or set `iterations` to the existing value, not overwrite with numTurns). The `iterations` field should only be incremented by `redeployMission`, not set by the executor. The turn count is already available in the `result` message and captured in the debrief.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "fix: stop writing numTurns to iterations field (reserved for redeploy count)"
```

---

## Task 8: Integration Verification

**Files:**
- Various fixes

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Build test**

```bash
pnpm build
```

- [ ] **Step 3: Route verification**

Start `pnpm dev` and verify:
1. All existing routes still return HTTP 200
2. Server starts with orchestrator online message
3. Mission detail page renders (check for Continue/Redeploy button visibility)

- [ ] **Step 4: Verify worktree code paths**

The full worktree flow requires a real Claude Code execution. Verify at minimum:
- `createWorktree` function: can be tested by calling it directly on the seeded battlefield
- `removeWorktree` function: verify cleanup
- `.gitignore` update: verify `.worktrees/` is appended
- If `claude` CLI is available: deploy a mission and verify worktree is created, execution happens in worktree, merge back on completion

- [ ] **Step 5: Fix any issues**

Address bugs, TypeScript errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase B2b — worktrees and session reuse operational"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Worktree created in `{battlefield.repoPath}/.worktrees/` for each mission
- [ ] Branch naming follows `devroom/{codename}/{id-suffix-12}` pattern
- [ ] `.worktrees/` added to battlefield's `.gitignore` automatically
- [ ] Worktree creation failure falls back to repo root gracefully
- [ ] Merge after accomplished mission uses `--no-ff`
- [ ] Conflict auto-resolution spawns Claude Code with correct prompt
- [ ] Failed conflict resolution → mission compromised, branch preserved
- [ ] Worktree cleaned up immediately after successful merge
- [ ] Abandoned missions have worktrees cleaned up
- [ ] Compromised missions have worktrees/branches preserved
- [ ] Continue Mission creates new mission with same sessionId
- [ ] Continue from compromised reuses preserved branch
- [ ] Redeploy creates fresh mission (no sessionId)
- [ ] Redeploy increments iterations on original mission
- [ ] `iterations` field NOT overwritten by executor's numTurns
- [ ] `cleanOrphanedWorktrees` utility exists for future Phase D sweep
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
