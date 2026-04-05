# Prompt Architecture

Implementation: `src/lib/orchestrator/prompt-builder.ts` (main entry), `scripts/seed.ts` (asset system prompts).

## Prompt Assembly

All mission prompts are built by `buildPrompt()` which routes to one of three builders:

1. **Bootstrap** → `buildBootstrapPrompt()` — battlefield initialization
2. **Campaign mission** → `buildCampaignMissionPrompt()` — missions within a campaign
3. **Standard mission** → inline in `buildPrompt()` — standalone missions

The executor (`executor.ts`) then appends additional sections: workspace context, retry feedback (if applicable), and previous mission context (for session continuations).

Asset CLI arguments (model, max-turns, effort, system prompt, skills, MCP servers) are built separately by `buildAssetCliArgs()` in `asset-cli.ts` and passed as CLI flags — not embedded in the prompt.

## Rules of Engagement

Prepended to all 5 mission asset system prompts (`OPERATIVE`, `VANGUARD`, `ARCHITECT`, `ASSERT`, `INTEL`). Defined in `scripts/seed.ts` as `RULES_OF_ENGAGEMENT`. System assets (`GENERAL`, `OVERSEER`, `QUARTERMASTER`) have their own standalone system prompts.

```
You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more.
   Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice.
   If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief
   under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need.
   Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages.
   Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)
```

Each mission asset appends its own specialty line after the rules. Example for OPERATIVE: `"You are a general-purpose engineer. Backend, infrastructure, APIs, data layer — you handle whatever the mission requires."`

## Standard Mission

Built by `buildPrompt()` for non-campaign, non-bootstrap missions. Two sections separated by `---`:

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC (from disk, cached)

---

## Mission Briefing

**Mission**: {title}
**Battlefield**: {codename}
**Priority**: {priority}

{briefing}                                         ← DYNAMIC
```

The executor then appends a `## Workspace` section with the working directory path, worktree status, and main repository path.

Note: The asset system prompt (including Rules of Engagement) is passed as a CLI flag (`--system-prompt`), not embedded in the prompt text.

## Campaign Mission

Built by `buildCampaignMissionPrompt()`. Richer context than standard missions:

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC (from disk)

---

## Campaign Context

**Operation**: {campaign.name}
**Objective**: {campaign.objective}
**Phase**: {phase.name} ({n} of {total})

### Previous Phase Results
{previousPhaseMissionDebriefs}                     ← actual mission debriefs from prior phases
  #### Phase {n}: {name}
  **{missionTitle}** ({status}):
  {missionDebrief}

### Other Missions in This Phase                   ← sibling missions (title + status)
- {title} ({status})

### Upcoming Phases                                ← future phases with mission titles
**Phase {n}: {name}**
  - {missionTitle}

*Do not recommend actions that are already covered by missions listed above.*

---

## Mission Briefing

**Mission**: {title}
**Priority**: {priority}

{briefing}                                         ← DYNAMIC
```

The executor appends: `## Workspace` section, retry feedback (if retrying), and previous mission context (if session continuation).

## Retry Feedback Injection

When the Overseer issues a `retry` verdict, the review handler stores a `[RETRY_FEEDBACK]` log. On the next execution attempt, the executor reads this log and appends it to the prompt:

```
OVERSEER REVIEW FEEDBACK (Retry {n})
========================================
The Overseer reviewed your previous work and found these concerns:
{retryFeedback.answer}

Overseer's reasoning: {retryFeedback.reasoning}

Please address these concerns. Your previous session context is preserved.
You have access to all changes you made previously.

Original briefing:
{mission.briefing}
```

Implementation: `executor.ts` lines 196–206. Feedback is stored in the `overseerLogs` table with question prefix `[RETRY_FEEDBACK]`.

## Overseer Debrief Review Prompt

Used by the Overseer to evaluate mission debriefs. Implementation: `src/lib/overseer/debrief-reviewer.ts`.

The Overseer spawns as a `--print` process (max 2 turns, JSON output) with structured JSON schema for the verdict.

```
You are the Overseer, reviewing a mission debrief for quality and completeness.

MISSION BRIEFING (what was requested):
{missionBriefing}

MISSION DEBRIEF (what was done):
{missionDebrief}

---

PROJECT CONVENTIONS:                               ← CLAUDE.md content (truncated to 3000 chars)
{claudeMd}

---

FILES CHANGED:                                     ← git diff --stat
{gitDiffStat}

---

CODE CHANGES:                                      ← git diff (truncated to 3000 chars)
{gitDiff}

---

Review the debrief and assess:
1. Did the agent complete what was requested in the briefing?
2. Are there any warnings, risks, or concerns mentioned?
3. Are there indicators of test failures or incomplete work?
4. Did the agent make unexpected decisions that deviate from conventions?
5. Do the code changes match what the debrief claims?

Rules:
- Most debriefs are satisfactory. Only flag genuine issues.
- Minor style differences are not concerns.
- "retry" only if the agent clearly failed to complete the task.
- "escalate" only if there's a significant risk the Commander should know about.

IMPORTANT: Do NOT use any tools. Do NOT read files. Do NOT run commands.
You have all the information you need above. Analyze the text and respond
with your assessment only.
```

Output schema: `{ verdict: 'approve' | 'retry' | 'escalate', concerns: string[], reasoning: string }`.

## Overseer Runtime Prompt (askOverseer)

Used for real-time stall detection during mission execution. Implementation: `src/lib/overseer/overseer.ts`.

When the executor detects 2+ minutes of silence with an assistant message but no tool use, it calls `askOverseer()` which spawns the Overseer with this system prompt:

```
You are the OVERSEER of DEVROOM operations, serving under the Commander.
Your role is to make tactical decisions for AI agents executing missions.

RULES:
- Be decisive. Never hedge or ask for more information.
- Align decisions with the project's conventions (CLAUDE.md provided).
- Align with the mission briefing objectives.
- Choose the simplest approach that satisfies the requirements.
- If the question involves a MAJOR architectural change that contradicts
  CLAUDE.md or the mission briefing, set escalate=true.
- If you're genuinely uncertain between two valid approaches, set
  confidence='low' and escalate=true.
- Keep answers concise — the agent is waiting.
- Log your reasoning clearly — the Commander reviews your decisions.

Respond ONLY with a JSON object:
{
  "answer": "Your decisive response to the agent",
  "reasoning": "Why you chose this approach (1-2 sentences)",
  "escalate": false,
  "confidence": "high"
}
```

The dynamic prompt includes: CLAUDE.md, mission briefing, campaign context (if available), recent agent output (~2000 chars), the agent's question, and Overseer history (for consistency).

## Quartermaster Conflict Resolution Prompt

Used by the Quartermaster to resolve merge conflicts. Implementation: `src/lib/quartermaster/conflict-resolver.ts`.

Spawns the QUARTERMASTER system asset via Claude Code CLI (`--print`, max 20 turns, 10-minute timeout).

```
{BATTLEFIELD_CLAUDE_MD}                            ← if available

---

## Merge Conflict Resolution

Branch `{sourceBranch}` into `{targetBranch}`.

### Mission Briefing
{mission.briefing}

### Mission Debrief
{mission.debrief}

### What the mission changed
{branchLog}                                        ← git log --oneline target..source

### What landed upstream
{upstreamLog}                                      ← git log --oneline source..target

### Conflict Diff
{conflictDiff}                                     ← git diff (with conflict markers)

### Orders
1. Analyze both sides of each conflict.
2. Resolve preserving both intents.
3. If incompatible, prefer source (new work). Note losses.
4. Run tests if a test command is available.
5. Commit: "Merge {sourceBranch}: resolve conflicts"
6. Report to the Commander.
```

## Phase Debrief Generation

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC

---

## Phase Debrief Generation

**Operation**: {campaign.name}
**Phase**: {phase.name} ({n} of {total})

### Mission Debriefs
{allMissionDebriefs}

### Orders
Produce a concise debrief addressed to "Commander":
1. What was accomplished.
2. Issues or partial failures.
3. Readiness for next phase.
4. Recommended adjustments.
5. Recommended next actions for the Commander (use heading: ## Recommended Next Actions)

Under 300 words. Military briefing tone — factual, precise, actionable.
```

## Cache Optimization

Static top, dynamic bottom. CLAUDE.md is read from disk and placed first in all prompts. Asset system prompts are passed via CLI `--system-prompt` flag. Campaign context and mission briefing follow. Target 90%+ cache hit rate. See also `.devroom/server-and-sockets.md` for prompt cache details.

## Bootstrap Prompt

Used when generating CLAUDE.md + SPEC.md for a new battlefield. Implementation: `buildBootstrapPrompt()` in `prompt-builder.ts`.

```
## Battlefield Bootstrap — Intelligence Generation

You are initializing a new battlefield for the DEVROOM agent orchestrator.
Your task is to analyze this repository and the Commander's briefing, then
generate two comprehensive documents.

### Commander's Briefing

{battlefield.initialBriefing}

### Repository Analysis

Analyze the repository at the current working directory. Examine:
- File structure, language, frameworks, dependencies
- Existing configuration files (package.json, tsconfig, etc.)
- Code conventions, patterns, architecture
- Database schema if present
- Test setup and coverage tooling
- CI/CD configuration
- Any existing documentation

### Orders

Create TWO files in the repository root using your Write tool:

1. **CLAUDE.md** should include:
   - Project overview and purpose
   - Tech stack with rationale
   - Project structure (actual, from repo analysis)
   - Domain model (entities, relationships, database schema)
   - Coding rules and conventions (inferred from existing code + Commander's briefing)
   - Key patterns (API structure, state management, error handling)
   - Definition of Done checklist
   - Environment variables and configuration
   - Scripts / commands reference

2. **SPEC.md** should include:
   - Detailed feature specifications for every major feature
   - Screen/page descriptions with layout and behavior
   - User flows and workflows
   - API endpoint specifications if applicable
   - Business logic rules
   - Error handling specifications
   - Edge cases and constraints
   - Future features / backlog if mentioned in the briefing

Both documents should be written as if they are the authoritative reference
for any developer (or AI agent) working on this project. Be thorough,
precise, and specific to this actual codebase — not generic.

**IMPORTANT:** Write the files using your Write tool. Do NOT commit them.
The Commander will review and approve before committing.
```

## STRATEGIST — Briefing Prompt

Used for interactive campaign planning sessions. Implementation: `src/lib/briefing/briefing-prompt.ts`.

The STRATEGIST briefing persona is a "campaign planning and coordination specialist." It receives: campaign name, objective, battlefield codename, CLAUDE.md (up to 8000 chars), SPEC.md (up to 8000 chars), and a list of available active assets.

Key rules injected:
- This is a **conversation** — each response stops and waits for Commander reply. No tool use unless asked.
- Ask clarifying questions (2–3 per turn) to understand the objective.
- On `GENERATE PLAN`, output JSON: `{ summary, phases: [{ name, objective, missions: [{ title, briefing, assetCodename, priority, dependsOn }] }] }`.
- `dependsOn` references mission titles within the same phase only.
- Each mission briefing must be self-contained — the asset has no context beyond what's written.

## GENERAL — Admin Prompt

Used for diagnostics, architecture discussion, and system administration queries. Implementation: `src/lib/general/general-prompt.ts`.

The GENERAL admin persona is a "senior strategic advisor and administrator of NYHZ OPS — DEVROOM." Has full system access: database queries, battlefield repos, git history, mission logs. Handles `/sitrep`, `/diagnose`, and general operational queries. Distinct from the briefing prompt — this persona has tool access and acts as the Commander's right hand.

If opened from a battlefield page, the prompt includes active battlefield context (codename, repo path, default branch).
