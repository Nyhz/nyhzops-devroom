# Prompt Architecture

Implementation: `src/control/prompt-builder.ts` (pure prompt builders, no I/O), `src/control/assets/cli-builder.ts` (CLI arg assembly), `src/control/assets/prompts/` (asset system prompts as `.md` files).

## Prompt Assembly

All mission prompts are built by pure functions exported from `prompt-builder.ts`. Each function takes a typed input struct and returns a string — no database access, no file I/O. Three mission variants:

1. **Standard combat** → `buildStandardCombatPrompt()` — standalone missions.
2. **Campaign combat** → `buildCampaignCombatPrompt()` — missions inside a campaign phase.
3. **Recon** → `buildReconPrompt()` — read-only scouting, no worktree.

Retry variants are also built by `prompt-builder.ts` (see Retry Prompts below). OVERSEER and QUARTERMASTER prompts likewise live there.

Asset CLI arguments (model, max-turns, effort, `--append-system-prompt`, skills, MCP servers) are assembled by `buildClaudeArgs()` in `src/control/assets/cli-builder.ts`. Every `claude` invocation receives `--print --dangerously-skip-permissions`. Stream-json output also gets `--verbose`.

## Asset System Prompts

Asset system prompts are stored as `.md` files under `src/control/assets/prompts/`, divided into two subdirectories:

- `combat/` — mission assets: `operative.md`, `vanguard.md`, `intel.md`.
- `system/` — infrastructure assets: `overseer.md`, `quartermaster.md`, `strategist.md`.

These files are the source of truth for each asset's identity, specialty, domain conventions, and discipline rules. They are passed to the Claude Code CLI via `--append-system-prompt`. System assets (`OVERSEER`, `QUARTERMASTER`, `STRATEGIST`) receive their system prompt alone. Combat assets receive the Rules of Engagement prepended, then the asset system prompt.

## Rules of Engagement

Stored as a single row in the `settings` table under key `rules_of_engagement`. The current default lives in `src/lib/settings/default-rules-of-engagement.ts` as `DEFAULT_RULES_OF_ENGAGEMENT` — used only for seeding and upgrade detection at runtime; the live value is always the settings row.

Composed onto every combat asset system prompt by `buildClaudeArgs()` — **only when `isSystem === 0`**. System assets (OVERSEER, QUARTERMASTER, STRATEGIST) are never prefixed.

The RoE text contains a `{{GATE_MANIFEST}}` placeholder. `composeRulesOfEngagement()` in `prompt-builder.ts` substitutes it with the battlefield's current gate command set (build / test / lint / typecheck) before the system prompt is passed to the CLI. Gates marked unavailable render as `(unavailable — skip)`.

Key rules in the current RoE:

1. **MISSION SCOPE IS ABSOLUTE** — execute exactly what the briefing describes, nothing more. Report out-of-scope issues in the debrief.
2. **WORKTREE BOUNDARY** — operate inside the assigned worktree path only. Recon exception: repo root, read-only.
3. **GATE AWARENESS** — CONTROL runs the gate manifest after exit; failure burns an attempt. Run gates yourself before emitting the debrief.
4. **COMMIT DISCIPLINE** — clear, conventional commit messages; only mission-related files.
5. **MATCH EXISTING PATTERNS** — follow established conventions; CLAUDE.md wins over ambient patterns.
6. **NO SPECULATIVE ABSTRACTION** — YAGNI; three similar lines beat a premature generic.
7. **SPEED AND PRECISION** — minimal file reads, surgical edits.
8. **VERIFY BEFORE DEBRIEF** — run type-check and relevant tests before exiting.
9. **DEBRIEF FORMAT** — final assistant message must be a single `<DEBRIEF>...</DEBRIEF>` block; malformed or missing blocks fail the attempt.
10. **REPORT, DON'T FIX** — out-of-scope issues go under nextActions, not silently repaired.
11. **NO AUTONOMOUS ABORT** — if the mission is impossible, say so in openQuestions, still emit the debrief, still stop.

The FINAL STEP CHECKLIST appears at both the top and bottom of the RoE: (1) git add + git commit, (2) emit `<DEBRIEF>` block, (3) stop.

Edited via the RULES OF ENGAGEMENT tab on `/assets`.

## Standard Combat Prompt

Built by `buildStandardCombatPrompt()`. Three sections in order:

```
{BATTLEFIELD_CLAUDE_MD}

## Mission Briefing

{briefing}

## Workspace

{workspace}
```

`BATTLEFIELD_CLAUDE_MD` is read from disk by the caller and placed first — static content for prompt cache efficiency. The workspace section contains the worktree path, worktree status, and main repository path.

The asset system prompt (with RoE prepended) is passed as `--append-system-prompt` to the CLI, not embedded in the prompt text.

## Campaign Combat Prompt

Built by `buildCampaignCombatPrompt()`. Adds a `## Campaign Context` section and phase debrief history:

```
{BATTLEFIELD_CLAUDE_MD}

## Mission Briefing

{briefing}

## Campaign Context

Operation: {operationName}
Phase: {phaseName}

## Previous Phase Results

{previousPhaseDebriefs}    ← prose summaries from prior phases, separated by ---
                            "_No previous phases._" when first phase

## Workspace

{workspace}
```

Previous phase debriefs are deterministically composed by `src/control/campaign/debrief.ts` from mission debrief structured fields — no LLM call. Each entry is injected verbatim under `## Previous Phase Results`, separated by `---` if multiple.

## Recon Prompt

Built by `buildReconPrompt()`. Recon missions run in the repo root with no worktree — there is no workspace section. An `## Operating Boundary` section enforces read-only behavior:

```
{BATTLEFIELD_CLAUDE_MD}

## Recon Briefing

{briefing}

## Operating Boundary

You are operating in read-only mode inside the repository root: {repoRootPath}
You may not write, edit, delete, or move any files. You are producing a prose report only.
CONTROL verifies the working tree after exit — any change reverts the tree and flags your mission.
```

## Retry Prompts

When gates fail, CONTROL injects a retry prompt into the next session via `--resume`. Two variants:

**Deterministic retry** (attempts 2 and 3 after gate failure) — built by `buildDeterministicRetryPrompt()`:

```
OVERSEER REVIEW FEEDBACK (Retry {retryNumber})
========================================
Gates failed. Output:
{gateStderr}

Please fix the gate failures. Your previous session context is preserved.
```

**OVERSEER-redirected retry** (attempt 4, after OVERSEER issues a `redirect` verdict) — built by `buildOverseerRedirectPrompt()`:

```
OVERSEER REDIRECT (Retry {retryNumber})
========================================
The Overseer has reviewed your attempts and reframed the approach.

{newPrompt}

Your previous session context is preserved.
```

The OVERSEER authors the `newPrompt` content during the consult (see OVERSEER Prompts below). Session continuity across all retries is preserved via `--resume`.

## OVERSEER Prompts

OVERSEER is invoked by CONTROL for two narrow tasks. Both prompts are built by functions in `prompt-builder.ts`. The OVERSEER system prompt (`src/control/assets/prompts/system/overseer.md`) instructs it to respond with JSON only, use no tools, and never decide whether a mission should continue.

### Exit Classification

Built by `buildOverseerClassificationPrompt()`. Used when a subprocess exits with an ambiguous code.

The prompt provides: exit code, raw stderr, and the last ~2000 chars of stdout. It asks OVERSEER to classify the exit and respond with JSON:

```json
{
  "category": "INFRASTRUCTURE" | "AGENT_FAILURE" | "NEEDS_COMMANDER",
  "reasoning": "<one sentence>"
}
```

OVERSEER does not judge the quality of the work — only the nature of the exit.

### Consult (Gate Failure After Retries)

Built by `buildOverseerConsultPrompt()`. Used when a combat asset has exhausted deterministic retries. Also used for recon retry budget exhaustion (in which case `gateStderr` and `finalDiff` are `null` and those sections are omitted).

The prompt provides: mission briefing, attempt history (one pre-formatted line per attempt), last gate stderr (if applicable), final diff (if applicable), and a CLAUDE.md excerpt. OVERSEER chooses between redirect and escalate:

```json
{
  "verdict": "redirect" | "escalate",
  "reasoning": "<explanation>",
  "redirect": "<reframed prompt for attempt 4>",   // present when verdict=redirect
  "escalate": "<specific question for Commander>"  // present when verdict=escalate
}
```

OVERSEER must not output `"abort"` — the Commander decides whether a mission continues.

## QUARTERMASTER Conflict Resolution Prompt

Built by `buildQuartermasterPrompt()`. Used when a worktree rebase produces merge conflicts. Implementation: `src/control/merge/quartermaster.ts`.

The prompt provides: mission briefing, mission debrief, conflict diff (with `<<<<<<<`/`=======`/`>>>>>>>` markers), git log in both directions (`source..target` and `target..source`), and a CLAUDE.md excerpt. The QUARTERMASTER system prompt (`src/control/assets/prompts/system/quartermaster.md`) gives it authority to edit conflicted files, `git add`, and produce exactly one commit. It may NOT run tests or builds, may NOT make new changes beyond conflict resolution, and gets one shot with a ten-minute hard timeout.

After committing the resolution, QUARTERMASTER emits a short `<DEBRIEF>...</DEBRIEF>` block and stops. CONTROL re-runs the full gate suite on the resolved state.

Prompt structure:

```
You are the QUARTERMASTER. A worktree merge produced conflicts. Resolve them or
escalate to the Commander with a specific question.

MISSION BRIEFING:
{briefing}

MISSION DEBRIEF:
{debrief}

CONFLICT DIFF:
{conflictDiff}

LOG (source..target):
{logSourceToTarget}

LOG (target..source):
{logTargetToSource}

PROJECT CONVENTIONS:
{claudeMdExcerpt}

ORDERS: resolve the conflicts with commits that preserve both the mission intent
and the target branch history, or emit an escalation with a precise question for
the Commander.
```

## Debrief Format

Documented in `src/control/debrief/schema.ts`. CONTROL parses the `<DEBRIEF>...</DEBRIEF>` block emitted by combat assets and validates it against `DebriefSchema.safeParse()`. The structured fields:

```json
{
  "summary": "one-sentence outcome, Commander-facing",
  "commits": ["commit hash or message strings"],
  "files_touched": ["path/to/file.ts"],
  "confidence": "high" | "medium" | "low" | "unknown",
  "open_questions": [
    {
      "title": "short label",
      "description": "prose explanation",
      "severity": "low" | "medium" | "high"
    }
  ]
}
```

`open_questions` may be an empty array. When parsing fails, CONTROL falls back to synthesizing a debrief from git state (diff stat, commit list).

The RoE instructs combat assets to write summary, changes, risks, nextActions, and openQuestions as prose fields inside the `<DEBRIEF>` block. CONTROL normalizes this into the structured schema.

## Phase Debrief Generation

Phase debriefs are generated deterministically by `src/control/campaign/debrief.ts` — no LLM call. CONTROL composes them from the structured `Debrief` fields of every mission in the phase (summary, files_touched, confidence, open_questions). The result is injected into the next phase's prompt under `## Previous Phase Results`.

## Combat Asset System Prompts

### OPERATIVE (`src/control/assets/prompts/combat/operative.md`)

General backend, fullstack, refactoring, and test-writing. Specialties: server-side logic (route handlers, Server Actions, DB access, services), full-stack features, refactors, and test coverage. Convention highlights: TypeScript strict mode, established ORM patterns only, prefer Server Actions for mutations, tests test behavior not implementation. Notes that the RoE is prepended at runtime by CONTROL.

### VANGUARD (`src/control/assets/prompts/combat/vanguard.md`)

Frontend — UI, styling, UX, client-side interaction. Specialties: React components, Tailwind styling, UX polish (loading/error/empty states, keyboard affordances), accessibility, real-time UI (Socket.IO subscribers, live terminals). Convention highlights: Server Components by default, Tailwind only (no inline styles, no CSS modules), tactical-operations-center aesthetic (dark/monospace/green+amber/no decoration), use `cn()` for conditional classes. Notes that the RoE is prepended at runtime by CONTROL.

### INTEL (`src/control/assets/prompts/combat/intel.md`)

Docs, analysis, specs, and bootstrap. Writing-heavy work. Specialties: authoring and maintaining CLAUDE.md, SPEC.md, READMEs, design docs, plan files; codebase analysis; battlefield bootstrap; recon missions (read-only scouting — debrief is the deliverable). Convention highlights: tactical-operations-center voice, mirror existing doc prose style, cite files and line regions when analyzing, do not invent facts. Notes that the RoE is prepended at runtime by CONTROL, and that the read-only boundary is especially strict for recon.

## STRATEGIST — Briefing Prompt

Used for interactive campaign planning sessions. Implementation: `src/lib/briefing/briefing-prompt.ts`.

The system prompt (`src/control/assets/prompts/system/strategist.md`) is assembled alongside battlefield context by `buildBriefingSystemPrompt()`, which concatenates: the STRATEGIST identity and planning contract (`BRIEFING_CONTRACT`), CLAUDE.md (truncated to `CLAUDE_MD_CAP`), SPEC.md (truncated to `SPEC_MD_CAP`), and the available mission asset roster. This stable block is passed as `--append-system-prompt` for cache efficiency.

Campaign-specific data (name, objective, battlefield codename, Commander message) is delivered separately via `buildBriefingUserMessage()`, keeping the stable system prompt cacheable across briefing sessions.

Key STRATEGIST rules:
- This is a **conversation** — each response stops and waits for Commander reply. No tools unless explicitly asked.
- Ask 2–3 clarifying questions per turn to understand the objective.
- Phase execution is sequential; missions within a phase run in parallel unless linked by `dependsOn`.
- Mission briefings must be self-contained and detailed — the asset has no context beyond what's written.
- Mission types: `"combat"` (default — modifies files, must produce a commit, gates checked, merged by Quartermaster) or `"recon"` (read-only, prose debrief, no commit, no gates, no merge). Prefer recon for investigative verbs; prefer combat when the briefing asks for writes, edits, fixes, or implementations.
- Recon does not chain — recon missions cannot depend on other recon missions.
- On `GENERATE PLAN`, respond with **only** a raw JSON object — no preamble, no markdown fences, no trailing commentary.

The GENERATE PLAN JSON schema:

```json
{
  "summary": "Brief campaign summary",
  "phases": [
    {
      "name": "Phase name",
      "objective": "Phase objective",
      "missions": [
        {
          "title": "Mission title",
          "briefing": "Self-contained detailed briefing in plain text — no code fences",
          "assetCodename": "OPERATIVE",
          "priority": "routine",
          "type": "combat",
          "dependsOn": ["Other mission title in same phase"]
        }
      ]
    }
  ]
}
```

## GENERAL — Admin Prompt

Used for diagnostics, architecture discussion, and system administration queries. Implementation: `src/lib/general/general-prompt.ts` (`buildGeneralPrompt()`).

GENERAL is the Commander's senior strategic advisor and right hand — not a campaign planner. The prompt assembles: GENERAL identity and capabilities, campaign/briefing vocabulary with the active mission asset roster, and (if opened from a battlefield page) the active battlefield context (codename, repo path, default branch).

Capabilities: query the DEVROOM SQLite database directly, read battlefield code and git history, diagnose stuck or failed missions by reading their logs, workshop campaign briefings, suggest DEVROOM improvements, and general strategic discussion.

Personality: addresses the user as Commander, military brevity, confident and opinionated when asked for recommendations, tactical language used naturally without overdoing it.

## Cache Optimization

CLAUDE.md is read from disk and placed first in all mission prompts — the largest static block, maximizing cache hits across consecutive turns. Asset system prompts are stable and passed via `--append-system-prompt`. Campaign context and mission briefing follow. In the STRATEGIST briefing, volatile data (campaign name, objective, Commander message) is separated into the user-turn message so the stable system prompt block remains cacheable across the full briefing session. Target 90%+ cache hit rate. See `.devroom/server-and-sockets.md` for prompt cache details.
