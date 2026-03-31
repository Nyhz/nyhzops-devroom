# Prompt Architecture

## Standard Mission

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC (cached)

---

{ASSET_SYSTEM_PROMPT}                              ← SEMI-STATIC

---

## Mission Briefing

**Mission**: {title}
**Battlefield**: {codename}
**Priority**: {priority}

{briefing}                                         ← DYNAMIC

---

## Operational Parameters

- Execute the task described above.
- Commit with clear, descriptive messages.
- Upon completion, provide a debrief addressed to the Commander.
  Structure your debrief with these sections:
  - What was done
  - What changed (files modified)
  - Risks or concerns
  - ## Recommended Next Actions (bullet list of concrete follow-up tasks, if any)
```

## Campaign Mission

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC

---

{ASSET_SYSTEM_PROMPT}                              ← SEMI-STATIC

---

## Campaign Context

**Operation**: {campaign.name}
**Objective**: {campaign.objective}
**Phase**: {phase.name} ({n} of {total})

### Previous Phase Results
{previousPhaseMissionDebriefs}                     ← SEMI-DYNAMIC

---

## Mission Briefing

**Mission**: {title}
**Priority**: {priority}

{briefing}                                         ← DYNAMIC

---

## Operational Parameters

- Execute the task above.
- Other missions run in parallel. Stay within your assigned scope.
- Commit with messages prefixed by mission title.
- Provide debrief addressed to the Commander.
  Structure your debrief with these sections:
  - What was done
  - What changed (files modified)
  - Risks or concerns
  - ## Recommended Next Actions (bullet list of concrete follow-up tasks, if any)
```

## Conflict Resolution

```
{BATTLEFIELD_CLAUDE_MD}                            ← STATIC

---

## Merge Conflict Resolution

Branch `{source}` into `{target}`.

### Context
{mission.debrief}

### Conflicts
{gitDiffWithMarkers}

### Orders
1. Analyze both sides.
2. Resolve preserving both intents.
3. If incompatible, prefer source (new work). Note losses.
4. Run tests.
5. Commit: "Merge {source}: resolve conflicts"
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

Static top, dynamic bottom. 2000-token CLAUDE.md + 500-token asset prompt = 2500 tokens cached. Target 90%+ hit rate. See also `.devroom/server-and-sockets.md` for prompt cache details.

## Bootstrap Prompt

Used when generating CLAUDE.md + SPEC.md for a new battlefield:

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

**CLAUDE.md** should include:
- Project overview and purpose
- Tech stack with rationale
- Project structure (actual, from repo analysis)
- Domain model (entities, relationships, database schema)
- Coding rules and conventions (inferred from existing code + Commander's briefing)
- Key patterns (API structure, state management, error handling)
- Definition of Done checklist
- Environment variables and configuration
- Scripts / commands reference

**SPEC.md** should include:
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

Address the Commander in any commentary. Use military briefing tone in
meta-commentary only, not in the technical documentation itself.

Write the files using your Write tool. Do NOT commit them.
```

## GENERAL — Briefing Prompt

Used for interactive campaign planning sessions. Implementation: `src/lib/briefing/briefing-prompt.ts`.

The GENERAL briefing persona is a "campaign planning and coordination specialist" that helps the Commander design multi-phase operations. It outputs a JSON plan with phases, missions, dependencies, and asset assignments.

## GENERAL — Admin Prompt

Used for diagnostics, architecture discussion, and system administration queries. Implementation: `src/lib/general/general-prompt.ts`.

A second GENERAL persona: "senior strategic advisor and administrator of NYHZ OPS — DEVROOM." Handles `/sitrep`, `/diagnose`, and general operational queries. Distinct from the briefing prompt.
