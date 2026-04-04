# Codebase Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplication, simplify overengineered patterns, fix all TS/lint errors. Leave the codebase at its cleanest state.

**Architecture:** Extract shared utilities (`filterFlag`, `createAuthenticatedHome`, `parseDecision`) into canonical modules, deduplicate plan insertion logic, simplify JSON parsing, split the 1062-line campaign.ts into 3 focused files, fix all 22 TS errors and 59 ESLint issues.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM, Socket.IO, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-codebase-cleanup-design.md`

---

### Task 1: Extract `filterFlag` to shared utility

**Files:**
- Create: `src/lib/utils/cli.ts`
- Modify: `src/lib/orchestrator/asset-cli.ts` (remove local `filterFlag`)
- Modify: `src/lib/overseer/overseer.ts:138-144` (remove local `filterFlag`)
- Modify: `src/lib/overseer/debrief-reviewer.ts:83-90` (remove local `filterFlag`)
- Modify: `src/lib/overseer/phase-failure-handler.ts:18-25` (remove local `filterFlag`)
- Modify: `src/lib/quartermaster/conflict-resolver.ts:15-22` (remove local `filterFlag`)
- Modify: `src/lib/general/general-engine.ts:19-26` (remove local `filterFlags`)

- [ ] **Step 1: Create `src/lib/utils/cli.ts`**

```typescript
/**
 * Filter a flag and its value from a CLI args array.
 * E.g., filterFlag(['--max-turns', '5', '--model', 'x'], '--max-turns') => ['--model', 'x']
 */
export function filterFlag(args: string[], flag: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) { i++; continue; }
    result.push(args[i]);
  }
  return result;
}

/**
 * Filter multiple flags and their values from a CLI args array.
 */
export function filterFlags(args: string[], flags: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) { i++; continue; }
    result.push(args[i]);
  }
  return result;
}
```

- [ ] **Step 2: Update all 6 consumers**

In each file, remove the local `filterFlag`/`filterFlags` function and add the import:

**`src/lib/orchestrator/asset-cli.ts`** — This file doesn't have `filterFlag` but uses it elsewhere. Check if it uses it — skip if not.

**`src/lib/overseer/overseer.ts`** — Remove lines 136-144 (the `filterFlag` function). Add import at top:
```typescript
import { filterFlag } from '@/lib/utils/cli';
```

**`src/lib/overseer/debrief-reviewer.ts`** — Remove lines 79-90. Add import:
```typescript
import { filterFlag } from '@/lib/utils/cli';
```

**`src/lib/overseer/phase-failure-handler.ts`** — Remove lines 15-25. Add import:
```typescript
import { filterFlag } from '@/lib/utils/cli';
```

**`src/lib/quartermaster/conflict-resolver.ts`** — Remove lines 12-22. Add import:
```typescript
import { filterFlag } from '@/lib/utils/cli';
```

**`src/lib/general/general-engine.ts`** — Remove lines 19-26 (named `filterFlags`). Add import:
```typescript
import { filterFlags } from '@/lib/utils/cli';
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase.

- [ ] **Step 4: Also remove stale eslint-disable directive in `asset-cli.ts`**

`src/lib/orchestrator/asset-cli.ts:71` has an unused `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directive. Remove it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/cli.ts src/lib/overseer/overseer.ts src/lib/overseer/debrief-reviewer.ts src/lib/overseer/phase-failure-handler.ts src/lib/quartermaster/conflict-resolver.ts src/lib/general/general-engine.ts src/lib/orchestrator/asset-cli.ts
git commit -m "refactor: extract filterFlag/filterFlags to shared utility

Removes 6 identical copies across overseer, quartermaster, general,
and debrief-reviewer modules."
```

---

### Task 2: Deduplicate HOME isolation — use `createAuthenticatedHome` everywhere

**Files:**
- Modify: `src/lib/process/claude-print.ts` (add `createAuthenticatedHomeAt` variant)
- Modify: `src/lib/orchestrator/executor.ts:259-276` (replace inline HOME setup)
- Modify: `src/lib/general/general-engine.ts:137-150` (replace inline HOME setup)
- Modify: `src/lib/briefing/briefing-engine.ts:201-214` (replace inline HOME setup)

The existing `createAuthenticatedHome()` in `claude-print.ts` creates a random temp path. But `executor.ts`, `general-engine.ts`, and `briefing-engine.ts` use deterministic paths (`/tmp/claude-config/{id}`, `/tmp/claude-general-{id}`, `/tmp/claude-briefing-{id}`) for session persistence with `--resume`.

- [ ] **Step 1: Add `createAuthenticatedHomeAt` to `claude-print.ts`**

Add after the existing `createAuthenticatedHome` function (after line 70):

```typescript
/**
 * Set up an isolated HOME at a specific path (for session persistence with --resume).
 * Same credential/config extraction as createAuthenticatedHome, but caller controls the path.
 */
export function createAuthenticatedHomeAt(homePath: string): string {
  const claudeDir = path.join(homePath, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  const realHome = process.env.HOME || os.homedir();

  try {
    fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(homePath, '.claude.json'));
  } catch { /* fine */ }

  try {
    fs.copyFileSync(path.join(realHome, '.claude', 'settings.json'), path.join(claudeDir, 'settings.json'));
  } catch { /* fine */ }

  const cred = extractKeychainCredentials();
  if (cred) {
    fs.writeFileSync(path.join(claudeDir, '.credentials.json'), cred, { mode: 0o600 });
  }

  return homePath;
}
```

Also refactor `createAuthenticatedHome` to delegate:

```typescript
export function createAuthenticatedHome(): string {
  const tempHome = `/tmp/claude-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return createAuthenticatedHomeAt(tempHome);
}
```

- [ ] **Step 2: Update `executor.ts`**

Replace lines 259-276 (the inline HOME setup block) with:

```typescript
import { createAuthenticatedHomeAt } from '@/lib/process/claude-print';
```

(Add to imports at top, remove `extractKeychainCredentials` import if it exists.)

Replace the inline block with:

```typescript
    const missionHome = createAuthenticatedHomeAt(`/tmp/claude-config/${mission.id}`);
```

Also remove the `import os from 'os'` and `import fs from 'fs'` if they're no longer needed after this change. Check remaining usages first — executor likely still uses `fs` for other things (log file cleanup, etc.), so keep them if so.

- [ ] **Step 3: Update `general-engine.ts`**

Replace lines 137-150 (inline HOME setup) with:

```typescript
import { createAuthenticatedHomeAt } from '@/lib/process/claude-print';
```

Replace the block with:

```typescript
  const persistentHome = createAuthenticatedHomeAt(`/tmp/claude-general-${sessionId}`);
```

Remove `extractKeychainCredentials` from existing imports. Remove `import os from 'os'` if no longer used.

- [ ] **Step 4: Update `briefing-engine.ts`**

Replace lines 201-214 (inline HOME setup) with:

```typescript
import { createAuthenticatedHomeAt } from '@/lib/process/claude-print';
```

Replace the block with:

```typescript
  const persistentHome = createAuthenticatedHomeAt(`/tmp/claude-briefing-${campaignId}`);
```

Remove `extractKeychainCredentials` from imports (line 6). Remove `import os from 'os'` (line 2) if no longer used.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase.

- [ ] **Step 6: Commit**

```bash
git add src/lib/process/claude-print.ts src/lib/orchestrator/executor.ts src/lib/general/general-engine.ts src/lib/briefing/briefing-engine.ts
git commit -m "refactor: deduplicate HOME isolation via createAuthenticatedHomeAt

Executor, general-engine, and briefing-engine now delegate to the
canonical createAuthenticatedHomeAt from claude-print.ts instead of
inlining credential extraction and config copying."
```

---

### Task 3: Extract overseer `parseDecision` to shared module

**Files:**
- Create: `src/lib/overseer/parse-decision.ts`
- Modify: `src/lib/overseer/overseer.ts:85-132` (remove `parseDecision`, add import)
- Modify: `src/lib/overseer/phase-failure-handler.ts:91-119` (remove `parseDecision`, add import)

- [ ] **Step 1: Create `src/lib/overseer/parse-decision.ts`**

```typescript
import type { OverseerDecision, PhaseFailureDecision } from '@/types';

/**
 * Parse a structured JSON decision from raw Overseer output.
 * Handles markdown fences and extra text around the JSON.
 */
export function parseOverseerDecision(raw: string): OverseerDecision {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      answer: raw.trim(),
      reasoning: 'Failed to parse structured response — using raw output.',
      escalate: false,
      confidence: 'low',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      answer?: string;
      reasoning?: string;
      escalate?: boolean;
      confidence?: string;
    };

    if (!parsed.answer) {
      return {
        answer: raw.trim(),
        reasoning: 'Parsed JSON had no answer field — using raw output.',
        escalate: false,
        confidence: 'low',
      };
    }

    return {
      answer: parsed.answer,
      reasoning: parsed.reasoning || '',
      escalate: parsed.escalate ?? false,
      confidence: (parsed.confidence as OverseerDecision['confidence']) || 'medium',
    };
  } catch {
    return {
      answer: raw.trim(),
      reasoning: 'JSON parse failed — using raw output.',
      escalate: false,
      confidence: 'low',
    };
  }
}

const FALLBACK_PHASE_DECISION: PhaseFailureDecision = {
  decision: 'escalate',
  reasoning: 'Unable to parse Overseer decision. Escalating to Commander.',
};

/**
 * Parse a phase failure decision from raw Overseer output.
 */
export function parsePhaseFailureDecision(raw: string): PhaseFailureDecision {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return FALLBACK_PHASE_DECISION;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      decision?: string;
      reasoning?: string;
      retryBriefings?: Record<string, string>;
    };

    const validDecisions = ['retry', 'skip', 'escalate'] as const;
    const decision = validDecisions.includes(
      parsed.decision as typeof validDecisions[number],
    )
      ? (parsed.decision as PhaseFailureDecision['decision'])
      : 'escalate';

    return {
      decision,
      reasoning: parsed.reasoning || 'No reasoning provided.',
      retryBriefings: decision === 'retry' ? (parsed.retryBriefings || {}) : undefined,
    };
  } catch {
    return FALLBACK_PHASE_DECISION;
  }
}
```

- [ ] **Step 2: Update `overseer.ts`**

Remove lines 85-132 (the `parseDecision` function). Add import:
```typescript
import { parseOverseerDecision } from './parse-decision';
```

Find all call sites of `parseDecision(` in `overseer.ts` and rename to `parseOverseerDecision(`.

- [ ] **Step 3: Update `phase-failure-handler.ts`**

Remove lines 27-30 (the `FALLBACK_DECISION` constant) and lines 91-119 (the `parseDecision` function). Add import:
```typescript
import { parsePhaseFailureDecision } from './parse-decision';
```

Find all call sites of `parseDecision(` and rename to `parsePhaseFailureDecision(`.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overseer/parse-decision.ts src/lib/overseer/overseer.ts src/lib/overseer/phase-failure-handler.ts
git commit -m "refactor: extract parseDecision to shared overseer module

Consolidates identical JSON parsing logic from overseer.ts and
phase-failure-handler.ts into parse-decision.ts."
```

---

### Task 4: Deduplicate `insertPlanFromJSON` — briefing-engine delegates to campaign action

**Files:**
- Modify: `src/actions/campaign.ts:134-198` (export `insertPlanFromJSON`)
- Modify: `src/lib/briefing/briefing-engine.ts:612-675` (remove `insertPlanFromBriefing`, import and call `insertPlanFromJSON`)

- [ ] **Step 1: Export `insertPlanFromJSON` from campaign.ts**

Change line 134 from:
```typescript
function insertPlanFromJSON(
```
to:
```typescript
export function insertPlanFromJSON(
```

- [ ] **Step 2: Replace `insertPlanFromBriefing` in `briefing-engine.ts`**

Remove the entire `insertPlanFromBriefing` function (lines 608-675).

Add import at top:
```typescript
import { insertPlanFromJSON } from '@/actions/campaign';
```

Remove these imports that are no longer needed (only if they're not used elsewhere in the file):
- `assets` from schema import (line 14 — check if used elsewhere)
- `phases` from schema import (line 16 — check if used elsewhere)
- `missions` from schema import (line 17 — check if used elsewhere)

At the call site (line 332), replace:
```typescript
insertPlanFromBriefing(campaignId, campaign.battlefieldId, plan);
```
with:
```typescript
insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);
```

The `detectCycle` call that `insertPlanFromBriefing` had before the insert — move it to just before the `insertPlanFromJSON` call at line 332:
```typescript
// Validate no circular dependencies
const allMissions = plan.phases.flatMap((p) =>
  p.missions.map((m) => ({ title: m.title, dependsOn: m.dependsOn ?? [] })),
);
const cycle = detectCycle(allMissions);
if (cycle) throw new Error(`Plan contains circular dependencies: ${cycle}`);

insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);
```

Keep the `detectCycle` import (from `@/lib/utils/dependency-graph`).

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase.

- [ ] **Step 4: Commit**

```bash
git add src/actions/campaign.ts src/lib/briefing/briefing-engine.ts
git commit -m "refactor: deduplicate plan insertion — briefing-engine delegates to campaign action

Removes insertPlanFromBriefing (duplicate of insertPlanFromJSON) and
imports the canonical version from campaign.ts instead."
```

---

### Task 5: Simplify briefing JSON parsing

**Files:**
- Modify: `src/lib/briefing/briefing-engine.ts:475-606`

- [ ] **Step 1: Simplify `extractPlanJSON`**

Replace lines 475-513 with:

```typescript
function extractPlanJSON(response: string): PlanJSON | null {
  // Best case: the response is pure JSON
  const trimmed = response.trim();
  if (trimmed.startsWith('{')) {
    try {
      const direct = JSON.parse(trimmed) as PlanJSON;
      if (direct.summary && direct.phases) return direct;
    } catch { /* fall through to extraction */ }
  }

  // Find all candidate start positions for the plan JSON object.
  // We search from last to first — the final plan in the response is
  // typically the most complete when GENERAL outputs drafts before the final.
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = response.indexOf('"summary"', searchFrom);
    if (idx === -1) break;
    // Walk backwards to find the opening brace
    const braceIdx = response.lastIndexOf('{', idx);
    if (braceIdx !== -1) candidates.push(braceIdx);
    searchFrom = idx + 1;
  }

  // Try last occurrence first
  for (let i = candidates.length - 1; i >= 0; i--) {
    const result = tryParseFrom(response, candidates[i]);
    if (result) return result;
  }

  return null;
}
```

- [ ] **Step 2: Inline `sanitizeJsonStrings` into `tryParseFrom`**

Replace lines 515-606 (both `tryParseFrom` and `sanitizeJsonStrings`) with a single `tryParseFrom`:

```typescript
function tryParseFrom(text: string, startIndex: number): PlanJSON | null {
  // Track brace depth and string state to find the matching closing brace.
  // Required because briefing text inside JSON strings can contain { } characters.
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(startIndex, i + 1);
        try {
          return JSON.parse(raw) as PlanJSON;
        } catch {
          // LLMs sometimes produce literal control characters inside JSON strings.
          // Sanitize and retry.
          try {
            return JSON.parse(sanitizeControlChars(raw)) as PlanJSON;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/** Replace unescaped control characters inside JSON string values. */
function sanitizeControlChars(raw: string): string {
  const out: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; out.push(ch); continue; }
    if (ch === '\\' && inStr) { esc = true; out.push(ch); continue; }
    if (ch === '"') { inStr = !inStr; out.push(ch); continue; }
    if (inStr && ch.charCodeAt(0) < 0x20) {
      if (ch === '\n') out.push('\\n');
      else if (ch === '\r') out.push('\\r');
      else if (ch === '\t') out.push('\\t');
      else out.push(`\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}
```

- [ ] **Step 3: Reduce excessive logging in the GENERATE PLAN block**

In the same file, find the GENERATE PLAN block (~lines 324-365). Replace the 6 `console.log` statements with 2:

Keep only:
```typescript
console.log(`[BRIEFING] Plan generated for campaign ${campaignId}: ${plan.phases.length} phases, ${totalMissions} missions`);
```

Remove:
- `console.log(\`[BRIEFING] GENERATE PLAN triggered...`
- `console.log(\`[BRIEFING] Response length...`
- `console.log(\`[BRIEFING] Plan inserted into DB\``
- `console.log(\`[BRIEFING] Campaign status → planning\``
- `console.log(\`[BRIEFING] briefing:plan-ready emitted...`

Keep the `console.error` on failure — that's important.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing/briefing-engine.ts
git commit -m "refactor: simplify briefing JSON parsing and reduce logging

Streamlined extractPlanJSON candidate search, inlined sanitizeJsonStrings
as sanitizeControlChars, reduced GENERATE PLAN logging from 6 to 1 line."
```

---

### Task 6: Use StreamParser in general-engine.ts

**Files:**
- Modify: `src/lib/general/general-engine.ts:162-199`

- [ ] **Step 1: Replace inline stream parsing with StreamParser**

Add import at top of `general-engine.ts`:
```typescript
import { StreamParser } from '@/lib/orchestrator/stream-parser';
```

Replace lines 162-199 (the inline `proc.stdout.on('data', ...)` block) with:

```typescript
  const parser = new StreamParser();
  let lineBuffer = '';

  parser.onDelta((text) => {
    fullResponse += text;
    io.to(room).emit('general:chunk', { sessionId, content: text });
  });

  parser.onResult((result) => {
    const sid = parser.getSessionId();
    if (sid) extractedSessionId = sid;
    if (!fullResponse && result.result && typeof result.result === 'string') {
      fullResponse = result.result;
      io.to(room).emit('general:chunk', { sessionId, content: result.result });
    }
  });

  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) parser.feed(line);
    }
  });
```

Note: `StreamParser` also tracks `sessionId` internally via `getSessionId()`. After process close, check:
```typescript
if (!extractedSessionId) {
  extractedSessionId = parser.getSessionId();
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

- [ ] **Step 3: Commit**

```bash
git add src/lib/general/general-engine.ts
git commit -m "refactor: use StreamParser in general-engine instead of inline parsing

Replaces 30 lines of reimplemented stream parsing with the canonical
StreamParser class from orchestrator/stream-parser.ts."
```

---

### Task 7: Split `campaign.ts` into 3 files

**Files:**
- Modify: `src/actions/campaign.ts` (keep CRUD + lifecycle + helpers)
- Create: `src/actions/campaign-plan.ts` (plan management functions)
- Create: `src/actions/campaign-overrides.ts` (mission/phase override functions)

- [ ] **Step 1: Create `src/actions/campaign-plan.ts`**

Move these functions from `campaign.ts`:
- `insertPlanFromJSON` (already exported from Task 4)
- `deletePlanData`
- `cloneCampaignPlan`
- `updateBattlePlan`
- `backToDraft`

The file should start with:
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets, battlefields, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import type { PlanJSON } from '@/types';
import { revalidateCampaignPaths } from './campaign';
```

Move each function as-is. Export `insertPlanFromJSON` and `deletePlanData` (used by other files).

- [ ] **Step 2: Create `src/actions/campaign-overrides.ts`**

Move these functions from `campaign.ts`:
- `tacticalOverride`
- `commanderOverride`
- `skipMission`
- `retryPhaseDebrief`
- `skipPhaseDebrief`
- `skipAndContinueCampaign`
- `updateMissionSkillOverrides`

The file should start with:
```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets, battlefields, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
import type { Campaign } from '@/types';
import { reactivateCampaignIfNeeded, notifyCampaignExecutor, revalidateCampaignPaths } from './campaign';
```

Move each function as-is.

- [ ] **Step 3: Export helpers from `campaign.ts`**

In `campaign.ts`, export the helper functions that the new files need:
```typescript
export function reactivateCampaignIfNeeded(campaignId: string) { ... }
export async function notifyCampaignExecutor(campaignId: string, missionId: string) { ... }
export function revalidateCampaignPaths(battlefieldId: string, campaignId?: string) { ... }
```

Remove the moved functions from `campaign.ts`. Keep: `createCampaign`, `getCampaign`, `listCampaigns`, `updateCampaign`, `deleteCampaign`, `launchCampaign`, `completeCampaign`, `abandonCampaign`, `redeployCampaign`, `saveAsTemplate`, `runTemplate`, `listTemplates`, `resumeCampaign`, and the helper functions.

- [ ] **Step 4: Update imports across the codebase**

Search for imports from `@/actions/campaign` that reference moved functions. Update them to import from the new files:

```bash
grep -rn "from '@/actions/campaign'" src/ --include="*.ts" --include="*.tsx"
```

For each file that imports a moved function, update the import path. Common patterns:
- Components importing `tacticalOverride`, `commanderOverride`, `skipMission` → import from `@/actions/campaign-overrides`
- Components importing `updateBattlePlan`, `backToDraft` → import from `@/actions/campaign-plan`
- `briefing-engine.ts` importing `insertPlanFromJSON` → import from `@/actions/campaign-plan`

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase.

- [ ] **Step 6: Commit**

```bash
git add src/actions/campaign.ts src/actions/campaign-plan.ts src/actions/campaign-overrides.ts src/
git commit -m "refactor: split campaign.ts into 3 focused files

campaign.ts: CRUD + lifecycle + helpers (~550 lines)
campaign-plan.ts: plan management (insert, delete, update, backToDraft)
campaign-overrides.ts: mission/phase overrides (tactical, commander, skip, retry)"
```

---

### Task 8: Fix TypeScript errors — production code

**Files:**
- Modify: `src/components/ui/tac-card.tsx:5`
- Modify: `src/components/asset/asset-profile-tab.tsx:111`
- Modify: `src/lib/utils/dependency-graph.ts:61`

- [ ] **Step 1: Add `"teal"` to TacCard status prop**

In `src/components/ui/tac-card.tsx`, change line 5:
```typescript
  status?: 'green' | 'amber' | 'red' | 'blue' | 'dim';
```
to:
```typescript
  status?: 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'dim';
```

Add `teal` to `statusBorderStyles` (after line 14):
```typescript
  teal: 'border-l-2 border-l-dr-teal',
```

- [ ] **Step 2: Fix `asset-profile-tab.tsx` null handling**

At line 111, change:
```typescript
<TacSelect value={effort} onValueChange={(val) => setEffort(val)}>
```
to:
```typescript
<TacSelect value={effort} onValueChange={(val) => setEffort(val ?? '')}>
```

- [ ] **Step 3: Fix `dependency-graph.ts` type**

Line 61: `cyclePath.join(' -> ')` errors because `cyclePath` is typed as `string[] | null` but at this point it's checked for null on line 60. The issue is likely that TypeScript doesn't narrow after the early return. The actual code at line 60-61:

```typescript
  if (!cyclePath) return null;
  return `Circular dependency: ${cyclePath.join(' -> ')}`;
```

This should work. Let me check — the error says `.join` doesn't exist on type `never`. This means `cyclePath` is being narrowed to `never` — likely because it's declared as `let cyclePath: string[] | null = null` and TypeScript sees that it's only set inside a nested function (the `dfs` closure), which TS can't track mutations for.

Fix by adding a type assertion:
```typescript
  if (!cyclePath) return null;
  return `Circular dependency: ${(cyclePath as string[]).join(' -> ')}`;
```

Or better — return from within `dfs` and restructure. But the assertion is cleaner for this cleanup.

- [ ] **Step 4: Verify production TS errors fixed**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "__tests__\|test/" | grep -v "api/test"` — should be empty.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/tac-card.tsx src/components/asset/asset-profile-tab.tsx src/lib/utils/dependency-graph.ts
git commit -m "fix: resolve TypeScript errors in production code

- Add 'teal' to TacCard status prop union
- Handle null in asset-profile-tab TacSelect onChange
- Fix cyclePath type narrowing in dependency-graph"
```

---

### Task 9: Fix TypeScript errors — test code

**Files:**
- Modify: `src/app/api/test/seed-active-campaign/route.ts`
- Modify: `src/app/api/test/seed-campaign/route.ts`
- Modify: `src/components/__tests__/battlefield-selector.test.tsx`
- Modify: `src/hooks/__tests__/use-socket.test.ts`
- Modify: `src/lib/socket/__tests__/emit.test.ts`
- Modify: `src/lib/discovery/__tests__/skill-scanner.test.ts`
- Modify: `src/lib/test/db.ts`
- Modify: `src/lib/test/mock-db.ts`
- Modify: `src/components/ui/__tests__/tac-select.test.tsx`

- [ ] **Step 1: Fix seed routes — remove `updatedAt` from asset insert**

In both `src/app/api/test/seed-active-campaign/route.ts` and `src/app/api/test/seed-campaign/route.ts`, find the `db.insert(assets).values({...})` call and remove the `updatedAt` property from the values object. The assets schema doesn't have an `updatedAt` column.

- [ ] **Step 2: Fix `battlefield-selector.test.tsx` — add missing fields**

In `src/components/__tests__/battlefield-selector.test.tsx`, find the mock battlefield object (around line 24) and add the missing fields:

```typescript
{
  id: '1',
  name: 'Test Battlefield',
  codename: 'TEST',
  description: null,
  initialBriefing: null,
  repoPath: '/tmp/test',
  defaultBranch: null,
  claudeMdPath: null,
  specMdPath: null,
  status: 'active',
  worktreeMode: 'auto',
  autoStartDevServer: 0,
  devServerCommand: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as Battlefield
```

- [ ] **Step 3: Fix `use-socket.test.ts` — add null assertions**

In `src/hooks/__tests__/use-socket.test.ts`, for lines 14-16, add `!` after `result.current`:
```typescript
expect(result.current!.connected).toBe(false);
```

Or wrap in an `if` guard.

- [ ] **Step 4: Fix `emit.test.ts` — add null guards**

In `src/lib/socket/__tests__/emit.test.ts`, add `!` after `io` at lines 32, 38, 124, 192:
```typescript
io!.to(...).emit(...)
```

- [ ] **Step 5: Fix `skill-scanner.test.ts` — fix Dirent mock types**

The issue is `Dirent<string>` vs `Dirent<NonSharedBuffer>`. In the mock `readdirSync` implementations, cast the return:
```typescript
vi.spyOn(fs, 'readdirSync').mockImplementation(((p: PathLike, _opts: any) => {
  // ... existing logic
}) as typeof fs.readdirSync);
```

Use `as typeof fs.readdirSync` to avoid the type mismatch. Or use `as any` since it's a test mock.

- [ ] **Step 6: Fix `mock-db.ts` and `db.ts` type issues**

`src/lib/test/mock-db.ts:21` — add type assertion for the mock:
```typescript
.where(eq(table.id as any, id as any))
```

`src/lib/test/db.ts:54` — fix the symbol index type:
```typescript
const key = column as string;
```
or cast as needed.

- [ ] **Step 7: Fix `tac-select.test.tsx` — update callback signature**

Change line 17:
```typescript
onValueChange?: (val: string) => void;
```
to:
```typescript
onValueChange?: (val: string | null) => void;
```

- [ ] **Step 8: Verify all TS errors fixed**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — should be 0.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/test/ src/components/__tests__/ src/hooks/__tests__/ src/lib/socket/__tests__/ src/lib/discovery/__tests__/ src/lib/test/ src/components/ui/__tests__/
git commit -m "fix: resolve all TypeScript errors in test files

- Remove updatedAt from seed route asset inserts (not in schema)
- Add missing Battlefield fields in test mock
- Add null assertions for test helpers
- Fix Dirent mock types in skill-scanner tests
- Fix mock-db and test db type assertions
- Update tac-select test callback signature"
```

---

### Task 10: Fix ESLint errors — setState-in-effect and impure render

**Files:**
- Modify: `src/app/error.tsx`
- Modify: `src/components/asset/asset-deployment.tsx`
- Modify: `src/components/board/note-panel.tsx`
- Modify: `src/components/layout/collapsible-sidebar.tsx`
- Modify: `src/components/warroom/boot-gate.tsx`
- Modify: `src/components/asset/asset-skills-tab.tsx`
- Modify: `src/components/git/git-log.tsx`
- Modify: `src/components/mission/merge-countdown.tsx`
- Modify: `src/lib/test/component-setup.ts`

- [ ] **Step 1: Fix `error.tsx` — use lazy initializer**

Replace:
```typescript
const [quote, setQuote] = useState(ERROR_QUOTES[0]);

useEffect(() => {
  setQuote(ERROR_QUOTES[Math.floor(Math.random() * ERROR_QUOTES.length)]);
}, []);
```
with:
```typescript
const [quote] = useState(() => ERROR_QUOTES[Math.floor(Math.random() * ERROR_QUOTES.length)]);
```

Remove the `useEffect` import if it's the only usage. Keep `useState`.

- [ ] **Step 2: Fix `asset-deployment.tsx` — use lazy initializer for peaceMsg**

Replace:
```typescript
const [peaceMsg, setPeaceMsg] = useState(PEACE_MESSAGES[0]);

useEffect(() => {
  setPeaceMsg(getPeaceMessage());
}, []);
```
with:
```typescript
const [peaceMsg] = useState(() => getPeaceMessage());
```

The second ESLint error at line 47 (`refresh()` called in effect) is a legitimate data-fetch pattern — calling an async function that does `setData(result)` inside an effect is correct. Suppress with:
```typescript
// eslint-disable-next-line react-hooks/set-state-in-effect
refresh();
```

- [ ] **Step 3: Fix `note-panel.tsx` — sync form state from props**

The pattern of resetting form state when `note` prop changes is legitimate (syncing internal state from external prop). This is a valid use of `useEffect` + `setState`. Suppress:
```typescript
useEffect(() => {
  if (note === null) {
    setTitle(''); // eslint-disable-line react-hooks/set-state-in-effect
    setDescription(''); // eslint-disable-line react-hooks/set-state-in-effect
  } else {
    setTitle(note.title); // eslint-disable-line react-hooks/set-state-in-effect
    setDescription(note.description ?? ''); // eslint-disable-line react-hooks/set-state-in-effect
  }
}, [note]);
```

Or better — derive from `note` directly with `useMemo` and lift state to key-based reset. But that's a larger refactor. The suppress is acceptable here.

- [ ] **Step 4: Fix `collapsible-sidebar.tsx` — use lazy initializer**

Replace:
```typescript
const [expanded, setExpanded] = useState(false);

useEffect(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "expanded") {
      setExpanded(true);
    }
  } catch {
    // localStorage unavailable
  }
}, []);
```
with:
```typescript
const [expanded, setExpanded] = useState(() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "expanded";
  } catch {
    return false;
  }
});
```

Remove the `useEffect` block.

- [ ] **Step 5: Fix `boot-gate.tsx` — use lazy initializer**

Replace:
```typescript
const [state, setState] = useState<'pending' | 'booting' | 'done'>('pending');

useEffect(() => {
  if (sessionStorage.getItem('devroom-booted') === 'true') {
    setState('done');
  } else {
    setState('booting');
  }
}, []);
```
with:
```typescript
const [state, setState] = useState<'booting' | 'done'>(() => {
  try {
    return sessionStorage.getItem('devroom-booted') === 'true' ? 'done' : 'booting';
  } catch {
    return 'booting';
  }
});
```

Note: This removes the `'pending'` state entirely — it was only used during the brief moment before the effect ran (SSR → client hydration). Using a lazy initializer means the state is correct from the first render. Check that no code references `state === 'pending'` — if it does, keep the `try/catch` for SSR safety.

- [ ] **Step 6: Fix impure render — `Date.now()` calls**

**`asset-skills-tab.tsx:51`** — Replace:
```typescript
const [lastScanned, setLastScanned] = useState(Date.now());
```
with:
```typescript
const [lastScanned, setLastScanned] = useState(() => Date.now());
```

**`git-log.tsx:33`** — Replace:
```typescript
const nowRef = useRef(Date.now());
```
with:
```typescript
const nowRef = useRef<number>(null);
```
And in the existing useEffect:
```typescript
useEffect(() => {
  nowRef.current = Date.now();
}, []);
```

**`merge-countdown.tsx:6`** — Replace:
```typescript
const [remaining, setRemaining] = useState(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
```
with:
```typescript
const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
```

- [ ] **Step 7: Fix `component-setup.ts` — replace require with import**

In `src/lib/test/component-setup.ts:30`, replace:
```typescript
const { createElement } = require('react');
return createElement('a', { href, ...props }, children);
```
with:
```typescript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createElement } = require('react');
return createElement('a', { href, ...props }, children);
```

Note: In a vi.mock factory, dynamic `import()` doesn't work — vi.mock is hoisted and must be synchronous. So `require` is the correct approach. Suppress the lint rule.

- [ ] **Step 8: Verify ESLint errors fixed**

Run: `npx eslint src/ --max-warnings 999 2>&1 | grep -c " error "` — should be 0.

- [ ] **Step 9: Commit**

```bash
git add src/app/error.tsx src/components/asset/asset-deployment.tsx src/components/board/note-panel.tsx src/components/layout/collapsible-sidebar.tsx src/components/warroom/boot-gate.tsx src/components/asset/asset-skills-tab.tsx src/components/git/git-log.tsx src/components/mission/merge-countdown.tsx src/lib/test/component-setup.ts
git commit -m "fix: resolve all ESLint errors

- Replace setState-in-effect with lazy useState initializers
- Wrap Date.now() in lazy initializers for render purity
- Suppress legitimate setState-in-effect patterns with comments
- Suppress require() in vi.mock factory (synchronous requirement)"
```

---

### Task 11: Fix ESLint warnings — unused vars and imports

**Files:** ~20 files with unused imports/variables

- [ ] **Step 1: Auto-fix the single auto-fixable warning**

Run: `npx eslint src/lib/orchestrator/asset-cli.ts --fix` (if not already done in Task 1)

- [ ] **Step 2: Fix production code unused imports**

**`src/actions/asset.ts:8`** — Remove unused `Asset` import.

**`src/actions/follow-up.ts:6`** — Remove unused `missions`, `campaigns` imports.

**`src/app/api/test-fixtures/route.ts:3`** — Remove unused `assets` import.

**`src/components/board/intel-board.tsx:12`** — Remove unused `cn` import.

**`src/components/layout/intel-bar.tsx:7`** — Remove unused `cn` import.

**`src/components/asset/asset-profile-tab.tsx:64`** — Remove unused `handleToggleStatus` function.

**`src/lib/orchestrator/prompt-builder.ts:10`** — Remove unused `asset` destructuring.

**`src/components/mission/mission-comms.tsx`**:
- Line 9: Remove unused `TacCard` import.
- Line 10: Remove unused `formatDuration` import.
- Lines 73-80: Remove unused variables `displayOutput`, `displayDuration`, `displayCostUsd`, `cachePercent`. Keep `displayInput`, `displayCacheHit`, `totalInputContext` only if they're used below. If they're all unused now, remove them too.

- [ ] **Step 3: Fix test file unused imports**

For each test file with warnings, remove the unused imports/variables:

**`src/actions/__tests__/battlefield.test.ts`** — Prefix unused vars with `_`: `_asset`, `_older`, `_newer`.

**`src/actions/__tests__/campaign.test.ts`** — Remove unused `missionLogs` import. Prefix `_phase`, `_mission`.

**`src/actions/__tests__/notification.test.ts`** — Prefix `_n1`, `_n2`, `_n3`.

**`src/components/campaign/__tests__/phase-timeline.test.tsx`** — Remove unused `within` import.

**`src/components/ui/__tests__/modal.test.tsx`** — Remove unused `vi` import.

**`src/components/ui/__tests__/tac-badge.test.tsx`** — Remove unused `statusColorMap` import.

**`src/components/ui/__tests__/tac-select.test.tsx`** — Remove unused `vi` import.

**`src/components/ui/__tests__/tac-textarea-with-images.test.tsx`** — Remove unused `ControlledTextarea` import.

**`src/lib/socket/__tests__/emit.test.ts`** — Remove unused `getEmitCalls` variable.

**`src/lib/test/db.ts`** — Remove unused `sql` import.

**`src/hooks/use-streaming-chat.ts:144`** — Prefix unused `_p` parameter.

- [ ] **Step 4: Verify all warnings resolved**

Run: `npx eslint src/ 2>&1 | tail -5` — should show 0 errors, 0 warnings (or very close).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: remove all unused imports and variables

Cleans up 49 ESLint warnings across production and test files."
```

---

### Task 12: Final verification

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 2: Run ESLint**

Run: `npx eslint src/`

Expected: 0 errors, 0 warnings (or minimal acceptable warnings).

- [ ] **Step 3: Run tests**

Run: `pnpm test`

Expected: All tests pass.

- [ ] **Step 4: Verify build**

Run: `pnpm build`

Expected: Build succeeds.
