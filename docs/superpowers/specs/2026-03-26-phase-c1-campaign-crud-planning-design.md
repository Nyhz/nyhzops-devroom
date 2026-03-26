# Phase C1: Campaign CRUD + Plan Generation + Plan Editor — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** C1 (Campaign CRUD + Planning)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase B3 (Bootstrap) — complete

---

## Overview

Phase C1 adds campaign management: creating campaigns, generating AI battle plans via Claude Code, editing plans with a drag-and-drop war board, and the campaign detail page with phase timeline. After C1, the Commander can create campaigns, generate and refine battle plans, and prepare for launch. Execution comes in C2.

---

## 1. Campaign Plan JSON Schema

The schema used by both the plan generator (output) and the plan editor (input/output).

```json
{
  "summary": "string — 2-3 sentence overview of what the campaign accomplishes",
  "phases": [
    {
      "name": "string — tactical phase name",
      "objective": "string — what this phase accomplishes and why it must precede the next",
      "missions": [
        {
          "title": "string — short descriptive title",
          "briefing": "string — detailed agent instructions with file paths, acceptance criteria, constraints",
          "assetCodename": "string — which agent profile executes this",
          "priority": "low|normal|high|critical",
          "dependsOn": ["string — titles of sibling missions in the same phase that must complete first (optional)"]
        }
      ]
    }
  ]
}
```

**`dependsOn` semantics:**
- Optional field (omit or empty array = no dependencies, run immediately when phase starts)
- References mission titles within the SAME phase only (cross-phase dependencies are implicit via phase ordering)
- The orchestrator (C2) checks dependencies before dispatching — if a mission's dependencies aren't all `accomplished`, it waits
- Circular dependencies are rejected during plan validation

---

## 2. Campaign Server Actions

**File:** `src/actions/campaign.ts`

### Actions

#### `createCampaign(battlefieldId, name, objective): Promise<Campaign>`

Create campaign with status `draft`. Generate ULID, set timestamps. `revalidatePath`.

#### `getCampaign(id): Promise<CampaignWithPlan | null>`

Return campaign with all phases (ordered by `phaseNumber`) and their missions. Include asset codenames via join.

```typescript
interface CampaignWithPlan extends Campaign {
  phases: Array<Phase & {
    missions: Array<Mission & { assetCodename: string | null }>;
  }>;
}
```

#### `listCampaigns(battlefieldId): Promise<Campaign[]>`

All campaigns for a battlefield, ordered by `updatedAt` desc.

#### `updateCampaign(id, data): Promise<Campaign>`

Update name, objective. Only valid in `draft` or `planning` status. `revalidatePath`.

#### `deleteCampaign(id): Promise<void>`

Only valid in `draft` or `planning`. Cascade delete: missions → mission logs, then phases, then campaign. `revalidatePath`.

#### `generateBattlePlan(campaignId): Promise<void>`

1. Get campaign and battlefield
2. Call `generatePlan()` from plan-generator (see §3)
3. Parse JSON response into phase + mission records
4. Insert phases with `phaseNumber` (1-indexed)
5. Insert missions linked to their phase and campaign, with `battlefieldId`
6. Set campaign status to `planning`
7. `revalidatePath`

#### `updateBattlePlan(campaignId, plan: PlanJSON): Promise<void>`

Accept the full plan structure from the editor. In a transaction:
1. Delete all existing missions for this campaign's phases
2. Delete all existing phases for this campaign
3. Recreate phases from `plan.phases` with correct `phaseNumber`
4. Recreate missions from each phase's `missions` array
5. Update campaign `updatedAt`
6. `revalidatePath`

Only valid in `planning` status.

#### `launchCampaign(campaignId): Promise<void>`

1. Validate campaign has phases and missions
2. Set status to `active`
3. Set `currentPhase` to 1
4. `revalidatePath`

Actual execution (queuing phase 1 missions) comes in C2.

#### Campaign control actions (UI wired in C1, execution in C2):

- `completeCampaign(id)`: Set status to `accomplished`. Manual completion.
- `abandonCampaign(id)`: Set status to `compromised`. Abort active missions (C2).
- `redeployCampaign(id)`: Clone campaign + phases + missions into a new campaign. Set status to `active`.

---

## 3. Plan Generator

**File:** `src/lib/orchestrator/plan-generator.ts`

### Function

```typescript
async function generatePlan(
  campaign: Campaign,
  battlefield: Battlefield,
  assets: Asset[],
): Promise<PlanJSON>
```

### Flow

1. Build the planning prompt (see below)
2. Spawn Claude Code: `config.claudePath --print --dangerously-skip-permissions --max-turns 10 --prompt {prompt}`
   - `cwd`: battlefield repo path
   - Uses `--print` (plain text, not stream-json) — one-shot generation
3. Capture stdout
4. Parse JSON:
   - Try `JSON.parse(stdout.trim())`
   - If fails: try extracting from markdown fences (`` ```json ... ``` ``)
   - If fails: throw `PlanGenerationError` with raw output
5. Validate structure:
   - `phases` is non-empty array
   - Each phase has `name`, `objective`, non-empty `missions` array
   - Each mission has `title`, `briefing`, `assetCodename`, `priority`
   - `assetCodename` values match available assets (warn but don't reject on mismatch — Commander can reassign in editor)
   - No circular `dependsOn` references within a phase
6. Return parsed `PlanJSON`

### Planning Prompt

```
## Campaign Battle Plan Generation

You are a strategic planner for the DEVROOM agent orchestrator.
Analyze this project and generate a detailed battle plan for the following objective.

### Project Intelligence

{CLAUDE.md content — read from battlefield.claudeMdPath if exists}

{SPEC.md content — read from battlefield.specMdPath if exists}

### Campaign Objective

{campaign.objective}

### Available Assets

{for each asset: "- {codename} ({specialty}): {first 100 chars of systemPrompt}"}

### Execution Model

- Phases execute SEQUENTIALLY. Phase N must fully complete before Phase N+1 starts.
- All missions within a phase execute IN PARALLEL on separate git branches.
- After each phase: all branches merge to main, a debrief summary passes to the next phase.
- Each agent has full codebase access and the project's CLAUDE.md as context.
- If Mission B depends on Mission A's output AND they are in the same phase, add
  Mission A's title to Mission B's "dependsOn" array. The orchestrator will wait for A
  before starting B.

### Planning Rules

- Pin dependency versions in install commands (e.g., pnpm add stripe@17.4.0)
- Include infrastructure missions early: dependency installation, env vars, DB migrations
- Ensure API/service missions complete BEFORE frontend missions that call them (use phase ordering or dependsOn)
- Include a final verification/testing phase
- Write detailed briefings with specific file paths where possible and clear acceptance criteria
- End every briefing with "Do NOT..." constraints to prevent scope creep
- Assign the most appropriate asset for each mission based on specialty
- Keep phases focused: 2-5 missions per phase is ideal
- Do not create unnecessary phases — combine related work

### Output Format

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
          "briefing": "Detailed instructions...",
          "assetCodename": "ASSET_NAME",
          "priority": "low|normal|high|critical",
          "dependsOn": []
        }
      ]
    }
  ]
}
```

---

## 4. Plan Editor (Drag-and-Drop)

**File:** `src/components/campaign/plan-editor.tsx` — Client Component

### Dependencies

Install: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### Features

**Phase management:**
- Phases stacked vertically, draggable to reorder
- Each phase card: editable name, editable objective, mission count, delete button
- `[+ ADD PHASE]` button at bottom

**Mission management:**
- Mission cards inside each phase, draggable between and within phases
- Each card: editable title, expandable briefing (click to edit in TacTextarea), asset dropdown, priority selector, dependsOn tags
- `[+ ADD MISSION]` button inside each phase
- Delete button per mission

**Drag-and-drop:**
- `@dnd-kit/core` DndContext wrapping the editor
- `@dnd-kit/sortable` SortableContext for both phase ordering and mission ordering
- Drag missions between phases (changes the mission's phase)
- Drag phases to reorder (updates `phaseNumber`)
- Visual feedback: amber glow on drag, dashed border on drop zone

**Inline editing:**
- Click on phase name/objective → inline text input
- Click on mission title → inline text input
- Click on mission briefing → expands to TacTextarea
- Asset: dropdown of active assets (codename + specialty)
- Priority: small dropdown (low/normal/high/critical)
- DependsOn: click to show dropdown of sibling mission titles, toggle selection

**Save:**
- `[SAVE PLAN]` button at top
- Converts React state to `PlanJSON`, calls `updateBattlePlan(campaignId, plan)` Server Action
- Debounce or explicit save (no auto-save — Commander controls when to persist)

### Styling

- Phase cards: `bg-dr-surface border border-dr-border`, left border `border-l-2 border-l-dr-amber`
- Mission cards: `bg-dr-elevated border border-dr-border`, compact
- Drag handle: amber grip dots (⠿ or similar)
- Active drag: `shadow-glow-amber`, slight scale transform
- Drop zone: amber dashed border `border-dashed border-dr-amber`
- Asset badge: small colored tag with codename
- Priority: colored dot (dim=low, muted=normal, amber=high, red=critical)

---

## 5. Campaign Pages

### Campaign List (`/projects/[id]/campaigns/page.tsx`)

Replace existing stub. Server Component.

- Header: `CAMPAIGNS` + `[+ NEW CAMPAIGN]` button
- Grid of campaign cards (TacCard):
  - Name (amber title)
  - Objective (truncated, dim)
  - Status badge (TacBadge)
  - Phase count + mission count
  - Link to campaign detail
- Empty state: "No campaigns deployed. Launch your first operation."

### Campaign Creation (`/projects/[id]/campaigns/new/page.tsx`)

- Breadcrumb: `Battlefields // {name} // Campaigns // New`
- Form fields:
  - Name (TacInput, required) — e.g., "Operation Clean Sweep"
  - Objective (TacTextarea, required) — detailed description of what the campaign should accomplish
- Submit → `createCampaign()` → redirect to `/projects/[id]/campaigns/[campaignId]`

### Campaign Detail (`/projects/[id]/campaigns/[campaignId]/page.tsx`)

Replace existing stub. Server Component with conditional rendering.

**By status:**

| Status | Content |
|--------|---------|
| `draft` | Campaign info (name, objective) + `[GENERATE BATTLE PLAN]` button + `[DELETE]` |
| `planning` | Plan editor (drag-and-drop) + `[SAVE PLAN]` + `[LAUNCH OPERATION]` + `[REGENERATE PLAN]` + `[DELETE]` |
| `active` | Phase timeline (read-only) + campaign controls. (Live data wired in C2.) |
| `paused` | Phase timeline + `[RESUME]` + `[ABANDON]` |
| `accomplished` | Phase timeline (all secured) + completion banner + `[REDEPLOY]` |
| `compromised` | Phase timeline showing failure point + `[REDEPLOY]` + `[ABANDON]` |

**Generate button flow:**
1. Commander clicks `[GENERATE BATTLE PLAN]`
2. Loading state: "Generating battle plan..." with pulsing animation
3. Calls `generateBattlePlan(campaignId)` Server Action
4. On success: page revalidates, shows plan editor
5. On error: show error message with retry option

**Regenerate:** Same as generate but warns that existing plan will be replaced. Confirmation dialog.

**Launch:** `[LAUNCH OPERATION]` button (amber, prominent). Confirmation dialog: "Launch {name}? This will begin executing Phase 1." Calls `launchCampaign(campaignId)`.

---

## 6. Phase Timeline Component

**File:** `src/components/campaign/phase-timeline.tsx`

Reusable component for displaying phases and their missions. Used in both the plan editor (editable) and the campaign detail (read-only).

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
      durationMs: number | null;
      costInput: number | null;
      costOutput: number | null;
    }>;
  }>;
  readOnly?: boolean;
}
```

**Layout per phase:**
```
┌─ Phase {n}  {name} ──────────────────────────── {STATUS} ┐
│  {relative_time} · {duration} · {tokens}                   │
│                                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ Mission 1   │  │ Mission 2   │  │ Mission 3   │       │
│  │ ASSET       │  │ ASSET       │  │ ASSET       │       │
│  │ ● STATUS    │  │ ● STATUS    │  │ ● STATUS    │       │
│  │ {time} {tok}│  │ {time} {tok}│  │ {time} {tok}│       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                            │
│  Debrief ▸ (collapsible)                                   │
└────────────────────────────────────────────────────────────┘
```

- Left border: green=secured, amber=active, dim=standby
- Mission cards horizontal, wrapping
- Debrief: collapsible section, hidden by default
- Read-only mode: no edit controls, no drag handles

---

## 7. New Types

**Added to `src/types/index.ts`:**

```typescript
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

---

## 8. Sidebar Updates

The sidebar's campaign count badge should reflect real data. The sidebar Server Component already queries battlefields — add a campaign count query per battlefield (similar to the mission count).

---

## 9. What Is NOT Built in Phase C1

- Campaign execution (queuing missions, phase advancement) — Phase C2
- Live phase status updates via Socket.IO — Phase C2
- Phase debrief generation — Phase C2
- Campaign templates (isTemplate, RUN TEMPLATE) — Phase C3
- `dependsOn` orchestrator enforcement — Phase C2 (the editor supports it, the executor respects it in C2)
- Pause/Resume campaign — Phase C2

---

## 10. End State

After Phase C1:
1. Commander can create campaigns with name and objective
2. "GENERATE BATTLE PLAN" spawns Claude Code to create a structured plan
3. Commander reviews and edits the plan on a drag-and-drop war board
4. Phases and missions can be reordered, added, removed, and edited inline
5. Assets assigned per mission, priorities set, intra-phase dependencies declared
6. Plan saved to database via Server Action
7. Campaign detail page shows phase timeline with mission cards
8. "LAUNCH OPERATION" sets campaign to active (execution wired in C2)
9. Campaign list page shows all campaigns with status badges
