# Phase B3: Bootstrap — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** B3 (Bootstrap)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase B2b (Worktrees + Session Reuse) — complete

---

## Overview

Phase B3 adds the bootstrap flow: when a new battlefield is created, a special bootstrap mission analyzes the repo and Commander's briefing, then generates CLAUDE.md and SPEC.md files. The Commander reviews, edits, and approves the generated docs before the battlefield goes active. Files are written to disk by Claude Code (no JSON parsing), reviewed in a tactical document editor, and committed on approval.

---

## 1. Bootstrap Mission Flow

### Creation Flow Changes

**`createBattlefield` modifications:**
- New battlefields default to status `initializing` (changed from `active` in B1)
- After creating the battlefield record, automatically create a bootstrap mission:
  - `type`: `bootstrap`
  - `assetId`: look up the ARCHITECT asset by codename
  - `priority`: `critical`
  - `briefing`: the Commander's `initialBriefing`
  - `title`: `Bootstrap: {battlefield.codename}`
  - `status`: `queued`
- Set `bootstrapMissionId` on the battlefield record
- **If scaffold command is running:** do NOT queue the bootstrap mission yet. The scaffold route handler (B1) must signal completion. After scaffold completes successfully, THEN create and queue the bootstrap mission. The creation form should only fire-and-forget the scaffold POST; the scaffold route handler's completion path triggers the bootstrap queue.
- **If no scaffold command:** trigger orchestrator immediately: `globalThis.orchestrator?.onMissionQueued(bootstrapMission.id)`
- **Asset assignment:** Look up the ARCHITECT asset by codename. If not found, use any active asset. If no active assets exist, fail with error: "No active assets available. Run the seed script."

**Skip bootstrap toggle on creation form:**
- Toggle: `[Skip bootstrap — I'll provide my own CLAUDE.md]`
- When enabled, reveals:
  - `claudeMdPath` input (file path to existing CLAUDE.md)
  - `specMdPath` input (optional, file path to existing SPEC.md)
- When skip is on: battlefield created with status `active` directly. No bootstrap mission. `claudeMdPath`/`specMdPath` set from inputs.

### Bootstrap Prompt

The prompt tells Claude to create files on disk (not output JSON):

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

> **Note:** SPEC.md §3.3 describes the bootstrap output as JSON stored in the debrief field (`{ claudeMd, specMd }`). This design supersedes that approach — Claude writes files directly to disk using its Write tool, which is more robust than parsing LLM-generated JSON. SPEC.md should be updated to reflect this.

### Executor Behavior for Bootstrap

Bootstrap missions already skip worktrees (`mission.type !== 'bootstrap'` check in executor). They run on the repo root. No changes needed to the executor — the standard execution flow handles bootstrap like any other mission. Claude Code uses its built-in Write tool to create the files.

### Bootstrap Prompt in Prompt Builder

Add a special case in `prompt-builder.ts`: when `mission.type === 'bootstrap'`, use the bootstrap prompt instead of the standard prompt structure. Skip the CLAUDE.md-from-disk section (it doesn't exist yet) and skip the asset system prompt section (use the bootstrap prompt directly).

---

## 2. Bootstrap Review Screen

**New file:** `src/components/battlefield/bootstrap-review.tsx` — Client Component

Shown on the battlefield page when `battlefield.status === 'initializing'` and bootstrap mission is `accomplished`.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  {CODENAME} — BOOTSTRAP COMPLETE                             │
│  Status: INITIALIZING — Awaiting Commander review            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ CLAUDE.md ─────────────────────────────────────────────┐ │
│  │  (rendered content, scrollable)                          │ │
│  │                                            [EDIT]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ SPEC.md ───────────────────────────────────────────────┐ │
│  │  (rendered content, scrollable)                          │ │
│  │                                            [EDIT]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [APPROVE & DEPLOY]              [REGENERATE]  [ABANDON]     │
└──────────────────────────────────────────────────────────────┘
```

### Document Display

Each doc in a TacCard:
- Amber header: filename (`CLAUDE.md` / `SPEC.md`) with classification aesthetic
- Content in `whitespace-pre-wrap font-data text-dr-text` (raw markdown)
- Scrollable via ScrollArea (max-height ~400px)
- `[EDIT]` button (ghost variant) in the header

### Tactical Document Editor

When EDIT is clicked, the card transforms:
- Header changes to `◆ EDITING — CLAUDE.md` with amber glow (`shadow-glow-amber`)
- Content area becomes a full-height `TacTextarea` with `font-data bg-dr-bg`
- Monospace editing, styled as modifying classified intelligence
- Buttons below: `[SAVE]` (success) and `[CANCEL]` (ghost)
- SAVE: calls `writeBootstrapFile` Server Action to persist to disk, updates local state with the edited content (no server round-trip needed for display — the Client Component holds the content in React state and renders it immediately)
- CANCEL: discards edits from local state, reverts to preview showing the last saved content

### Actions

**APPROVE & DEPLOY** (success variant, green):
1. Calls `approveBootstrap(battlefieldId)` Server Action
2. Server Action: `git add CLAUDE.md SPEC.md && git commit -m "Bootstrap: add CLAUDE.md and SPEC.md"`
3. Sets `claudeMdPath` and `specMdPath` on battlefield record (absolute paths)
4. Transitions battlefield status to `active`
5. `revalidatePath` → page shows normal battlefield overview

**REGENERATE** (primary variant, amber):
1. Expands to show `initialBriefing` in an editable textarea (pre-filled)
2. Commander can modify the briefing
3. On confirm: calls `regenerateBootstrap(battlefieldId, newBriefing)` Server Action
4. Server Action: discards current files (`git checkout -- CLAUDE.md SPEC.md`), updates `initialBriefing`, creates new bootstrap mission (queued), increments `iterations` on the old one
5. Page transitions back to bootstrap comms (live terminal for new run)

**ABANDON** (danger variant, red):
1. Confirmation dialog: "This will delete the battlefield and all associated data."
2. Calls `abandonBootstrap(battlefieldId)` Server Action
3. Server Action: discards generated files, deletes battlefield (cascade delete from B1)
4. Redirects to `/projects`

---

## 3. Bootstrap During Initialization

### Conditional Page Rendering

**Modify:** `src/app/projects/[id]/page.tsx`

The battlefield overview page renders different content based on state:

| `battlefield.status` | Bootstrap Mission State | Component Shown |
|---|---|---|
| `initializing` | `queued` / `deploying` / `in_combat` | `<BootstrapComms>` — live terminal |
| `initializing` | `accomplished` | `<BootstrapReview>` — review screen |
| `initializing` | `compromised` | Error state with `[RETRY]` button |
| `initializing` | No mission / `abandoned` | Error state |
| `active` | Any | Normal battlefield overview (existing) |
| `archived` | Any | Archived notice |

### Bootstrap Comms Component

**New file:** `src/components/battlefield/bootstrap-comms.tsx` — Client Component

Uses `useMissionComms` hook (from B2a) to stream the bootstrap mission's output.

**Props:** `battlefieldId: string`, `missionId: string`, `codename: string`

**Renders:**
- Header: `{CODENAME} — INITIALIZING` (amber)
- Subtitle: "Generating battlefield intel..." (dim, pulsing)
- Terminal component with live comms
- Token stats below terminal (optional, same as mission detail)

When `status` changes to `accomplished` (via hook): wait 1 second (guard against DB write lag), then call `router.refresh()` to trigger page re-render → shows review screen. The delay ensures the mission record is fully updated before the Server Component re-reads it.

---

## 4. New Server Actions

### In `src/actions/battlefield.ts`:

#### `approveBootstrap(battlefieldId: string): Promise<void>`

1. Get battlefield, validate status is `initializing`
2. `simple-git`: `git add CLAUDE.md SPEC.md` in the repo
3. `simple-git`: `git commit -m "Bootstrap: add CLAUDE.md and SPEC.md"`
4. Update battlefield: `claudeMdPath = path.join(repoPath, 'CLAUDE.md')`, `specMdPath = path.join(repoPath, 'SPEC.md')`, `status = 'active'`
5. `revalidatePath`

#### `regenerateBootstrap(battlefieldId: string, briefing: string): Promise<void>`

1. Get battlefield, validate status is `initializing`
2. Discard generated files: delete from disk via `fs.unlinkSync` if they exist (do NOT use `git checkout --` since the files may not be tracked yet in a fresh repo)
3. Update `initialBriefing` on battlefield
4. Get old bootstrap mission, increment its `iterations`
5. Create new bootstrap mission (same pattern as initial creation)
6. Queue it: `globalThis.orchestrator?.onMissionQueued(newMission.id)`
7. `revalidatePath`

#### `abandonBootstrap(battlefieldId: string): Promise<void>`

1. Get battlefield, validate status is `initializing`
2. Discard generated files from disk (if they exist)
3. Delete battlefield (uses existing `deleteBattlefield` cascade logic)
4. `revalidatePath('/projects')`

#### `writeBootstrapFile(battlefieldId: string, filename: string, content: string): Promise<void>`

1. Get battlefield, validate status is `initializing`
2. Validate `filename` is `CLAUDE.md` or `SPEC.md` (prevent arbitrary file writes)
3. `fs.writeFileSync(path.join(battlefield.repoPath, filename), content, 'utf-8')`

#### `readBootstrapFile(battlefieldId: string, filename: string): Promise<string>`

1. Get battlefield
2. Validate `filename` is `CLAUDE.md` or `SPEC.md`
3. Read file from disk: `fs.readFileSync(path.join(battlefield.repoPath, filename), 'utf-8')`
4. Return content (or empty string if file doesn't exist)

---

## 5. Prompt Builder Changes

**Modify:** `src/lib/orchestrator/prompt-builder.ts`

Add a special case for bootstrap missions:

```typescript
if (mission.type === 'bootstrap') {
  return buildBootstrapPrompt(mission, battlefield);
}
```

The `buildBootstrapPrompt` function uses the bootstrap prompt template from §1 instead of the standard CLAUDE.md + asset + briefing structure. It doesn't read CLAUDE.md from disk (it doesn't exist yet) and doesn't include an asset system prompt.

---

## 6. Creation Form Changes

**Modify:** `src/components/battlefield/create-battlefield.tsx`

Add skip bootstrap toggle:
- `[Skip bootstrap — I'll provide my own CLAUDE.md]` toggle link/checkbox
- When enabled: show `claudeMdPath` input (required) and `specMdPath` input (optional)
- When disabled: show `initialBriefing` textarea (already exists)
- The `initialBriefing` field becomes more prominent — label it as the primary input for bootstrap
- Pass the skip flag and paths to `createBattlefield` Server Action

**Modify `createBattlefield` in `src/actions/battlefield.ts`:**
- Add `skipBootstrap?: boolean`, `claudeMdPath?: string`, `specMdPath?: string` to input
- If `skipBootstrap`: set status `active`, set paths, no bootstrap mission
- If not skip: set status `initializing`, create bootstrap mission

---

## 7. What Is NOT Built in Phase B3

- Markdown rendering (preview shows raw markdown — a markdown renderer can be added in polish)
- Re-bootstrap from config page (SPEC.md §15 mentions a RE-BOOTSTRAP button — deferred to Phase D config page)
- Bootstrap for linked repos with existing CLAUDE.md (skip bootstrap handles this via the toggle)

---

## 8. End State

After Phase B3 is complete:
1. New battlefields default to `initializing` status
2. Bootstrap mission auto-created and queued on battlefield creation
3. Commander watches bootstrap in real-time (live terminal)
4. Review screen shows generated CLAUDE.md and SPEC.md
5. Tactical document editor for inline editing with classified docs aesthetic
6. APPROVE commits docs and activates battlefield
7. REGENERATE allows briefing edits and re-runs bootstrap
8. ABANDON discards everything
9. Skip bootstrap toggle for projects with existing docs
10. Prompt builder handles bootstrap type with dedicated prompt
11. All subsequent missions for the battlefield benefit from the generated CLAUDE.md (prompt cache optimization)
