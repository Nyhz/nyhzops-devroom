# Tactical Naming Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename generic/civilian terminology to delta-force/black-ops aesthetic across code and UI, keeping them in sync (no translation layer).

**Architecture:** Five independent rename categories, each touching types → schema → business logic → UI → tests. Each category is its own task and can be implemented in parallel via worktrees. A DB migration adjusts SQLite defaults for new rows; existing data uses text columns so old values just work until naturally overwritten.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), Next.js App Router, Vitest

**Important:** These are all string-literal renames. The DB columns themselves don't change names — only the *values* stored in them change. No Drizzle migration is needed because SQLite text columns accept any string. We just need to update the `.default()` calls in schema.ts and all code that reads/writes these values.

---

### Task 1: Rename MissionType `standard` → `direct_action`

Smallest change set — 9 locations. Good warmup.

**Files:**
- Modify: `src/types/index.ts:31`
- Modify: `src/lib/db/schema.ts:34`
- Modify: `src/actions/campaign-helpers.ts:167`
- Modify: `src/app/api/test/seed-campaign/route.ts` (lines 87, 103, 131)
- Modify: `src/app/api/test/seed-active-campaign/route.ts` (lines 86, 104, 134)
- Modify: `src/actions/__tests__/schedule.test.ts:68`

- [ ] **Step 1: Update type definition**

In `src/types/index.ts`, change line 31:
```typescript
// Before:
export type MissionType = 'standard' | 'bootstrap' | 'conflict_resolution' | 'phase_debrief';
// After:
export type MissionType = 'direct_action' | 'bootstrap' | 'conflict_resolution' | 'phase_debrief';
```

- [ ] **Step 2: Update schema default**

In `src/lib/db/schema.ts`, change line 34:
```typescript
// Before:
type: text('type').default('standard'),
// After:
type: text('type').default('direct_action'),
```

- [ ] **Step 3: Update business logic**

In `src/actions/campaign-helpers.ts`, find `type: 'standard'` and replace with `type: 'direct_action'`.

- [ ] **Step 4: Update test seed data**

In `src/app/api/test/seed-campaign/route.ts`, replace all `type: 'standard'` with `type: 'direct_action'` (3 occurrences).

In `src/app/api/test/seed-active-campaign/route.ts`, replace all `type: 'standard'` with `type: 'direct_action'` (3 occurrences).

In `src/actions/__tests__/schedule.test.ts`, update the DEFAULT assertion from `'standard'` to `'direct_action'`.

- [ ] **Step 5: Run tests and build**

```bash
pnpm test --run && pnpm build
```
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "rename: MissionType 'standard' → 'direct_action'"
```

---

### Task 2: Rename MissionPriority `normal` → `routine`

~53 locations. Mechanical find-and-replace but need to be careful not to catch unrelated uses of "normal".

**Files:**
- Modify: `src/types/index.ts:32`
- Modify: `src/lib/db/schema.ts:38`
- Modify: `src/lib/orchestrator/prompt-builder.ts` (lines 127, 221)
- Modify: `src/lib/orchestrator/orchestrator.ts:225`
- Modify: `src/lib/scheduler/scheduler.ts:115`
- Modify: `src/lib/briefing/briefing-engine.ts` (lines 181, 450)
- Modify: `src/lib/briefing/briefing-prompt.ts:75`
- Modify: `src/actions/mission.ts` (lines 52, 343)
- Modify: `src/actions/schedule.ts` (lines 45, 115)
- Modify: `src/actions/campaign-helpers.ts:171`
- Modify: `src/components/schedule/schedule-form.tsx` (lines 66, 105, 118, 247, 253)
- Modify: `src/components/campaign/mission-card.tsx` (lines 35, 72)
- Modify: `src/components/campaign/plan-editor/plan-editor-utils.ts` (lines 31, 35)
- Modify: `src/components/campaign/plan-editor.tsx:157`
- Modify: `src/app/(hq)/battlefields/[id]/campaigns/[campaignId]/page.tsx:72`
- Modify: `src/lib/test/fixtures.ts:58`
- Modify: `src/app/api/test/seed-campaign/route.ts:107`
- Modify: `src/app/api/test/seed-active-campaign/route.ts:138`
- Modify: Tests in `src/actions/__tests__/mission.test.ts`, `campaign.test.ts`, `schedule.test.ts`
- Modify: Tests in `src/components/campaign/__tests__/plan-editor.test.tsx`, `plan-editor-utils.test.ts`, `mission-card.test.tsx`
- Modify: `src/components/dashboard/__tests__/mission-list.test.tsx:34`

- [ ] **Step 1: Update type definition**

In `src/types/index.ts`, change line 32:
```typescript
// Before:
export type MissionPriority = 'low' | 'normal' | 'high' | 'critical';
// After:
export type MissionPriority = 'low' | 'routine' | 'high' | 'critical';
```

- [ ] **Step 2: Update schema default**

In `src/lib/db/schema.ts`, change line 38:
```typescript
// Before:
priority: text('priority').default('normal'),
// After:
priority: text('priority').default('routine'),
```

- [ ] **Step 3: Update orchestrator & scheduler**

In `src/lib/orchestrator/prompt-builder.ts`, replace `|| 'normal'` with `|| 'routine'` (2 occurrences).

In `src/lib/orchestrator/orchestrator.ts`, replace `WHEN 'normal' THEN` with `WHEN 'routine' THEN`.

In `src/lib/scheduler/scheduler.ts`, replace `|| 'normal'` with `|| 'routine'`.

- [ ] **Step 4: Update briefing engine**

In `src/lib/briefing/briefing-engine.ts`, replace `"priority":"normal"` with `"priority":"routine"` and `|| 'normal'` with `|| 'routine'`.

In `src/lib/briefing/briefing-prompt.ts`, replace `"priority": "normal"` with `"priority": "routine"`.

- [ ] **Step 5: Update actions**

In `src/actions/mission.ts`, replace `?? 'normal'` and `|| 'normal'` with `'routine'` equivalents (2 occurrences).

In `src/actions/schedule.ts`, replace `|| 'normal'` and `?? 'normal'` with `'routine'` equivalents (2 occurrences).

In `src/actions/campaign-helpers.ts`, replace `|| 'normal'` with `|| 'routine'`.

- [ ] **Step 6: Update UI components**

In `src/components/schedule/schedule-form.tsx`:
- Replace `?? 'normal'` with `?? 'routine'`
- Replace `as 'low' | 'normal' | 'high' | 'critical'` with `as 'low' | 'routine' | 'high' | 'critical'` (2 occurrences)
- Replace `value="normal">Normal` with `value="routine">Routine`

In `src/components/campaign/mission-card.tsx`:
- Replace `normal: 'bg-dr-muted'` with `routine: 'bg-dr-muted'`
- Replace `?? 'normal'` with `?? 'routine'`

In `src/components/campaign/plan-editor/plan-editor-utils.ts`:
- Replace `'normal'` with `'routine'` in PRIORITIES array and color map.

In `src/components/campaign/plan-editor.tsx`:
- Replace `priority: 'normal' as MissionPriority` with `priority: 'routine' as MissionPriority`.

In `src/app/(hq)/battlefields/[id]/campaigns/[campaignId]/page.tsx`:
- Replace `|| 'normal'` with `|| 'routine'`.

- [ ] **Step 7: Update test fixtures and seed data**

In `src/lib/test/fixtures.ts`, replace `priority: 'normal'` with `priority: 'routine'`.

In seed routes, replace `priority: 'normal'` with `priority: 'routine'`.

- [ ] **Step 8: Update test assertions**

In all test files listed above, replace `'normal'` priority references with `'routine'`. Key files:
- `src/actions/__tests__/mission.test.ts`
- `src/actions/__tests__/campaign.test.ts`
- `src/actions/__tests__/schedule.test.ts`
- `src/components/campaign/__tests__/plan-editor.test.tsx`
- `src/components/campaign/__tests__/plan-editor-utils.test.ts`
- `src/components/campaign/__tests__/mission-card.test.tsx`
- `src/components/dashboard/__tests__/mission-list.test.tsx`

- [ ] **Step 9: Run tests and build**

```bash
pnpm test --run && pnpm build
```
Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "rename: MissionPriority 'normal' → 'routine'"
```

---

### Task 3: Rename LogType `log` → `comms`, `status` → `sitrep`, `error` → `alert`

~55 locations. Three simultaneous renames. Be careful with `'error'` — only replace when used as a LogType value, not general error handling.

**Files:**
- Modify: `src/types/index.ts:34`
- Modify: `src/lib/db/schema.ts:149` (missionLogs type default)
- Modify: `src/lib/orchestrator/executor.ts` (~15 occurrences of storeLog and type literals)
- Modify: `src/actions/mission.ts` (lines 460, 466)
- Modify: `src/lib/orchestrator/orchestrator.ts:275`
- Modify: `src/lib/overseer/review-handler.ts` (lines 20, 26)
- Modify: `src/lib/general/general-commands.ts:21`
- Modify: `src/components/ui/terminal.tsx` (lines 8, 19, 59, 61)
- Modify: `src/components/battlefield/bootstrap-comms.tsx` (lines 29, 32)
- Modify: `src/components/mission/mission-comms.tsx` (lines 87, 98, 105, 112, 121)
- Modify: `src/components/deps/deps-output.tsx:17`
- Modify: `src/components/tests/test-output.tsx:19`
- Modify: `src/components/tests/test-runner.tsx:127`
- Modify: `src/components/battlefield/scaffold-output.tsx:94`
- Modify: Tests in `src/components/mission/__tests__/mission-comms.test.tsx`
- Modify: Tests in `src/components/battlefield/__tests__/bootstrap-comms.test.tsx`
- Modify: Tests in `src/actions/__tests__/battlefield.test.ts`
- Modify: Tests in `src/actions/__tests__/mission.test.ts`

- [ ] **Step 1: Update type definition**

In `src/types/index.ts`, change line 34:
```typescript
// Before:
export type LogType = 'log' | 'status' | 'error';
// After:
export type LogType = 'comms' | 'sitrep' | 'alert';
```

- [ ] **Step 2: Update schema default**

In `src/lib/db/schema.ts`, find the missionLogs table type field default. If it defaults to `'log'`, change to `'comms'`.

- [ ] **Step 3: Update executor**

In `src/lib/orchestrator/executor.ts`, apply these replacements throughout:
- `type: 'log'` → `type: 'comms'`
- `storeLog('log',` → `storeLog('comms',`
- `type: 'error'` → `type: 'alert'`
- `storeLog('error',` → `storeLog('alert',`
- `type: 'status'` → `type: 'sitrep'`
- `storeLog('status',` → `storeLog('sitrep',`

- [ ] **Step 4: Update other server-side log producers**

In `src/actions/mission.ts`, replace `type: 'status'` with `type: 'sitrep'` (2 occurrences at lines ~460, ~466).

In `src/lib/orchestrator/orchestrator.ts`, replace `type: 'status'` with `type: 'sitrep'`.

In `src/lib/overseer/review-handler.ts`, replace `type: 'status'` with `type: 'sitrep'` (2 occurrences).

In `src/lib/general/general-commands.ts`, update the comment mentioning `'log', 'status', 'error'` to `'comms', 'sitrep', 'alert'`.

- [ ] **Step 5: Update terminal component**

In `src/components/ui/terminal.tsx`:
- Replace the type union `'log' | 'status' | 'error'` with `'comms' | 'sitrep' | 'alert'` (2 occurrences).
- Replace `entry.type === 'log'` with `entry.type === 'comms'`.
- Replace `prev.type === 'log'` with `prev.type === 'comms'`.

- [ ] **Step 6: Update comms components**

In `src/components/battlefield/bootstrap-comms.tsx`:
- Replace the comment and cast `'log' | 'status' | 'error'` with `'comms' | 'sitrep' | 'alert'`.

In `src/components/mission/mission-comms.tsx`:
- Replace `type: 'status' as const` with `type: 'sitrep' as const` (3 occurrences).
- Replace `log.type === 'log'` with `log.type === 'comms'`.
- Replace `type: (log.type as 'log' | 'status' | 'error')` with `type: (log.type as 'comms' | 'sitrep' | 'alert')`.

In `src/components/deps/deps-output.tsx`, replace `type: 'log' as const` with `type: 'comms' as const`.

In `src/components/tests/test-output.tsx`, replace `type: 'log' as const` with `type: 'comms' as const`.

In `src/components/tests/test-runner.tsx`, replace `type: 'log' as const` with `type: 'comms' as const`.

In `src/components/battlefield/scaffold-output.tsx`, replace `type: 'log' as const` with `type: 'comms' as const`.

- [ ] **Step 7: Update tests**

In all test files, replace log type values:
- `type: 'log'` → `type: 'comms'`
- `type: 'status'` → `type: 'sitrep'`
- `type: 'error'` → `type: 'alert'`

Key test files:
- `src/components/mission/__tests__/mission-comms.test.tsx`
- `src/components/battlefield/__tests__/bootstrap-comms.test.tsx`
- `src/actions/__tests__/battlefield.test.ts`
- `src/actions/__tests__/mission.test.ts`

- [ ] **Step 8: Run tests and build**

```bash
pnpm test --run && pnpm build
```
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "rename: LogType 'log'→'comms', 'status'→'sitrep', 'error'→'alert'"
```

---

### Task 4: Rename IntelNoteColumn `backlog` → `tasked`, `planned` → `ops_ready`

~46 locations. Heaviest in use-board.ts tests.

**Files:**
- Modify: `src/types/index.ts:54`
- Modify: `src/lib/db/schema.ts:301` (intelNotes column default)
- Modify: `src/hooks/use-board.ts` (lines 9, 10, 22, 26, 27)
- Modify: `src/components/board/intel-board.tsx:85`
- Modify: `src/actions/intel.ts` (lines 74, 87, 299)
- Modify: `src/actions/campaign.ts:290`
- Modify: `src/actions/campaign-helpers.ts` (lines 120, 188)
- Modify: `src/actions/mission.ts` (lines 69, 365)
- Modify: `src/lib/test/fixtures.ts:170`
- Modify: `src/hooks/__tests__/use-board.test.ts` (~30 occurrences)
- Modify: `src/actions/__tests__/intel.test.ts` (~12 occurrences)
- Modify: `src/actions/__tests__/mission.test.ts:140`
- Modify: `src/actions/__tests__/follow-up.test.ts:174`
- Modify: `src/actions/__tests__/campaign.test.ts:379`

- [ ] **Step 1: Update type definition**

In `src/types/index.ts`, change line 54:
```typescript
// Before:
export type IntelNoteColumn = 'backlog' | 'planned';
// After:
export type IntelNoteColumn = 'tasked' | 'ops_ready';
```

- [ ] **Step 2: Update schema default**

In `src/lib/db/schema.ts`, find the intelNotes table column field default. Change `'backlog'` to `'tasked'`.

- [ ] **Step 3: Update use-board hook**

In `src/hooks/use-board.ts`:
- Replace `backlog:` with `tasked:` in the columns object (line 9).
- Replace `planned:` with `ops_ready:` (line 10).
- Replace return values `'planned'` with `'ops_ready'` (lines 22, 26).
- Replace `'backlog'` with `'tasked'` (line 27).

- [ ] **Step 4: Update intel-board component**

In `src/components/board/intel-board.tsx`, replace `'backlog'` and `'planned'` in the validColumns array with `'tasked'` and `'ops_ready'`.

- [ ] **Step 5: Update actions**

In `src/actions/intel.ts`, replace all `'backlog'` with `'tasked'` (3 occurrences) and `'planned'` with `'ops_ready'` where applicable.

In `src/actions/campaign.ts`, replace `'planned'` with `'ops_ready'` (line 290).

In `src/actions/campaign-helpers.ts`, replace `'backlog'` with `'tasked'` (2 occurrences).

In `src/actions/mission.ts`, replace `'backlog'` with `'tasked'` (2 occurrences).

- [ ] **Step 6: Update test fixtures**

In `src/lib/test/fixtures.ts`, replace `column: 'backlog'` with `column: 'tasked'`.

- [ ] **Step 7: Update tests**

In `src/hooks/__tests__/use-board.test.ts`, replace all `'backlog'` with `'tasked'` and all `'planned'` with `'ops_ready'` (~30 occurrences).

In `src/actions/__tests__/intel.test.ts`, replace all `'backlog'` with `'tasked'` and `'planned'` with `'ops_ready'` (~12 occurrences).

In `src/actions/__tests__/mission.test.ts`, `follow-up.test.ts`, `campaign.test.ts`, replace `'backlog'` with `'tasked'`.

- [ ] **Step 8: Run tests and build**

```bash
pnpm test --run && pnpm build
```
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "rename: IntelNoteColumn 'backlog'→'tasked', 'planned'→'ops_ready'"
```

---

### Task 5: Rename button labels

12 locations. String-only changes in UI components and their tests.

**Files:**
- Modify: `src/components/mission/mission-actions.tsx` (lines 236, 242, 257)
- Modify: `src/components/campaign/campaign-live-view.tsx` (lines 120, 130)
- Modify: `src/components/asset/asset-form.tsx:130`
- Modify: `src/components/general/new-session-modal.tsx:87`
- Modify: `src/app/(hq)/battlefields/[id]/campaigns/new/form.tsx:85`
- Modify: `src/actions/mission.ts` (lines 471, 546, 563, 569, 574 — `[RETRY MERGE]` log prefix)
- Modify: Any test files asserting on these button labels

- [ ] **Step 1: Update mission-actions.tsx**

In `src/components/mission/mission-actions.tsx`:

Replace the RETRY REVIEW button text:
```typescript
// Before:
{isPending ? 'REVIEWING...' : 'RETRY REVIEW'}
// After:
{isPending ? 'REVIEWING...' : 'RESUBMIT REVIEW'}
```

Replace the RETRY MERGE button text and tooltip:
```typescript
// Before tooltip:
'Retry merging the worktree branch into the target branch.'
// After:
'Reintegrate the worktree branch into the target branch.'

// Before button:
{isPending ? 'MERGING...' : 'RETRY MERGE'}
// After:
{isPending ? 'REINTEGRATING...' : 'REINTEGRATE'}
```

- [ ] **Step 2: Update campaign-live-view.tsx**

In `src/components/campaign/campaign-live-view.tsx`:
```typescript
// Before toast:
toast.success('Retrying debrief generation...');
// After:
toast.success('Resubmitting debrief generation...');

// Before toast error:
toast.error(err instanceof Error ? err.message : 'Retry failed');
// After:
toast.error(err instanceof Error ? err.message : 'Resubmit failed');

// Before button:
{isPending ? 'RETRYING...' : 'RETRY DEBRIEF'}
// After:
{isPending ? 'RESUBMITTING...' : 'RESUBMIT DEBRIEF'}
```

- [ ] **Step 3: Update asset-form.tsx**

In `src/components/asset/asset-form.tsx`:
```typescript
// Before:
{isPending ? 'DEPLOYING...' : editAsset ? 'UPDATE ASSET' : 'RECRUIT'}
// After:
{isPending ? 'DEPLOYING...' : editAsset ? 'MODIFY ASSET' : 'RECRUIT'}
```

- [ ] **Step 4: Update new-session-modal.tsx**

In `src/components/general/new-session-modal.tsx`:
```typescript
// Before:
CREATE
// After:
OPEN CHANNEL
```

- [ ] **Step 5: Update campaign creation form**

In `src/app/(hq)/battlefields/[id]/campaigns/new/form.tsx`:
```typescript
// Before:
{submitting ? 'CREATING...' : 'CREATE CAMPAIGN'}
// After:
{submitting ? 'PLANNING...' : 'PLAN CAMPAIGN'}
```

- [ ] **Step 6: Update log prefixes in mission actions**

In `src/actions/mission.ts`, replace all `[RETRY MERGE]` log prefixes with `[REINTEGRATE]` and `'RETRY MERGE AGENT FAILED'` with `'REINTEGRATE AGENT FAILED'`.

- [ ] **Step 7: Update test assertions**

Search for tests asserting on any of the old button labels and update them. Key files to check:
- `src/components/campaign/__tests__/campaign-controls.test.tsx` — uses `CREATE CAMPAIGN` in assertions? Check.
- Any test asserting on `RETRY REVIEW`, `RETRY MERGE`, `RETRY DEBRIEF`, `UPDATE ASSET`, `CREATE` (in general context).

- [ ] **Step 8: Run tests and build**

```bash
pnpm test --run && pnpm build
```
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "rename: button labels to tactical terminology"
```

---

### Task 6: Update CLAUDE.md terminology table

After all renames are done, update the CLAUDE.md domain model tables to reflect the new values.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update terminology references**

In the Status Terms table, no changes needed (those are already thematic).

Update any references to `standard`, `normal`, `backlog`, `planned`, `log`, `status`, `error` in the context of these renamed concepts.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: update CLAUDE.md with new tactical terminology"
```
