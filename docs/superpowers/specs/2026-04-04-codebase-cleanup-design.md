# Codebase Cleanup — Reduce Overhead, Unify, Simplify

**Date:** 2026-04-04
**Goal:** Bring the codebase to its cleanest state before continuing new development. Remove duplication, simplify overengineered patterns, fix all TS/lint errors.

---

## Section 1: Extract Shared Utilities

### 1A. `filterFlag()` → `src/lib/utils/cli.ts`

The identical `filterFlag(args, flag)` function exists in **6 files**:
- `orchestrator/asset-cli.ts`
- `overseer/overseer.ts`
- `overseer/debrief-reviewer.ts`
- `overseer/phase-failure-handler.ts`
- `quartermaster/conflict-resolver.ts`
- `general/general-engine.ts`

**Action:** Create `src/lib/utils/cli.ts` with the single canonical export. Replace all 6 copies with imports.

### 1B. `createAuthenticatedHome()` → canonical import everywhere

`src/lib/process/claude-print.ts` already has `createAuthenticatedHome()` and `extractKeychainCredentials()`. But these modules still inline their own HOME isolation:
- `orchestrator/executor.ts` (~27 lines of inline HOME setup)
- `general/general-engine.ts` (~11 lines of inline HOME setup)
- `briefing/briefing-engine.ts` (~8 lines of inline HOME setup)

**Action:** Import `createAuthenticatedHome` from `claude-print.ts` in all three. Delete the inline duplication.

### 1C. Overseer `parseDecision()` → `src/lib/overseer/parse-decision.ts`

Identical `parseDecision()` function in both `overseer.ts` and `phase-failure-handler.ts`.

**Action:** Extract to shared module. Both import from there.

### 1D. `insertPlanFromJSON` — deduplicate

`briefing-engine.ts:insertPlanFromBriefing` and `campaign.ts:insertPlanFromJSON` are 99% identical. The only difference: `insertPlanFromBriefing` runs `detectCycle()` before inserting, and doesn't create `intelNotes`.

**Action:** Keep `insertPlanFromJSON` in `campaign.ts` as the canonical version. Make `briefing-engine.ts` import and call it, running cycle detection before the call. Add an `options.skipIntelNotes` flag if the intel notes divergence matters, or just let briefing also create them (they're harmless backlog entries).

---

## Section 2: Simplify Briefing Engine JSON Parsing

### Current state (135 lines)

`briefing-engine.ts:475-606` contains:
- `extractPlanJSON()` — needle search + candidate sorting
- `tryParseFrom()` — manual brace-depth tracking with string escape state machine
- `sanitizeJsonStrings()` — character-level control character escaping

### Simplified approach (~40 lines)

1. **Try direct `JSON.parse`** on trimmed response (already done, keep as-is)
2. **Find JSON candidates** — instead of manual brace tracking, use a simpler approach: find all substrings starting with `{"summary"`, extract to the matching `}` using `tryParseFrom` BUT simplified
3. **Keep `sanitizeJsonStrings`** — this one is actually needed. LLMs do produce literal newlines inside JSON strings. But inline it as the single fallback inside `tryParseFrom`
4. **Remove the needle array** — just search for `{"summary"` (the whitespace variant `{\n  "summary"` is subsumed by searching for `{` followed by `"summary"` at any position)

The brace-depth tracker in `tryParseFrom` is actually correct and necessary — `JSON.parse` can't find the end of a JSON object embedded in surrounding text. But we can simplify the flow:

```
extractPlanJSON(response):
  1. try JSON.parse(trimmed) → return if valid
  2. find all indices of '{"summary"' and '{\n  "summary"' 
  3. sort descending (last = most complete)
  4. for each: tryParseFrom → return first success
  5. return null

tryParseFrom(text, start):
  1. track brace depth + string state (keep existing logic — it's correct)
  2. on depth=0: try JSON.parse
  3. on parse fail: sanitize control chars, retry
  4. return result or null
```

**Net change:** Remove `sanitizeJsonStrings` as a separate function — inline the control-char replacement into `tryParseFrom`'s catch block. Simplify candidate search. ~95 lines → ~55 lines.

**On reflection:** The brace-depth tracker is not overengineering — it's the only reliable way to find where a JSON object ends in a mixed-content response. The real cleanup is structural: merge `sanitizeJsonStrings` into `tryParseFrom`, simplify needle search, remove redundant comments.

---

## Section 3: Split Monolithic Files

### 3A. `campaign.ts` (1,062 lines → 3 files)

Current: 19 functions covering CRUD, lifecycle, plan management, templates, mission overrides.

Split into:

| File | Functions | ~Lines |
|---|---|---|
| `campaign.ts` | CRUD (create, get, list, update, delete) + lifecycle (launch, complete, abandon, pause, resume) + helpers | ~550 |
| `campaign-plan.ts` | `insertPlanFromJSON`, `deletePlanData`, `cloneCampaignPlan`, `updateBattlePlan`, `revertBattlePlan`, `generateBattlePlan` | ~250 |
| `campaign-overrides.ts` | `commanderOverrideMission`, `tacticalOverrideMission`, `skipMission`, `retryPhaseDebrief`, `skipPhaseDebrief` | ~250 |

Shared helpers (`reactivateCampaignIfNeeded`, `notifyCampaignExecutor`, `revalidateCampaignPaths`) stay in `campaign.ts` and are exported for the other two files.

### 3B. `general-engine.ts` — use `StreamParser`

`general-engine.ts:167-199` reimplements stream parsing inline (~30 lines). The project already has `StreamParser` class in `orchestrator/stream-parser.ts`.

**Action:** Import and use `StreamParser` instead of inline parsing. This is a straightforward swap — StreamParser already handles line buffering, JSON parsing, and event classification.

---

## Section 4: Fix TypeScript Errors (22 errors)

### Production code (5 errors)

| File | Error | Fix |
|---|---|---|
| `src/components/ui/tac-badge.tsx` (via campaigns page, HQ page, phase-timeline) | `StatusColor` includes `"teal"` but badge only accepts 5 colors | Add `"teal"` to badge's color union |
| `src/components/asset/asset-profile-tab.tsx:111` | `string \| null` not assignable to `SetStateAction<string>` | Default to `""` when null |
| `src/lib/utils/dependency-graph.ts:61` | `.join` on `never` type | Fix type narrowing — likely an unreachable code path or incorrect type guard |

### Test code (17 errors)

| Category | Files | Fix |
|---|---|---|
| `Dirent<string>` vs `Dirent<NonSharedBuffer>` | `skill-scanner.test.ts` (5 errors) | Cast mock Dirent types properly |
| `updatedAt` not in asset schema | `seed-active-campaign/route.ts`, `seed-campaign/route.ts` | Remove `updatedAt` from test seed insert (schema doesn't have it) |
| Missing Battlefield fields in mock | `battlefield-selector.test.ts` | Add missing fields to mock object |
| `io` possibly undefined | `emit.test.ts` (4 errors) | Add non-null assertion or null guard |
| `result.current` possibly null | `use-socket.test.ts` (3 errors) | Add non-null assertions |
| `unknown` type issues | `mock-db.ts`, `db.ts` | Fix type casts in test helpers |
| `tac-select.test.tsx` | `onChange` type mismatch | Update callback signature to accept `string \| null` |

---

## Section 5: Fix ESLint Errors (10 errors)

| Category | Files | Fix |
|---|---|---|
| `setState` in effect (6 errors) | `error.tsx`, `asset-deployment.tsx`, `note-panel.tsx`, `collapsible-sidebar.tsx`, `boot-gate.tsx` | Use lazy initializer for `useState` or `useMemo` instead of `useEffect` + `setState` |
| Impure function in render (3 errors) | `asset-skills-tab.tsx`, `git-log.tsx`, `merge-countdown.tsx` | Move `Date.now()` into `useRef` initializer or lazy `useState` |
| `require()` import (1 error) | `lib/test/component-setup.ts` | Convert to ESM `import()` |

---

## Section 6: Fix ESLint Warnings (49 warnings)

All are `@typescript-eslint/no-unused-vars`. Categories:

| Category | Count | Fix |
|---|---|---|
| Unused imports in test files | ~25 | Remove unused imports |
| Unused variables in test files | ~15 | Prefix with `_` or remove |
| Unused imports in production code | ~9 | Remove (`cn`, `TacCard`, `formatDuration`, `Asset`, `missions`, `campaigns`, `assets`, etc.) |

---

## Section 7: Minor Cleanup

- **Remove unused variables in `mission-comms.tsx`** — 4 assigned-but-never-used variables (`displayOutput`, `displayDuration`, `displayCostUsd`, `cachePercent`)
- **Clean up excessive logging in `briefing-engine.ts`** — reduce 6+ console.log statements to 2 (start + result)
- **Remove stale eslint-disable directive** in `asset-cli.ts`

---

## Out of Scope

These were identified but are **not included** in this cleanup:

- **Full unified `spawnClaude()` abstraction** — per user decision, approach A only (shared setup, not unified spawning)
- **Splitting `executor.ts`** — 699 lines is large but the stall detection is tightly coupled to execution; splitting risks introducing bugs in a critical path
- **Splitting `mission-actions.tsx`** — 376 lines with 9 action buttons. Complex but cohesive — it's one component showing contextual actions. Splitting would scatter related logic
- **Campaign cascade optimization** — the O(n^2) `skipMission` loop is correct and operates on tiny sets (missions in a single phase, typically <10). Not worth the abstraction
- **Socket.IO event unification** — would touch every real-time component. Better as its own focused effort
- **N+1 query in `intel.ts`** — performance issue but campaigns have few missions. Not urgent

---

## Estimated Scope

| Category | Changes | Net line impact |
|---|---|---|
| Extract utilities (1A-1D) | 10 files modified, 2 new | -120 lines (duplication removed) |
| Simplify JSON parsing (2) | 1 file | -40 lines |
| Split campaign.ts (3A) | 1 file → 3 files | +0 lines (reorganization) |
| StreamParser in general (3B) | 1 file | -15 lines |
| TS errors (4) | ~12 files | ~+20 lines (type fixes) |
| ESLint errors (5) | ~8 files | ~+5 lines (pattern fixes) |
| ESLint warnings (6) | ~20 files | -50 lines (removed dead code) |
| Minor cleanup (7) | 3 files | -15 lines |
| **Total** | **~40 files** | **~-215 lines** |
