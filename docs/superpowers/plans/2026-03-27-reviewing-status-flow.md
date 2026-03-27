# REVIEWING Status Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `REVIEWING` status so the Captain reviews mission results before they become `ACCOMPLISHED`, with retry capability for unsatisfactory work.

**Architecture:** Async non-blocking review. Executor sets `REVIEWING`/`COMPROMISED` and releases the slot. A new `review-handler.ts` module processes the captain's decision and transitions the mission to its final state or re-queues it. Session ID preserved across retries for full context continuity.

**Tech Stack:** Drizzle ORM (SQLite migration), TypeScript, Socket.IO for live status updates.

**Spec:** `docs/superpowers/specs/2026-03-27-reviewing-status-flow-design.md`

---

### Task 1: Schema and Type Changes

**Files:**
- Modify: `src/types/index.ts:20`
- Modify: `src/lib/db/schema.ts:29-54`
- Create: new Drizzle migration

- [ ] **Step 1: Add `reviewing` to MissionStatus type**

In `src/types/index.ts`, change line 20:

```typescript
export type MissionStatus = 'standby' | 'queued' | 'deploying' | 'in_combat' | 'reviewing' | 'accomplished' | 'compromised' | 'abandoned';
```

- [ ] **Step 2: Add `reviewAttempts` column to missions schema**

In `src/lib/db/schema.ts`, add after the `costCacheHit` line (around line 50):

```typescript
  reviewAttempts: integer('review_attempts').default(0),
```

- [ ] **Step 3: Generate the Drizzle migration**

Run: `npx drizzle-kit generate`

Expected: a new migration file created in `src/lib/db/migrations/`

- [ ] **Step 4: Apply the migration**

Run: `npx drizzle-kit migrate`

Expected: `review_attempts` column added to `missions` table

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "feat: add REVIEWING status and reviewAttempts column to missions"
```

---

### Task 2: Captain Review Handler

**Files:**
- Create: `src/lib/captain/review-handler.ts`

This is the core logic — the callback that processes the captain's review result and transitions the mission.

- [ ] **Step 1: Create the review handler module**

Create `src/lib/captain/review-handler.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields } from '@/lib/db/schema';
import { reviewDebrief, type DebriefReview } from './debrief-reviewer';
import { storeCaptainLog } from './captain-db';
import { escalate } from './escalation';
import type { Mission } from '@/types';

// Max retries: 2 for reviewing (successful missions), 1 for compromised (failed missions)
const MAX_REVIEW_RETRIES = 2;
const MAX_TRIAGE_RETRIES = 1;

/**
 * Run the captain review for a mission and handle the result.
 * Called asynchronously after the executor releases the slot.
 */
export async function runCaptainReview(missionId: string): Promise<void> {
  const db = getDatabase();

  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) {
    console.error(`[Captain] Review: mission ${missionId} not found`);
    return;
  }

  if (!mission.debrief) {
    console.warn(`[Captain] Review: mission ${missionId} has no debrief, auto-accepting`);
    if (mission.status === 'reviewing') {
      promoteMission(missionId, 'accomplished');
    }
    return;
  }

  const battlefield = db.select().from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId)).get();
  if (!battlefield) {
    console.error(`[Captain] Review: battlefield not found for mission ${missionId}`);
    return;
  }

  // Read CLAUDE.md for context
  let claudeMd: string | null = null;
  if (battlefield.claudeMdPath) {
    try {
      const fs = await import('fs');
      claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
    } catch { /* file may not exist */ }
  }

  // Run the captain review
  let review: DebriefReview;
  try {
    review = await reviewDebrief({
      missionBriefing: mission.briefing,
      missionDebrief: mission.debrief,
      claudeMd,
      missionId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
  } catch (err) {
    console.error(`[Captain] Review failed for mission ${missionId}:`, err);
    // On review failure, auto-accept to avoid blocking
    if (mission.status === 'reviewing') {
      promoteMission(missionId, 'accomplished');
    }
    return;
  }

  // Store the captain log
  storeCaptainLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
    answer: review.satisfactory
      ? 'Satisfactory'
      : `Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: review.satisfactory ? 'high' : 'medium',
    escalated: review.recommendation === 'escalate' ? 1 : 0,
  });

  const isReviewing = mission.status === 'reviewing';
  const isCompromised = mission.status === 'compromised';
  const maxRetries = isReviewing ? MAX_REVIEW_RETRIES : MAX_TRIAGE_RETRIES;
  const currentAttempts = mission.reviewAttempts ?? 0;

  // Handle the captain's recommendation
  if (review.recommendation === 'accept' || (review.satisfactory && review.recommendation !== 'escalate')) {
    // Captain approves
    promoteMission(missionId, 'accomplished');

    if (review.concerns.length > 0) {
      // Satisfactory but with concerns — info notification
      await escalate({
        level: 'info',
        title: `Debrief Note: ${mission.title}`,
        detail: review.concerns.join('. '),
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });
    }
  } else if (review.recommendation === 'retry') {
    if (currentAttempts < maxRetries) {
      // Retry — re-queue with captain feedback
      await requeueMissionWithFeedback(mission as Mission, review);
    } else {
      // Exhausted retries — compromise and escalate
      exhaustRetries(mission as Mission, review);
    }
  } else if (review.recommendation === 'escalate') {
    // Direct escalation
    if (isReviewing) {
      db.update(missions).set({
        status: 'compromised',
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();
    }

    emitStatusChange(missionId, isReviewing ? 'compromised' : mission.status!);

    await escalate({
      level: 'warning',
      title: `Captain Escalation: ${mission.title}`,
      detail: `Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
      entityType: 'mission',
      entityId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
  }
}

function promoteMission(missionId: string, status: 'accomplished'): void {
  const db = getDatabase();
  db.update(missions).set({
    status,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  }).where(eq(missions.id, missionId)).run();

  emitStatusChange(missionId, status);
  console.log(`[Captain] Mission ${missionId} → ${status}`);
}

async function requeueMissionWithFeedback(
  mission: Mission,
  review: DebriefReview,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  db.update(missions).set({
    status: 'queued',
    reviewAttempts: (mission.reviewAttempts ?? 0) + 1,
    completedAt: null,
    startedAt: null,
    updatedAt: now,
  }).where(eq(missions.id, mission.id)).run();

  emitStatusChange(mission.id, 'queued');

  console.log(`[Captain] Mission ${mission.id} re-queued (attempt ${(mission.reviewAttempts ?? 0) + 1}). Concerns: ${review.concerns.join(', ')}`);

  // Store the feedback so the executor can build the retry prompt
  storeCaptainLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[RETRY_FEEDBACK] Mission: ${mission.title}`,
    answer: `Retry requested. Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: 'medium',
    escalated: 0,
  });

  // Notify orchestrator
  globalThis.orchestrator?.onMissionQueued(mission.id);
}

function exhaustRetries(mission: Mission, review: DebriefReview): void {
  const db = getDatabase();
  const isReviewing = mission.status === 'reviewing';

  if (isReviewing) {
    db.update(missions).set({
      status: 'compromised',
      debrief: (mission.debrief || '') +
        `\n\n---\n\nCAPTAIN REVIEW: Mission rejected after ${mission.reviewAttempts ?? 0} retries.\nConcerns: ${review.concerns.join(', ')}\nReasoning: ${review.reasoning}`,
      updatedAt: Date.now(),
    }).where(eq(missions.id, mission.id)).run();
  }

  emitStatusChange(mission.id, 'compromised');

  escalate({
    level: 'warning',
    title: `Mission Rejected: ${mission.title}`,
    detail: `Captain exhausted ${isReviewing ? MAX_REVIEW_RETRIES : MAX_TRIAGE_RETRIES} retries. Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
    entityType: 'mission',
    entityId: mission.id,
    battlefieldId: mission.battlefieldId,
  });

  console.log(`[Captain] Mission ${mission.id} → compromised (retries exhausted)`);
}

function emitStatusChange(missionId: string, status: string): void {
  if (globalThis.io) {
    globalThis.io.to(`mission:${missionId}`).emit('mission:status', {
      missionId,
      status,
      timestamp: Date.now(),
    });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/captain/review-handler.ts
git commit -m "feat: add captain review handler with retry and escalation logic"
```

---

### Task 3: Executor Changes

**Files:**
- Modify: `src/lib/orchestrator/executor.ts:402-493`

Replace the direct status assignment and fire-and-forget captain review with the new flow.

- [ ] **Step 1: Add import for review handler**

At the top of `src/lib/orchestrator/executor.ts`, add:

```typescript
import { runCaptainReview } from '@/lib/captain/review-handler';
```

- [ ] **Step 2: Update the import for captain log retrieval**

In `src/lib/orchestrator/executor.ts`, find the existing captain-related imports. We need to add an import for getting retry feedback. Add to imports:

```typescript
import { getCaptainLogs } from '@/actions/captain';
```

- [ ] **Step 3: Replace final status logic and captain review trigger**

In `src/lib/orchestrator/executor.ts`, find the block starting at approximately line 402 (the `if (streamResult)` block). Replace the final status assignment and the entire captain review fire-and-forget block.

Find this code (lines ~402-416):
```typescript
      const r = streamResult as StreamResult;
      const finalStatus = r.isError ? 'compromised' : 'accomplished';

      db.update(missions).set({
        sessionId: r.sessionId,
        debrief: r.result,
        costInput: r.usage.inputTokens,
        costOutput: r.usage.outputTokens,
        costCacheHit: r.usage.cacheReadTokens,
        durationMs: r.durationMs,
        status: finalStatus,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();
```

Replace with:
```typescript
      const r = streamResult as StreamResult;
      const finalStatus = r.isError ? 'compromised' : 'reviewing';

      db.update(missions).set({
        sessionId: r.sessionId,
        debrief: r.result,
        costInput: r.usage.inputTokens,
        costOutput: r.usage.outputTokens,
        costCacheHit: r.usage.cacheReadTokens,
        durationMs: r.durationMs,
        status: finalStatus,
        completedAt: r.isError ? Date.now() : null,
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();
```

Note: `completedAt` is `null` for `reviewing` since the mission isn't truly complete yet.

- [ ] **Step 4: Replace the entire captain fire-and-forget block**

Find the block starting with `// Captain auto-review of debrief (fire-and-forget)` (approximately lines 445-493). Replace that entire `if (finalStatus === 'accomplished')` block with:

```typescript
      // Captain review — async, non-blocking
      runCaptainReview(mission.id).catch(err => {
        console.error('[Captain] Review handler failed:', err);
      });
```

This fires for BOTH `reviewing` and `compromised` missions — the review handler internally checks the status and applies the appropriate retry limits.

- [ ] **Step 5: Update the retry prompt building in the executor**

The executor needs to check if a mission is being retried (has captain feedback) and adjust the prompt accordingly. Find the prompt building section (where `fullPrompt` is assembled, before the Claude spawn).

In `src/lib/orchestrator/executor.ts`, find where `fullPrompt` is built (the prompt-builder call). After it, add:

```typescript
    // Check for captain retry feedback
    const retryAttempts = mission.reviewAttempts ?? 0;
    if (retryAttempts > 0) {
      // This is a captain-driven retry — append feedback to the prompt
      const captainLogs = await getCaptainLogs({ missionId: mission.id });
      const retryFeedback = captainLogs
        .filter(log => log.question.startsWith('[RETRY_FEEDBACK]'))
        .pop(); // Most recent retry feedback

      if (retryFeedback) {
        fullPrompt += `\n\n---\n\nCAPTAIN REVIEW FEEDBACK (Retry ${retryAttempts})\n========================================\nThe Captain reviewed your previous work and found these concerns:\n${retryFeedback.answer}\n\nCaptain's reasoning: ${retryFeedback.reasoning}\n\nPlease address these concerns. Your previous session context is preserved.\nYou have access to all changes you made previously.\n\nOriginal briefing:\n${mission.briefing}`;
      }
    }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "feat: executor sets REVIEWING status, delegates to captain review handler"
```

---

### Task 4: UI — Badge, Comms, and Actions

**Files:**
- Modify: `src/components/ui/tac-badge.tsx:11-24`
- Modify: `src/components/mission/mission-comms.tsx:27-28`
- Modify: `src/components/mission/mission-actions.tsx:38-43`

- [ ] **Step 1: Add reviewing color to TacBadge**

In `src/components/ui/tac-badge.tsx`, add to the `statusColorMap` object (after `deploying: 'amber'`):

```typescript
  reviewing: 'blue',
```

- [ ] **Step 2: Update terminal and pre-deploy status lists in MissionComms**

In `src/components/mission/mission-comms.tsx`, update lines 27-28:

```typescript
const TERMINAL_STATUSES: MissionStatus[] = ['accomplished', 'compromised', 'abandoned'];
const PRE_DEPLOY_STATUSES = ['standby', 'queued'];
```

No change to `TERMINAL_STATUSES` — `reviewing` is NOT terminal (it can transition). No change to `PRE_DEPLOY_STATUSES` either. But we need to add a reviewing-specific message in the terminal logs section.

Find the `isPreDeploy` ternary that builds `terminalLogs` (around line 75-90):

```typescript
  const isPreDeploy = PRE_DEPLOY_STATUSES.includes(liveStatus);
  const terminalLogs = isPreDeploy
    ? [
        {
          timestamp: Date.now(),
          type: 'status' as const,
          content:
            'Awaiting deployment. Comms will appear here when the mission is in combat.',
        },
      ]
    : logs.map((log) => ({
```

Replace with:

```typescript
  const isPreDeploy = PRE_DEPLOY_STATUSES.includes(liveStatus);
  const isReviewing = liveStatus === 'reviewing';
  const terminalLogs = isPreDeploy
    ? [
        {
          timestamp: Date.now(),
          type: 'status' as const,
          content:
            'Awaiting deployment. Comms will appear here when the mission is in combat.',
        },
      ]
    : [
        ...logs.map((log) => ({
          timestamp: log.timestamp,
          type: (log.type as 'log' | 'status' | 'error') ?? 'log',
          content: log.content,
        })),
        ...(isReviewing
          ? [
              {
                timestamp: Date.now(),
                type: 'status' as const,
                content: 'Agent work complete. Captain reviewing debrief...',
              },
            ]
          : []),
      ];
```

Note: remove the existing else branch that maps logs (it's now incorporated into the array above).

- [ ] **Step 3: Update mission action visibility**

In `src/components/mission/mission-actions.tsx`, update the status checks (lines 38-43):

```typescript
  const canDeploy = status === 'standby';
  const canAbandon = status === 'standby' || status === 'queued' || status === 'in_combat' || status === 'reviewing';
  const isTerminal = status === 'accomplished' || status === 'compromised' || status === 'abandoned';
  const canContinue =
    (status === 'accomplished' || status === 'compromised') && sessionId != null;
  const canRedeploy = isTerminal;
```

Only change: added `|| status === 'reviewing'` to `canAbandon`. Commander can abort a mission during review.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/tac-badge.tsx src/components/mission/mission-comms.tsx src/components/mission/mission-actions.tsx
git commit -m "feat: UI support for REVIEWING status — badge, comms message, action visibility"
```

---

### Task 5: Stats Bar and Battlefield Overview

**Files:**
- Modify: `src/app/(hq)/battlefields/[id]/page.tsx:154-158`
- Modify: `src/components/dashboard/stats-bar.tsx`
- Modify: `src/app/(hq)/page.tsx` (HQ page stats if applicable)

- [ ] **Step 1: Count reviewing missions as active in battlefield overview**

In `src/app/(hq)/battlefields/[id]/page.tsx`, find the stats computation (around line 155):

```typescript
  const inCombatCount = missionRows.filter(m => m.status === 'in_combat' || m.status === 'deploying').length;
```

Replace with:

```typescript
  const inCombatCount = missionRows.filter(m => m.status === 'in_combat' || m.status === 'deploying' || m.status === 'reviewing').length;
```

- [ ] **Step 2: Check HQ page for same pattern**

In `src/app/(hq)/page.tsx`, search for similar stats computation. If `inCombat` or active counts exist, add `reviewing` to them using the same pattern.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/app/(hq)/battlefields/[id]/page.tsx src/app/(hq)/page.tsx
git commit -m "feat: count REVIEWING missions as active in stats"
```

---

### Task 6: Remove Old Captain Fire-and-Forget References

**Files:**
- Modify: `src/lib/orchestrator/executor.ts` (verify cleanup)

- [ ] **Step 1: Verify no old captain imports remain unused**

Check that the old imports (`reviewDebrief`, `storeCaptainLog`, `escalate`) are removed from `executor.ts` if they're no longer directly used there. The review handler now owns those calls.

Remove these imports from `executor.ts` if present and unused:

```typescript
// Remove if unused:
import { reviewDebrief } from '@/lib/captain/debrief-reviewer';
import { storeCaptainLog } from '@/lib/captain/captain-db';
import { escalate } from '@/lib/captain/escalation';
```

Run: `npx tsc --noEmit` to verify nothing breaks.

- [ ] **Step 2: Verify the `getCaptainLogs` import works**

Ensure `getCaptainLogs` from `@/actions/captain` accepts a `{ missionId }` filter and returns logs ordered by timestamp. Read the function to confirm.

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "refactor: clean up old captain imports from executor"
```

---

### Task 7: End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: Restart the dev server**

Run: `npm run dev` (or restart if already running)

The new migration should be applied automatically on startup.

- [ ] **Step 2: Create a test mission and deploy it**

From the battlefield page, create a simple mission (e.g., "List all files in the src/ directory") and deploy it.

- [ ] **Step 3: Verify REVIEWING status appears**

Watch the mission page. After the agent finishes:
- Status should show blue `REVIEWING` badge
- Comms should show "Agent work complete. Captain reviewing debrief..."
- ABANDON button should be visible
- Stats bar should count this mission as active

- [ ] **Step 4: Verify captain review completes**

Wait for the captain review (10-30 seconds). The mission should transition to:
- `ACCOMPLISHED` (green) if the captain approves
- Back to `QUEUED` if the captain requests retry (check the server logs)

- [ ] **Step 5: Check captain log**

On the mission page, verify a Captain's Log entry appears with the actual review reasoning (not "Unable to parse review").

- [ ] **Step 6: Verify battlefield stats update**

Check the battlefield overview page — the stats should correctly show the mission's final status.
