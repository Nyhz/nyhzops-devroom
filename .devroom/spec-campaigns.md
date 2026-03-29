# Campaigns

## Concept

Multi-phase operation. Phases execute sequentially. Within each phase, missions run in parallel. After each phase, a debrief is generated and passed to the next phase — NOT full logs.

## Creating a Campaign

**Step 1**: Name and objective. Server Action → `draft`. Worktree mode defaults to `'phase'` (schema field exists but not exposed in UI).

**Step 2**: `[GENERATE PLAN]` opens the `<BriefingChat />` (GENERAL conversation). Campaign transitions to `planning`.

**Step 3**: `<PlanEditor />` shows editable plan with drag-and-drop. Reorder/add/remove phases and missions. Recruit recommended assets. Assign assets.

**Step 4**: `[GREEN LIGHT]` → `active`. Execution begins.

## Execution

1. Phase 1 → `active`.
2. Worktree mode applied per mission or per phase.
3. Queue all phase missions. Parallel execution (up to `DEVROOM_MAX_AGENTS`).
4. All missions terminal:
   - All accomplished → phase `secured`.
   - Any compromised → phase `compromised`, campaign `compromised`. Commander decides (resume, skip, or abandon). Note: `'paused'` is used in some UI/action code but is not in the `CampaignStatus` type union — the actual status set is `'compromised'`.
   - Merge worktrees if applicable.
   - Generate phase debrief.
   - Record `totalTokens`, `durationMs`.
   - Advance `currentPhase`.
5. Next phase. Pass ONLY phase debrief as context.
6. Repeat. All phases secured → campaign `accomplished`.

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

Note: A `redeployCampaign` server action exists but is not yet exposed in the campaign detail UI.
