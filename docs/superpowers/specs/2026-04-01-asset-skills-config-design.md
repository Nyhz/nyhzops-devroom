# Asset Skills & MCP Configuration — Design Spec

**Date:** 2026-04-01
**Scope:** Per-asset skill/MCP configuration, host discovery, editable system prompts, campaign-level mission overrides

---

## 1. Asset Roster

### Mission Assets (assignable to missions)

| Asset | Specialty | Default Skills | Role |
|-------|-----------|---------------|------|
| VANGUARD | Frontend engineering | `frontend-design` | UI/component work |
| OPERATIVE | Backend / general code | — | API, logic, infrastructure |
| ARCHITECT | System design, refactoring | `simplify` | Structural changes, large refactors |
| ASSERT | Testing & QA | — | Test writing, coverage |
| INTEL | Docs, bootstrap, project intelligence | — | CLAUDE.md, SPEC.md, changelogs, bootstrap |

### System Assets (run automatically, not assignable)

| Asset | Specialty | Default Skills | Spawn Points |
|-------|-----------|---------------|-------------|
| GENERAL | Campaign planning | — | Briefing chat |
| OVERSEER | Review & evaluation | `code-review` | Debrief review, stall detection, phase failure decisions, phase/campaign debrief generation |
| QUARTERMASTER | Merge & integration | — | Conflict resolution |

### Replaces

- PATHFINDER → merged into INTEL
- WATCHDOG → merged into OVERSEER
- DISTILL → renamed to INTEL

---

## 2. Schema Changes

### Modified `assets` table — new columns

- **`skills`** — `TEXT`, nullable. JSON array of enabled skill IDs. Example: `["frontend-design@claude-plugins-official"]`. Null means no skills.
- **`mcpServers`** — `TEXT`, nullable. JSON object of MCP server configurations. Example: `{"telegram": {"command": "bun", "args": ["run", ...]}}`. Null means no MCPs.
- **`maxTurns`** — `INTEGER`, nullable. Per-asset default max turns. Defaults: 100 for mission assets, 5 for OVERSEER, 20 for QUARTERMASTER, 3 for GENERAL. Individual spawn points can override this in code when needed (e.g., OVERSEER stall detection forces `maxTurns: 1` regardless of asset config, since it's a single-turn decision). The asset value is the default; code-level overrides are for structural reasons, not preference.
- **`effort`** — `TEXT`, nullable. One of `low`, `medium`, `high`, `max`. Null uses CLI default.
- **`isSystem`** — `INTEGER`, default 0. 1 for system assets (OVERSEER, QUARTERMASTER, GENERAL). System assets cannot be deleted, toggled offline, or assigned to regular missions.

### Modified `missions` table — new column

- **`skillOverrides`** — `TEXT`, nullable. JSON object: `{ "added": ["skill-id"], "removed": ["skill-id"] }`. Null means use asset defaults unchanged. The executor merges: start with asset's `skills` array, remove entries in `removed`, append entries in `added`.

### Existing columns now wired

- **`assets.model`** — already exists, currently ignored by executor. Now passed via `--model` flag.
- **`assets.systemPrompt`** — already exists, currently injected into prompt text. Now passed via `--append-system-prompt` flag.

---

## 3. Skill & MCP Discovery

### On-demand scan with 5-minute cache

When the assets detail page or mission skill config panel is opened, the server scans the host system for available skills and MCPs.

### Scan sources

**Skills — `~/.claude/plugins/`:**
- Read `installed_plugins.json` for the plugin manifest
- For each enabled plugin, read skill definitions from the plugin's cached files
- Return: `{ id: "frontend-design@claude-plugins-official", name: "Frontend Design", pluginName: "claude-plugins-official", description: "..." }`

**MCP Servers — plugin configs + user settings:**
- Each plugin can define MCP servers in its configuration
- Also check `~/.claude/settings.json` for user-level MCP server definitions
- Return: `{ id: "telegram", name: "Telegram", command: "bun", args: [...], source: "telegram@claude-plugins-official" }`

### Cache

Server-side, in-memory. Stores scan result with timestamp. Re-scans if cache is older than 5 minutes. No DB storage.

### Server action

```typescript
export async function getAvailableSkillsAndMcps(): Promise<{
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
  cachedAt: number;
}>
```

---

## 4. Executor Changes

### Shared utility: `buildAssetCliArgs()`

A single function that all spawn points call to translate asset config into CLI flags:

```typescript
function buildAssetCliArgs(
  asset: Asset,
  skillOverrides?: { added?: string[]; removed?: string[] } | null,
): string[]
```

Returns an array of CLI arguments:

- `--model <asset.model>` — if set
- `--max-turns <asset.maxTurns>` — if set
- `--effort <asset.effort>` — if set
- `--append-system-prompt <asset.systemPrompt>` — if set (replaces current prompt text injection)
- `--plugin-dir <path>` — for each resolved skill (after applying overrides). Maps skill ID to its disk path under `~/.claude/plugins/cache/`.
- `--mcp-config <json>` — if asset has MCP servers configured

### Prompt separation

The asset's system prompt (identity, behavior rules) goes via `--append-system-prompt`. The mission-specific content (briefing, campaign context, CLAUDE.md, task-specific instructions) stays as the user message via positional argument or stdin.

### All spawn points updated

| Spawn Point | File | Loads Asset |
|-------------|------|-------------|
| Mission execution | `executor.ts` | Mission's assigned asset (by `mission.assetId`) |
| Debrief review | `debrief-reviewer.ts` | OVERSEER (by codename) |
| Stall detection | `overseer.ts` | OVERSEER (by codename) |
| Phase failure | `phase-failure-handler.ts` | OVERSEER (by codename) |
| Phase debrief | `campaign-executor.ts` | OVERSEER (by codename) |
| Campaign debrief | `campaign-executor.ts` | OVERSEER (by codename) |
| Conflict resolution | `conflict-resolver.ts` | QUARTERMASTER (by codename) |
| Briefing chat | `briefing-engine.ts` | GENERAL (by codename) |

System asset lookups use a helper: `getSystemAsset(codename: string)` that caches the asset row in memory (refreshed on change).

---

## 5. Prompt Migration

### Principle

Each asset gets an editable system prompt stored in DB. On first server boot, if the asset doesn't exist, create it with the seed system prompt. If it already exists, don't overwrite (user may have edited it).

### What moves to `--append-system-prompt` (editable)

The identity and behavioral rules for each role. This is the "who you are" part.

### What stays in code (not editable)

Task-specific instructions that vary per invocation. This is the "what to do" part — it changes every time (different briefing, different debrief to review, different conflict to resolve). Passed as the user message.

### Seed system prompts

**Mission Assets (VANGUARD, OPERATIVE, ARCHITECT, ASSERT, INTEL):**

Shared operational parameters, upgraded from the current prompt:

```
You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)
```

Each specialist gets an additional paragraph appended to the shared base:

- **VANGUARD:** "You specialize in frontend engineering — components, layouts, styling, client-side interactivity. Prioritize visual fidelity, accessibility, and responsive behavior."
- **OPERATIVE:** "You are a general-purpose engineer. Backend, infrastructure, APIs, data layer — you handle whatever the mission requires."
- **ARCHITECT:** "You specialize in system design and structural improvements. Focus on clean boundaries, clear interfaces, and sustainable patterns. When refactoring, preserve all existing behavior."
- **ASSERT:** "You specialize in testing and quality assurance. Write tests that verify behavior, not implementation details. Cover edge cases. If the codebase has test conventions, follow them."
- **INTEL:** "You specialize in project intelligence — documentation, specifications, and codebase analysis. Produce documents that are thorough, precise, and specific to the actual codebase. Your output is the authoritative reference for all other agents."

**GENERAL:**

```
You are GENERAL, a campaign planning and coordination specialist for NYHZ OPS DEVROOM.

Your role is to work with the Commander to design campaign plans — phased operations with concrete missions assigned to specialist assets.

CONDUCT:
- This is a conversation. Respond, then STOP and WAIT for the Commander's reply.
- Do NOT use tools or explore the codebase unless explicitly asked.
- Ask clarifying questions to deeply understand the objective (2-3 per turn max).
- Discuss technical approach, risks, and trade-offs before committing to a plan.
- Consider inter-mission dependencies — what must complete before what.
- Assign assets by specialty: VANGUARD for frontend, OPERATIVE for backend, ARCHITECT for structural work, ASSERT for testing, INTEL for documentation.
- Keep each response concise and focused.

When the Commander says "GENERATE PLAN", output the final plan as JSON conforming to the PlanJSON schema.

PLAN RULES:
- Phases execute SEQUENTIALLY (Phase 1 completes before Phase 2 starts).
- Missions within a phase execute IN PARALLEL unless constrained by dependsOn.
- dependsOn references mission titles within the SAME phase only.
- Each mission briefing must be self-contained — the asset has NO context beyond what you write.
```

**OVERSEER:**

```
You are the OVERSEER of DEVROOM operations, serving under the Commander.

Your role is to evaluate agent work, make tactical decisions about mission quality, and maintain operational standards across all campaigns.

CONDUCT:
- Be decisive. Never hedge or ask for more information.
- Align decisions with project conventions (CLAUDE.md) and mission objectives.
- Choose the simplest approach that satisfies requirements.
- Most agent work is satisfactory. Only flag genuine issues — not style preferences.
- "retry" only when the agent clearly failed to complete the task.
- "escalate" only when there is significant risk the Commander should know about.
- If genuinely uncertain between two valid approaches, escalate.
- Keep responses concise — agents and campaigns are waiting on your judgment.
- Log reasoning clearly — the Commander reviews your decisions.
```

**QUARTERMASTER:**

```
You are the QUARTERMASTER of DEVROOM operations.

Your role is to integrate completed mission work into the main codebase by resolving merge conflicts. You receive the mission context (what was built and why) along with the conflict details and upstream changes.

CONDUCT:
- Analyze both sides of each conflict carefully.
- Resolve preserving both intents — the mission's new work and upstream changes should coexist.
- If intents are truly incompatible, prefer the mission's work (source branch). Note what was lost.
- Run tests if a test command is available.
- Commit with message: "Merge [branch]: resolve conflicts"
- Report what you resolved and any risks.
```

---

## 6. Asset Detail Page

### Route: `/assets/[id]`

**Tab 1: Profile**
- Codename (read-only for system assets, editable for mission assets)
- Specialty (text field)
- Model (dropdown: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001)
- Effort level (dropdown: low, medium, high, max, default)
- Max turns (number input)
- Status toggle (active/offline — disabled for system assets)
- Missions completed (read-only counter)
- System asset badge (if `isSystem`)

**Tab 2: System Prompt**
- Full-height monospace textarea
- Save button
- Character count
- This text is passed via `--append-system-prompt` at spawn time

**Tab 3: Skills & MCPs**
- **Skills section:** List of all discovered skills from host. Each row: skill name, plugin source, description, toggle switch. Enabled skills stored in asset's `skills` JSON array.
- **MCP Servers section:** List of all discovered MCPs. Each row: server name, source, toggle switch. Enabled MCPs stored in asset's `mcpServers` JSON object.
- Discovery status indicator: "Last scanned: 2 min ago" with manual refresh button.

### System asset protections

- Cannot be deleted
- Cannot be toggled offline
- Codename is read-only
- Do not appear in mission asset assignment dropdowns

---

## 7. Assets List Page

### Route: `/assets`

Two sections:

**Mission Assets**
Cards for VANGUARD, OPERATIVE, ARCHITECT, ASSERT, INTEL. Each card shows: codename, specialty, model, status, missions completed, number of active skills. Card links to `/assets/[id]`.

**System Assets**
Cards for GENERAL, OVERSEER, QUARTERMASTER. Same card layout but with a "SYSTEM" badge. Cannot be toggled offline from this view.

---

## 8. Campaign Planning — Per-Mission Skill Overrides

### When: Campaign in `planning` or `draft` state

On the campaign detail page, each mission card shows the assigned asset badge. Clicking the badge opens a side panel showing:

**Asset assignment:** Dropdown to change the assigned asset. Changing resets any skill overrides.

**Skills list:** All discovered skills. Asset defaults are pre-toggled on with a "(default)" label. Toggle to add (adds to `skillOverrides.added`) or remove (adds to `skillOverrides.removed`).

**MCP Servers list:** Same toggle pattern for MCPs.

**Persistence:** Changes save immediately via server action, stored in mission's `skillOverrides` column.

**Locked after launch:** Once campaign is `active`, skill overrides are read-only.

---

## 9. Seeding & Migration

### On first boot or migration

A seed function checks if each asset exists by codename. If not, creates it with:
- Seed system prompt (from section 5)
- Default skills (from section 1)
- Default model (sonnet for mission assets, sonnet for GENERAL, sonnet for OVERSEER, sonnet for QUARTERMASTER)
- Default max turns (100 for mission assets, type-specific for system assets)
- `isSystem` flag

If the asset already exists, skip — never overwrite user edits.

### Migration

- Add new columns to `assets` table: `skills`, `mcpServers`, `maxTurns`, `effort`, `isSystem`
- Add `skillOverrides` column to `missions` table
- Run seed function to create any missing assets with defaults

---

## Summary — What Changes Where

### New Files

| File | Purpose |
|------|---------|
| `src/lib/discovery/skill-scanner.ts` | Scan host for available skills and MCPs |
| `src/lib/orchestrator/asset-cli.ts` | `buildAssetCliArgs()` shared utility |
| `src/app/(hq)/assets/[id]/page.tsx` | Asset detail page (server component) |
| `src/components/asset/asset-detail-tabs.tsx` | Tabbed detail UI (client component) |
| `src/components/asset/skill-toggle-list.tsx` | Skill/MCP toggle list component |
| `src/components/campaign/mission-skill-panel.tsx` | Per-mission skill override panel |
| `src/actions/discovery.ts` | Server action for skill/MCP discovery |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | New columns on assets and missions |
| `src/types/index.ts` | New types: DiscoveredSkill, DiscoveredMcp, SkillOverrides |
| `src/lib/orchestrator/executor.ts` | Use `buildAssetCliArgs()`, pass `--append-system-prompt` instead of prompt injection |
| `src/lib/overseer/debrief-reviewer.ts` | Load OVERSEER asset, use `buildAssetCliArgs()` |
| `src/lib/overseer/overseer.ts` | Load OVERSEER asset, use `buildAssetCliArgs()` |
| `src/lib/overseer/phase-failure-handler.ts` | Load OVERSEER asset, use `buildAssetCliArgs()` |
| `src/lib/orchestrator/campaign-executor.ts` | Load OVERSEER asset for debriefs |
| `src/lib/quartermaster/conflict-resolver.ts` | Load QUARTERMASTER asset, use `buildAssetCliArgs()` |
| `src/lib/briefing/briefing-engine.ts` | Load GENERAL asset, use `buildAssetCliArgs()` |
| `src/lib/orchestrator/prompt-builder.ts` | Remove system prompt from prompt text (moved to `--append-system-prompt`) |
| `src/actions/asset.ts` | CRUD for new columns, seed function |
| `src/actions/campaign.ts` | Skill overrides in mission creation |
| `src/app/(hq)/assets/page.tsx` | Two-section layout (mission + system) |
| `src/components/campaign/mission-card.tsx` | Asset badge click → skill panel |
