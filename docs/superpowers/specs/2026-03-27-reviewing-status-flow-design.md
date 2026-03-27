# REVIEWING Status Flow

## Summary

Add a `REVIEWING` status to the mission lifecycle. When an agent finishes work, the mission enters `REVIEWING` instead of going straight to `ACCOMPLISHED`. The Captain (an automated reviewer) evaluates the debrief and either approves it, sends it back for rework, or escalates to the Commander.

Compromised missions also get a single Captain triage to determine if the failure is recoverable.

## Motivation

Currently, missions go straight to `ACCOMPLISHED` when the agent finishes. The Captain review fires in the background but has no authority to change the mission status. This means:

- No distinction between "agent done" and "quality verified"
- Captain retry creates a new mission (loses session context)
- The review result has no real consequence on mission state

## Status Lifecycle (Updated)

```
STANDBY → QUEUED → DEPLOYING → IN_COMBAT
                                    │
                          ┌─────────┴──────────┐
                          │                    │
                     (success)            (failure)
                          │                    │
                      REVIEWING           COMPROMISED
                          │                    │
                ┌─────────┼──────────┐    Captain triage
                │         │          │    (1 attempt max)
             accept    retry(≤2)  escalate    │
                │         │          │    ┌───┼────┐
          ACCOMPLISHED  QUEUED  COMPROMISED  retry  stay
                          │         +notify   │  COMPROMISED
                          │                QUEUED    +notify
                       (re-execute)
                          │
                      REVIEWING ...
```

## Retry Limits

- **REVIEWING missions**: max 2 captain-driven retries. On the 3rd rejection → `COMPROMISED` + escalate.
- **COMPROMISED missions**: max 1 captain triage retry. On the 2nd rejection → stays `COMPROMISED` + escalate.

Tracked by a `reviewAttempts` column on the missions table.

## Approach: Asynchronous Review (Non-blocking)

When the agent finishes, the executor:
1. Sets status to `REVIEWING` (or `COMPROMISED` for failures)
2. Releases the agent slot
3. Returns

The Captain review runs as a separate background process. When it completes, a callback:
- Updates the mission status
- Re-queues via `orchestrator.onMissionQueued()` if retrying
- Calls `escalate()` if exhausted

This keeps the executor simple (run once, return) and frees slots during the 10-30s review window.

## Detailed Changes

### 1. Schema

**Missions table — new column:**
```sql
ALTER TABLE missions ADD COLUMN review_attempts INTEGER DEFAULT 0;
```

**Types — MissionStatus updated:**
```typescript
type MissionStatus = 'standby' | 'queued' | 'deploying' | 'in_combat'
  | 'reviewing' | 'accomplished' | 'compromised' | 'abandoned';
```

### 2. Executor (`executor.ts`)

**When agent finishes successfully (isError = false):**
- Set status → `REVIEWING`
- Release slot (executor returns)
- Fire captain review asynchronously

**When agent fails (isError = true):**
- Set status → `COMPROMISED` (same as today)
- Release slot (executor returns)
- Fire captain triage asynchronously (new)

The executor **never sets `accomplished` directly.** Only the captain callback promotes to `accomplished`.

### 3. Captain Review Callback

New function: `handleCaptainReviewResult(missionId, review)`.

**For `REVIEWING` missions:**

| Captain result | reviewAttempts < 2 | reviewAttempts = 2 |
|---|---|---|
| `accept` | → `ACCOMPLISHED` | → `ACCOMPLISHED` |
| `retry` | Append feedback, → `QUEUED`, increment reviewAttempts | → `COMPROMISED`, escalate (notification + telegram) |
| `escalate` | → `COMPROMISED`, escalate | → `COMPROMISED`, escalate |

**For `COMPROMISED` missions:**

| Captain result | reviewAttempts < 1 | reviewAttempts = 1 |
|---|---|---|
| `accept` | → `ACCOMPLISHED` | → `ACCOMPLISHED` |
| `retry` | Append feedback, → `QUEUED`, increment reviewAttempts | Stay `COMPROMISED`, escalate |
| `escalate` | Stay `COMPROMISED`, escalate | Stay `COMPROMISED`, escalate |

### 4. Retry Prompt Construction

When the captain triggers a retry, the agent needs context. The executor builds a prompt:

```
[Original CLAUDE.md content — cached]
[Asset system prompt]

MISSION RETRY — Captain Review Feedback
========================================
The Captain reviewed your previous work and found these concerns:
- [concern 1]
- [concern 2]

Captain's reasoning: [reasoning]

Please address these concerns. Your previous session context is preserved.
You have access to all changes you made previously.

Original briefing:
[original mission briefing]
```

The session ID is preserved so the agent has full conversation history from the previous attempt.

### 5. UI Changes

**TacBadge:**
- `reviewing` → blue color, glow effect

**Mission Comms:**
- `REVIEWING` is neither terminal nor pre-deploy — it's a mid-state
- Show existing comms (agent's work) + a status line: "Captain reviewing debrief..."
- When status changes via socket, UI updates live

**Mission Actions:**
- `REVIEWING` state: only ABANDON button (Commander override)
- No DEPLOY, REDEPLOY, or CONTINUE

**StatsBar:**
- `REVIEWING` counts with active missions (not accomplished, not standby)

**Mission list:**
- Blue badge, sorted near top with active missions

### 6. Escalation

Uses the existing `escalate()` function from `src/lib/captain/escalation.ts`:
- Stores notification in DB
- Emits via Socket.IO to HQ activity feed
- Sends Telegram message to Commander

Triggered when:
- REVIEWING mission: captain rejects after 2 retries
- REVIEWING mission: captain recommends escalate
- COMPROMISED mission: captain rejects after 1 triage retry
- COMPROMISED mission: captain recommends escalate

### 7. Files to Modify

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'reviewing'` to MissionStatus |
| `src/lib/db/schema.ts` | Add `reviewAttempts` column |
| `drizzle migration` | ALTER TABLE for new column |
| `src/lib/orchestrator/executor.ts` | Set `reviewing` instead of `accomplished`, fire async review for both outcomes |
| `src/lib/captain/debrief-reviewer.ts` | No change (already works) |
| `src/lib/captain/escalation.ts` | No change (already works) |
| New: `src/lib/captain/review-handler.ts` | Captain review callback logic, retry prompt construction |
| `src/lib/orchestrator/orchestrator.ts` | No change (queue logic already handles re-queued missions) |
| `src/components/ui/tac-badge.tsx` | Add reviewing color |
| `src/components/mission/mission-comms.tsx` | Handle reviewing state in UI |
| `src/components/mission/mission-actions.tsx` | ABANDON only for reviewing |
| `src/components/dashboard/stats-bar.tsx` | Count reviewing as active |
| `src/app/(hq)/battlefields/[id]/page.tsx` | Count reviewing in stats |

### 8. Worktree and Merge Timing

Currently, the executor merges the worktree branch and cleans up **before** setting the final status. With the new flow, this needs adjustment:

- **Merge happens before REVIEWING** — the agent's work is merged into the default branch before the captain reviews. This is the same as today.
- **Worktree is cleaned up after merge** — same as today.
- **If captain retries**: the agent is re-queued and a **new worktree** is created for the retry (new branch from the current default branch, which already contains the merged work). The agent runs in this new worktree with the session preserved, addresses the captain's concerns, and the new changes are merged on completion.
- **If merge fails**: status goes to `COMPROMISED` with the branch preserved (same as today). The captain triage can then decide if it's recoverable.

This means each retry gets a fresh worktree branched from the latest state (which includes all previous work that was merged). The session ID continuity gives the agent memory of what it did, while the new worktree gives it a clean workspace.

### 9. What Does NOT Change

- Orchestrator queue logic — re-queued missions are picked up the same way
- Session management — session IDs preserved across retries
- Campaign executor — campaign missions go through the same flow
- Existing captain log storage — each review is logged as before
