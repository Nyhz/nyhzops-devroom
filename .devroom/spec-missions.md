# Missions, Assets & Dossiers

## Mission Lifecycle

```
STANDBY → QUEUED → DEPLOYING → IN COMBAT → REVIEWING → ACCOMPLISHED
                                                     → COMPROMISED
                                          → ABANDONED
```

## Creating a Mission

**Quick deploy** (battlefield overview): textarea + asset + SAVE/SAVE & DEPLOY.

**Full form** (modal or page): title, briefing (markdown + image paste), priority, asset, worktree toggle.

## Load Dossier

The `<DossierSelector />` component lets the Commander pick a saved dossier template from the database. If the dossier has `{{variable}}` placeholders, a form appears to fill in values. The interpolated template populates the briefing textarea and the recommended asset is auto-selected. See Dossiers section below.

## Execution Flow

In `executor.ts` when the orchestrator dequeues a mission:

1. **Status → DEPLOYING**. Emit events.
2. Worktree setup (if enabled):
   - Branch: `devroom/{codename}/{mission-id-short}`.
   - Create worktree via simple-git.
   - `cwd` = worktree path.
3. No worktree: `cwd` = repo root.
4. Build prompt via `prompt-builder.ts` (see `.devroom/spec-prompts.md`).
5. Spawn Claude Code with AbortController.
6. **Status → IN COMBAT**.
7. Stream stdout:
   - Parse each JSON line.
   - Emit `mission:log` to Socket.IO room.
   - Store in `missionLogs`.
   - Track tokens incrementally.
8. On process close:
   - Calculate duration.
   - Parse final token usage.
   - Generate debrief.
   - If worktree + success: trigger merge (see `.devroom/git-and-workflows.md`).
   - **Status → REVIEWING** (captain review begins asynchronously).
   - Captain reviews debrief quality via `review-handler.ts` (up to 2 retries for successful missions, 1 for compromised).
   - On review pass: **Status → ACCOMPLISHED** or **COMPROMISED**.
   - On review fail after retries: escalate to Commander via Telegram.
   - Emit: `mission:status`, `mission:debrief`, `mission:tokens`, `activity:event`.

## Session Reuse

Completed missions store `sessionId`. Detail page shows:
- **[Continue Mission]**: new mission reusing session (context preserved).
- **[Redeploy]**: re-run same mission (`iterations++`).

## Debrief Generation

Extract summary from Claude Code output. If unclear, spawn a quick process to generate one. Written in Commander-addressed military briefing style.

## Mission Detail — `/battlefields/[id]/missions/[missionId]`

Server Component + Client children for real-time:

```
┌──────────────────────────────────────────────────────────────┐
│  MISSION: Fix authentication bug                             │
│  Status: ● IN COMBAT | Asset: OPERATIVE | Priority: HIGH    │
│  Battlefield: OPERATION THUNDER                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  BRIEFING                                                    │
│  ──────────────────────────────────────────────────────────  │
│  Fix the JWT token refresh logic...                          │
│                                                              │
│  COMMS                                                       │
│  ──────────────────────────────────────────────────────────  │
│  14:32:01 │ Analyzing auth middleware...                      │
│  14:32:03 │ Found issue in refreshToken handler...           │
│  14:32:15 │ Applying fix to src/auth/refresh.ts              │
│  14:32:20 │ Running test suite...                            │
│  14:32:45 │ All tests passing ✓                              │
│  █                                                           │
│                                                              │
│  ┌─ TOKENS ────────────────────────────────────────────────┐ │
│  │ Input: 12,340 │ Output: 3,210 │ Cache: 11,100 (91.0%)  │ │
│  │ Duration: 2m 14s                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [ABANDON]  [CONTINUE MISSION]  [REDEPLOY]                  │
└──────────────────────────────────────────────────────────────┘
```

After completion: DEBRIEF section with Commander-addressed report.

---

## Assets

### Defaults (seeded)

| Codename    | Specialty              | Model  | Description                                               |
|-------------|------------------------|--------|-----------------------------------------------------------|
| PATHFINDER  | project bootstrapping  | Sonnet | Recon and initialization. Generates CLAUDE.md + SPEC.md.  |
| GENERAL     | campaign leadership    | Opus   | Plans campaigns, assigns assets, defines execution order.  |
| OPERATIVE   | mission execution      | Sonnet | Versatile executor. Features, bugs, refactoring, any task.|
| WATCHDOG    | code review            | Sonnet | Reviews quality, security, performance, maintainability.   |
| ASSERT      | testing                | Sonnet | Tests, edge cases, coverage analysis.                      |
| DISTILL     | docs                   | Sonnet | Documentation maintainer. Keeps docs aligned with code.    |

### Management — `/assets`

Grid of cards: codename, specialty, model, status, completed count. Edit, toggle offline, recruit new.

### Recruitment

Campaign plan generation may recommend new assets. `[RECRUIT]` creates via Server Action. Manual creation also available.

### Status

- **active**: available, green dot.
- **offline**: disabled, gray dot.

Multiple missions can use the same asset concurrently (it's a profile, not a singleton).

---

## Dossiers — Briefing Templates

### Concept

Dossiers are reusable mission briefing templates with variable interpolation. Each dossier has a codename (e.g. `CODE_REVIEW`, `SECURITY_AUDIT`), a markdown template with `{{variable}}` placeholders, and an optional recommended asset.

### Schema

See `Dossier` table in `.devroom/database-schema.md`. Variables are stored as a JSON array of `DossierVariable` objects: `{ key, label, description, placeholder }`.

### Usage

- The deploy mission form includes a `[Load dossier]` button (`<DossierSelector />`).
- Selecting a dossier populates the briefing textarea with the template.
- If the dossier has variables, a form appears to fill in values before populating.
- The recommended asset is auto-selected if specified.

### CRUD

Server Actions in `src/actions/dossier.ts`: create, update, delete, list, get by codename.
