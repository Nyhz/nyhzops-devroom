# Campaigns

## Concept

Multi-phase operation. Phases execute sequentially. Within each phase, missions run in parallel. After each phase, a deterministic debrief is composed and passed to the next phase as context — NOT full logs.

Implementation:
- `src/control/campaign/executor.ts` — execution loop
- `src/control/campaign/dependency-graph.ts` — cycle detection, dependency resolution
- `src/control/campaign/debrief.ts` — deterministic phase debrief composition (no LLM call)
- `src/actions/campaign.ts`, `src/actions/campaign-helpers.ts`, `src/actions/campaign-overrides.ts`, `src/actions/campaign-plan.ts` — server actions

## Creating a Campaign

**Step 1**: Name and objective. Server Action `createCampaign()` → `draft`. Worktree mode defaults to `'phase'` (schema field exists but not exposed in UI).

**Step 2**: `[GENERATE PLAN]` opens the `<BriefingChat />` (STRATEGIST conversation). Campaign transitions to `planning`.

**Step 3**: `<PlanEditor />` shows editable plan with drag-and-drop. Reorder/add/remove phases and missions. Recruit recommended assets. Assign assets. `dependsOn` field enables intra-phase ordering — missions can declare dependencies on other missions within the same phase. Each mission has a `type: 'combat' | 'recon'` field set by STRATEGIST.

**Step 4**: `[GREEN LIGHT]` → `launchCampaign()` validates the plan:
- All phases have at least one mission.
- All `dependsOn` references are valid titles within the same phase.
- No circular dependencies (via `detectCycle()` in `src/control/campaign/dependency-graph.ts` — DFS-based).
- No recon mission depends on another recon mission (validator rejects this).

On success: campaign → `active`, briefing session data deleted, intel notes replaced with mission-linked notes, executor triggered.

## Campaign Statuses

| Status | Description |
|--------|-------------|
| `DRAFT` | Created, plan not yet started. |
| `PLANNING` | BriefingChat open, STRATEGIST generating plan. |
| `ACTIVE` | Execution running — at least one phase in progress. |
| `ACCOMPLISHED` | All phases secured. |
| `COMPROMISED` | No forward progress possible without Commander input. |
| `ABANDONED` | Cancelled by Commander. |

## Execution

1. Phase 1 → `active`.
2. Worktree created per mission.
3. Missions with no `dependsOn` → `QUEUED` immediately. Missions with `dependsOn` → `STANDBY` until dependencies are `ACCOMPLISHED`. Parallel execution up to `DEVROOM_MAX_AGENTS`.
4. Each mission completes execution → CONTROL runs gates:
   - Gates pass → status `MERGING` → Quartermaster merge → on success `ACCOMPLISHED`.
   - Gates fail → status `COMPROMISED` (reason: `gate-failure`). Commander notified.
5. As each mission reaches `ACCOMPLISHED`, `checkDependencies()` runs — any `STANDBY` missions whose dependencies are all `ACCOMPLISHED` get queued immediately.
6. Phase settles when every mission is terminal (`ACCOMPLISHED`, `COMPROMISED`, or `ABANDONED`):
   - **All ACCOMPLISHED** → phase `SECURED`. `src/control/campaign/debrief.ts` composes phase debrief deterministically. Record `totalTokens`, `durationMs`. Advance to next phase.
   - **Any COMPROMISED or ABANDONED** → phase `COMPROMISED`. Campaign → `COMPROMISED`. Commander resolves each blocked mission individually.
7. Phase completion is atomic — uses `UPDATE WHERE completingAt IS NULL` to prevent duplicate handlers when multiple missions complete simultaneously.
8. Next phase receives previous phase debriefs as context (not full logs).
9. Repeat. All phases secured → campaign `ACCOMPLISHED`. Campaign debrief generated from all phase debriefs.

## Phase Failure Handling

When a phase contains any `COMPROMISED` mission, the phase transitions to `COMPROMISED` and the campaign transitions to `COMPROMISED`. There is no automatic Overseer-driven retry, skip, or escalation step.

Commander resolves each `COMPROMISED` mission individually (see Commander Controls). When any resolution creates forward progress — a mission is re-queued or accepted — the campaign auto-resumes.

## Mission Dependencies

Missions declare `dependsOn` as a JSON array of mission titles within the same phase. At launch, `launchCampaign()` validates:
- All referenced titles exist in the same phase.
- No circular dependencies (`detectCycle()` in `src/control/campaign/dependency-graph.ts` — DFS-based).
- No recon mission depends on another recon mission.

During execution, `checkDependencies()` fires after each mission reaches `ACCOMPLISHED`, unblocking any `STANDBY` missions whose dependencies are all satisfied.

When Commander sets a mission to `ABANDONED`, the dependency graph is walked transitively — every mission that (directly or transitively) depended on the abandoned mission is also set to `ABANDONED` with reason `dependency-cascade`.

## Mission Types

STRATEGIST assigns each mission a `type`:

| Type | Description |
|------|-------------|
| `combat` | Writes or modifies code. Runs in a worktree with gate enforcement. |
| `recon` | Read-only analysis. No worktree, no gates. Cannot depend on other recon missions. |

## Templates

`isTemplate = true` → appears in templates section. `[RUN TEMPLATE]` clones campaign + phases + missions.

## Campaign Fields

| Field | Description |
|-------|-------------|
| `debrief` | Campaign completion debrief — synthesized from all phase debriefs |

## Campaign Detail — `/battlefields/[id]/campaigns/[campaignId]`

```
┌──────────────────────────────────────────────────────────────┐
│  Battlefields // Project // Campaigns // Operation Clean Sweep│
│  OPERATION CLEAN SWEEP                                        │
│                              [MISSION ACCOMPLISHED] [ABANDON] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Phase 1  Recon ──────────────────────────────── SECURED ┐│
│  │  1 day ago · 1m 48s · 683.0K tok                         ││
│  │                                                          ││
│  │  ┌─────────────────┐  ┌─────────────────┐               ││
│  │  │ Code audit      │  │ Test coverage   │               ││
│  │  │ OPERATIVE       │  │ ASSERT          │               ││
│  │  │ ● ACCOMPLISHED  │  │ ● ACCOMPLISHED  │               ││
│  │  │ 1m 9s  226.8K   │  │ 1m 36s  456.3K  │               ││
│  │  └─────────────────┘  └─────────────────┘               ││
│  │                                                          ││
│  │  Debrief ▸ (collapsible)                                 ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Phase 2  Strike ─────────────────────────────── SECURED ┐│
│  │  ...                                                      ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              ✓ Mission Accomplished.                      ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

Phase containers: left border (green=SECURED, amber=ACTIVE, red=COMPROMISED). Header: `Phase {n}` dim + **name** amber + status right. Metadata: relative time · duration · tokens. Mission cards horizontal inside. Debrief collapsible.

## Commander Controls

### Campaign-level

- **MISSION ACCOMPLISHED** (green outline): manually mark the campaign complete.
- **ABANDON CAMPAIGN** (red outline): cancel. Abort all in-combat missions. Campaign → `ABANDONED`.

### Per COMPROMISED mission

- **Tactical Override** (`tacticalOverride`): Rewrite the briefing for a compromised mission, reset to `QUEUED`. Campaign auto-resumes.
- **Accept and Merge** (`commanderOverride`): Mark a compromised mission as `ACCOMPLISHED` without re-running — accepts the output as-is. Triggers dependency checks and may unblock STANDBY missions.
- **Abandon** (`abandonMission`): Set a compromised mission to `ABANDONED`. Cascades transitively to all dependent missions (reason: `dependency-cascade`). May trigger phase completion evaluation.
- **Skip Mission** (`skipMission`): Mark a single compromised mission as `ABANDONED`. Cascades to dependent missions. May trigger phase completion.

Campaign auto-resumes whenever a Commander resolution (Tactical Override or Accept and Merge) creates forward progress.
