# Phase C2: Campaign Execution — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** C2 (Campaign Execution)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase C1 (Campaign CRUD + Planning) — complete

---

## Overview

Phase C2 adds campaign execution: sequential phase progression with parallel mission execution within each phase, `dependsOn` enforcement for intra-phase ordering, AI-generated phase debriefs passed as context to subsequent phases, and real-time status updates. When a phase has compromised missions, the campaign pauses for Commander decision (resume, skip, or abandon).

---

## 1. Campaign Executor

**File:** `src/lib/orchestrator/campaign-executor.ts`

Manages the lifecycle of a running campaign.

### Class Design

```typescript
class CampaignExecutor {
  private campaignId: string;
  private io: SocketIOServer;

  constructor(campaignId: string, io: SocketIOServer);

  async start(): Promise<void>;
  async resume(): Promise<void>;
  async skipAndContinue(): Promise<void>;
  async onCampaignMissionComplete(missionId: string): Promise<void>;
  private async startPhase(phaseId: string): Promise<void>;
  private async checkDependencies(phaseId: string): Promise<void>;
  private async onPhaseComplete(phaseId: string): Promise<void>;
  private async generatePhaseDebrief(phaseId: string): Promise<void>;
  private async advanceToNextPhase(): Promise<void>;
  private emitCampaignStatus(status: string): void;
  private emitPhaseStatus(phaseId: string, phaseNumber: number, status: string): void;
}
```

### `start()`

1. Get campaign, validate status is `active`
2. Get the phase matching `currentPhase` number
3. Call `startPhase(phase.id)`

### `startPhase(phaseId)`

1. Set phase status to `active`
2. Emit `campaign:phase-status` event
3. Get all missions in this phase
4. For each mission:
   - If no `dependsOn` (null, empty array, or `[]` JSON): set status to `queued`, call `orchestrator.onMissionQueued()`
   - If has `dependsOn`: leave as `standby` — will be queued by `checkDependencies` when deps complete

### `onCampaignMissionComplete(missionId)`

Called by the orchestrator when any campaign mission reaches a terminal state.

1. Get the mission and its phase
2. Emit `campaign:mission-status` event
3. If mission `accomplished`: call `checkDependencies(phaseId)` to unblock waiting missions
4. Check if ALL missions in the phase are terminal (`accomplished`, `compromised`, or `abandoned`)
5. If all terminal: call `onPhaseComplete(phaseId)`

### `checkDependencies(phaseId)`

1. Get all `standby` missions in this phase
2. Get all `accomplished` mission titles in this phase
3. For each standby mission with `dependsOn`:
   - Parse `dependsOn` from JSON string to string array
   - Check if ALL dependency titles are in the accomplished set
   - If yes: set status to `queued`, call `orchestrator.onMissionQueued()`

### `onPhaseComplete(phaseId)`

1. Get all missions in the phase
2. Check if any are `compromised`:
   - **Yes (any compromised):**
     - Set phase status to `compromised`
     - Set campaign status to `paused`
     - Emit events
     - Log: "Phase compromised. Campaign paused. Awaiting Commander orders."
     - Return (Commander decides via resume/skip/abandon)
   - **No (all accomplished):**
     - Call `generatePhaseDebrief(phaseId)`
     - Set phase status to `secured`
     - Record `totalTokens` (sum of all mission token costs) and `durationMs` on the phase
     - Emit `campaign:phase-status` (secured) and `campaign:phase-debrief`
     - Call `advanceToNextPhase()`

### `advanceToNextPhase()`

1. Get campaign, increment `currentPhase`
2. Get the next phase (by `phaseNumber = currentPhase`)
3. If no more phases:
   - Set campaign status to `accomplished`
   - Emit `campaign:status` (accomplished)
   - Log: "Campaign accomplished. All phases secured."
4. If more phases:
   - Update `currentPhase` on campaign record
   - Call `startPhase(nextPhase.id)`

### `resume()`

For paused campaigns. Re-evaluates the current phase:
1. Set campaign status to `active`
2. Get current phase and its missions
3. If there are still `standby` or `queued` missions: continue executing (queue standby missions whose deps are met)
4. If all missions are terminal: call `onPhaseComplete()` (which will generate debrief and advance)

### `skipAndContinue()`

For paused campaigns where Commander wants to skip failed missions:
1. Set all `compromised` missions in current phase to `abandoned`
2. Set campaign status to `active`
3. Re-evaluate: call `onPhaseComplete()` which now sees no `compromised` missions (they're `abandoned` which is treated as "done, move on")

---

## 2. Phase Debrief Generation

Integrated into `campaign-executor.ts`.

### `generatePhaseDebrief(phaseId)`

1. Get the phase and all its missions (with debriefs)
2. Get the battlefield (for CLAUDE.md path)
3. Get the campaign (for name)
4. Count total phases for context

5. Build prompt:
```
{BATTLEFIELD_CLAUDE_MD}

---

## Phase Debrief Generation

**Operation**: {campaign.name}
**Phase**: {phase.name} ({phaseNumber} of {totalPhases})

### Mission Debriefs

{for each mission:}
**{mission.title}** ({mission.status}):
{mission.debrief || 'No debrief available.'}

{end for}

### Orders
Produce a concise debrief addressed to "Commander":
1. What was accomplished.
2. Issues or partial failures.
3. Readiness for next phase.
4. Recommended adjustments.

Under 300 words. Military briefing tone — factual, precise, actionable.
```

6. Spawn Claude Code: `--print --dangerously-skip-permissions --max-turns 5`
   - Write prompt to temp file (same pattern as plan generator)
   - `cwd`: battlefield repo path
7. Store result in `phases.debrief`
8. If Claude call fails: store a fallback debrief concatenating mission debriefs

---

## 3. Campaign Prompt Builder

**Modify:** `src/lib/orchestrator/prompt-builder.ts`

Add a campaign mission case. When `mission.campaignId` is set (and `mission.type !== 'bootstrap'`):

```
{BATTLEFIELD_CLAUDE_MD}                    ← STATIC

---

{ASSET_SYSTEM_PROMPT}                      ← SEMI-STATIC

---

## Campaign Context

**Operation**: {campaign.name}
**Objective**: {campaign.objective}
**Phase**: {phase.name} ({phaseNumber} of {totalPhases})

### Previous Phase Debrief
{previousPhase.debrief || 'This is Phase 1 — no previous debrief.'}

---

## Mission Briefing

**Mission**: {title}
**Priority**: {priority}

{briefing}

---

## Operational Parameters

- Execute the task above.
- Other missions may run in parallel. Stay within your assigned scope.
- Commit with clear, descriptive messages.
- Provide debrief addressed to the Commander:
  what was done, what changed, risks, and recommended next actions.
```

**Changes to `buildPrompt`:**
- After bootstrap check, before standard prompt: `if (mission.campaignId) return buildCampaignMissionPrompt(...)`
- New function `buildCampaignMissionPrompt(mission, battlefield, asset, campaign, phase, previousPhaseDebrief)`
- Queries campaign and phase from DB using `mission.campaignId` and `mission.phaseId`
- Gets previous phase by `phaseNumber - 1` for debrief context

---

## 4. Schema Migration

**New column on missions table:**

```
dependsOn TEXT  — JSON array of mission titles (nullable)
```

Requires a Drizzle migration. Add to `src/lib/db/schema.ts`:

```typescript
dependsOn: text('depends_on'),  // JSON string: '["Mission A", "Mission B"]'
```

**Update `insertPlanFromJSON`** in campaign actions to write `dependsOn` as `JSON.stringify(mission.dependsOn || [])`.

**Update `getCampaign`** to include `dependsOn` in the mission data returned.

---

## 5. Orchestrator Integration

**Modify:** `src/lib/orchestrator/orchestrator.ts`

### New state

```typescript
private activeCampaigns: Map<string, CampaignExecutor> = new Map();
```

### New methods

**`startCampaign(campaignId)`:**
1. Create `CampaignExecutor` instance
2. Store in `activeCampaigns`
3. Call `executor.start()`

**`resumeCampaign(campaignId)`:**
1. Get or create `CampaignExecutor`
2. Call `executor.resume()`

**`skipAndContinueCampaign(campaignId)`:**
1. Get or create `CampaignExecutor`
2. Call `executor.skipAndContinue()`

**`abortCampaign(campaignId)`:**
1. Get all active missions for this campaign from `activeJobs` map
2. Abort each via their AbortControllers
3. Remove from `activeCampaigns`

### Modified: mission completion callback

In the `finally` block of `onMissionQueued`, after existing `drainQueue()` call:

```typescript
// Notify campaign executor if this is a campaign mission
const completedMission = db.select().from(missions).where(eq(missions.id, missionId)).get();
if (completedMission?.campaignId) {
  const campaignExec = this.activeCampaigns.get(completedMission.campaignId);
  campaignExec?.onCampaignMissionComplete(missionId);
}
```

### Modified: shutdown

Add campaign cleanup to `shutdown()`:
```typescript
this.activeCampaigns.clear();
```

---

## 6. Socket.IO Events

### New events (Server → Client)

| Event | Payload | Room |
|-------|---------|------|
| `campaign:status` | `{ campaignId, status, timestamp }` | `campaign:{campaignId}` |
| `campaign:phase-status` | `{ campaignId, phaseId, phaseNumber, status, timestamp }` | `campaign:{campaignId}` |
| `campaign:phase-debrief` | `{ campaignId, phaseId, debrief }` | `campaign:{campaignId}` |
| `campaign:mission-status` | `{ campaignId, missionId, status, timestamp }` | `campaign:{campaignId}` |

### Socket.IO server update

Add to `src/lib/socket/server.ts`:
```typescript
socket.on('campaign:subscribe', (campaignId: string) => {
  socket.join(`campaign:${campaignId}`);
});
socket.on('campaign:unsubscribe', (campaignId: string) => {
  socket.leave(`campaign:${campaignId}`);
});
```

---

## 7. Campaign Comms Hook

**New file:** `src/hooks/use-campaign-comms.ts`

```typescript
function useCampaignComms(campaignId: string, initialStatus: string): {
  status: CampaignStatus;
  phaseStatuses: Map<string, string>;
  phaseDebriefs: Map<string, string>;
  missionStatuses: Map<string, string>;
}
```

- Subscribes to `campaign:{id}` room on mount
- Listens for all four campaign events
- Merges live updates with initial data
- Unsubscribes on unmount

---

## 8. Campaign Detail Page Updates

**Modify:** `src/app/projects/[id]/campaigns/[campaignId]/page.tsx`

For `active`/`paused` campaigns, wrap the PhaseTimeline in a Client Component that uses `useCampaignComms` for live updates.

**New component:** `src/components/campaign/campaign-live-view.tsx` — Client Component

Props: initial campaign data (phases, missions, statuses) + campaignId.

- Uses `useCampaignComms` hook
- Overlays live status changes on the PhaseTimeline
- Shows phase debriefs as they arrive
- Shows campaign status banner (active → accomplished, or paused with Commander options)
- On terminal state: `router.refresh()`

**Campaign controls update:**

Add buttons for paused state:
- `[RESUME]` — calls `resumeCampaign` (continue executing, failed missions stay failed)
- `[SKIP & CONTINUE]` — calls `skipAndContinueCampaign` (mark failed as abandoned, advance)
- `[ABANDON]` — calls `abandonCampaign`

---

## 9. Server Action Updates

**Modify:** `src/actions/campaign.ts`

**`launchCampaign`:**
Add after status update:
```typescript
globalThis.orchestrator?.startCampaign(campaignId);
```

**`abandonCampaign`:**
Add:
```typescript
globalThis.orchestrator?.abortCampaign(campaignId);
// Set all non-terminal missions to abandoned
// Set all non-terminal phases to compromised
```

**New: `resumeCampaign(campaignId)`:**
1. Validate status is `paused`
2. Set status to `active`
3. Call `globalThis.orchestrator?.resumeCampaign(campaignId)`
4. `revalidatePath`

**New: `skipAndContinueCampaign(campaignId)`:**
1. Validate status is `paused`
2. Call `globalThis.orchestrator?.skipAndContinueCampaign(campaignId)`
3. `revalidatePath`

---

## 10. What Is NOT Built in Phase C2

- Campaign templates (isTemplate, RUN TEMPLATE) — Phase C3
- Campaign worktree modes (none/phase) — using mission-level worktrees only
- Pause/resume from the Commander mid-phase (only auto-pause on failure)

---

## 11. End State

After Phase C2:
1. Commander launches a campaign → Phase 1 starts automatically
2. Missions within each phase execute in parallel (respecting `dependsOn`)
3. `dependsOn` missions wait until their dependencies are accomplished
4. When all phase missions complete → AI generates phase debrief
5. Phase debrief passed as context to next phase's missions
6. Next phase starts automatically
7. If any mission compromised → campaign pauses, Commander chooses: resume, skip & continue, or abandon
8. All phases secured → campaign accomplished
9. Live real-time updates on campaign detail page (status, debriefs)
10. Campaign controls: launch, pause, resume, skip, abandon, complete
