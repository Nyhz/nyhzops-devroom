# Phase C2: Campaign Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable campaigns to execute: sequential phase progression with parallel mission execution, `dependsOn` enforcement, AI-generated phase debriefs, real-time status streaming, and Commander controls for paused campaigns.

**Architecture:** CampaignExecutor class manages phase lifecycle. Orchestrator notifies CampaignExecutor on mission completion. Phase debriefs generated via one-shot Claude Code call. Socket.IO streams campaign/phase/mission status changes. `dependsOn` column added to missions table for intra-phase ordering.

**Tech Stack:** Drizzle ORM, Socket.IO, Claude Code CLI, child_process.spawn, simple-git

**Spec:** `docs/superpowers/specs/2026-03-26-phase-c2-campaign-execution-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Schema Migration:**
- `src/lib/db/schema.ts` (modified — add dependsOn column)
- `src/lib/db/migrations/` (new migration)

**Task 2 — Campaign Executor:**
- `src/lib/orchestrator/campaign-executor.ts`

**Task 3 — Campaign Prompt Builder:**
- `src/lib/orchestrator/prompt-builder.ts` (modified — add campaign case)

**Task 4 — Orchestrator Integration:**
- `src/lib/orchestrator/orchestrator.ts` (modified — campaign tracking + mission completion callback)
- `server.ts` (modified — startup recovery)

**Task 5 — Server Action Wiring:**
- `src/actions/campaign.ts` (modified — launch/abandon/resume/skip trigger orchestrator)

**Task 6 — Socket.IO + Campaign Comms:**
- `src/lib/socket/server.ts` (modified — campaign subscribe/unsubscribe)
- `src/hooks/use-campaign-comms.ts`

**Task 7 — Campaign Live UI:**
- `src/components/campaign/campaign-live-view.tsx`
- `src/app/projects/[id]/campaigns/[campaignId]/page.tsx` (modified)
- `src/components/campaign/campaign-controls.tsx` (modified — add resume/skip buttons)

**Task 8 — Plan Insert Update (dependsOn storage):**
- `src/actions/campaign.ts` (modified — insertPlanFromJSON writes dependsOn)

**Task 9 — Integration Verification:**
- Various fixes, final commit

---

## Task 1: Schema Migration (dependsOn column)

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: new migration in `src/lib/db/migrations/`

- [ ] **Step 1: Add dependsOn column**

In `src/lib/db/schema.ts`, add to the `missions` table:

```typescript
dependsOn: text('depends_on'),  // JSON string: '["Mission A Title", "Mission B Title"]'
```

Place it near `worktreeBranch` or after `priority`.

- [ ] **Step 2: Generate and apply migration**

```bash
pnpm db:generate && pnpm db:migrate
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "feat: add dependsOn column to missions table for campaign phase ordering"
```

---

## Task 2: Campaign Executor

**Files:**
- Create: `src/lib/orchestrator/campaign-executor.ts`

- [ ] **Step 1: Create the campaign executor**

Read the spec at `docs/superpowers/specs/2026-03-26-phase-c2-campaign-execution-design.md` sections 1 and 2 for full details.

Create `src/lib/orchestrator/campaign-executor.ts`:

**Class with these methods:**

- `constructor(campaignId, io)` — stores campaignId and Socket.IO server ref
- `start()` — gets campaign, validates active, gets current phase, calls `startPhase`
- `resume()` — for paused campaigns after Commander corrective action. Re-queues missions, checks deps, guards against infinite loop
- `skipAndContinue()` — marks compromised missions as abandoned, cascades to standby missions with broken deps, then calls `onPhaseComplete`
- `onCampaignMissionComplete(missionId)` — called by orchestrator. Emits status, checks deps, checks if phase is complete
- `startPhase(phaseId)` — sets phase active, queues missions without deps, leaves dep missions in standby
- `checkDependencies(phaseId)` — finds standby missions whose deps are all accomplished, queues them
- `onPhaseComplete(phaseId)` — checks for compromised missions (pause) or all accomplished (generate debrief + advance)
- `generatePhaseDebrief(phaseId)` — spawns Claude Code with `--print` to synthesize phase summary from mission debriefs. Uses temp file for prompt (same pattern as plan generator). Stores in `phases.debrief`.
- `advanceToNextPhase()` — increments currentPhase, starts next or marks campaign accomplished
- Helper: `emitCampaignStatus(status)`, `emitPhaseStatus(phaseId, phaseNumber, status)`, `emitMissionStatus(missionId, status)`

**Key implementation details:**

- `checkDependencies`: parse `dependsOn` from JSON string, match against accomplished mission titles in same phase
- `onPhaseComplete` all-accomplished path: use async fire-and-forget for debrief generation + advance (don't block event handlers):
  ```typescript
  this.generateAndAdvance(phaseId).catch(err => console.error('[Campaign] Phase advance failed:', err));
  ```
- `skipAndContinue` cascade: iterate — mark compromised → abandoned, then find standby missions whose deps include any abandoned title, mark those abandoned too, repeat until stable
- `generatePhaseDebrief`: build prompt with CLAUDE.md + all mission debriefs from the phase + instructions. Write to temp file, spawn `claude --print --dangerously-skip-permissions --max-turns 5`. On failure: fallback to concatenated mission debriefs.
- All status changes update DB AND emit Socket.IO events to `campaign:{campaignId}` room
- Access orchestrator via `globalThis.orchestrator` for `onMissionQueued` calls

**Imports needed:**
```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import { eq, and, inArray } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions, battlefields } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import type { Mission } from '@/types';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/campaign-executor.ts
git commit -m "feat: add campaign executor with phase progression and debrief generation"
```

---

## Task 3: Campaign Prompt Builder

**Files:**
- Modify: `src/lib/orchestrator/prompt-builder.ts`

- [ ] **Step 1: Add campaign mission prompt**

Read the existing `prompt-builder.ts`. Add a campaign case.

After the bootstrap check (`if (mission.type === 'bootstrap')`), add:

```typescript
if (mission.campaignId) {
  return buildCampaignMissionPrompt(mission, battlefield, asset);
}
```

Add the new function (not exported):

```typescript
function buildCampaignMissionPrompt(
  mission: Mission,
  battlefield: Battlefield,
  asset: Asset | null,
): string {
  const db = getDatabase();
  const sections: string[] = [];

  // 1. CLAUDE.md (static, cached)
  if (battlefield.claudeMdPath) {
    try {
      sections.push(fs.readFileSync(battlefield.claudeMdPath, 'utf-8'));
    } catch { /* skip */ }
  }

  // 2. Asset system prompt
  if (asset?.systemPrompt) {
    sections.push(asset.systemPrompt);
  }

  // 3. Campaign context
  const campaign = db.select().from(campaigns)
    .where(eq(campaigns.id, mission.campaignId!)).get();

  let phaseContext = '';
  if (mission.phaseId) {
    const phase = db.select().from(phases)
      .where(eq(phases.id, mission.phaseId)).get();

    if (phase && campaign) {
      const totalPhases = db.select({ value: count() }).from(phases)
        .where(eq(phases.campaignId, campaign.id)).all();

      // Get previous phase debrief
      let prevDebrief = 'This is Phase 1 — no previous debrief.';
      if (phase.phaseNumber > 1) {
        const prevPhase = db.select().from(phases)
          .where(and(
            eq(phases.campaignId, campaign.id),
            eq(phases.phaseNumber, phase.phaseNumber - 1)
          )).get();
        if (prevPhase?.debrief) {
          prevDebrief = prevPhase.debrief;
        }
      }

      phaseContext = [
        '## Campaign Context',
        '',
        `**Operation**: ${campaign.name}`,
        `**Objective**: ${campaign.objective}`,
        `**Phase**: ${phase.name} (${phase.phaseNumber} of ${totalPhases[0]?.value || '?'})`,
        '',
        '### Previous Phase Debrief',
        prevDebrief,
      ].join('\n');
    }
  }

  if (phaseContext) sections.push(phaseContext);

  // 4. Mission briefing
  sections.push([
    '## Mission Briefing',
    '',
    `**Mission**: ${mission.title}`,
    `**Priority**: ${mission.priority || 'normal'}`,
    '',
    mission.briefing,
  ].join('\n'));

  // 5. Operational parameters (campaign-specific)
  sections.push([
    '## Operational Parameters',
    '',
    '- Execute the task above.',
    '- Other missions may run in parallel. Stay within your assigned scope.',
    '- Commit with clear, descriptive messages.',
    '- Provide debrief addressed to the Commander:',
    '  what was done, what changed, risks, and recommended next actions.',
  ].join('\n'));

  return sections.join('\n\n---\n\n');
}
```

Add needed imports: `count` from drizzle-orm, `campaigns`, `phases` from schema, `getDatabase`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/prompt-builder.ts
git commit -m "feat: add campaign mission prompt with phase context and previous debrief"
```

---

## Task 4: Orchestrator Integration

**Files:**
- Modify: `src/lib/orchestrator/orchestrator.ts`
- Modify: `server.ts`

- [ ] **Step 1: Add campaign tracking to orchestrator**

Read the existing `orchestrator.ts`. Add:

**New state:**
```typescript
public activeCampaigns: Map<string, CampaignExecutor> = new Map();
```

**New methods:**

```typescript
async startCampaign(campaignId: string): Promise<void> {
  const executor = new CampaignExecutor(campaignId, this.io);
  this.activeCampaigns.set(campaignId, executor);
  await executor.start();
}

async resumeCampaign(campaignId: string): Promise<void> {
  let executor = this.activeCampaigns.get(campaignId);
  if (!executor) {
    executor = new CampaignExecutor(campaignId, this.io);
    this.activeCampaigns.set(campaignId, executor);
  }
  await executor.resume();
}

async skipAndContinueCampaign(campaignId: string): Promise<void> {
  let executor = this.activeCampaigns.get(campaignId);
  if (!executor) {
    executor = new CampaignExecutor(campaignId, this.io);
    this.activeCampaigns.set(campaignId, executor);
  }
  await executor.skipAndContinue();
}

async abortCampaign(campaignId: string): Promise<void> {
  // Abort all active missions for this campaign
  const db = getDatabase();
  const campaignMissions = db.select({ id: missions.id }).from(missions)
    .where(and(
      eq(missions.campaignId, campaignId),
      inArray(missions.status, ['queued', 'deploying', 'in_combat'])
    )).all();

  for (const m of campaignMissions) {
    await this.onMissionAbort(m.id);
  }

  this.activeCampaigns.delete(campaignId);
}
```

**Modify the `finally` block in `onMissionQueued`:** After `drainQueue()`, add campaign notification:

```typescript
// Notify campaign executor if this is a campaign mission
const completedMission = db.select().from(missions).where(eq(missions.id, missionId)).get();
if (completedMission?.campaignId) {
  const campaignExec = this.activeCampaigns.get(completedMission.campaignId);
  if (campaignExec) {
    campaignExec.onCampaignMissionComplete(missionId).catch(err => {
      console.error(`[Orchestrator] Campaign mission complete handler failed:`, err);
    });
  }
}
```

**Modify `shutdown`:** Add `this.activeCampaigns.clear()`.

**Import:** `import { CampaignExecutor } from './campaign-executor';` and `inArray` from drizzle-orm.

- [ ] **Step 2: Add startup recovery to server.ts**

Read `server.ts`. After orchestrator creation, add:

```typescript
// Startup recovery: pause any campaigns that were active when server stopped
const activeCampaigns = db.select().from(campaigns)
  .where(eq(campaigns.status, 'active')).all();
for (const c of activeCampaigns) {
  db.update(campaigns).set({ status: 'paused', updatedAt: Date.now() })
    .where(eq(campaigns.id, c.id)).run();
  console.log(`[DEVROOM] Campaign ${c.id} paused — server restarted`);
}
```

Import `campaigns` from schema if not already imported.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/orchestrator/orchestrator.ts server.ts
git commit -m "feat: integrate campaign execution into orchestrator with startup recovery"
```

---

## Task 5: Server Action Wiring

**Files:**
- Modify: `src/actions/campaign.ts`

- [ ] **Step 1: Wire campaign actions to orchestrator**

Read the existing `src/actions/campaign.ts`. Make these changes:

**`launchCampaign`:** Before calling orchestrator, add dependsOn validation:
```typescript
// Validate dependsOn references
for (const phase of campaignPhases) {
  const titleSet = new Set(phase.missions.map(m => m.title));
  for (const mission of phase.missions) {
    if (mission.dependsOn) {
      const deps = JSON.parse(mission.dependsOn) as string[];
      for (const dep of deps) {
        if (!titleSet.has(dep)) {
          throw new Error(`Mission "${mission.title}" depends on "${dep}" which doesn't exist in phase "${phase.name}"`);
        }
      }
    }
  }
}
```

After status update, add: `globalThis.orchestrator?.startCampaign(campaignId);`

**`abandonCampaign`:** Add:
```typescript
globalThis.orchestrator?.abortCampaign(campaignId);
// Set non-terminal missions to abandoned
// Set non-terminal phases to compromised
```

**New: `resumeCampaign(campaignId: string)`:**
```typescript
export async function resumeCampaign(campaignId: string) {
  const db = getDatabase();
  const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign || campaign.status !== 'paused') throw new Error('Campaign not paused');

  db.update(campaigns).set({ status: 'active', updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId)).run();

  globalThis.orchestrator?.resumeCampaign(campaignId);
  revalidatePath(`/projects/${campaign.battlefieldId}/campaigns/${campaignId}`);
}
```

**New: `skipAndContinueCampaign(campaignId: string)`:**
```typescript
export async function skipAndContinueCampaign(campaignId: string) {
  const db = getDatabase();
  const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign || campaign.status !== 'paused') throw new Error('Campaign not paused');

  globalThis.orchestrator?.skipAndContinueCampaign(campaignId);
  revalidatePath(`/projects/${campaign.battlefieldId}/campaigns/${campaignId}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/campaign.ts
git commit -m "feat: wire campaign launch, abandon, resume, skip to orchestrator"
```

---

## Task 6: Socket.IO + Campaign Comms Hook

**Files:**
- Modify: `src/lib/socket/server.ts`
- Create: `src/hooks/use-campaign-comms.ts`

- [ ] **Step 1: Add campaign Socket.IO handlers**

In `src/lib/socket/server.ts`, add:

```typescript
socket.on('campaign:subscribe', (campaignId: string) => {
  socket.join(`campaign:${campaignId}`);
});
socket.on('campaign:unsubscribe', (campaignId: string) => {
  socket.leave(`campaign:${campaignId}`);
});
```

- [ ] **Step 2: Create campaign comms hook**

Create `src/hooks/use-campaign-comms.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';
import type { CampaignStatus, PhaseStatus, MissionStatus } from '@/types';

interface CampaignCommsReturn {
  status: CampaignStatus;
  phaseStatuses: Record<string, PhaseStatus>;
  phaseDebriefs: Record<string, string>;
  missionStatuses: Record<string, MissionStatus>;
}

export function useCampaignComms(
  campaignId: string,
  initialStatus: string,
): CampaignCommsReturn {
  const socket = useSocket();
  const [status, setStatus] = useState<CampaignStatus>(initialStatus as CampaignStatus);
  const [phaseStatuses, setPhaseStatuses] = useState<Record<string, PhaseStatus>>({});
  const [phaseDebriefs, setPhaseDebriefs] = useState<Record<string, string>>({});
  const [missionStatuses, setMissionStatuses] = useState<Record<string, MissionStatus>>({});

  useEffect(() => {
    if (!socket) return;

    socket.emit('campaign:subscribe', campaignId);

    socket.on('campaign:status', (data: { campaignId: string; status: string }) => {
      if (data.campaignId === campaignId) setStatus(data.status as CampaignStatus);
    });

    socket.on('campaign:phase-status', (data: { campaignId: string; phaseId: string; status: string }) => {
      if (data.campaignId === campaignId) {
        setPhaseStatuses(prev => ({ ...prev, [data.phaseId]: data.status as PhaseStatus }));
      }
    });

    socket.on('campaign:phase-debrief', (data: { campaignId: string; phaseId: string; debrief: string }) => {
      if (data.campaignId === campaignId) {
        setPhaseDebriefs(prev => ({ ...prev, [data.phaseId]: data.debrief }));
      }
    });

    socket.on('campaign:mission-status', (data: { campaignId: string; missionId: string; status: string }) => {
      if (data.campaignId === campaignId) {
        setMissionStatuses(prev => ({ ...prev, [data.missionId]: data.status as MissionStatus }));
      }
    });

    return () => {
      socket.off('campaign:status');
      socket.off('campaign:phase-status');
      socket.off('campaign:phase-debrief');
      socket.off('campaign:mission-status');
      socket.emit('campaign:unsubscribe', campaignId);
    };
  }, [socket, campaignId]);

  return { status, phaseStatuses, phaseDebriefs, missionStatuses };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/socket/server.ts src/hooks/use-campaign-comms.ts
git commit -m "feat: add campaign Socket.IO events and useCampaignComms hook"
```

---

## Task 7: Campaign Live UI

**Files:**
- Create: `src/components/campaign/campaign-live-view.tsx`
- Modify: `src/app/projects/[id]/campaigns/[campaignId]/page.tsx`
- Modify: `src/components/campaign/campaign-controls.tsx`

- [ ] **Step 1: Create campaign live view component**

Create `src/components/campaign/campaign-live-view.tsx` — Client Component:

Wraps `PhaseTimeline` with live Socket.IO updates via `useCampaignComms`.

**Props:** `campaignId: string`, `initialStatus: string`, `initialPhases: PhaseTimelineProps['phases']`, `battlefieldId: string`

**Behavior:**
- Uses `useCampaignComms` for live updates
- Overlays `phaseStatuses` and `missionStatuses` from hook onto the initial phase data
- When `phaseDebriefs` arrive, merges into phase data
- Renders `PhaseTimeline` with the merged data
- Shows campaign status banner: "ACTIVE — Phase {n} in progress" or "PAUSED — Awaiting Commander orders"
- On terminal status (accomplished/compromised): calls `router.refresh()`

- [ ] **Step 2: Update campaign detail page**

Read `src/app/projects/[id]/campaigns/[campaignId]/page.tsx`. For `active` and `paused` statuses, replace the static `<PhaseTimeline>` with `<CampaignLiveView>`:

```tsx
if (campaign.status === 'active' || campaign.status === 'paused') {
  return (
    <div className="p-6">
      {/* Header */}
      <CampaignLiveView
        campaignId={campaignId}
        initialStatus={campaign.status}
        initialPhases={campaign.phases}
        battlefieldId={id}
      />
      <CampaignControls
        campaignId={campaignId}
        battlefieldId={id}
        status={campaign.status}
      />
    </div>
  );
}
```

- [ ] **Step 3: Update campaign controls**

Read `src/components/campaign/campaign-controls.tsx`. Add buttons for `paused` status:

```typescript
// For paused campaigns:
{status === 'paused' && (
  <>
    <TacButton variant="primary" onClick={() => resumeCampaign(campaignId)}>RESUME</TacButton>
    <TacButton variant="ghost" onClick={() => skipAndContinueCampaign(campaignId)}>SKIP & CONTINUE</TacButton>
    <TacButton variant="danger" onClick={() => abandonCampaign(campaignId)}>ABANDON</TacButton>
  </>
)}
```

Import `resumeCampaign` and `skipAndContinueCampaign` from `@/actions/campaign`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/campaign/ src/app/projects/[id]/campaigns/
git commit -m "feat: add campaign live view with real-time status updates and pause controls"
```

---

## Task 8: Plan Insert Update (dependsOn storage)

**Files:**
- Modify: `src/actions/campaign.ts`

- [ ] **Step 1: Update insertPlanFromJSON to write dependsOn**

Read `src/actions/campaign.ts`. Find the `insertPlanFromJSON` helper (or wherever missions are inserted from plan data).

When inserting missions, add the `dependsOn` field:

```typescript
dependsOn: mission.dependsOn && mission.dependsOn.length > 0
  ? JSON.stringify(mission.dependsOn)
  : null,
```

Also update `getCampaign` to include `dependsOn` in the mission query results if not already there.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/campaign.ts
git commit -m "feat: persist dependsOn field when saving campaign plans"
```

---

## Task 9: Integration Verification

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
- All existing routes return 200
- `/projects/[id]/campaigns` — 200
- `/projects/[id]/campaigns/[campaignId]` — 200
- Server starts with orchestrator + startup recovery log
- Campaign controls show correct buttons per status

- [ ] **Step 4: Fix any issues**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase C2 — campaign execution operational"
```

---

## Verification Checklist

- [ ] `dependsOn` column exists on missions table
- [ ] Campaign executor manages phase lifecycle (start → complete → advance)
- [ ] `dependsOn` enforcement: standby missions queued only when deps accomplished
- [ ] Phase debrief generated via Claude Code after phase secured
- [ ] Phase debrief passed to next phase missions via campaign prompt builder
- [ ] Campaign pauses on compromised phase
- [ ] Resume works (after Commander redeploys failed missions)
- [ ] Skip & Continue cascades abandoned deps and advances
- [ ] Launch validates dependsOn references
- [ ] Abandon aborts all active campaign missions
- [ ] Socket.IO events: campaign:status, campaign:phase-status, campaign:phase-debrief, campaign:mission-status
- [ ] Campaign live view updates in real-time
- [ ] Startup recovery pauses active campaigns
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
