# Missions, Assets & Dossiers

## Mission Lifecycle

```
STANDBY → QUEUED → DEPLOYING → IN COMBAT → REVIEWING → APPROVED → MERGING → ACCOMPLISHED
                                                     → COMPROMISED (execution-failed / timeout / review-failed / escalated / merge-failed)
                                          → ABANDONED (Commander cancel)
```

| Status        | Color | Meaning |
|---------------|-------|---------|
| STANDBY       | dim   | Created, not yet queued. |
| QUEUED        | muted | Waiting for an available agent slot. |
| DEPLOYING     | amber | Setting up worktree / preparing process. |
| IN COMBAT     | amber | Claude Code process actively running. |
| REVIEWING     | blue  | Overseer reviewing debrief quality. |
| APPROVED      | green | Overseer approved, awaiting merge. |
| MERGING       | amber | Quartermaster merging worktree into target branch. |
| ACCOMPLISHED  | green | Completed and merged successfully. |
| COMPROMISED   | red   | Failed — `compromiseReason` field records why. |
| ABANDONED     | dim   | Cancelled by Commander or interrupted. |

## Creating a Mission

**Quick deploy** (battlefield overview): textarea + asset + SAVE/SAVE & DEPLOY.

**Full form** (modal or page): title, briefing (markdown + image paste), priority, asset. Worktrees are created automatically by the executor for all non-bootstrap missions — no user toggle.

## Load Dossier

The `<DossierSelector />` component lets the Commander pick a saved dossier template from the database. If the dossier has `{{variable}}` placeholders, a form appears to fill in values. The interpolated template populates the briefing textarea and the recommended asset is auto-selected. See Dossiers section below.

## Execution Flow

In `executor.ts` when the orchestrator dequeues a mission:

1. **Status → DEPLOYING**. Emit events via `emitStatusChange()`.
2. **Auth check**: `checkCliAuth()` verifies Claude Code CLI can authenticate. On failure, the mission is re-queued and the orchestrator pauses with a critical escalation to Commander.
3. **Worktree setup** (automatic for non-bootstrap missions):
   - Branch: `devroom/{codename}/{mission-id-short}`.
   - Create worktree via simple-git (`createWorktree()`).
   - `cwd` = worktree path.
   - If mission already has a `worktreeBranch` (e.g. retry from compromised), the existing worktree is reused.
4. Bootstrap missions: `cwd` = repo root (no worktree).
5. **Build prompt** via `prompt-builder.ts` (see `.devroom/spec-prompts.md`):
   - Includes campaign context if this is a campaign mission.
   - Includes Overseer retry feedback if `reviewAttempts > 0` (concerns from previous review).
   - Includes previous mission debrief for continued missions (`sessionId` link).
   - Appends workspace context (worktree path, repo root).
6. **Build CLI args** via `asset-cli.ts` — model, max-turns, effort, system prompt, skills (plugin dirs), MCP servers.
7. **Spawn Claude Code** with AbortController. Each mission gets an isolated `HOME` directory (`/tmp/claude-config/{missionId}`) to prevent concurrent config corruption. Auth credentials are extracted from macOS Keychain.
8. **Hard timeout**: 30-minute timer. Kills the process if it hangs indefinitely.
9. **Status → IN COMBAT**.
10. **Stream stdout** via `StreamParser`:
    - Parse each JSON line.
    - Emit `mission:log` to Socket.IO room.
    - Store in `missionLogs`.
    - Track tokens incrementally.
    - Track debrief candidates (assistant messages matching debrief patterns).
11. **Stall detection** (every 5 seconds):
    - If 2+ minutes of silence after an assistant message with no tool use, the Overseer is consulted.
    - `askOverseer()` evaluates whether the agent is stuck and provides an answer via `stdin`.
    - Decisions are logged to `overseerLogs`. If confidence is low, Commander is notified via Telegram escalation.
12. **On process close**:
    - Calculate duration.
    - Parse final token/cost usage.
    - Select best debrief (prefers debrief-pattern matches from comms over final result).
    - If error: **Status → COMPROMISED** with `compromiseReason: 'execution-failed'`.
    - If success: **Status → REVIEWING**. Trigger Overseer review asynchronously.
    - If rate limited: **Status → QUEUED** for retry. Throws `RateLimitError` for orchestrator handling.
    - If aborted by Commander: **Status → ABANDONED**. Worktree cleaned up.
    - If timed out: **Status → COMPROMISED** with `compromiseReason: 'timeout'`. Branch preserved.

## Overseer Review

After execution completes successfully, the mission enters `reviewing` status and `runOverseerReview()` is called asynchronously (non-blocking — the executor slot is released).

Implementation: `src/lib/overseer/review-handler.ts`, `src/lib/overseer/debrief-reviewer.ts`, `src/lib/overseer/review-parser.ts`.

### Review Process

1. Load mission and battlefield from DB.
2. Read CLAUDE.md for project conventions context.
3. Fetch git diff (`--stat` and full diff) between target branch and mission's worktree branch.
4. Build review prompt with: mission briefing, debrief text, CLAUDE.md excerpt, diff stat, code diff.
5. Spawn OVERSEER system asset via `claude --print` with JSON schema output.
6. Parse the structured verdict via `review-parser.ts`.

### Verdict Handling

| Verdict   | Action |
|-----------|--------|
| `approve` | **Status → APPROVED**. Trigger Quartermaster for merge. |
| `retry`   | Re-queue mission with Overseer feedback appended to prompt. Increment `reviewAttempts`. |
| `escalate`| **Status → COMPROMISED** with `compromiseReason: 'escalated'`. Telegram alert to Commander. |

### Retry Limits

- Successful missions (status was `reviewing`): up to **2 retries**.
- Compromised missions: up to **1 retry**.
- After exhausting retries: mission is marked `compromised` with `compromiseReason: 'review-failed'` and escalated.

### Review Assessment Criteria

The Overseer evaluates:
1. Did the agent complete what was requested in the briefing?
2. Are there warnings, risks, or concerns?
3. Are there indicators of test failures or incomplete work?
4. Did the agent make unexpected decisions that deviate from conventions?
5. Do the code changes match what the debrief claims?

## Quartermaster Merge

After the Overseer approves a mission (`status: approved`), the Quartermaster handles merging and cleanup.

Implementation: `src/lib/quartermaster/quartermaster.ts`, `src/lib/quartermaster/merge-executor.ts`, `src/lib/quartermaster/conflict-resolver.ts`.

### Merge Flow

1. **Non-worktree missions**: Skip merge, go directly to **ACCOMPLISHED**.
2. **Worktree missions**:
   - **Status → MERGING**.
   - `executeMerge()` merges the source branch into the target (default) branch.
   - On conflict: `conflict-resolver.ts` attempts automated resolution via QUARTERMASTER asset.
   - If merge retry is needed, `mergeRetryAt` timestamp is set on the mission.
   - On success: worktree cleaned up, **Status → ACCOMPLISHED**.
   - On failure: **Status → COMPROMISED** with `compromiseReason: 'merge-failed'`. Branch preserved for manual review. Critical escalation to Commander.
3. **Follow-up extraction**: After completion (success or failure), `extractAndSaveSuggestions()` parses the debrief for recommended next actions and saves them to the `followUpSuggestions` table. These appear as cards on the battlefield overview.
4. **Campaign notification**: If this is a campaign mission, notify the campaign executor via `onCampaignMissionComplete()`.

## Session Reuse

Completed missions store `sessionId`. Detail page shows:
- **[CONTINUE MISSION]**: new mission reusing session (context preserved). Previous mission's debrief is injected into the prompt for context since session resume doesn't work across worktrees.
- **[TACTICAL OVERRIDE]**: edit briefing and redeploy as a new mission with modified parameters.

## Debrief Generation

The full Claude Code result is stored as the mission debrief. The executor tracks debrief candidates throughout the stream — assistant messages matching debrief patterns (e.g., `## DEBRIEF`, `## What Was Done`, `## Summary`). The best candidate (longest matching message) is preferred over the final result, which may be a short acknowledgement. The Overseer reviews debrief quality but does not generate a separate summary. Written in Commander-addressed military briefing style.

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
│  [ABANDON]  [CONTINUE MISSION]  [TACTICAL OVERRIDE]         │
└──────────────────────────────────────────────────────────────┘
```

After completion: DEBRIEF section with Commander-addressed report.

---

## Assets

Assets are Claude Code agent profiles — a specialty, system prompt, model, and configuration. They are not singletons; multiple missions can use the same asset concurrently.

### Categories

**Mission assets** (`isSystem: 0`) — deployable agents assigned to missions by the Commander or campaign planner. Can be edited, toggled offline, or deleted.

**System assets** (`isSystem: 1`) — internal agents used by the orchestrator. Cannot be deleted or have their codename changed. Not directly assignable to missions.

### Default Roster (seeded)

| Codename       | Type    | Specialty                          | Model             |
|----------------|---------|------------------------------------|--------------------|
| OPERATIVE      | mission | Backend / general code             | claude-sonnet-4-6  |
| VANGUARD       | mission | Frontend engineering               | claude-sonnet-4-6  |
| ARCHITECT      | mission | System design, refactoring         | claude-sonnet-4-6  |
| ASSERT         | mission | Testing & QA                       | claude-sonnet-4-6  |
| INTEL          | mission | Docs, bootstrap, project intel     | claude-sonnet-4-6  |
| STRATEGIST     | system  | Campaign planning                  | claude-opus-4-6    |
| OVERSEER       | system  | Mission review — debrief verdicts   | claude-sonnet-4-6  |
| QUARTERMASTER  | system  | Merge & integration                | claude-sonnet-4-6  |

### Asset Fields

| Field            | Type         | Description |
|------------------|--------------|-------------|
| `codename`       | string       | Unique identifier (e.g. `OPERATIVE`). |
| `specialty`      | string       | Short description of the asset's focus area. |
| `systemPrompt`   | string       | Asset-specific system prompt. For mission assets the shared Rules of Engagement (from `settings.rules_of_engagement`) is prepended at runtime by `buildAssetCliArgs()`. |
| `model`          | string       | Claude model ID (e.g. `claude-sonnet-4-6`). |
| `status`         | string       | `active` or `offline`. |
| `skills`         | JSON string  | Array of Claude Code plugin skill identifiers (e.g. `["frontend-design@claude-plugins-official"]`). Resolved to `--plugin-dir` flags via `asset-cli.ts`. |
| `mcpServers`     | JSON string  | Array of MCP server configurations. Passed as `--mcp-config`. |
| `maxTurns`       | integer      | Maximum turns for Claude Code invocation (e.g. 100 for mission assets, 3 for STRATEGIST). |
| `effort`         | string       | Effort level: `low`, `medium`, `high`, or `max`. Passed as `--effort` flag. |
| `isSystem`       | integer      | `0` = mission asset, `1` = system asset. |
| `missionsCompleted` | integer   | Running count of completed missions. |

### Asset CLI Builder

`src/lib/orchestrator/asset-cli.ts` translates asset configuration into Claude Code CLI flags:

- `--model` from `asset.model`
- `--max-turns` from `asset.maxTurns` (dynamic per asset, not hardcoded)
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

### Status

- **active**: available, green dot.
- **offline**: disabled, gray dot.

Multiple missions can use the same asset concurrently (it's a profile, not a singleton).

---

## Mission Fields Reference

Key fields on the `missions` table relevant to the execution lifecycle:

| Field              | Type        | Description |
|--------------------|-------------|-------------|
| `status`           | string      | Current lifecycle status (see lifecycle diagram above). |
| `type`             | string      | `standard` or `bootstrap`. |
| `dependsOn`        | string      | Mission ID this mission depends on (for intra-phase ordering in campaigns). |
| `sessionId`        | string      | Claude Code session ID — enables session continuation. |
| `reviewAttempts`   | integer     | Number of Overseer review retry cycles completed. |
| `compromiseReason` | string      | Why the mission failed: `timeout`, `merge-failed`, `review-failed`, `execution-failed`, `escalated`. |
| `mergeRetryAt`     | integer     | Unix ms timestamp for scheduled merge retry. |
| `skillOverrides`   | JSON string | `{ added?: string[], removed?: string[] }` — per-mission skill modifications. |
| `worktreeBranch`   | string      | Git branch name for the mission's worktree. |
| `debrief`          | string      | Post-mission report text. |
| `costInput`        | integer     | Input tokens consumed. |
| `costOutput`       | integer     | Output tokens consumed. |
| `costCacheHit`     | integer     | Cache read tokens. |
| `durationMs`       | integer     | Total execution duration in milliseconds. |

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
