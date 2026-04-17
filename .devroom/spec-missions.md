# Missions, Assets & Dossiers

## Mission Lifecycle

```
STANDBY → QUEUED → DEPLOYING → IN COMBAT → MERGING → ACCOMPLISHED
                                         → COMPROMISED (retry budget exhausted / gate failure / escalated / merge failed)
                              → ABANDONED (Commander cancel only)
```

Recon missions follow a shorter path — no worktree, no gates, no merge:

```
QUEUED → DEPLOYING → IN COMBAT → ACCOMPLISHED
```

| Status       | Color | Meaning |
|--------------|-------|---------|
| STANDBY      | dim   | Created, not yet queued. |
| QUEUED       | muted | Waiting for an available agent slot. |
| DEPLOYING    | amber | Setting up worktree / preparing process. |
| IN COMBAT    | amber | Claude Code process actively running. |
| MERGING      | amber | CONTROL rebase-then-merge in progress. |
| ACCOMPLISHED | green | Completed, gates passed, merged successfully. |
| COMPROMISED  | red   | Retry budget exhausted, OVERSEER escalated, or merge cannot complete. Commander decides next action. |
| ABANDONED    | dim   | Cancelled by Commander. Only the Commander can set this status. |

## Creating a Mission

**Quick deploy** (battlefield overview): textarea + asset selector + SAVE / SAVE & DEPLOY.

**Full form** (modal or page): title, briefing (markdown + image paste), priority, asset, mission type. Worktrees are created automatically by CONTROL for all combat missions — no user toggle needed.

## Load Dossier

The `<DossierSelector />` component lets the Commander pick a saved dossier template from the database. If the dossier has `{{variable}}` placeholders, a form appears to fill in values. The interpolated template populates the briefing textarea and the recommended asset is auto-selected. See the Dossiers section below.

---

## Execution Flow

Implementation: `src/control/mission-runner.ts` (per-mission lifecycle), `src/control/control.ts` (dispatch loop).

CONTROL picks a mission from QUEUED when an agent slot is free and drives it through the full lifecycle deterministically. No LLM is consulted on the happy path.

1. **Status → DEPLOYING**. Emit `mission:status` event via Socket.IO.
2. **Auth check** via macOS Keychain. On failure → orchestrator-wide pause + AUTH escalation to Commander.
3. **Worktree setup** (combat missions only):
   - Branch: `devroom/{codename}/{mission-id-short}` under `{battlefield.repoPath}/.worktrees/{sanitized-branch}`.
   - Rebase onto latest target branch before starting.
4. **Build prompt** via `src/control/prompt-builder.ts` (see `.devroom/spec-prompts.md`):
   - Includes campaign context if this is a campaign mission.
   - Includes gate stderr from previous attempt if `currentSortieAttempts > 0`.
   - Appends workspace context (worktree path, repo root, gate manifest).
5. **Build CLI args** via `src/control/assets/cli-builder.ts` — model, max-turns, effort, system prompt, skills (plugin dirs), MCP servers.
6. **Spawn `claude`** with AbortController. Each mission gets an isolated `HOME` at `/tmp/claude-config/{missionId}` to prevent concurrent config corruption.
7. **Status → IN COMBAT**. Launch `LivenessMonitor` (L1 / L3 / L5).

---

## Supervision Layers

CONTROL attaches four supervision layers to every running mission.

| Layer | Trigger | Threshold | Action |
|-------|---------|-----------|--------|
| L1 | Subprocess `close` event | Immediate | Exit classification → retry policy or merge. |
| L3 | Stdout silence | 5 min (10 min for recon) | SIGTERM → SIGKILL after 5 s grace. |
| L5 | Hard wall clock (per attempt) | 30 min | SIGTERM → SIGKILL after 5 s grace. |
| L6 | Watchdog sweep (global) | Every 60 s + on CONTROL startup | Recover stale transient states (`DEPLOYING`, `IN COMBAT`, `MERGING`). |

When L3 or L5 fires, the exit is classified as `TIMEOUT` and the retry policy is invoked.

---

## Exit Classification

On subprocess exit, CONTROL classifies the outcome before deciding the next step.

**Fast-path categories** (regex matching, no LLM):

| Category         | Meaning |
|------------------|---------|
| `CLEAN`          | Zero exit, debrief emitted. |
| `TURN_LIMIT`     | Hit `--max-turns` ceiling. |
| `TIMEOUT`        | L3 / L5 fired. |
| `INFRASTRUCTURE` | Host-side error (disk, OOM, process crash). |
| `RATE_LIMIT`     | Claude API rate limit response. |
| `AUTH`           | Authentication failure. |

**Fallback:** If no fast-path regex matches, CONTROL spawns OVERSEER for a one-shot classification pass (`claude --print`). OVERSEER returns `{ category, reasoning }`.

Categories that feed the retry policy:
- `AGENT_FAILURE` — counts against the sortie retry budget.
- `INFRASTRUCTURE` — free retry with exponential backoff.
- `NEEDS_COMMANDER` — immediately → COMPROMISED.

---

## Auto-Commit Sweep

On `CLEAN` or `TURN_LIMIT` exit: CONTROL runs `git status --porcelain` in the worktree. If the tree is dirty (uncommitted changes), CONTROL runs `git add -A && git commit --no-verify` with a synthesized commit message before proceeding to gate execution.

---

## Gate Execution

Gates run after a successful auto-commit sweep on `CLEAN` or `TURN_LIMIT` exits. They are the deterministic quality gate that replaces the old Overseer review loop.

- **Order**: lint → typecheck → build → test (sequential, fail-fast).
- **Per-gate timeout**: 5 minutes. **Total budget**: 15 minutes.
- First gate failure stops the suite and captures stderr for the retry prompt.
- All gates pass → **MERGING**.
- Any gate failure → retry policy.

Gate commands are defined in the battlefield's Gate Manifest and verified green on HEAD before the battlefield is activated.

---

## Retry Policy

| Attempt | Type | Behavior |
|---------|------|----------|
| 1 | Initial | Fresh session, full briefing. |
| 2 | Deterministic | `--resume` same session. Gate stderr appended to prompt. |
| 3 | Deterministic | Same as attempt 2, only if attempt 2 produced a different diff. |
| 4 | OVERSEER redirect | OVERSEER consult: returns `redirect` (new prompt) or `escalate` (→ COMPROMISED). One shot. |

Hard caps per mission: **4 combat-asset spawns**, **1 OVERSEER consult**.

After attempt 4 fails → **COMPROMISED**.

**Infrastructure exits** bypass the sortie budget and use exponential backoff: 30 s → 2 min → 10 min → 30 min → COMPROMISED.

---

## Merge Flow

Triggered when all gates pass. CONTROL handles the full merge — no separate Quartermaster service.

1. **Acquire** per-battlefield merge lock (prevents concurrent merges).
2. **Compare** target branch HEAD at mission start vs. current HEAD.
3. **Target did not advance** → fast-forward merge → **ACCOMPLISHED**.
4. **Target advanced** → rebase mission branch onto latest target:
   - Rebase clean → re-run gates:
     - Gates pass → merge → **ACCOMPLISHED**.
     - Gates fail → **COMPROMISED**.
   - Rebase conflicts → spawn **QUARTERMASTER** (one-shot, max 15 turns, 10-min timeout):
     - QM succeeds + gates pass → merge → **ACCOMPLISHED**.
     - QM fails or gates fail → **COMPROMISED**.

On ACCOMPLISHED: worktree is cleaned up. Follow-up suggestions from the debrief are extracted and saved to `followUpSuggestions` for display on the battlefield overview.

On COMPROMISED from merge: critical escalation to Commander. Branch is preserved for manual inspection.

---

## Recon Missions

`type: 'recon'`. No worktree. No commits. No gates. No merge.

- Runs with `cwd` = repo root.
- L3 silence threshold raised to 10 minutes.
- On exit: CONTROL checks for unauthorized changes (`git status --porcelain`). If the worktree is dirty, changes are reverted and `reconViolatedReadonly` is flagged on the mission record.

---

## Debrief Format

Combat assets emit a structured JSON block as their final action:

```
<DEBRIEF>{"summary": "...", "commits": [...], "files_touched": [...], "confidence": "high|medium|low", "open_questions": "..."}</DEBRIEF>
```

CONTROL parses this block and stores it in `debriefStructured`. If parsing fails, CONTROL synthesizes a debrief from git state: summary from the last assistant message, commits and files from `git log` / `git diff`, confidence `unknown`.

The raw debrief text is stored in the `debrief` field and displayed on the mission detail page addressed to the Commander.

---

## Commander Actions on COMPROMISED Missions

| Action | Effect |
|--------|--------|
| **Tactical Override** | Rewrite briefing, reset `currentSortieAttempts` to 0, mission → QUEUED with a fresh session. |
| **Accept and Merge** | Force-merge current worktree state into target branch; mission → ACCOMPLISHED. |
| **Abandon** | Mission → ABANDONED. Dependent campaign missions cascade to ABANDONED. |

---

## Mission Detail — `/battlefields/[id]/missions/[missionId]`

Server Component + Client children for real-time updates:

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
│  14:32:20 │ Running gate suite...                            │
│  14:32:45 │ All gates passing ✓                              │
│  █                                                           │
│                                                              │
│  ┌─ TOKENS ────────────────────────────────────────────────┐ │
│  │ Input: 12,340 │ Output: 3,210 │ Cache: 11,100 (91.0%)  │ │
│  │ Duration: 2m 14s                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [ABANDON]                                                   │
│  (COMPROMISED only) [TACTICAL OVERRIDE]  [ACCEPT AND MERGE] │
└──────────────────────────────────────────────────────────────┘
```

After completion: **DEBRIEF** section with the structured Commander-addressed report. Attempt history panel shows each sortie's exit category, duration, and gate results.

---

## Assets

Assets are Claude Code agent profiles — a specialty, system prompt, model, and configuration. They are not singletons; multiple missions can use the same asset concurrently.

### Categories

**Mission assets** (`isSystem: 0`) — deployable agents assigned to missions by the Commander or campaign planner. Can be edited, toggled offline, or deleted.

**System assets** (`isSystem: 1`) — internal agents used by CONTROL. Cannot be deleted or have their codename changed. Not directly assignable to missions.

### Default Roster (seeded)

| Codename      | Type    | Specialty                          | Model            |
|---------------|---------|------------------------------------|------------------|
| OPERATIVE     | mission | Backend / general code             | claude-sonnet-4-6 |
| VANGUARD      | mission | Frontend engineering               | claude-sonnet-4-6 |
| INTEL         | mission | Docs, bootstrap, project intel     | claude-sonnet-4-6 |
| STRATEGIST    | system  | Campaign planning                  | claude-opus-4-6   |
| OVERSEER      | system  | Exit classification + gate-failure consult | claude-sonnet-4-6 |
| QUARTERMASTER | system  | Merge conflict resolution          | claude-sonnet-4-6 |

### Asset Fields

| Field              | Type        | Description |
|--------------------|-------------|-------------|
| `codename`         | string      | Unique identifier (e.g. `OPERATIVE`). |
| `specialty`        | string      | Short description of the asset's focus area. |
| `systemPrompt`     | string      | Asset-specific system prompt. For mission assets the shared Rules of Engagement (from `settings.rules_of_engagement`) is prepended at runtime by `cli-builder.ts`. |
| `model`            | string      | Claude model ID (e.g. `claude-sonnet-4-6`). |
| `status`           | string      | `active` or `offline`. |
| `skills`           | JSON string | Array of Claude Code plugin skill identifiers. Resolved to `--plugin-dir` flags by `cli-builder.ts`. |
| `mcpServers`       | JSON string | Array of MCP server configurations. Passed as `--mcp-config`. |
| `maxTurns`         | integer     | Maximum turns for Claude Code invocation (e.g. 100 for mission assets, 3 for STRATEGIST). |
| `effort`           | string      | Effort level: `low`, `medium`, `high`, or `max`. Passed as `--effort` flag. |
| `isSystem`         | integer     | `0` = mission asset, `1` = system asset. |
| `missionsCompleted`| integer     | Running count of completed missions. |

### Asset CLI Builder

`src/control/assets/cli-builder.ts` translates asset configuration into Claude Code CLI flags:

- `--model` from `asset.model`
- `--max-turns` from `asset.maxTurns`
- `--effort` from `asset.effort`
- `--append-system-prompt` from `asset.systemPrompt`
- `--plugin-dir` for each skill (resolved from `~/.claude/plugins/cache/{publisher}/{name}/`)
- `--mcp-config` from `asset.mcpServers`

Mission-level `skillOverrides` (`{ added?: string[], removed?: string[] }`) can modify the asset's default skill set per mission.

### Asset Detail Page — `/assets/[id]`

Tabbed layout with three tabs:

- **Profile tab** (`asset-profile-tab.tsx`): codename, specialty, model, status, completed count.
- **Prompt tab** (`asset-prompt-tab.tsx`): editable system prompt.
- **Skills tab** (`asset-skills-tab.tsx`): skill toggle list (`skill-toggle-list.tsx`), MCP server configuration.

System assets display their configuration as read-only (codename cannot be changed, asset cannot be deleted).

Status toggle: `asset-status-toggle.tsx` — switches between `active` (green) and `offline` (gray).

### Management — `/assets`

Grid of asset cards: codename, specialty, model, status, completed count. Click card to navigate to detail page.

### Recruitment

Campaign plan generation may recommend new assets. `[RECRUIT]` creates via Server Action. Manual creation also available.

---

## Mission Fields Reference

Key fields on the `missions` table relevant to the execution lifecycle:

| Field                    | Type        | Description |
|--------------------------|-------------|-------------|
| `status`                 | string      | Current lifecycle status (see lifecycle diagram above). |
| `type`                   | string      | `combat` or `recon`. |
| `priority`               | string      | `routine`, `urgent`, or `critical`. Default: `routine`. |
| `dependsOn`              | string      | Mission ID this mission waits on (intra-phase ordering in campaigns). |
| `sessionId`              | string      | Claude Code session ID from the most recent sortie. |
| `currentSortieAttempts`  | integer     | Number of combat-asset spawns consumed (max 4). |
| `infrastructureRetryCount` | integer   | Count of free infrastructure retries consumed. |
| `nextAttemptAt`          | integer     | Unix ms timestamp for scheduled infrastructure retry. |
| `compromiseReason`       | string      | Why the mission failed: `timeout`, `merge-failed`, `execution-failed`, `escalated`, `gate-failed`. |
| `worktreeBranch`         | string      | Git branch name for the mission's worktree. |
| `debrief`                | string      | Post-mission report text (raw). |
| `debriefStructured`      | JSON        | Parsed `<DEBRIEF>` block: `{summary, commits, files_touched, confidence, open_questions}`. |
| `mergeResult`            | string      | `fast-forward`, `rebase-clean`, `quartermaster`, or `failed`. |
| `mergeConflictFiles`     | JSON        | Array of file paths that had merge conflicts (if any). |
| `mergeTimestamp`         | integer     | Unix ms timestamp when merge completed. |
| `reconViolatedReadonly`  | boolean     | Set if a recon mission made unauthorized filesystem changes. |
| `skillOverrides`         | JSON string | `{ added?: string[], removed?: string[] }` — per-mission skill modifications. |
| `costInput`              | integer     | Input tokens consumed. |
| `costOutput`             | integer     | Output tokens consumed. |
| `costCacheHit`           | integer     | Cache read tokens. |
| `durationMs`             | integer     | Total execution duration in milliseconds. |

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
