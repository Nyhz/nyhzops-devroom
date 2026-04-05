# Campaigns

## Concept

Multi-phase operation. Phases execute sequentially. Within each phase, missions run in parallel. After each phase, a debrief is generated and passed to the next phase — NOT full logs.

Implementation: `src/lib/orchestrator/campaign-executor.ts` (execution), `src/actions/campaign.ts` (server actions).

## Creating a Campaign

**Step 1**: Name and objective. Server Action `createCampaign()` → `draft`. Worktree mode defaults to `'phase'` (schema field exists but not exposed in UI).

**Step 2**: `[GENERATE PLAN]` opens the `<BriefingChat />` (STRATEGIST conversation). Campaign transitions to `planning`.

**Step 3**: `<PlanEditor />` shows editable plan with drag-and-drop. Reorder/add/remove phases and missions. Recruit recommended assets. Assign assets. `dependsOn` field enables intra-phase ordering — missions can declare dependencies on other missions within the same phase.

**Step 4**: `[GREEN LIGHT]` → `launchCampaign()` validates the plan (all phases have missions, all `dependsOn` references valid within same phase, cycle detection via `dependency-graph.ts`), transitions to `active`, deletes briefing session data, replaces intel notes with mission-linked notes, triggers orchestrator.

## Execution

1. Phase 1 → `active`.
2. Worktree created per mission.
3. Queue missions with no dependencies immediately. Missions with `dependsOn` stay in `standby` until dependencies are `accomplished`. Parallel execution up to `DEVROOM_MAX_AGENTS`.
4. Each mission completes execution → status `reviewing` → **Overseer review** begins:
   - Overseer issues verdict: `approve`, `retry`, or `escalate`.
   - `approve` → status `approved` → **Quartermaster merge** begins (status `merging`) → on success `accomplished`.
   - `retry` → re-queued with Overseer feedback injected into prompt (up to 2 retries for reviewing, 1 for compromised).
   - `escalate` → status `compromised` (reason: `escalated`), Commander notified.
5. As each mission reaches `accomplished`, `checkDependencies()` runs — any `standby` missions whose dependencies are all accomplished get queued immediately.
6. When all phase missions are terminal (accomplished, compromised, or abandoned):
   - **All accomplished** → phase `secured`. Generate phase debrief. Record `totalTokens`, `durationMs`. Advance to next phase.
   - **Any compromised** → `handlePhaseFailure()` invokes the Overseer to decide:
     - **Retry**: Reset compromised missions to `queued` with optional new briefings.
     - **Skip**: Mark compromised as `abandoned`, cascade to dependent missions, evaluate phase completion.
     - **Escalate**: Campaign → `paused` with `stallReason` and `stalledPhaseId` recorded. Commander intervention required.
7. Phase completion is atomic — uses `UPDATE WHERE completingAt IS NULL` to prevent duplicate handlers when multiple missions complete simultaneously.
8. Next phase. Previous phase mission debriefs passed as context (not full logs).
9. Repeat. All phases secured → campaign `accomplished`. Campaign debrief generated, follow-up suggestions extracted.

## Campaign Fields

| Field | Description |
|-------|-------------|
| `debrief` | Campaign completion debrief — synthesized from all phase debriefs |
| `stallReason` | Why the campaign was paused (from Overseer's escalation) |
| `stalledPhaseId` | Which phase caused the stall |

## Mission Dependencies

Missions declare `dependsOn` as a JSON array of mission titles within the same phase. At launch, `launchCampaign()` validates:
- All referenced titles exist in the same phase.
- No circular dependencies (via `detectCycle()` in `src/lib/utils/dependency-graph.ts` — DFS-based).

During execution, `checkDependencies()` fires after each mission reaches `accomplished`, unblocking any `standby` missions whose dependencies are all satisfied.

When a compromised mission is skipped, dependent missions are cascaded to `abandoned` — the cascade repeats until no more unresolvable dependencies remain.

## Templates

`isTemplate = true` → appears in templates section. `[RUN TEMPLATE]` clones campaign + phases + missions.

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

Phase containers: left border (green=secured, amber=active). Header: `Phase {n}` dim + **name** amber + status right. Metadata: relative time · duration · tokens. Mission cards horizontal inside. Debrief collapsible.

## Campaign Controls

- **MISSION ACCOMPLISHED** (green outline): manually complete the campaign.
- **ABANDON** (red outline): cancel. Abort in-combat missions. Status → `compromised`.
- **Resume** (`resumeCampaign`): Resume a `paused` campaign. Re-queues `queued` missions, checks dependencies for `standby` missions.
- **Skip & Continue** (`skipAndContinueCampaign`): On a paused campaign — marks all compromised missions as `abandoned`, cascades to dependents, evaluates phase completion.
- **Tactical Override** (`tacticalOverride`): Rewrite the briefing for a compromised/abandoned mission, reset to `queued`, re-activate campaign if needed.
- **Commander Override** (`commanderOverride`): Mark a compromised mission as `accomplished` without re-running — bypasses Overseer's failed review. Triggers dependency checks.
- **Skip Mission** (`skipMission`): Mark a single compromised mission as `abandoned`. Cascades to dependent missions. May trigger phase completion.

Note: A `redeployCampaign` server action exists but is not yet exposed in the campaign detail UI.
