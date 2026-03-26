# Phase C1: Campaign CRUD + Plan Generation + Plan Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Commander to create campaigns, generate AI battle plans via Claude Code, edit plans on a drag-and-drop war board, and view campaign detail pages with phase timelines — ready for C2 execution.

**Architecture:** Campaign Server Actions for CRUD. Plan generator spawns Claude Code with `--print` for one-shot JSON output. Plan editor uses `@dnd-kit` for drag-and-drop. Campaign detail page conditionally renders by status (draft/planning/active/etc). Phase timeline component shared between editor and read-only views.

**Tech Stack:** Next.js Server Actions, @dnd-kit/core + @dnd-kit/sortable, Claude Code CLI, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-03-26-phase-c1-campaign-crud-planning-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Types + Dependencies:**
- `src/types/index.ts` (modified — add PlanJSON, CampaignWithPlan types)
- `package.json` (modified — add @dnd-kit dependencies)

**Task 2 — Campaign Server Actions:**
- `src/actions/campaign.ts`

**Task 3 — Plan Generator:**
- `src/lib/orchestrator/plan-generator.ts`

**Task 4 — Phase Timeline Component:**
- `src/components/campaign/phase-timeline.tsx`
- `src/components/campaign/mission-card.tsx`

**Task 5 — Plan Editor:**
- `src/components/campaign/plan-editor.tsx`

**Task 6 — Campaign Pages:**
- `src/app/projects/[id]/campaigns/page.tsx` (replace stub)
- `src/app/projects/[id]/campaigns/new/page.tsx`
- `src/app/projects/[id]/campaigns/[campaignId]/page.tsx` (replace stub)
- `src/components/campaign/campaign-controls.tsx`
- `src/components/campaign/generate-plan-button.tsx`

**Task 7 — Integration Verification:**
- Various fixes, final commit

---

## Task 1: Types + Dependencies

**Files:**
- Modify: `src/types/index.ts`
- Modify: `package.json` (via pnpm add)

- [ ] **Step 1: Add C1 types**

Append to `src/types/index.ts`:

```typescript
// === Phase C1: Campaign Planning Types ===

// Campaign plan JSON schema (for generation and editing)
export interface PlanJSON {
  summary: string;
  phases: PlanPhase[];
}

export interface PlanPhase {
  name: string;
  objective: string;
  missions: PlanMission[];
}

export interface PlanMission {
  title: string;
  briefing: string;
  assetCodename: string;
  priority: MissionPriority;
  dependsOn?: string[];
}

// Enriched campaign type for UI
export interface CampaignWithPlan extends Campaign {
  phases: Array<Phase & {
    missions: Array<Mission & { assetCodename: string | null }>;
  }>;
}
```

- [ ] **Step 2: Install @dnd-kit dependencies**

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts package.json pnpm-lock.yaml
git commit -m "feat: add C1 campaign planning types and @dnd-kit dependencies"
```

---

## Task 2: Campaign Server Actions

**Files:**
- Create: `src/actions/campaign.ts`

- [ ] **Step 1: Create campaign server actions**

Create `src/actions/campaign.ts` with `"use server"` directive. Implement all actions from the spec.

**Required imports:**
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, and, count } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { Campaign, CampaignWithPlan, PlanJSON, Phase, Mission } from '@/types';
```

**Actions to implement:**

1. **`createCampaign(battlefieldId: string, name: string, objective: string)`** — Insert with `generateId()`, status `draft`, timestamps. `revalidatePath`.

2. **`getCampaign(id: string): Promise<CampaignWithPlan | null>`** — Query campaign. Then query its phases ordered by `phaseNumber`. For each phase, query its missions with left join on assets for `assetCodename`. Assemble into `CampaignWithPlan`.

3. **`listCampaigns(battlefieldId: string): Promise<Campaign[]>`** — Select where `battlefieldId` matches, order by `updatedAt` desc.

4. **`updateCampaign(id: string, data: { name?: string; objective?: string })`** — Validate status is `draft` or `planning`. Update fields + `updatedAt`. `revalidatePath`.

5. **`deleteCampaign(id: string)`** — Validate status is `draft` or `planning`. Transaction:
   - Get all phase IDs for this campaign
   - Get all mission IDs for those phases
   - Delete mission logs for those missions
   - Delete missions
   - Delete phases
   - Delete campaign
   - `revalidatePath`

6. **`generateBattlePlan(campaignId: string)`** — This calls the plan generator (Task 3). For now, create the function signature and a placeholder that will be wired in Task 3:
   ```typescript
   export async function generateBattlePlan(campaignId: string): Promise<void> {
     // Will be implemented after plan-generator.ts is created
     throw new Error('Not implemented — waiting for plan-generator');
   }
   ```

7. **`updateBattlePlan(campaignId: string, plan: PlanJSON)`** — Validate status is `planning`. Transaction:
   - Get all existing phase IDs for this campaign
   - Get all existing mission IDs for those phases
   - Delete mission logs, missions, phases (FK-safe order)
   - For each `plan.phases[i]`: insert phase with `phaseNumber = i + 1`
   - For each phase's missions: insert mission with `battlefieldId` from campaign, `campaignId`, `phaseId`, `status: 'standby'`, `priority` from plan, title/briefing from plan
   - Look up asset by codename to get `assetId` (skip if not found)
   - Update campaign `updatedAt`
   - `revalidatePath`

8. **`launchCampaign(campaignId: string)`** — Validate has phases with missions. Set status `active`, `currentPhase = 1`. `revalidatePath`. (Execution triggers come in C2.)

9. **`completeCampaign(id: string)`** — Set status `accomplished`. `revalidatePath`.

10. **`abandonCampaign(id: string)`** — Set status `compromised`. `revalidatePath`. (Abort active missions in C2.)

11. **`redeployCampaign(id: string)`** — Clone campaign + phases + missions into new campaign with status `planning`. Generate new IDs for everything. `revalidatePath`. Return new campaign.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/campaign.ts
git commit -m "feat: add campaign CRUD server actions with plan management"
```

---

## Task 3: Plan Generator

**Files:**
- Create: `src/lib/orchestrator/plan-generator.ts`
- Modify: `src/actions/campaign.ts` (wire generateBattlePlan)

- [ ] **Step 1: Create plan generator**

Create `src/lib/orchestrator/plan-generator.ts`:

```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields, assets } from '@/lib/db/schema';
import { config } from '@/lib/config';
import type { PlanJSON, Campaign, Battlefield, Asset } from '@/types';

export class PlanGenerationError extends Error {
  rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(message);
    this.name = 'PlanGenerationError';
    this.rawOutput = rawOutput;
  }
}

export async function generatePlan(
  campaign: Campaign,
  battlefield: Battlefield,
  availableAssets: Asset[],
): Promise<PlanJSON> {
  const prompt = buildPlanningPrompt(campaign, battlefield, availableAssets);

  // Spawn Claude Code for one-shot generation
  const stdout = await runClaudeForPlan(prompt, battlefield.repoPath);

  // Parse JSON from output
  const plan = parsePlanJSON(stdout);

  // Validate structure
  validatePlan(plan, availableAssets);

  return plan;
}

function buildPlanningPrompt(
  campaign: Campaign,
  battlefield: Battlefield,
  assets: Asset[],
): string {
  const sections: string[] = [];

  sections.push('## Campaign Battle Plan Generation\n\nYou are a strategic planner for the DEVROOM agent orchestrator.\nAnalyze this project and generate a detailed battle plan for the following objective.');

  // Project intelligence
  if (battlefield.claudeMdPath) {
    try {
      const claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      sections.push(`### Project Intelligence — CLAUDE.md\n\n${claudeMd}`);
    } catch { /* skip */ }
  }
  if (battlefield.specMdPath) {
    try {
      const specMd = fs.readFileSync(battlefield.specMdPath, 'utf-8');
      sections.push(`### Project Intelligence — SPEC.md\n\n${specMd}`);
    } catch { /* skip */ }
  }

  // Objective
  sections.push(`### Campaign Objective\n\n${campaign.objective}`);

  // Assets
  const assetList = assets.map(a =>
    `- ${a.codename} (${a.specialty}): ${(a.systemPrompt || '').slice(0, 100)}`
  ).join('\n');
  sections.push(`### Available Assets\n\n${assetList}`);

  // Execution model + rules
  sections.push(`### Execution Model

- Phases execute SEQUENTIALLY. Phase N must fully complete before Phase N+1 starts.
- All missions within a phase execute IN PARALLEL on separate git branches.
- After each phase: all branches merge to main, a debrief summary passes to the next phase.
- Each agent has full codebase access and the project's CLAUDE.md as context.
- If Mission B depends on Mission A's output AND they are in the same phase, add Mission A's title to Mission B's "dependsOn" array.

### Planning Rules

- Pin dependency versions in install commands
- Include infrastructure missions early: dependency installation, env vars, DB migrations
- Ensure API/service missions complete BEFORE frontend missions that call them
- Include a final verification/testing phase
- Write detailed briefings with specific file paths and acceptance criteria
- End every briefing with "Do NOT..." constraints to prevent scope creep
- Assign the most appropriate asset based on specialty
- Keep phases focused: 2-5 missions per phase is ideal`);

  // Output format
  sections.push(`### Output

Respond with ONLY a JSON object. No preamble, no markdown fences, no explanation.

{
  "summary": "2-3 sentence overview",
  "phases": [
    {
      "name": "Tactical phase name",
      "objective": "What and why",
      "missions": [
        {
          "title": "Short title",
          "briefing": "Detailed instructions with file paths and acceptance criteria. End with Do NOT constraints.",
          "assetCodename": "ASSET_NAME",
          "priority": "low|normal|high|critical",
          "dependsOn": []
        }
      ]
    }
  ]
}`);

  return sections.join('\n\n---\n\n');
}

async function runClaudeForPlan(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write prompt to temp file to avoid shell arg length limits
    const tmpFile = `/tmp/devroom-plan-prompt-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    const proc = spawn(config.claudePath, [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', '10',
      '--prompt-file', tmpFile,
    ], { cwd });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new PlanGenerationError(
          `Claude exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`,
          stdout,
        ));
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      reject(err);
    });
  });
}

function parsePlanJSON(output: string): PlanJSON {
  // Try direct parse first
  try {
    return JSON.parse(output.trim());
  } catch { /* continue */ }

  // Try extracting from markdown fences
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch { /* continue */ }
  }

  // Try finding JSON object in output
  const braceStart = output.indexOf('{');
  const braceEnd = output.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(output.slice(braceStart, braceEnd + 1));
    } catch { /* continue */ }
  }

  throw new PlanGenerationError('Failed to parse plan JSON from Claude output', output);
}

function validatePlan(plan: PlanJSON, availableAssets: Asset[]): void {
  if (!plan.phases || !Array.isArray(plan.phases) || plan.phases.length === 0) {
    throw new PlanGenerationError('Plan has no phases', JSON.stringify(plan));
  }

  const assetCodenames = new Set(availableAssets.map(a => a.codename));

  for (const phase of plan.phases) {
    if (!phase.name) throw new PlanGenerationError(`Phase missing name`, JSON.stringify(plan));
    if (!phase.missions || phase.missions.length === 0) {
      throw new PlanGenerationError(`Phase "${phase.name}" has no missions`, JSON.stringify(plan));
    }

    const missionTitles = new Set(phase.missions.map(m => m.title));

    for (const mission of phase.missions) {
      if (!mission.title) throw new PlanGenerationError(`Mission missing title in phase "${phase.name}"`, JSON.stringify(plan));
      if (!mission.briefing) throw new PlanGenerationError(`Mission "${mission.title}" missing briefing`, JSON.stringify(plan));

      // Warn but don't reject on unknown asset
      if (mission.assetCodename && !assetCodenames.has(mission.assetCodename)) {
        console.warn(`[PlanGenerator] Unknown asset "${mission.assetCodename}" in mission "${mission.title}". Commander can reassign in editor.`);
      }

      // Check for circular dependsOn
      if (mission.dependsOn) {
        for (const dep of mission.dependsOn) {
          if (dep === mission.title) {
            throw new PlanGenerationError(`Mission "${mission.title}" depends on itself`, JSON.stringify(plan));
          }
          if (!missionTitles.has(dep)) {
            console.warn(`[PlanGenerator] Mission "${mission.title}" depends on unknown sibling "${dep}". Ignoring.`);
          }
        }
      }
    }
  }
}
```

**Note about `--prompt-file`:** The planning prompt can be very large (CLAUDE.md + SPEC.md + instructions). Passing it via `--prompt` CLI flag can hit shell argument length limits. Using a temp file with `--prompt-file` (if Claude CLI supports it) or piping via stdin is safer. The implementer should check which approach the `claude` CLI supports:
- If `--prompt-file` is not a valid flag, write the prompt to a temp file and use `cat tmpfile | claude --print ...` via shell piping
- Or pass the prompt via stdin: `proc.stdin.write(prompt); proc.stdin.end()`

- [ ] **Step 2: Wire into generateBattlePlan Server Action**

In `src/actions/campaign.ts`, replace the placeholder `generateBattlePlan`:

```typescript
import { generatePlan } from '@/lib/orchestrator/plan-generator';

export async function generateBattlePlan(campaignId: string): Promise<void> {
  const db = getDatabase();

  const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'draft' && campaign.status !== 'planning') {
    throw new Error('Can only generate plan for draft or planning campaigns');
  }

  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, campaign.battlefieldId)).get();
  if (!battlefield) throw new Error('Battlefield not found');

  const availableAssets = db.select().from(assets).where(eq(assets.status, 'active')).all();

  // Generate plan via Claude Code
  const plan = await generatePlan(campaign, battlefield, availableAssets);

  // Clear existing plan if regenerating
  // (reuse the updateBattlePlan logic or inline it)
  // Delete existing phases/missions, then insert new ones

  // ... insert phases and missions from plan (same logic as updateBattlePlan)

  // Update campaign status to 'planning' and summary
  db.update(campaigns).set({
    status: 'planning',
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();

  revalidatePath(`/projects/${campaign.battlefieldId}/campaigns/${campaignId}`);
  revalidatePath(`/projects/${campaign.battlefieldId}/campaigns`);
}
```

The implementer should refactor the "insert phases/missions from plan" logic into a shared helper used by both `generateBattlePlan` and `updateBattlePlan`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/orchestrator/plan-generator.ts src/actions/campaign.ts
git commit -m "feat: add AI battle plan generator and wire into campaign actions"
```

---

## Task 4: Phase Timeline + Mission Card Components

**Files:**
- Create: `src/components/campaign/phase-timeline.tsx`
- Create: `src/components/campaign/mission-card.tsx`

- [ ] **Step 1: Create campaign mission card**

Create `src/components/campaign/mission-card.tsx` — Server Component (or shared, no `"use client"` needed for the base).

A compact card displaying a mission within a campaign phase context. Used by both the phase timeline (read-only) and the plan editor (interactive wrapper).

**Props:**
```typescript
interface CampaignMissionCardProps {
  title: string;
  assetCodename: string | null;
  status: string | null;
  priority: string | null;
  durationMs: number | null;
  costInput: number | null;
  costOutput: number | null;
  className?: string;
}
```

**Renders:**
- Compact card: `bg-dr-elevated border border-dr-border`
- Title (truncated)
- Asset codename badge (small, dim)
- Status badge (TacBadge) if status exists
- Duration + tokens if available (dim, small)
- Priority dot: dim=low, muted=normal, amber=high, red=critical

- [ ] **Step 2: Create phase timeline**

Create `src/components/campaign/phase-timeline.tsx`:

**Props:**
```typescript
interface PhaseTimelineProps {
  phases: Array<{
    id: string;
    phaseNumber: number;
    name: string;
    objective: string | null;
    status: string | null;
    debrief: string | null;
    totalTokens: number | null;
    durationMs: number | null;
    missions: Array<{
      id: string;
      title: string | null;
      status: string | null;
      assetCodename: string | null;
      priority: string | null;
      durationMs: number | null;
      costInput: number | null;
      costOutput: number | null;
    }>;
  }>;
}
```

**Renders:**
- Stacked phase containers
- Each phase: left border colored by status (green=secured, amber=active, dim=standby)
- Header: `Phase {n}` (dim) + name (amber) + status badge (right)
- Metadata row: relative time, duration, tokens (if available)
- Mission cards laid out horizontally (flex-wrap)
- Collapsible debrief section (hidden by default, toggle via click)

**Styling:**
- Phase container: `bg-dr-surface border border-dr-border`, `border-l-2` colored by status
- Phase header: `bg-dr-elevated px-4 py-2`
- Mission cards: horizontal flex with gap, inside a padded content area
- Debrief: `text-dr-muted text-sm whitespace-pre-wrap font-data`, collapsible

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/campaign/
git commit -m "feat: add phase timeline and campaign mission card components"
```

---

## Task 5: Plan Editor (Drag-and-Drop)

**Files:**
- Create: `src/components/campaign/plan-editor.tsx`

- [ ] **Step 1: Create the plan editor**

Create `src/components/campaign/plan-editor.tsx` — Client Component (`"use client"`).

This is the most complex UI component in DEVROOM. It's a drag-and-drop war board for editing battle plans.

**Props:**
```typescript
interface PlanEditorProps {
  campaignId: string;
  battlefieldId: string;
  initialPlan: PlanJSON;
  assets: Array<{ id: string; codename: string; specialty: string }>;
}
```

**State:** The full plan as React state (`useState<PlanJSON>`). All edits happen in-memory. Save persists to DB.

**DnD setup using @dnd-kit:**
- `DndContext` wrapping the entire editor
- `SortableContext` for phases (vertical list)
- `SortableContext` for missions within each phase (horizontal list)
- Use `arrayMove` from `@dnd-kit/sortable` for reordering
- Support moving missions between phases via `onDragEnd` with `over.data.current.sortable.containerId`

**Phase rendering:**
Each phase is a sortable item containing:
- Drag handle (amber grip dots)
- Name: inline editable (click → input, blur → save to state)
- Objective: inline editable (click → textarea, blur → save)
- Mission list: sortable context with mission cards
- `[+ ADD MISSION]` button
- Delete phase button (with confirmation if has missions)

**Mission rendering (inside phase):**
Each mission is a sortable item:
- Drag handle
- Title: inline editable
- Briefing: click to expand into a TacTextarea for editing
- Asset: dropdown of available assets
- Priority: small selector (low/normal/high/critical)
- DependsOn: tags showing dependency titles. Click tag to remove. Small `[+]` to add from sibling missions dropdown.
- Delete button

**Actions:**
- `[+ ADD PHASE]` at bottom: adds empty phase to state
- `[SAVE PLAN]` at top: calls `updateBattlePlan(campaignId, plan)` Server Action
- Show unsaved changes indicator

**Implementation notes:**
- The @dnd-kit library handles the complex drag interactions
- Use `useSortable` hook per sortable item
- Use `CSS.Transform.toString(transform)` for drag transform styles
- Drag overlay for visual feedback during drag
- Keep the component focused — extract sub-components if needed:
  - `PlanPhaseItem` — renders a single phase in the editor
  - `PlanMissionItem` — renders a single mission in the editor

**Styling:**
- Phase cards: `bg-dr-surface border border-dr-border border-l-2 border-l-dr-amber`
- Mission cards: `bg-dr-elevated border border-dr-border` compact
- Drag handle: `cursor-grab text-dr-amber` (⠿ or ≡ icon)
- Active drag: `shadow-glow-amber opacity-90`
- Drop placeholder: `border-dashed border-dr-amber bg-dr-amber/5`

This is a large component. The implementer should read `@dnd-kit` docs (https://docs.dndkit.com/) before starting. Key concepts: `DndContext`, `SortableContext`, `useSortable`, `DragOverlay`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/campaign/plan-editor.tsx
git commit -m "feat: add drag-and-drop battle plan editor with @dnd-kit"
```

---

## Task 6: Campaign Pages

**Files:**
- Replace: `src/app/projects/[id]/campaigns/page.tsx`
- Create: `src/app/projects/[id]/campaigns/new/page.tsx`
- Replace: `src/app/projects/[id]/campaigns/[campaignId]/page.tsx`
- Create: `src/components/campaign/campaign-controls.tsx`
- Create: `src/components/campaign/generate-plan-button.tsx`

- [ ] **Step 1: Create campaign list page**

Replace `src/app/projects/[id]/campaigns/page.tsx` — Server Component:

- Query all campaigns for the battlefield via `listCampaigns()`
- Header: `CAMPAIGNS` (amber) + `[+ NEW CAMPAIGN]` TacButton linking to `/projects/[id]/campaigns/new`
- Grid of TacCards for each campaign: name (amber), objective (truncated, dim), status badge, phase count + mission count
- Each card links to `/projects/[id]/campaigns/[campaignId]`
- Empty state: "No campaigns deployed. Launch your first operation."

- [ ] **Step 2: Create campaign creation page**

Create `src/app/projects/[id]/campaigns/new/page.tsx` — Server Component + Client form:

- Breadcrumb: `Battlefields // {name} // Campaigns // New`
- Title: `NEW CAMPAIGN` (amber)
- Form (Client Component or inline):
  - Name (TacInput, required)
  - Objective (TacTextarea, required, large)
  - Submit → `createCampaign()` → redirect to campaign detail

- [ ] **Step 3: Create generate plan button component**

Create `src/components/campaign/generate-plan-button.tsx` — Client Component:

- `[GENERATE BATTLE PLAN]` TacButton (primary, large)
- On click: set loading state, call `generateBattlePlan(campaignId)`, then `router.refresh()`
- Loading state: button disabled, shows "Generating battle plan..." with pulsing animation
- Error handling: catch and display error message with `[RETRY]` option

- [ ] **Step 4: Create campaign controls component**

Create `src/components/campaign/campaign-controls.tsx` — Client Component:

Props: `campaignId: string`, `battlefieldId: string`, `status: string`

Buttons shown based on status:
- `planning`: `[LAUNCH OPERATION]` (amber), `[REGENERATE PLAN]` (ghost), `[DELETE]` (danger)
- `active`: `[MISSION ACCOMPLISHED]` (green), `[ABANDON]` (danger)
- `paused`: `[RESUME]` (amber), `[ABANDON]` (danger)
- `accomplished`: `[REDEPLOY]` (ghost)
- `compromised`: `[REDEPLOY]` (ghost)

Each button calls the corresponding Server Action and refreshes the page.
`[LAUNCH OPERATION]` and `[ABANDON]` show confirmation dialogs.

- [ ] **Step 5: Create campaign detail page**

Replace `src/app/projects/[id]/campaigns/[campaignId]/page.tsx` — Server Component:

Async with `await params` for both `id` and `campaignId`.

Query: `getCampaign(campaignId)` — returns `CampaignWithPlan`.

Conditional rendering by status:

**draft:**
```tsx
<div>
  <Header: codename, name, objective />
  <GeneratePlanButton campaignId={campaignId} />
  <CampaignControls ... status="draft" /> // just DELETE
</div>
```

**planning:**
```tsx
<div>
  <Header />
  <PlanEditor campaignId={campaignId} battlefieldId={id} initialPlan={planFromDB} assets={assets} />
  <CampaignControls ... status="planning" />
</div>
```

Convert the DB phases/missions into `PlanJSON` format for the editor.

**active/paused/accomplished/compromised:**
```tsx
<div>
  <Header />
  <PhaseTimeline phases={campaign.phases} />
  <CampaignControls ... status={status} />
</div>
```

- [ ] **Step 6: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/app/projects/[id]/campaigns/ src/components/campaign/
git commit -m "feat: add campaign pages with plan editor, timeline, and controls"
```

---

## Task 7: Integration Verification

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
- `/projects/[id]/campaigns` — shows campaign list (empty state or with data)
- `/projects/[id]/campaigns/new` — shows creation form
- Creating a campaign → redirects to detail page in `draft` state
- Detail page shows GENERATE BATTLE PLAN button
- All existing routes still work
- Sidebar campaign count reflects real data

Note: Full plan generation testing requires the `claude` CLI. If not available, verify:
- Campaign CRUD works (create, list, delete)
- Plan editor renders with mock data (manually insert phases/missions in DB)
- Phase timeline renders correctly
- Drag-and-drop works in the plan editor

- [ ] **Step 4: Fix any issues**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase C1 — campaign CRUD and planning operational"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Campaign CRUD: create, list, update, delete
- [ ] Plan generation: spawns Claude Code, parses JSON, creates DB records
- [ ] Plan generation handles parse failures gracefully (retry option)
- [ ] Plan editor: drag phases, drag missions between phases
- [ ] Plan editor: inline edit names, objectives, briefings
- [ ] Plan editor: assign assets, set priorities, manage dependsOn
- [ ] Plan editor: add/remove phases and missions
- [ ] Save plan persists to DB
- [ ] Campaign detail: conditional rendering by status (draft/planning/active/etc.)
- [ ] Phase timeline: displays phases with mission cards
- [ ] Campaign controls: correct buttons per status
- [ ] Launch sets status to active with currentPhase = 1
- [ ] Redeploy clones campaign with status planning
- [ ] Campaign list page with cards and status badges
- [ ] Sidebar campaign count updates
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
