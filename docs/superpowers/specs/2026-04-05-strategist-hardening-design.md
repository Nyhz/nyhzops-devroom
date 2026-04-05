# STRATEGIST Hardening — Design

**Date:** 2026-04-05
**Status:** Draft
**Related:** Mirrors the Overseer hardening pattern from `feat/overseer-hardening` (merged `de65322`).

## Problem

STRATEGIST is the campaign planning asset. It runs inside the briefing chat, receives a high-level objective from the Commander, and produces a structured JSON plan with phases, missions, asset assignments, and mission types.

Several correctness and drift issues have accumulated since the asset roster and ROE were reworked:

1. **Stale asset routing hint.** `src/lib/briefing/briefing-prompt.ts:101` hardcodes a prose line: *"OPERATIVE for backend code, VANGUARD for frontend, ARCHITECT for system design/refactoring, ASSERT for testing, INTEL for docs/project intelligence."* After commit `842d5d1` (feat(assets): redesign mission asset prompts and add CIPHER), OPERATIVE is the generalist catch-all and CIPHER is the backend/APIs/data/auth specialist. The hint actively routes backend work to the wrong asset and never mentions CIPHER. The dynamic roster below contradicts the hint in the same prompt.

2. **Planning contract duplicated in three places.** The JSON schema, the `direct_action` / `verification` mission-type rules, and the planning rules appear in:
   - `scripts/seed.ts:130-169` (stored system prompt)
   - `src/lib/briefing/briefing-prompt.ts` (runtime first-message prompt)
   - `src/lib/briefing/briefing-engine.ts:162-185` (GENERATE PLAN self-contained fallback blob)

   The seed copy has already drifted — its schema uses `asset` where the other two use `assetCodename`, and it omits `summary`, `dependsOn`, and `priority`. Any future change to the contract has to be made in three files.

3. **Asset-roster formatting is duplicated.** `briefing-prompt.ts:38-53` and `briefing-engine.ts:169` both `.filter(...).map(...)` over the asset list to build STRATEGIST's roster view. Not a drift risk today (both read the DB), but it's the same logic in two places.

4. **Thin asset descriptions.** The roster shows `- CIPHER: Backend / APIs / data / auth` — just the `specialty` field. For user-created specialists whose specialty label is ambiguous (e.g. *"Animation & motion design"*), STRATEGIST has no idea what the asset actually does. The asset's `systemPrompt` contains a one-line identity statement that would resolve this at zero cost.

5. **No prompt caching.** The runtime prompt is prepended to stdin on the first message of a briefing. This means CLAUDE.md, SPEC.md, the planning contract, and the asset roster are **not** in the `--append-system-prompt` slot, so they are not eligible for prompt caching across briefings on the same battlefield. The Overseer hardening already established the pattern of hoisting stable context into the system prompt slot for cache hits (`62010b6`).

6. **Crude context truncation.** CLAUDE.md and SPEC.md are each hard-sliced at 8000 characters. No test pins the cap. Overseer pinned its cap to exactly 3000 chars with a test (`14ffa8b`).

7. **No retry on GENERATE PLAN parse failure.** If the STRATEGIST's plan response is not valid JSON, the briefing emits a generic error and stops. The Overseer hardening added a distinct notification for review parse failures (`32d59e3`) — STRATEGIST should similarly distinguish this failure mode, and ideally auto-retry once with a stricter re-prompt before giving up.

8. **No tests.** `briefing-prompt.ts` has no unit tests. None of the prompt composition, truncation, or roster formatting is pinned.

## Goals

- STRATEGIST's view of the asset roster comes from a single function that both the runtime prompt and the GENERATE PLAN fallback call.
- Adding a new asset via the UI causes STRATEGIST to see it on the next briefing, with a meaningful description, with no code changes.
- The planning contract (JSON schema + mission-type rules + planning rules) lives in one module. Seed prompt, runtime prompt, and GENERATE PLAN fallback all import from it.
- Stable context (identity + contract + CLAUDE.md + SPEC.md) is hoisted into `--append-system-prompt` for prompt-cache hits across messages within a briefing.
- Truncation caps are pinned with tests.
- GENERATE PLAN parse failures auto-retry once and surface a distinct notification on final failure.
- Unit tests cover the new roster helper, the contract module, and `buildBriefingPrompt` composition.

## Non-goals

- Context-awareness expansion (recent commits, recent campaigns, current branch state). Deferred to a follow-up.
- Any change to the STRATEGIST asset's model, max-turns, skills, or MCP configuration.
- Any change to the briefing chat UI.
- Any change to the Plan JSON schema itself — we are only consolidating where it is defined and referenced.

## Design

### 1. Asset roster SSOT — `formatAssetRoster`

New module `src/lib/briefing/asset-roster.ts`:

```ts
import type { Asset } from '@/types';

/**
 * Renders the set of assets STRATEGIST is allowed to assign missions to.
 * Excludes system assets (STRATEGIST, OVERSEER, QUARTERMASTER, GENERAL).
 * Each line is: "- CODENAME (specialty): first-line identity from systemPrompt".
 * Sorted by codename for deterministic output (useful for tests and cache hits).
 */
export function formatAssetRoster(allAssets: Asset[]): string { /* ... */ }

/** Extract the first non-empty line of an asset's system prompt, trimmed to 200 chars. */
export function extractAssetIdentityLine(systemPrompt: string | null): string { /* ... */ }
```

Behavior:

- Filter: `status === 'active' && isSystem === 0`. This is stricter than the current filter (`codename !== 'STRATEGIST'`), which would include OVERSEER, QUARTERMASTER, and GENERAL in the roster. Those are never assignable as mission assets.
- Sort: ascending by codename. Deterministic ordering means the rendered roster is stable across calls, which matters for prompt caching.
- Line format: `- ${codename} (${specialty}): ${identityLine}`
- Identity line: first non-empty line of the asset's `systemPrompt`, with any leading "You are CODENAME — " prefix stripped, truncated to 200 chars. If the systemPrompt is null or empty, the line falls back to just `- ${codename} (${specialty})` with no colon.
- The function does NOT hit the database. Callers pass in the asset list they already loaded.

Example output (with real current assets):

```
- ARCHITECT (System design & refactoring): the refactoring and architecture specialist...
- ASSERT (Testing & QA): the testing specialist...
- CIPHER (Backend / APIs / data / auth): the backend, API, data, and auth specialist...
- INTEL (Docs & project intelligence): the documentation and project intelligence specialist...
- OPERATIVE (Generalist / catch-all): the generalist...
- VANGUARD (Frontend engineering): the frontend specialist...
```

### 2. Planning contract SSOT — `briefing-contract.ts`

New module `src/lib/briefing/briefing-contract.ts` exports:

```ts
/** The full planning contract block — identity, mission types, JSON schema, rules. */
export const BRIEFING_CONTRACT: string;

/** Just the JSON schema + "output raw JSON only" rules. Used by GENERATE PLAN. */
export const GENERATE_PLAN_CONTRACT: string;

/** Minimal contract summary for the stored seed prompt (so the DB copy can't drift). */
export const SEED_CONTRACT_SUMMARY: string;
```

Content:

- `BRIEFING_CONTRACT` contains the identity paragraph, conversation-mode orders, mission-type rules (`direct_action` vs `verification`), planning rules, the JSON schema, and the "CRITICAL FORMAT RULES FOR GENERATE PLAN" block. Everything that is currently duplicated across the three files.
- `GENERATE_PLAN_CONTRACT` is the subset needed when STRATEGIST has already been in conversation and receives `GENERATE PLAN` — the JSON schema plus the strict "raw JSON only" rules plus the mission-type definitions. The GENERATE PLAN fallback in `briefing-engine.ts` imports this instead of hand-rolling the rules.
- `SEED_CONTRACT_SUMMARY` is a short paragraph suitable for the stored seed prompt: identity + "the full contract is supplied at runtime." This follows the pattern GENERAL already uses at `scripts/seed.ts:116-122`, which explicitly notes *"the runtime /general chat delivers a more detailed persona... This stored prompt exists for reference and UI display."*

### 3. Runtime prompt composition

`src/lib/briefing/briefing-prompt.ts` is rewritten to compose from the SSOT modules:

```ts
import { BRIEFING_CONTRACT } from './briefing-contract';
import { formatAssetRoster } from './asset-roster';

export function buildBriefingPrompt(params: {
  campaignName: string;
  campaignObjective: string;
  battlefieldCodename: string;
  claudeMdPath: string | null;
  specMdPath: string | null;
  allAssets: Asset[];
}): string { /* composes from SSOT */ }
```

No more hardcoded routing prose. The `formatAssetRoster(params.allAssets)` output is the only place STRATEGIST learns which assets exist, and the `BRIEFING_CONTRACT` is the only place it learns how to assign them.

### 4. Hoisting stable context into `--append-system-prompt`

Stable content = identity + planning contract + CLAUDE.md + SPEC.md. These do not change turn-to-turn within a briefing.

Volatile content = campaign name, campaign objective, battlefield codename, asset roster, current Commander message.

Wait — the asset roster is arguably stable within a single briefing session (assets don't change mid-briefing), but volatile across briefings. For prompt caching we care about stability *within* a session (multiple turns of the same briefing), so the roster can go into the stable slot.

New helper `buildBriefingSystemPrompt(params)` returns the string to pass via `--append-system-prompt`. It contains:

1. STRATEGIST identity (from the stored asset `systemPrompt`, which is already passed via `buildAssetCliArgs` → we need to be careful not to duplicate it).
2. `BRIEFING_CONTRACT`.
3. Truncated CLAUDE.md (cap pinned; see §6).
4. Truncated SPEC.md (cap pinned; see §6).
5. `formatAssetRoster(allAssets)`.

The volatile parts (campaign name/objective/battlefield, Commander message) stay in stdin.

Mechanics: `buildAssetCliArgs(strategistAsset)` already emits `--append-system-prompt <seed systemPrompt>`. We need to replace or extend that value with the composed system prompt. Two options:

- **Option A:** Filter out the `--append-system-prompt` flag that `buildAssetCliArgs` produced, then re-add our composed version. Similar to how `briefing-engine.ts:122` already filters `--max-turns`.
- **Option B:** Add a second `--append-system-prompt` flag (if the CLI accepts multiple and concatenates them). Riskier — behavior undocumented.

**Chosen: Option A.** Explicit, mirrors the existing pattern, no ambiguity. The seed `systemPrompt` (reduced to `SEED_CONTRACT_SUMMARY` per §2) is effectively replaced at runtime by the fully-composed prompt. This is acceptable because the seed version exists primarily for UI display and parity with GENERAL's pattern — see §2.

### 5. GENERATE PLAN path

`briefing-engine.ts` GENERATE PLAN branch (currently lines 150-185) is rewritten:

- The self-contained blob no longer hand-rolls the schema and rules. It imports `GENERATE_PLAN_CONTRACT` and composes: conversation history + campaign/battlefield line + `formatAssetRoster(allAssets)` + `GENERATE_PLAN_CONTRACT` + "The Commander has issued GENERATE PLAN."
- Same fresh-process / no-resume behavior as today — the rationale (old session lacks strict format rules) still holds. With the contract now hoisted into the system prompt for the *next* briefing, this could be revisited later, but not in this pass.

### 6. Pinned truncation caps

New constants in `briefing-contract.ts` (or a dedicated `briefing-limits.ts` — single small file either way):

```ts
export const CLAUDE_MD_CAP = 4000;
export const SPEC_MD_CAP = 4000;
```

`buildBriefingSystemPrompt` uses these. Tests pin them exactly (mirroring `14ffa8b`'s Overseer test).

Rationale for 4000 (down from the current 8000): the Overseer pinned at 3000 chars for CLAUDE.md alone. STRATEGIST is a planning asset and benefits from richer project context than Overseer (which only judges debriefs), so we bias slightly higher — but still half the current cap to keep cache-eligible content tight. Combined budget: ~8000 chars of project docs plus contract plus roster.

### 7. GENERATE PLAN parse retry + distinct notification

Current flow (`briefing-engine.ts:307-354`):

1. Wait for process close.
2. Try `extractPlanJSON(responseText)`.
3. If null, emit `briefing:error` with a generic message.
4. If extraction throws, emit `briefing:error` with `Plan extraction failed: ...`.

New flow:

1. Wait for process close.
2. Try `extractPlanJSON(responseText)`.
3. If the plan parses and validates → proceed as today.
4. If parsing fails → **spawn one retry** with a stricter re-prompt: the original `GENERATE_PLAN_CONTRACT` plus a one-line prefix *"Your previous response was not valid JSON. Output ONLY the JSON object now — no prose, no code fences, no preamble."* The retry reuses the same fresh-process / no-resume mechanism.
5. If the retry also fails → emit a **distinct** socket event `briefing:plan-parse-failed` (in addition to writing the usual stored message) so the UI can render a specific error state. This mirrors the Overseer's distinct review-parse-failure notification from `32d59e3`.

The retry is bounded (single attempt) and only triggers for parse failures, not for other process errors. Cycle detection and schema validation errors are NOT retried — those indicate STRATEGIST understood the format but produced invalid content, which retrying will not fix.

### 8. Stored seed prompt refresh

`scripts/seed.ts` STRATEGIST entry is rewritten to use `SEED_CONTRACT_SUMMARY`. The stored prompt becomes short and explicitly defers to runtime composition, following the GENERAL pattern. This eliminates the drifted schema in the seed (`asset` vs `assetCodename`, missing fields) because the seed no longer contains a schema at all.

No database migration is needed — the seed script upgrades the row on next run. Existing installs will still have the stale prompt until re-seeded, but this is acceptable because `buildAssetCliArgs` replaces it at runtime with the composed version (per §4).

### 9. Tests

New test files:

- `src/lib/briefing/__tests__/asset-roster.test.ts`
  - Roster excludes system assets.
  - Roster excludes inactive assets.
  - Roster is sorted by codename.
  - Identity line strips "You are X — " prefix.
  - Identity line truncates to 200 chars.
  - Null systemPrompt → line has no identity segment.
  - Empty roster → stable empty-state output.

- `src/lib/briefing/__tests__/briefing-prompt.test.ts`
  - System prompt includes identity, contract, CLAUDE.md (when present), SPEC.md (when present), roster.
  - CLAUDE.md truncation cap pinned to exactly 4000 chars.
  - SPEC.md truncation cap pinned to exactly 4000 chars.
  - Missing CLAUDE.md / SPEC.md paths do not throw.
  - Roster comes from `formatAssetRoster` (spy / snapshot).

- `src/lib/briefing/__tests__/briefing-contract.test.ts`
  - `BRIEFING_CONTRACT` contains the strings `direct_action`, `verification`, `dependsOn`, `assetCodename`, `summary`, `phases`.
  - `GENERATE_PLAN_CONTRACT` starts with the strict "raw JSON only" directive.
  - `SEED_CONTRACT_SUMMARY` is shorter than 1000 chars (parity with GENERAL's stub length).

Retry logic in `briefing-engine.ts` gets test coverage via the existing `src/actions/__tests__/briefing.test.ts` pattern — one new case for "retries once on parse failure, emits distinct event on final failure." If mocking the spawned Claude process there is too invasive, we accept integration-only coverage for the retry and focus the new unit tests on the pure-function modules.

## File touches (summary)

New:
- `src/lib/briefing/asset-roster.ts`
- `src/lib/briefing/briefing-contract.ts`
- `src/lib/briefing/__tests__/asset-roster.test.ts`
- `src/lib/briefing/__tests__/briefing-prompt.test.ts`
- `src/lib/briefing/__tests__/briefing-contract.test.ts`

Modified:
- `src/lib/briefing/briefing-prompt.ts` — composes from SSOT modules; no hardcoded routing.
- `src/lib/briefing/briefing-engine.ts` — filters and replaces `--append-system-prompt`; GENERATE PLAN uses `GENERATE_PLAN_CONTRACT`; parse retry + distinct notification.
- `scripts/seed.ts` — STRATEGIST entry uses `SEED_CONTRACT_SUMMARY`.
- `src/actions/__tests__/briefing.test.ts` — (optional) retry-path coverage.

## Risks & mitigations

- **Risk:** Hoisting content into `--append-system-prompt` changes what STRATEGIST sees on the first turn in subtle ways. Mitigation: the contract strings are ported verbatim from the current runtime prompt where possible, so the information content is identical; only the delivery slot changes.
- **Risk:** `--append-system-prompt` may have a length ceiling we do not know about. Mitigation: truncation caps keep the total well under 20KB; test locally with a representative battlefield before merging.
- **Risk:** The parse-failure retry could loop if the retry also fails in a way that throws. Mitigation: retry is strictly bounded to one attempt, enforced by a simple counter variable, not a loop.
- **Risk:** Existing briefings in-flight during a deploy could hit a mid-conversation contract change. Mitigation: briefings are short-lived and resumed via `--resume` only within a single chat session; worst case is one awkward turn, which is acceptable.

## Verification plan

Per the project memory rule *"verify with pnpm build"*:

1. `pnpm test -- briefing` — all new unit tests pass.
2. `pnpm build` — full Next.js build succeeds (catches type errors `tsc` alone misses).
3. Manual smoke test: create a briefing on a real battlefield, confirm STRATEGIST's first response references CIPHER correctly when the objective involves backend work, then run `GENERATE PLAN` and confirm the plan parses.
4. Manual smoke test for retry: temporarily force a parse failure (e.g. inject a prefix into the stdin prompt that causes STRATEGIST to add commentary) and confirm the distinct `briefing:plan-parse-failed` event fires.
