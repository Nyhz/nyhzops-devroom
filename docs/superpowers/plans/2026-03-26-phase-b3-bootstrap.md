# Phase B3: Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automatic generation of CLAUDE.md and SPEC.md for new battlefields via a bootstrap mission, with a tactical review screen for the Commander to edit, approve, or regenerate before the battlefield goes active.

**Architecture:** Bootstrap is a special mission type that runs Claude Code on the repo root to create files. The prompt builder handles the bootstrap case with a dedicated prompt. The battlefield page conditionally renders bootstrap comms (during execution) or a review screen (after completion). Server Actions handle approval, regeneration, and abandonment.

**Tech Stack:** Next.js Server Actions, simple-git, Socket.IO (via existing useMissionComms hook), fs for file I/O

**Spec:** `docs/superpowers/specs/2026-03-26-phase-b3-bootstrap-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Bootstrap Prompt:**
- `src/lib/orchestrator/prompt-builder.ts` (modified — add bootstrap case)

**Task 2 — Creation Flow Changes:**
- `src/actions/battlefield.ts` (modified — initializing status, bootstrap mission, skip toggle)
- `src/components/battlefield/create-battlefield.tsx` (modified — skip bootstrap toggle)
- `src/app/api/battlefields/[id]/scaffold/route.ts` (modified — trigger bootstrap after scaffold)

**Task 3 — Bootstrap Server Actions:**
- `src/actions/battlefield.ts` (modified — add approve, regenerate, abandon, read/write file actions)

**Task 4 — Bootstrap Review Screen:**
- `src/components/battlefield/bootstrap-review.tsx` (new)

**Task 5 — Bootstrap Comms:**
- `src/components/battlefield/bootstrap-comms.tsx` (new)

**Task 6 — Battlefield Page Conditional Rendering:**
- `src/app/projects/[id]/page.tsx` (modified)

**Task 7 — Integration Verification:**
- Various fixes, final commit

---

## Task 1: Bootstrap Prompt

**Files:**
- Modify: `src/lib/orchestrator/prompt-builder.ts`

- [ ] **Step 1: Add bootstrap prompt function**

Read the existing `src/lib/orchestrator/prompt-builder.ts`. Add a `buildBootstrapPrompt` function and modify `buildPrompt` to call it for bootstrap missions.

At the top of `buildPrompt`, add an early return:

```typescript
if (mission.type === 'bootstrap') {
  return buildBootstrapPrompt(mission, battlefield);
}
```

Add the new function:

```typescript
function buildBootstrapPrompt(mission: Mission, battlefield: Battlefield): string {
  return `## Battlefield Bootstrap — Intelligence Generation

You are initializing a new battlefield for the DEVROOM agent orchestrator.
Your task is to analyze this repository and the Commander's briefing, then
generate two comprehensive documents.

### Commander's Briefing

${battlefield.initialBriefing || 'No briefing provided.'}

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
The Commander will review and approve before committing.`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/prompt-builder.ts
git commit -m "feat: add bootstrap prompt to prompt builder"
```

---

## Task 2: Creation Flow Changes

**Files:**
- Modify: `src/actions/battlefield.ts`
- Modify: `src/components/battlefield/create-battlefield.tsx`
- Modify: `src/app/api/battlefields/[id]/scaffold/route.ts`

- [ ] **Step 1: Update CreateBattlefieldInput type**

In `src/types/index.ts`, add to `CreateBattlefieldInput`:

```typescript
skipBootstrap?: boolean;
claudeMdPath?: string;   // when skipping bootstrap
specMdPath?: string;     // when skipping bootstrap
```

- [ ] **Step 2: Update createBattlefield Server Action**

Read `src/actions/battlefield.ts`. Modify `createBattlefield`:

**Change default status:** Replace `status: 'active'` with conditional:
- If `data.skipBootstrap`: status `active`, set `claudeMdPath` and `specMdPath` from input
- If not skip AND no `scaffoldCommand`: status `initializing`, create bootstrap mission and queue it immediately
- If not skip AND has `scaffoldCommand`: status `initializing`, create bootstrap mission but do NOT queue it yet (scaffold route will trigger after completion)

**Bootstrap mission creation** (helper function or inline):
```typescript
function createBootstrapMission(battlefieldId: string, codename: string, briefing: string): string {
  const db = getDatabase();
  const now = Date.now();
  const missionId = generateId();

  // Find ARCHITECT asset, fall back to any active asset
  let asset = db.select().from(assets)
    .where(eq(assets.codename, 'ARCHITECT')).get();
  if (!asset) {
    asset = db.select().from(assets)
      .where(eq(assets.status, 'active')).limit(1).get();
  }
  if (!asset) {
    throw new Error('No active assets available. Run the seed script.');
  }

  db.insert(missions).values({
    id: missionId,
    battlefieldId,
    type: 'bootstrap',
    title: `Bootstrap: ${codename}`,
    briefing: briefing || 'Analyze this repository and generate CLAUDE.md and SPEC.md.',
    status: 'queued',
    priority: 'critical',
    assetId: asset.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  return missionId;
}
```

Update the battlefield record with `bootstrapMissionId`.

For non-scaffold battlefields: `globalThis.orchestrator?.onMissionQueued(missionId)`.
For scaffold battlefields: the scaffold route handles queuing after completion.

- [ ] **Step 3: Update scaffold route to trigger bootstrap**

Read `src/app/api/battlefields/[id]/scaffold/route.ts`. After successful scaffold + git commit (where `scaffoldStatus` is set to `complete`), add:

```typescript
// If battlefield has a bootstrap mission waiting, queue it now
if (battlefield.bootstrapMissionId) {
  const bootstrapMission = db.select().from(missions)
    .where(eq(missions.id, battlefield.bootstrapMissionId)).get();
  if (bootstrapMission && bootstrapMission.status === 'queued') {
    // The mission was created as queued but not triggered
    // Now trigger it since scaffold is complete
    globalThis.orchestrator?.onMissionQueued(battlefield.bootstrapMissionId);
  }
}
```

Wait — actually the bootstrap mission should be created with status `standby` initially (not `queued`) for the scaffold case, then changed to `queued` + triggered here. OR: create it as `queued` but don't call `onMissionQueued` during creation, then call it here. Since the orchestrator is event-driven (not polling), a queued mission without `onMissionQueued` call just sits in the DB. Call `onMissionQueued` here after scaffold completes.

- [ ] **Step 4: Update creation form with skip bootstrap toggle**

Read `src/components/battlefield/create-battlefield.tsx`. Add:

**New state:** `skipBootstrap: boolean` (default false)

**Toggle:** Below the `initialBriefing` textarea, add:
```
[Skip bootstrap — I'll provide my own CLAUDE.md]
```
Clickable link that toggles the state.

**When skip is true:**
- Hide `initialBriefing` textarea
- Show `claudeMdPath` input (TacInput, required, placeholder "Absolute path to CLAUDE.md")
- Show `specMdPath` input (TacInput, optional, placeholder "Absolute path to SPEC.md (optional)")

**Pass to createBattlefield:**
```typescript
await createBattlefield({
  ...existingFields,
  skipBootstrap,
  claudeMdPath: skipBootstrap ? claudeMdPath : undefined,
  specMdPath: skipBootstrap ? specMdPath : undefined,
});
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/actions/battlefield.ts src/components/battlefield/create-battlefield.tsx src/app/api/battlefields/
git commit -m "feat: add bootstrap mission creation and skip toggle to battlefield flow"
```

---

## Task 3: Bootstrap Server Actions

**Files:**
- Modify: `src/actions/battlefield.ts`

- [ ] **Step 1: Add bootstrap-related Server Actions**

Add these 5 functions to `src/actions/battlefield.ts`:

**`approveBootstrap(battlefieldId: string)`:**
1. Get battlefield, validate status is `initializing`
2. `simpleGit(repoPath)`: `git.add(['CLAUDE.md', 'SPEC.md'])`
3. `git.commit('Bootstrap: add CLAUDE.md and SPEC.md')`
4. Update battlefield: `claudeMdPath = path.join(repoPath, 'CLAUDE.md')`, `specMdPath = path.join(repoPath, 'SPEC.md')`, `status = 'active'`, `updatedAt = Date.now()`
5. `revalidatePath('/projects/' + battlefieldId)` and `revalidatePath('/projects')`

**`regenerateBootstrap(battlefieldId: string, briefing: string)`:**
1. Get battlefield, validate status is `initializing`
2. Delete generated files: for each of `CLAUDE.md`, `SPEC.md` — `try { fs.unlinkSync(path.join(repoPath, file)) } catch {}`
3. Update `initialBriefing` on battlefield
4. Get old bootstrap mission (via `bootstrapMissionId`), increment its `iterations`
5. Create new bootstrap mission (reuse the helper from Task 2)
6. Update `bootstrapMissionId` on battlefield
7. `globalThis.orchestrator?.onMissionQueued(newMissionId)`
8. `revalidatePath`

**`abandonBootstrap(battlefieldId: string)`:**
1. Get battlefield, validate status is `initializing`
2. Delete generated files from disk (try/catch, may not exist)
3. Call existing `deleteBattlefield(battlefieldId)` (cascade delete)
4. `revalidatePath('/projects')`

**`writeBootstrapFile(battlefieldId: string, filename: string, content: string)`:**
1. Get battlefield, validate status is `initializing`
2. Validate `filename === 'CLAUDE.md' || filename === 'SPEC.md'`
3. `fs.writeFileSync(path.join(battlefield.repoPath, filename), content, 'utf-8')`

**`readBootstrapFile(battlefieldId: string, filename: string): Promise<string>`:**
1. Get battlefield
2. Validate filename
3. `try { return fs.readFileSync(path.join(battlefield.repoPath, filename), 'utf-8') } catch { return '' }`

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/battlefield.ts
git commit -m "feat: add bootstrap approval, regeneration, abandon, and file read/write actions"
```

---

## Task 4: Bootstrap Review Screen

**Files:**
- Create: `src/components/battlefield/bootstrap-review.tsx`

- [ ] **Step 1: Create the review component**

Create `src/components/battlefield/bootstrap-review.tsx` — Client Component (`"use client"`).

**Props:**
```typescript
interface BootstrapReviewProps {
  battlefieldId: string;
  codename: string;
  initialBriefing: string;
  initialClaudeMd: string;
  initialSpecMd: string;
}
```

**State:**
- `claudeMd: string` (initialized from props)
- `specMd: string` (initialized from props)
- `editingFile: 'CLAUDE.md' | 'SPEC.md' | null`
- `editContent: string` (textarea value during edit)
- `showRegenerate: boolean` (toggle regenerate briefing textarea)
- `regenerateBriefing: string` (initialized from initialBriefing)
- `isPending: boolean`

**Rendering:**

Header section:
```
{codename} — BOOTSTRAP COMPLETE
Status: INITIALIZING — Awaiting Commander review
```

Two document cards (one for CLAUDE.md, one for SPEC.md):
- When NOT editing: `TacCard` with amber header showing filename, scrollable content area (`whitespace-pre-wrap font-data text-dr-text`), `[EDIT]` button in header
- When editing: card transforms — header becomes `◆ EDITING — {filename}` with `shadow-glow-amber` on the card, `TacTextarea` fills the content area with `font-data bg-dr-bg`, `[SAVE]` (success) and `[CANCEL]` (ghost) buttons below

EDIT flow:
1. Click EDIT → set `editingFile`, set `editContent` from current state
2. Edit in textarea
3. SAVE → call `writeBootstrapFile(battlefieldId, filename, content)`, update local state, clear `editingFile`
4. CANCEL → clear `editingFile`, discard `editContent`

Action buttons:
- `[APPROVE & DEPLOY]` (success) → call `approveBootstrap(battlefieldId)`, `router.push('/projects/' + battlefieldId)`
- `[REGENERATE]` (primary) → toggle `showRegenerate`. Shows briefing textarea + `[CONFIRM REGENERATE]` + `[CANCEL]`
- `[ABANDON]` (danger) → confirm dialog, call `abandonBootstrap(battlefieldId)`, `router.push('/projects')`

Regenerate flow:
1. Click REGENERATE → show textarea pre-filled with `regenerateBriefing`
2. Commander edits briefing
3. Click CONFIRM → call `regenerateBootstrap(battlefieldId, briefing)`, `router.refresh()`
4. Page re-renders → shows bootstrap comms for new run

**Tactical styling:**
- Cards: `bg-dr-surface border border-dr-border`
- Headers: `bg-dr-elevated text-dr-amber font-tactical tracking-wider`
- Edit mode glow: `shadow-glow-amber` on the card
- Content area max-height: `max-h-96 overflow-y-auto` via ScrollArea
- All buttons use `TacButton`

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/battlefield/bootstrap-review.tsx
git commit -m "feat: add bootstrap review screen with tactical document editor"
```

---

## Task 5: Bootstrap Comms

**Files:**
- Create: `src/components/battlefield/bootstrap-comms.tsx`

- [ ] **Step 1: Create bootstrap comms component**

Create `src/components/battlefield/bootstrap-comms.tsx` — Client Component.

**Props:** `battlefieldId: string`, `missionId: string`, `codename: string`

Uses `useMissionComms(missionId, [], 'queued')` hook from `@/hooks/use-mission-comms`.

**Renders:**
- Header: `{codename} — INITIALIZING` (amber, large)
- Subtitle: "Generating battlefield intel..." (dim text, with `animate-pulse`)
- Terminal component showing live comms from the bootstrap mission
- When `status` changes to `accomplished`: wait 1 second, then `router.refresh()` → page re-renders to show review screen
- When `status` changes to `compromised`: show error message with option to retry

**Styling:** Same tactical aesthetic as mission comms. The Terminal component is reused.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/battlefield/bootstrap-comms.tsx
git commit -m "feat: add bootstrap comms component for live initialization streaming"
```

---

## Task 6: Battlefield Page Conditional Rendering

**Files:**
- Modify: `src/app/projects/[id]/page.tsx`

- [ ] **Step 1: Add conditional rendering for bootstrap states**

Read the existing `src/app/projects/[id]/page.tsx`. The page already has conditional rendering for scaffold status. Add bootstrap state handling.

After the battlefield query, add:

```typescript
// Import new components
import { BootstrapReview } from '@/components/battlefield/bootstrap-review';
import { BootstrapComms } from '@/components/battlefield/bootstrap-comms';
import { readBootstrapFile } from '@/actions/battlefield';
```

The rendering logic should be:

```
if (battlefield.status === 'initializing') {
  // Get bootstrap mission
  const bootstrapMission = battlefield.bootstrapMissionId
    ? db.select().from(missions).where(eq(missions.id, battlefield.bootstrapMissionId)).get()
    : null;

  if (bootstrapMission?.status === 'accomplished') {
    // Show review screen
    const claudeMd = await readBootstrapFile(id, 'CLAUDE.md');
    const specMd = await readBootstrapFile(id, 'SPEC.md');
    return <BootstrapReview ... />;
  }

  if (bootstrapMission?.status === 'compromised') {
    // Show error state with retry
    return <ErrorState />;
  }

  if (bootstrapMission) {
    // Show live comms (queued/deploying/in_combat)
    return <BootstrapComms ... />;
  }

  // No bootstrap mission yet or mission abandoned — show error with recovery
  return (
    <div className="p-6 text-center">
      <div className="text-dr-amber text-xl font-tactical mb-2">{battlefield.codename} — AWAITING BOOTSTRAP</div>
      <div className="text-dr-dim text-sm mb-4">No active bootstrap mission found.</div>
      <TacButton variant="primary" onClick={...}>INITIATE BOOTSTRAP</TacButton>
    </div>
  );
  // Note: This needs to be a Client Component for the button handler.
  // Extract as <BootstrapWaiting battlefieldId={id} codename={battlefield.codename} briefing={battlefield.initialBriefing} />
  // The button calls regenerateBootstrap to create a new bootstrap mission.
}

// Existing scaffold status checks...
// Existing normal overview...
```

**Rendering order (unambiguous — implement exactly this):**

1. `scaffoldStatus === 'running'` → show ScaffoldOutput (scaffold runs before bootstrap)
2. `scaffoldStatus === 'failed'` → show ScaffoldRetry
3. `status === 'initializing'` → show bootstrap UI (comms, review, error, or waiting — per the conditional above)
4. `status === 'archived'` → show archived notice ("This battlefield has been archived.")
5. `status === 'active'` → show normal battlefield overview (existing code)

- [ ] **Step 2: Add error/waiting states for bootstrap edge cases**

For the compromised bootstrap case, render a simple error card:
```tsx
<div className="p-6">
  <h1 className="text-dr-amber text-xl font-tactical">{battlefield.codename} — BOOTSTRAP FAILED</h1>
  <p className="text-dr-dim mt-2">Intelligence generation encountered resistance.</p>
  <div className="mt-4 flex gap-3">
    <TacButton variant="primary" onClick={() => regenerateBootstrap(id, battlefield.initialBriefing || '')}>
      RETRY BOOTSTRAP
    </TacButton>
    <TacButton variant="danger" onClick={() => abandonBootstrap(id)}>
      ABANDON
    </TacButton>
  </div>
</div>
```

This needs to be a Client Component for the button handlers. Extract a small `<BootstrapError>` client component.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/projects/[id]/page.tsx src/components/battlefield/
git commit -m "feat: add conditional bootstrap rendering to battlefield page"
```

---

## Task 7: Integration Verification

**Files:**
- Various fixes

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Build test**

```bash
pnpm build
```

- [ ] **Step 3: Route verification**

Start `pnpm dev` and verify:
- `/projects` — 200
- `/projects/new` — shows creation form with skip bootstrap toggle
- `/projects/[id]` — existing active battlefield shows normal overview
- Creating a new battlefield (without scaffold) should show bootstrap comms
- After bootstrap completes: review screen should appear
- All other routes still work

- [ ] **Step 4: Fix any issues**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase B3 — bootstrap flow operational"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Prompt builder returns bootstrap prompt for `type === 'bootstrap'` missions
- [ ] New battlefields default to `initializing` status
- [ ] Bootstrap mission auto-created and queued on battlefield creation
- [ ] ARCHITECT asset used (with fallback to any active asset)
- [ ] Skip bootstrap toggle hides briefing, shows claudeMdPath/specMdPath
- [ ] Skip bootstrap creates battlefield as `active` directly
- [ ] Scaffold completion triggers bootstrap (via scaffold route)
- [ ] Bootstrap comms stream live during execution
- [ ] Review screen shows after bootstrap completes
- [ ] Document editor: EDIT → textarea → SAVE writes to disk → preview updates
- [ ] APPROVE & DEPLOY commits files, sets paths, activates battlefield
- [ ] REGENERATE shows editable briefing, re-runs bootstrap on confirm
- [ ] ABANDON deletes files and battlefield
- [ ] readBootstrapFile/writeBootstrapFile validate filename
- [ ] Bootstrap error state shows retry option
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
