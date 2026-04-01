# Reliability Hardening — Design Spec

**Date:** 2026-04-01
**Scope:** Decouple review from merge, harden real-time updates, eliminate data corruption vectors

---

## 1. Mission Lifecycle — New Statuses & Compromise Reasons

### Updated Pipeline

```
standby → queued → deploying → in_combat → reviewing → approved → merging → accomplished
                                              ↓            ↓          ↓
                                          compromised  compromised  compromised
```

`abandoned` remains reachable from any pre-terminal status via Commander action.

### New Statuses

| Status | Color | Owner | Meaning |
|--------|-------|-------|---------|
| `approved` | teal | Quartermaster | Overseer approved debrief, awaiting merge |
| `merging` | amber | Quartermaster | Actively merging or waiting for retry |

All existing statuses retain their current colors.

### New DB Columns on `missions`

- **`compromiseReason`** — `TEXT`, nullable. Values: `timeout`, `merge-failed`, `review-failed`, `execution-failed`, `escalated`. Null when not compromised.
- **`mergeRetryAt`** — `INTEGER`, nullable. Unix timestamp for Quartermaster retry. Drives countdown UI.

### Handoff Boundaries

Each entity owns specific status transitions. No entity reaches into another's transitions.

- **Executor:** `standby` through `in_combat`. Writes debrief, sets `reviewing`.
- **Overseer:** Owns `reviewing`. Sets `approved`, `queued` (retry), or `compromised:review-failed/escalated`.
- **Quartermaster:** Owns `approved` and `merging`. Sets `accomplished` or `compromised:merge-failed`.

---

## 2. Overseer (Captain Rename)

### Rename Scope

Full rename across the entire codebase — files, DB table, types, socket events, UI labels, prompt templates.

**File renames:**

```
src/lib/captain/              → src/lib/overseer/
src/actions/captain.ts        → src/actions/overseer.ts
```

**DB migration:** Rename table `captain_logs` → `overseer_logs`. Column names unchanged.

**Code references:** Every occurrence of `captain`/`Captain` in identifiers, log strings, UI labels, prompt text, socket events, file paths, and imports updated to `overseer`/`Overseer`.

**Type rename:** `DebriefReview` → `OverseerReview`.

### Behavioral Changes

Overseer no longer calls `promoteMission()` or touches merge logic. Its only status transitions are:

- `reviewing` → `approved` (verdict: approve)
- `reviewing` → `queued` (verdict: retry, with feedback stored in overseer log)
- `reviewing` → `compromised:review-failed` (verdict: escalate, or retries exhausted)

Follow-up suggestion extraction removed from Overseer — moves to Quartermaster's `accomplished` path.

### Simplified Review Schema

```json
{
  "verdict": "approve" | "retry" | "escalate",
  "concerns": ["list of strings"],
  "reasoning": "why this verdict"
}
```

`satisfactory` field dropped. No more ambiguous `satisfactory: false` + `recommendation: "accept"` contradictions.

### Enriched Review Prompt

The Overseer review prompt now includes actual code changes, not just the agent's self-report:

1. CLAUDE.md (project conventions, truncated to 3000 chars)
2. Mission briefing (what was requested)
3. Mission debrief (what the agent reported)
4. `git diff --stat {targetBranch}...{worktreeBranch}` (file change summary — what the mission changed vs main)
5. `git diff {targetBranch}...{worktreeBranch}` (truncated to first 3000 chars of actual changes)

### Robust Parser (`review-parser.ts`)

Single spawn attempt. No retry loop. The parser handles all cases:

1. **Clean structured output** — parse `envelope.structured_output` directly
2. **Envelope errors** (`subtype !== 'success'`) — extract diagnostic, return `escalate` verdict with error as reasoning
3. **JSON in prose** — regex extract `{...}` from response
4. **Field coercion** — `concerns` as string → wrap in array. Missing `reasoning` → default. Missing `concerns` → empty array.
5. **Only `verdict` is required** — missing or invalid verdict → return `escalate` with diagnostic
6. **Complete garbage** — return `escalate` verdict with raw output snippet as diagnostic

Return type:

```typescript
type ParseResult =
  | { ok: true; review: OverseerReview }
  | { ok: false; fallback: OverseerReview; diagnostic: string }
```

Fallback always has `verdict: 'escalate'` so the system never gets stuck.

---

## 3. Quartermaster (New Module)

### File Structure

```
src/lib/quartermaster/
  quartermaster.ts      — main entry, orchestrates merge flow
  merge-executor.ts     — git merge + retry logic
  conflict-resolver.ts  — Claude Code spawn for conflict resolution
```

### Trigger

Overseer sets mission to `approved` → Quartermaster picks it up immediately. No queue, no delay.

**Non-worktree missions** (bootstrap missions, missions running in repo root): Quartermaster skips the merge/cleanup steps and transitions directly from `approved` → `accomplished`. Follow-up suggestion extraction still runs. The `merging` status is never entered.

### Flow

```
approved
  → merging (status update)
  → git merge --no-ff
  → success?
      → cleanup worktree + config
      → accomplished
      → extract follow-up suggestions
      → notify campaign executor
  → conflicts?
      → spawn Claude Code with full context (10-min timeout per resolution attempt)
      → resolved? → accomplished (same as above)
      → failed or timed out?
          → set mergeRetryAt = now + 60s
          → emit socket event with retryAt (UI shows countdown)
          → wait 60 seconds
          → git fetch + fresh merge from updated main
          → spawn Claude Code again (refreshed diff, 10-min timeout)
          → resolved? → accomplished
          → failed? → compromised:merge-failed (branch preserved)
```

### Conflict Resolution Prompt

The conflict resolver receives rich context:

1. CLAUDE.md (project conventions)
2. Mission briefing (what was requested)
3. Mission debrief (what the agent did)
4. Conflict diff with markers
5. `git log --oneline main..{branch}` (what the mission changed)
6. `git log --oneline {branch}..main` (what landed upstream since divergence)
7. Orders: resolve preserving both intents, run tests, commit

### Cleanup Responsibilities

- **On `accomplished`:** Remove worktree, remove `/tmp/claude-config/{missionId}`, remove worktree branch.
- **On `compromised:merge-failed`:** Remove `/tmp/claude-config/{missionId}`, preserve worktree branch for Commander inspection.
- **On conflict resolution timeout (10 min):** Kill process, `compromised:merge-failed`.

### UI — Merge Retry Countdown

When Quartermaster schedules a retry, the mission card in `merging` status shows:

```
MERGING — Retry in 47s
```

Countdown driven by `mergeRetryAt` timestamp emitted via socket event. UI decrements client-side.

---

## 4. Centralized Socket Emitter

### New File: `src/lib/socket/emit.ts`

Single function for all status change emissions:

```typescript
function emitStatusChange(
  entity: 'mission' | 'phase' | 'campaign' | 'battlefield',
  id: string,
  status: string,
  extra?: Record<string, unknown>
): void
```

### Internal Steps

1. **Resolve related IDs** — query entity for `battlefieldId`, `campaignId`, `phaseId`. One DB read.
2. **Call `revalidatePath()`** — invalidate correct Next.js cache paths based on entity type.
3. **Emit to all relevant rooms:**

| Entity | Rooms |
|--------|-------|
| Mission | `mission:{id}`, `battlefield:{battlefieldId}`, `campaign:{campaignId}` (if exists), `hq:activity` |
| Phase | `campaign:{campaignId}`, `battlefield:{battlefieldId}`, `hq:activity` |
| Campaign | `campaign:{id}`, `battlefield:{battlefieldId}`, `hq:activity` |
| Battlefield | `battlefield:{id}`, `hq:activity` |

### Event Names

Consistent per entity: `mission:status`, `phase:status`, `campaign:status`, `battlefield:status`.

### Replaces

- Local `emitStatusChange()` in `review-handler.ts`
- Scattered `io.to(...).emit(...)` in `executor.ts`, `campaign-executor.ts`, server actions
- `activity:event` emissions in server actions

### Order Guarantee

Caller writes to DB first, then calls `emitStatusChange()`. Emitter does revalidation before socket emission. Clients always get events after cache is fresh.

---

## 5. Reconnect State Sync

When Socket.IO reconnects, client hooks refetch current state via existing server actions.

### Per-Hook Changes

- **`useCampaignComms`** — on reconnect, call server action to fetch campaign + phase + mission statuses.
- **`useAssetDeployment`** — on reconnect, call `getAssetDeployment()`. Already has `refresh()`, just wire it to reconnect.
- **`useMissionComms`** — on reconnect, refetch mission status + recent logs.

### Sidebar Fix

`asset-deployment.tsx` currently never calls `hq:unsubscribe` on unmount. Add to cleanup return.

### No Server-Side Changes

Existing server actions return fresh data. Reconnect triggers client-side refetches only.

---

## 6. Transaction Wrapping & DB Guards

### Blanket Rule

Every multi-step DB write wrapped in `db.transaction()`. Synchronous `better-sqlite3` — zero performance cost.

### Operations Wrapped

| Operation | File |
|-----------|------|
| Mission + intel note creation | `mission.ts` |
| Battlefield + bootstrap mission creation | `battlefield.ts` |
| Plan insertion (phases + missions loop) | `briefing-engine.ts` |
| Campaign launch (status + intel note swap + briefing cleanup) | `campaign.ts` |
| Cascading mission abandonment | `campaign.ts` |
| Mission deletion (mission + intel notes + logs + overseer logs) | `mission.ts` |
| Campaign completion/abandonment (status + child updates) | `campaign.ts` |
| Briefing session creation | `briefing-engine.ts` |

### Phase Completion DB Guard

New column on `phases` table: **`completingAt`** — `INTEGER`, nullable timestamp.

Before advancing a phase:

1. `UPDATE phases SET completingAt = now WHERE id = ? AND completingAt IS NULL`
2. Check rows affected — if 0, another process already claimed it, bail out
3. Proceed with phase debrief + advancement
4. Clear `completingAt` after completion (or on failure for recovery)

Atomic check-and-set. SQLite write lock guarantees one caller wins. Recovery sweep detects stale `completingAt` values after server restart.

### Briefing Session UPSERT

Add unique constraint on `briefingSessions.campaignId`. Replace check-then-insert with `INSERT ... ON CONFLICT (campaignId) DO NOTHING`, then select existing row.

---

## 7. Safe Orchestrator Wrapper & Process Timeout

### Safe Wrapper: `src/lib/orchestrator/safe-queue.ts`

```typescript
function safeQueueMission(missionId: string): void
```

Wraps `globalThis.orchestrator?.onMissionQueued()` in try-catch. On failure:

- Logs error with mission ID
- Emits escalation notification to Commander
- Emits status change so UI shows the mission is stuck

Replaces all 7 call sites across `battlefield.ts`, `mission.ts`, `campaign.ts`, `review-handler.ts`, `campaign-executor.ts`.

### 30-Minute Hard Process Timeout

After spawning Claude Code in `executor.ts`:

```typescript
const timeout = setTimeout(() => {
  abortController.abort();
}, 30 * 60 * 1000);
```

Clear on normal exit. When timeout fires:

1. AbortController kills the process
2. Mission marked `compromised` with `compromiseReason: 'timeout'`
3. Escalation notification sent
4. Overseer auto-retries once on timeout reason. If retry also times out, escalate to Commander.

30 minutes blanket, not configurable per-mission.

---

## 8. Validations & Inline Error Panels

### FK Validations

| Validation | Location | Error |
|-----------|----------|-------|
| `assetId` exists and active | `_createMission()` | "Asset not found or inactive" |
| `battlefieldId` exists | `createCampaign()` | "Battlefield not found" |
| `battlefieldId` active | `_createMission()` | "Battlefield not active" |
| `campaignId` exists | `insertPlanFromBriefing()` | "Campaign not found" |
| `phaseId` exists and belongs to campaign | Manual phase mission creation | "Phase not found or doesn't belong to campaign" |
| Briefing not empty | `_createMission()` | "Mission briefing is required" |
| PATHFINDER asset exists | `createBootstrapMission()` | "PATHFINDER asset required — no fallback" |

### Dependency Cycle Detection

Topological sort at insertion time. If cycle detected, reject with clear path: "Circular dependency: Mission A -> Mission B -> Mission A".

Runs at:
- `insertPlanFromBriefing()` — plan generation
- Manual mission creation with `dependsOn`

### Inline Error Panel Component

Reusable `<InlineErrorPanel>` for entity cards:

```typescript
interface InlineErrorPanelProps {
  title: string;
  detail: string;
  context?: string;
  actions: ErrorAction[];
}
```

Renders on mission cards based on `compromiseReason`:

| Reason | Title | Actions |
|--------|-------|---------|
| `merge-failed` | "Merge failed" + conflict files | Retry Merge, View Diff, Skip, Abandon |
| `review-failed` | "Overseer rejected" + concerns | Retry Mission, Edit Briefing & Retry, Skip, Abandon |
| `timeout` | "Timed out after 30 minutes" | Retry, Skip, Abandon |
| `execution-failed` | "Process crashed" + error | Retry, View Logs, Skip, Abandon |
| `escalated` | "Overseer escalation" + reasoning | Retry, Skip, Abandon, Override Approve |

**"Override Approve"** — Commander escape hatch for escalation cases. Pushes mission to `approved`, triggering Quartermaster.

Form validation errors surface as inline field errors — standard form UX, form stays open for correction.

---

## Summary — What Changes Where

### New Files

| File | Purpose |
|------|---------|
| `src/lib/quartermaster/quartermaster.ts` | Merge orchestration |
| `src/lib/quartermaster/merge-executor.ts` | Git merge + retry logic |
| `src/lib/quartermaster/conflict-resolver.ts` | Claude Code conflict resolution |
| `src/lib/overseer/review-parser.ts` | Robust lenient JSON parser |
| `src/lib/socket/emit.ts` | Centralized status emitter |
| `src/lib/orchestrator/safe-queue.ts` | Safe orchestrator wrapper |
| `src/components/ui/inline-error-panel.tsx` | Reusable error panel component |

### Renamed Files

| From | To |
|------|-----|
| `src/lib/captain/*` | `src/lib/overseer/*` |
| `src/actions/captain.ts` | `src/actions/overseer.ts` |

### Modified Files (Key Changes)

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add `compromiseReason`, `mergeRetryAt` to missions. Add `completingAt` to phases. Rename `captainLogs` → `overseerLogs`. Add unique constraint on `briefingSessions.campaignId`. |
| `src/lib/orchestrator/executor.ts` | Add 30-min timeout. Use centralized emitter. Use safe queue wrapper. |
| `src/lib/orchestrator/campaign-executor.ts` | Use phase completion guard. Use centralized emitter. Use safe queue wrapper. |
| `src/actions/mission.ts` | Transaction wrapping. FK validations. Use centralized emitter. Use safe queue wrapper. |
| `src/actions/campaign.ts` | Transaction wrapping. FK validations. Use centralized emitter. |
| `src/lib/briefing/briefing-engine.ts` | Transaction wrapping. UPSERT for sessions. Cycle detection on plan insertion. |
| `src/actions/battlefield.ts` | Transaction wrapping. |
| `src/hooks/use-campaign-comms.ts` | Listen for correct events. Refetch on reconnect. |
| `src/components/asset/asset-deployment.tsx` | Fix unsubscribe. Refetch on reconnect. |
| Mission card components | Render `<InlineErrorPanel>` based on `compromiseReason`. |
| Campaign detail page | Show `merging` status with countdown. Show `approved` status with teal badge. |
