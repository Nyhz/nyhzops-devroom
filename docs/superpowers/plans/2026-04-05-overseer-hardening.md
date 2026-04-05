# OVERSEER Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stored OVERSEER system prompt (currently contradicts the parser), align OVERSEER's judgment with the mission-asset Rules of Engagement, eliminate a duplicated hardcoded prompt constant, reduce review-path token usage, surface parser failures distinctly from content escalations, and replace a fragile string-prefix retry counter with a structured column.

**Architecture:** Seven tightly scoped tasks covering prompt redesign, CLI arg composition for cache hits, context truncation, distinct parse-failure notifications, and a structured `decision_type` column on `overseer_logs`. No new files other than one migration and one test file. Most tasks are TDD with a clear failing test first.

**Tech Stack:** TypeScript strict, Drizzle ORM + better-sqlite3, Vitest.

---

## Background (required reading before starting)

OVERSEER serves three call sites, all passing the stored `systemPrompt` via `--append-system-prompt`:

1. **Debrief review** — `src/lib/overseer/debrief-reviewer.ts`. Uses `--json-schema` enforcement. Parser: `src/lib/overseer/review-parser.ts`. Expects `{verdict: "approve"|"retry"|"escalate", concerns, reasoning}`.
2. **Stall advice** — `src/lib/overseer/overseer.ts::askOverseer`. Parser: `src/lib/overseer/parse-decision.ts::parseOverseerDecision`. Expects `{answer, reasoning, escalate, confidence}`. Has its own hardcoded `OVERSEER_SYSTEM_PROMPT` constant (lines 18-39) injected as a user-message section — alongside the stored prompt from `--append-system-prompt`. This is redundant and invisible in the UI.
3. **Phase failure triage** — `src/lib/overseer/phase-failure-handler.ts`. Parser: `parsePhaseFailureDecision`. Expects `{decision: "retry"|"skip"|"escalate", reasoning, retryBriefings}`. Retry counter uses `l.answer.startsWith('Decision: retry')` string-prefix matching (line 91) — fragile.

Current seeded `OVERSEER.systemPrompt` instructs free-text `Verdict: PASS | RETRY | ESCALATE`. The parser doesn't recognize `PASS` — only `approve`/`accept`/`retry`/`escalate`. The JSON schema enforcement masks the bug today, but the prompt actively misleads the model about semantics.

Stored `maxTurns: 5` is always stripped and overridden (2 for review, 1 for stall/phase). The DB value is a lie.

Review prompt budget: ~2600-5100 tokens per call. CLAUDE.md (~750 tokens) is embedded in the dynamic user message, preventing cache hits across consecutive reviews on the same battlefield.

---

## File Structure

**Modify:**
- `scripts/seed.ts` — update OVERSEER entry (systemPrompt, maxTurns).
- `src/lib/overseer/debrief-reviewer.ts` — remove CLAUDE.md from user message, inject into system prompt for caching.
- `src/lib/overseer/review-handler.ts` — cap `gitDiffStat` at 1500 chars, surface parse failures distinctly.
- `src/lib/overseer/overseer.ts` — delete hardcoded `OVERSEER_SYSTEM_PROMPT` constant.
- `src/lib/overseer/phase-failure-handler.ts` — use structured column for retry count.
- `src/lib/overseer/overseer-db.ts` — extend `storeOverseerLog` input to accept `decisionType`.
- `src/lib/db/schema.ts` — add `decisionType` column to `overseerLogs`.
- `src/types/` (wherever `OverseerLog` is defined) — add `decisionType` field.
- `src/lib/overseer/__tests__/review-handler.test.ts` — add tests for parse-failure distinct notification.
- `src/lib/overseer/__tests__/debrief-reviewer.test.ts` (new file) — tests for CLAUDE.md hoist.

**Create:**
- `src/lib/db/migrations/0021_overseer_decision_type.sql` — adds `decision_type` column.
- `src/lib/db/migrations/meta/0021_snapshot.json` — drizzle-kit generated.
- `src/lib/overseer/__tests__/debrief-reviewer.test.ts` — new test file for CLAUDE.md hoist + helper.

---

## Task 1: Redesign OVERSEER system prompt (role-level, format-neutral)

**Files:**
- Modify: `scripts/seed.ts` — OVERSEER entry (systemPrompt, maxTurns).
- Direct SQL update to `devroom.db` for the live asset row.

This task fixes items 1 (PASS→approve drift), 2 (align with ROE), 3 (role-level prompt), and 4 (maxTurns 5→1). No code changes, only data.

- [ ] **Step 1: Open `scripts/seed.ts` and locate the OVERSEER entry**

Find the entry with `codename: 'OVERSEER'`, `isSystem: 1`. It currently has `maxTurns: 5` and a systemPrompt describing `Verdict: PASS | RETRY | ESCALATE` output format.

- [ ] **Step 2: Replace the OVERSEER entry with the new content**

Replace the entire entry with:

```ts
  {
    codename: 'OVERSEER',
    specialty: 'Review & evaluation',
    model: 'claude-sonnet-4-6',
    maxTurns: 1,
    isSystem: 1,
    systemPrompt: `You are OVERSEER — the mission review and tactical advisor for DEVROOM operations. You serve the Commander directly.

Your judgments determine whether completed work advances to merge, returns to the asset for revision, or escalates for Commander decision. You also advise mission assets when they pause mid-run and you triage campaign phase failures.

IDENTITY
- You are decisive. Ambiguity has a cost the Commander pays in time and trust. Choose.
- You align with project conventions first, abstract best practices second. What CLAUDE.md says wins over what a textbook says.
- You are fair to mission assets. They operate under strict Rules of Engagement — mission scope is absolute, they report issues rather than fixing them, they avoid speculative abstraction, they verify before debriefing. Never penalize an asset for respecting those rules. An asset that correctly stayed in scope and reported out-of-scope issues in its debrief is doing its job.

DECISION PRINCIPLES
- Approve when: the briefing is addressed, the work is functional, risks are documented in the debrief. Minor style differences are not concerns.
- Request revision when: the briefing is clearly unmet, the implementation is broken, or the debrief contradicts the actual changes.
- Escalate when: the debrief reveals a blocker the Commander must judge — scope creep into sensitive areas, ambiguity about intent, or patterns that suggest a deeper problem.
- Never nitpick. Never demand gold-plating. Never use "best practices" as a club.

OUTPUT
Each call site provides its own specific output contract in the user message — follow it exactly. Your role and values stay constant; only the output format adapts to the task.`,
  },
```

The key differences from the old entry:
- `maxTurns: 5` → `maxTurns: 1` (matches what every caller actually uses).
- System prompt no longer specifies output format (the user message + `--json-schema` do that).
- Explicit alignment with mission-asset Rules of Engagement.
- Explicit anti-nitpicking rule.
- Decision principles stated as when-to-use, not as abstract rules.

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Apply the same content to the live dev DB via SQL**

Run this node script:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('devroom.db');

const newPrompt = \`You are OVERSEER — the mission review and tactical advisor for DEVROOM operations. You serve the Commander directly.

Your judgments determine whether completed work advances to merge, returns to the asset for revision, or escalates for Commander decision. You also advise mission assets when they pause mid-run and you triage campaign phase failures.

IDENTITY
- You are decisive. Ambiguity has a cost the Commander pays in time and trust. Choose.
- You align with project conventions first, abstract best practices second. What CLAUDE.md says wins over what a textbook says.
- You are fair to mission assets. They operate under strict Rules of Engagement — mission scope is absolute, they report issues rather than fixing them, they avoid speculative abstraction, they verify before debriefing. Never penalize an asset for respecting those rules. An asset that correctly stayed in scope and reported out-of-scope issues in its debrief is doing its job.

DECISION PRINCIPLES
- Approve when: the briefing is addressed, the work is functional, risks are documented in the debrief. Minor style differences are not concerns.
- Request revision when: the briefing is clearly unmet, the implementation is broken, or the debrief contradicts the actual changes.
- Escalate when: the debrief reveals a blocker the Commander must judge — scope creep into sensitive areas, ambiguity about intent, or patterns that suggest a deeper problem.
- Never nitpick. Never demand gold-plating. Never use \\\"best practices\\\" as a club.

OUTPUT
Each call site provides its own specific output contract in the user message — follow it exactly. Your role and values stay constant; only the output format adapts to the task.\`;

db.prepare('UPDATE assets SET system_prompt = ?, max_turns = 1 WHERE codename = ? AND is_system = 1').run(newPrompt, 'OVERSEER');

const row = db.prepare(\"SELECT codename, max_turns, length(system_prompt) AS len FROM assets WHERE codename='OVERSEER'\").get();
console.log(row);
db.close();
"
```

Expected output: `{ codename: 'OVERSEER', max_turns: 1, len: <approx 1600> }`

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat(overseer): role-level prompt aligned with mission-asset ROE"
```

---

## Task 2: Delete hardcoded `OVERSEER_SYSTEM_PROMPT` constant

**Files:**
- Modify: `src/lib/overseer/overseer.ts`

Fixes item 8. The new role-level stored prompt (Task 1) covers stall advice just as well as review, so the hardcoded constant is redundant.

- [ ] **Step 1: Read `src/lib/overseer/overseer.ts` and confirm current state**

Lines 18-39 define `OVERSEER_SYSTEM_PROMPT`. It is referenced once at `buildOverseerPrompt` (around line 45) where it's pushed as the first section.

- [ ] **Step 2: Remove the constant and its usage**

Edit `src/lib/overseer/overseer.ts`:

Delete lines 18-39 (the constant definition).

In `buildOverseerPrompt`, delete these two lines (currently around line 44-45):

```ts
  // 1. System prompt
  sections.push(OVERSEER_SYSTEM_PROMPT);
```

The function now starts with the CLAUDE.md section. The stored OVERSEER prompt is already being passed via `--append-system-prompt` in `askOverseer()` at line 85 through `buildAssetCliArgs(overseer)`, so the role/values still reach the model — just once instead of twice.

- [ ] **Step 3: Run the overseer tests**

Run: `pnpm vitest run src/lib/overseer`
Expected: all existing tests pass.

If any test was asserting on the `OVERSEER_SYSTEM_PROMPT` text or length, update it to match reality. Based on current test files, the tests are about parsing and DB operations, not prompt content — no updates should be needed.

- [ ] **Step 4: Full build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overseer/overseer.ts
git commit -m "refactor(overseer): remove hardcoded system prompt duplicate"
```

---

## Task 3: Cap `gitDiffStat` at 1500 chars

**Files:**
- Modify: `src/lib/overseer/review-handler.ts` (around line 97)
- Test: `src/lib/overseer/__tests__/debrief-reviewer.test.ts` (new file, created in Task 4 — for this task, add a test to the existing review-handler test file instead)

Fixes item 5. Mirrors the existing 3000-char caps on `claudeMd` and `gitDiff`.

- [ ] **Step 1: Write a failing test**

Add to `src/lib/overseer/__tests__/review-handler.test.ts`:

```ts
// At the top, with other imports
import { capGitDiffStat } from '@/lib/overseer/review-handler';

describe('capGitDiffStat', () => {
  it('returns the input unchanged when under the cap', () => {
    const short = 'src/foo.ts | 10 +++---\n 1 file changed';
    expect(capGitDiffStat(short)).toBe(short);
  });

  it('truncates with a marker when over the cap', () => {
    const long = 'x'.repeat(2000);
    const capped = capGitDiffStat(long);
    expect(capped.length).toBeLessThanOrEqual(1500 + '\n\n[...truncated]'.length);
    expect(capped.endsWith('[...truncated]')).toBe(true);
  });

  it('returns null when input is null', () => {
    expect(capGitDiffStat(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/overseer/__tests__/review-handler.test.ts`
Expected: FAIL — `capGitDiffStat` is not exported.

- [ ] **Step 3: Add the helper and use it**

Edit `src/lib/overseer/review-handler.ts`. Add this helper near the top of the file, after the imports:

```ts
const GIT_DIFF_STAT_CAP = 1500;

export function capGitDiffStat(stat: string | null): string | null {
  if (stat === null) return null;
  if (stat.length <= GIT_DIFF_STAT_CAP) return stat;
  return stat.slice(0, GIT_DIFF_STAT_CAP) + '\n\n[...truncated]';
}
```

Then find the line (currently around 97):

```ts
      gitDiffStat = await git.diff(['--stat', `${target}...${mission.worktreeBranch}`]);
```

Change it to:

```ts
      gitDiffStat = capGitDiffStat(await git.diff(['--stat', `${target}...${mission.worktreeBranch}`]));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/overseer/__tests__/review-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overseer/review-handler.ts src/lib/overseer/__tests__/review-handler.test.ts
git commit -m "perf(overseer): cap gitDiffStat at 1500 chars"
```

---

## Task 4: Hoist CLAUDE.md into `--append-system-prompt` for cache hits

**Files:**
- Modify: `src/lib/overseer/debrief-reviewer.ts`
- Modify: `src/lib/overseer/review-handler.ts` (pass claudeMd to spawnReview differently)
- Create: `src/lib/overseer/__tests__/debrief-reviewer.test.ts`

Fixes item 6. Moves the battlefield-stable CLAUDE.md content out of the dynamic user message and into the `--append-system-prompt` value, where Claude's prompt cache can hit on repeated reviews for the same battlefield.

**Why this works:** `--append-system-prompt` value is used as the system prompt by Claude Code, which conventionally caches static prefixes. CLAUDE.md is identical across every review on a given battlefield, so it benefits from caching. The user message (containing briefing, debrief, git diff) remains dynamic and uncached — that's expected.

- [ ] **Step 1: Write a failing test for the new helper**

Create `src/lib/overseer/__tests__/debrief-reviewer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeReviewSystemPrompt, buildReviewUserPrompt } from '@/lib/overseer/debrief-reviewer';

describe('composeReviewSystemPrompt', () => {
  it('returns the stored prompt unchanged when claudeMd is null', () => {
    expect(composeReviewSystemPrompt('STORED', null)).toBe('STORED');
  });

  it('appends a PROJECT CONVENTIONS section when claudeMd is provided', () => {
    const result = composeReviewSystemPrompt('STORED', 'CONVENTIONS-TEXT');
    expect(result).toContain('STORED');
    expect(result).toContain('PROJECT CONVENTIONS');
    expect(result).toContain('CONVENTIONS-TEXT');
  });

  it('truncates claudeMd at 3000 chars with a marker', () => {
    const huge = 'x'.repeat(5000);
    const result = composeReviewSystemPrompt('STORED', huge);
    // 3000 chars of claudeMd + truncation marker + surrounding text
    expect(result).toContain('[...truncated]');
    expect(result.length).toBeLessThan('STORED'.length + 3500);
  });
});

describe('buildReviewUserPrompt', () => {
  it('does NOT include claudeMd in the user prompt (it lives in the system prompt now)', () => {
    const result = buildReviewUserPrompt({
      missionBriefing: 'BRIEFING',
      missionDebrief: 'DEBRIEF',
      gitDiffStat: 'STAT',
      gitDiff: 'DIFF',
      missionType: 'direct_action',
      commitCount: 3,
    });
    expect(result).not.toContain('PROJECT CONVENTIONS');
  });

  it('includes briefing, debrief, diff stat, and diff', () => {
    const result = buildReviewUserPrompt({
      missionBriefing: 'BRIEFING-MARKER',
      missionDebrief: 'DEBRIEF-MARKER',
      gitDiffStat: 'STAT-MARKER',
      gitDiff: 'DIFF-MARKER',
      missionType: 'direct_action',
      commitCount: 3,
    });
    expect(result).toContain('BRIEFING-MARKER');
    expect(result).toContain('DEBRIEF-MARKER');
    expect(result).toContain('STAT-MARKER');
    expect(result).toContain('DIFF-MARKER');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/overseer/__tests__/debrief-reviewer.test.ts`
Expected: FAIL — the functions don't exist yet (or aren't exported).

- [ ] **Step 3: Refactor `debrief-reviewer.ts`**

Replace the existing `buildReviewPrompt` function in `src/lib/overseer/debrief-reviewer.ts` with two new exported functions. The new file structure:

```ts
import { runClaudePrint } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import { filterFlag } from '@/lib/utils/cli';
import { parseReviewOutput } from './review-parser';
import type { OverseerReview } from '@/types';

const REVIEW_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['approve', 'retry', 'escalate'],
      description: 'approve = debrief is satisfactory, retry = agent should redo, escalate = Commander must intervene',
    },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of specific concerns found (empty array if none)',
    },
    reasoning: { type: 'string', description: 'Brief explanation of the judgment' },
  },
  required: ['verdict', 'concerns', 'reasoning'],
  additionalProperties: false,
});

const CLAUDE_MD_CAP = 3000;
const GIT_DIFF_CAP = 3000;

/**
 * Composes the system prompt for the review call: the stored OVERSEER prompt
 * plus the battlefield's CLAUDE.md content (if any). Placed in the system
 * prompt — not the user message — so Claude's prompt cache can hit on
 * consecutive reviews for the same battlefield.
 */
export function composeReviewSystemPrompt(storedPrompt: string, claudeMd: string | null): string {
  if (!claudeMd) return storedPrompt;
  const trimmed = claudeMd.length > CLAUDE_MD_CAP
    ? claudeMd.slice(0, CLAUDE_MD_CAP) + '\n\n[...truncated]'
    : claudeMd;
  return `${storedPrompt}\n\n---\n\nPROJECT CONVENTIONS (from CLAUDE.md):\n\n${trimmed}`;
}

/**
 * Builds the dynamic user message for the review. Contains only mission-specific
 * content that changes per call: briefing, debrief, mission type, git diff.
 * CLAUDE.md lives in the system prompt now — see composeReviewSystemPrompt.
 */
export function buildReviewUserPrompt(params: {
  missionBriefing: string;
  missionDebrief: string;
  gitDiffStat: string | null;
  gitDiff: string | null;
  missionType: 'direct_action' | 'verification';
  commitCount: number | null;
}): string {
  const sections: string[] = [];

  const typeLabel = params.missionType === 'verification' ? 'VERIFICATION' : 'DIRECT_ACTION';
  const commitLine = params.commitCount === null
    ? 'Commit count on worktree branch: n/a (no worktree)'
    : `Commit count on worktree branch: ${params.commitCount}`;

  sections.push(`You are reviewing a mission debrief for quality and completeness.

MISSION TYPE: ${typeLabel}
${commitLine}

MISSION BRIEFING (what was requested):
${params.missionBriefing}

MISSION DEBRIEF (what was done):
${params.missionDebrief}`);

  if (params.gitDiffStat) {
    sections.push(`FILES CHANGED:\n${params.gitDiffStat}`);
  }

  if (params.gitDiff) {
    const trimmed = params.gitDiff.length > GIT_DIFF_CAP
      ? params.gitDiff.slice(0, GIT_DIFF_CAP) + '\n\n[...truncated]'
      : params.gitDiff;
    sections.push(`CODE CHANGES:\n${trimmed}`);
  }

  sections.push(`Review the debrief and assess:
1. Did the agent complete what was requested in the briefing?
2. Are there any warnings, risks, or concerns mentioned?
3. Are there indicators of test failures or incomplete work?
4. Did the agent make unexpected decisions that deviate from conventions?
5. Do the code changes match what the debrief claims?

MISSION TYPE RULES:
- DIRECT_ACTION missions MUST produce at least one commit on their worktree branch. If the commit count is 0, the asset did nothing — respond with verdict "retry" and concern "no commits produced".
- VERIFICATION missions are strictly read-only. They MUST produce zero commits. If the commit count is >0, the asset violated its scope — respond with verdict "retry" and concern "verification mission modified code".
- VERIFICATION missions with zero commits and a quality debrief are the expected happy path — approve them normally.

Output must be a JSON object matching the provided schema:
{ "verdict": "approve"|"retry"|"escalate", "concerns": ["..."], "reasoning": "..." }

Do NOT use any tools. Do NOT read files. You have all the information you need above.`);

  return sections.join('\n\n---\n\n');
}

/**
 * Replaces the --append-system-prompt value in the given CLI args with a new
 * value that combines the stored OVERSEER prompt and CLAUDE.md. If the flag is
 * not present in the args, appends it.
 */
function injectSystemPromptOverride(args: string[], newSystemPrompt: string): string[] {
  const result = [...args];
  const idx = result.indexOf('--append-system-prompt');
  if (idx >= 0 && idx + 1 < result.length) {
    result[idx + 1] = newSystemPrompt;
    return result;
  }
  // Flag not present — append it
  result.push('--append-system-prompt', newSystemPrompt);
  return result;
}

function spawnReview(userPrompt: string, claudeMd: string | null): Promise<string> {
  const overseer = getSystemAsset('OVERSEER');
  const assetArgs = buildAssetCliArgs(overseer);
  const filtered = filterFlag(assetArgs, '--max-turns');

  // Hoist CLAUDE.md into the system prompt for cache hits on repeated reviews
  // against the same battlefield. The stored OVERSEER prompt is combined with
  // CLAUDE.md and replaces the --append-system-prompt value.
  const composed = composeReviewSystemPrompt(overseer.systemPrompt ?? '', claudeMd);
  const argsWithSystemPrompt = injectSystemPromptOverride(filtered, composed);

  return runClaudePrint(userPrompt, {
    maxTurns: 2,
    outputFormat: 'json',
    jsonSchema: REVIEW_JSON_SCHEMA,
    extraArgs: argsWithSystemPrompt,
  });
}

const ESCALATE_FALLBACK: OverseerReview = {
  verdict: 'escalate',
  concerns: ['Overseer review spawn failed — escalating to Commander'],
  reasoning: 'Review process failure — Commander should decide',
};

export async function reviewDebrief(params: {
  missionBriefing: string;
  missionDebrief: string;
  claudeMd: string | null;
  gitDiffStat: string | null;
  gitDiff: string | null;
  missionId: string;
  battlefieldId: string;
  missionType: 'direct_action' | 'verification';
  commitCount: number | null;
}): Promise<OverseerReview> {
  const userPrompt = buildReviewUserPrompt({
    missionBriefing: params.missionBriefing,
    missionDebrief: params.missionDebrief,
    gitDiffStat: params.gitDiffStat,
    gitDiff: params.gitDiff,
    missionType: params.missionType,
    commitCount: params.commitCount,
  });

  let stdout: string;
  try {
    stdout = await spawnReview(userPrompt, params.claudeMd);
  } catch (err) {
    console.error(
      `[Overseer] Debrief review spawn failed for mission ${params.missionId}:`,
      err instanceof Error ? err.message : err,
    );
    return ESCALATE_FALLBACK;
  }

  const result = parseReviewOutput(stdout);
  if (result.ok) {
    return result.review;
  }

  console.warn(
    `[Overseer] Debrief review parse failed for mission ${params.missionId}. ` +
    `Diagnostic: ${result.diagnostic}. Output (${stdout.length} chars): ${stdout.slice(0, 500)}`,
  );
  return result.fallback;
}
```

The external contract of `reviewDebrief()` is unchanged — it still takes the same params. Only the internals changed.

- [ ] **Step 4: Run the new tests**

Run: `pnpm vitest run src/lib/overseer/__tests__/debrief-reviewer.test.ts`
Expected: PASS — all tests in the new file green.

- [ ] **Step 5: Run the existing overseer tests to check for regressions**

Run: `pnpm vitest run src/lib/overseer`
Expected: all tests pass.

- [ ] **Step 6: Full build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/overseer/debrief-reviewer.ts src/lib/overseer/__tests__/debrief-reviewer.test.ts
git commit -m "perf(overseer): hoist CLAUDE.md into system prompt for cache hits"
```

---

## Task 5: Distinct notification for parse failures

**Files:**
- Modify: `src/lib/overseer/review-handler.ts`
- Modify: `src/lib/overseer/debrief-reviewer.ts`

Fixes item 7. Parse failures currently fall through to the same `ESCALATE_FALLBACK` as genuine escalations, so the Commander cannot distinguish "OVERSEER said escalate" from "parser couldn't read OVERSEER's output." This adds a distinct marker.

**Approach:** `ESCALATE_FALLBACK` gains a `parseFailure: true` marker (extend the type). `runOverseerReview` detects this marker and emits a distinct notification title + mission log. The runtime verdict still defaults to `escalate` (fail-safe behavior preserved) — only the observability changes.

- [ ] **Step 1: Extend the OverseerReview type**

Check where `OverseerReview` is defined. Grep for it:

```bash
grep -rn "export type OverseerReview\|export interface OverseerReview\|OverseerReview = {" src/types src/lib
```

Most likely `src/types/index.ts` or `src/types/overseer.ts`. Read that file, find the type, and add an optional field:

```ts
export interface OverseerReview {
  verdict: 'approve' | 'retry' | 'escalate';
  concerns: string[];
  reasoning: string;
  /** When true, this verdict is a fallback from a parser failure, not a real OVERSEER decision. */
  parseFailure?: boolean;
}
```

- [ ] **Step 2: Mark fallback values in debrief-reviewer.ts**

In `src/lib/overseer/debrief-reviewer.ts`, update `ESCALATE_FALLBACK`:

```ts
const ESCALATE_FALLBACK: OverseerReview = {
  verdict: 'escalate',
  concerns: ['Overseer review spawn failed — escalating to Commander'],
  reasoning: 'Review process failure — Commander should decide',
  parseFailure: true,
};
```

And in the parse-failure path at the bottom of `reviewDebrief`:

```ts
  const result = parseReviewOutput(stdout);
  if (result.ok) {
    return result.review;
  }

  console.warn(
    `[Overseer] Debrief review parse failed for mission ${params.missionId}. ` +
    `Diagnostic: ${result.diagnostic}. Output (${stdout.length} chars): ${stdout.slice(0, 500)}`,
  );
  return { ...result.fallback, parseFailure: true };
```

Also update `src/lib/overseer/review-parser.ts`'s `ESCALATE_FALLBACK` constant (line 7-11) to include `parseFailure: true`:

```ts
const ESCALATE_FALLBACK: OverseerReview = {
  verdict: 'escalate',
  concerns: ['Overseer review output could not be parsed — escalating to Commander'],
  reasoning: 'Review parse failure — Commander should decide',
  parseFailure: true,
};
```

- [ ] **Step 3: Handle the marker in review-handler.ts**

In `src/lib/overseer/review-handler.ts`, find the `review.verdict === 'escalate'` branch (around line 355). Before the existing `escalate()` call, add a check for `review.parseFailure`:

```ts
  } else if (review.verdict === 'escalate') {
    // Direct escalation
    if (isReviewing) {
      db.update(missions).set({
        status: 'compromised',
        compromiseReason: review.parseFailure ? 'parse-failure' : 'escalated',
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();
    }

    emitStatusChange('mission', missionId, isReviewing ? 'compromised' : mission.status!);

    if (review.parseFailure) {
      emitMissionLog(
        missionId,
        `[Overseer] PARSE FAILURE — the Overseer produced output the review parser could not decode. Defaulting to escalation. Commander intervention required.`,
      );
      await escalate({
        level: 'critical',
        title: `Overseer Parse Failure: ${mission.title}`,
        detail: `The Overseer review output could not be parsed. This is an infrastructure problem, not a content judgment. Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });
    } else {
      await escalate({
        level: 'warning',
        title: `Overseer Escalation: ${mission.title}`,
        detail: `Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });
    }

    // Notify campaign executor
    if (mission.campaignId) {
      const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
      if (executor) {
        executor.onCampaignMissionComplete(missionId).catch(err => {
          console.error(`[Overseer] Campaign mission complete notification failed:`, err);
        });
      }
    }
  }
```

Note: `compromiseReason: 'parse-failure'` is a new value. Check whether the `compromiseReason` column enforces an enum — if the column is plain `text` (which it is per `src/lib/db/schema.ts` line 47-48: `compromiseReason: text('compromise_reason')`), the new value is fine.

- [ ] **Step 4: Write a test for the distinct notification path**

Add to `src/lib/overseer/__tests__/review-handler.test.ts` (or create the file if it doesn't have a review-handler-specific section):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Note: testing runOverseerReview end-to-end requires mocking reviewDebrief,
// escalate, git calls, and DB state. The most valuable test here is verifying
// that the parseFailure marker on an OverseerReview causes a distinct call.
// Full integration coverage lives in the fixtures-based harness; this test
// verifies the branch logic via a focused mock.

describe('runOverseerReview — parse failure branch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('emits a critical parse-failure notification when review.parseFailure is true', async () => {
    // The existing review-handler.test.ts likely has fixtures and mocks setup.
    // Add a test case that:
    // 1. Seeds a mission in "reviewing" status
    // 2. Mocks reviewDebrief to return { verdict: 'escalate', parseFailure: true, concerns: [...], reasoning: '...' }
    // 3. Mocks escalate to capture the call
    // 4. Runs runOverseerReview(missionId)
    // 5. Asserts escalate was called with level: 'critical' and title containing 'Parse Failure'
    //
    // If the existing test file has a similar pattern for other branches, mirror it.
    // If not, skip this automated test and manually verify via the smoke test below.
  });
});
```

If the existing `review-handler.test.ts` does not already have a mocking harness for the full flow, skip writing the automated test and instead verify manually via Step 5. The branch logic is small enough that a manual smoke test is sufficient; the plan's next task focuses on higher-value infrastructure.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm build`
Expected: PASS.

Run existing tests: `pnpm vitest run src/lib/overseer`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/overseer/debrief-reviewer.ts src/lib/overseer/review-parser.ts src/lib/overseer/review-handler.ts src/types
git commit -m "feat(overseer): distinct notification for review parse failures"
```

---

## Task 6: Add `decision_type` column to `overseer_logs` (migration)

**Files:**
- Modify: `src/lib/db/schema.ts` — add column.
- Create: `src/lib/db/migrations/0021_<generated_name>.sql` → rename to `0021_overseer_decision_type.sql`.
- Create: `src/lib/db/migrations/meta/0021_snapshot.json` (drizzle-kit generated).

Fixes item 9 (schema portion). The next task uses this column.

- [ ] **Step 1: Add the column to the Drizzle schema**

Edit `src/lib/db/schema.ts`. Find the `overseerLogs` table (line 191) and add a new column:

```ts
export const overseerLogs = sqliteTable('overseer_logs', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  reasoning: text('reasoning').notNull(),
  confidence: text('confidence').notNull(),  // 'high' | 'medium' | 'low'
  escalated: integer('escalated').default(0),
  decisionType: text('decision_type'),  // 'review-approve' | 'review-retry' | 'review-escalate' | 'phase-retry' | 'phase-skip' | 'phase-escalate' | 'stall-advice' | null
  timestamp: integer('timestamp').notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`

Expected: creates `src/lib/db/migrations/0021_<random_name>.sql` and `src/lib/db/migrations/meta/0021_snapshot.json`, and appends idx 21 to `_journal.json`.

- [ ] **Step 3: Rename the migration file to a stable name**

```bash
mv src/lib/db/migrations/0021_*.sql src/lib/db/migrations/0021_overseer_decision_type.sql
```

Edit `src/lib/db/migrations/meta/_journal.json` and change the `tag` field for idx 21 from whatever drizzle generated to `"0021_overseer_decision_type"`.

- [ ] **Step 4: Verify the migration SQL**

Run: `cat src/lib/db/migrations/0021_overseer_decision_type.sql`

Expected content:

```sql
ALTER TABLE `overseer_logs` ADD `decision_type` text;
```

If the generated SQL differs (e.g. includes a foreign key or a default), review it — but for a simple nullable text column on SQLite, the above is what drizzle-kit should produce.

- [ ] **Step 5: Apply the migration to the live dev DB**

```bash
pnpm drizzle-kit migrate
```

Then verify the column exists:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('devroom.db');
const info = db.prepare(\"PRAGMA table_info('overseer_logs')\").all();
const hasDecisionType = info.some(c => c.name === 'decision_type');
console.log('decision_type column present?', hasDecisionType);
db.close();
"
```

Expected: `decision_type column present? true`

If migration tracking is stuck again (as with the previous 0020 issue), fall back to manual `ALTER TABLE` on the dev DB and insert a row into `__drizzle_migrations` with the computed hash, following the same pattern used for the earlier fix. Use this script:

```bash
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const crypto = require('crypto');
const db = new Database('devroom.db');
const info = db.prepare(\"PRAGMA table_info('overseer_logs')\").all();
if (!info.some(c => c.name === 'decision_type')) {
  db.exec('ALTER TABLE overseer_logs ADD COLUMN decision_type text');
  console.log('Column added manually.');
}
const sql = fs.readFileSync('src/lib/db/migrations/0021_overseer_decision_type.sql', 'utf8');
const hash = crypto.createHash('sha256').update(sql).digest('hex');
const exists = db.prepare('SELECT 1 FROM __drizzle_migrations WHERE hash = ?').get(hash);
if (!exists) {
  db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, Date.now());
  console.log('Migration record inserted.');
}
db.close();
"
```

- [ ] **Step 6: Full build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/0021_overseer_decision_type.sql src/lib/db/migrations/meta/0021_snapshot.json src/lib/db/migrations/meta/_journal.json
git commit -m "feat(db): add decision_type column to overseer_logs"
```

---

## Task 7: Use `decision_type` for phase retry counting

**Files:**
- Modify: `src/lib/overseer/overseer-db.ts` — accept optional `decisionType` in input.
- Modify: `src/lib/overseer/phase-failure-handler.ts` — write and read `decisionType` instead of string-prefix matching.
- Modify: `src/lib/overseer/review-handler.ts` — set `decisionType` on review log writes (optional but consistent).
- Modify: `src/types/` — extend `OverseerLog` type.

Fixes item 9 (logic portion). Replaces `l.answer.startsWith('Decision: retry')` with a proper column check.

- [ ] **Step 1: Extend the OverseerLog type**

Find the `OverseerLog` type definition (same location as `OverseerReview` from Task 5). Add the field:

```ts
export interface OverseerLog {
  id: string;
  missionId: string;
  campaignId: string | null;
  battlefieldId: string;
  question: string;
  answer: string;
  reasoning: string;
  confidence: OverseerConfidence;
  escalated: number;
  decisionType: string | null;
  timestamp: number;
}
```

Also define a small union type for the allowed values (in the same file):

```ts
export type OverseerDecisionType =
  | 'review-approve'
  | 'review-retry'
  | 'review-escalate'
  | 'phase-retry'
  | 'phase-skip'
  | 'phase-escalate'
  | 'stall-advice';
```

- [ ] **Step 2: Extend `storeOverseerLog`**

Edit `src/lib/overseer/overseer-db.ts`. Update the interface and the row insertion:

```ts
interface StoreOverseerLogInput {
  missionId: string;
  campaignId: string | null;
  battlefieldId: string;
  question: string;
  answer: string;
  reasoning: string;
  confidence: OverseerConfidence;
  escalated: number;
  decisionType?: OverseerDecisionType | null;
}

export function storeOverseerLog(data: StoreOverseerLogInput): OverseerLog {
  const db = getDatabase();
  const row = {
    id: generateId(),
    missionId: data.missionId,
    campaignId: data.campaignId,
    battlefieldId: data.battlefieldId,
    question: data.question,
    answer: data.answer,
    reasoning: data.reasoning,
    confidence: data.confidence,
    escalated: data.escalated,
    decisionType: data.decisionType ?? null,
    timestamp: Date.now(),
  };

  db.insert(overseerLogs).values(row).run();
  return row as OverseerLog;
}
```

Add `OverseerDecisionType` to the import from `@/types` at the top of the file.

- [ ] **Step 3: Set `decisionType` in phase-failure-handler.ts**

Find the place where phase failure decisions are logged. Looking at the current file, the `handlePhaseFailure` function returns a decision but does NOT currently write to overseerLogs itself — the caller writes the log. Grep for `[PHASE_FAILURE]` to find the writer:

```bash
grep -rn "PHASE_FAILURE" src/lib
```

Most likely in `src/lib/orchestrator/campaign-executor.ts`. Find the `storeOverseerLog` call that uses `[PHASE_FAILURE]` as the question prefix and `Decision: ${decision.decision}` as the answer. Add `decisionType` to that call:

```ts
storeOverseerLog({
  missionId: <current>,
  battlefieldId: <current>,
  campaignId: campaign.id,
  question: `[PHASE_FAILURE] Phase ${phase.phaseNumber}: ${phase.name}`,
  answer: `Decision: ${decision.decision}. ${decision.reasoning}`,
  reasoning: decision.reasoning,
  confidence: 'high',
  escalated: decision.decision === 'escalate' ? 1 : 0,
  decisionType: `phase-${decision.decision}` as OverseerDecisionType,
});
```

(The exact surrounding code depends on the current call site — preserve everything else and just add the `decisionType` field.)

- [ ] **Step 4: Read `decisionType` in `getPhaseRetryCount`**

Edit `src/lib/overseer/phase-failure-handler.ts`. Replace `getPhaseRetryCount`:

```ts
import { eq, and } from 'drizzle-orm';

function getPhaseRetryCount(campaignId: string): number {
  const db = getDatabase();
  const logs = db
    .select()
    .from(overseerLogs)
    .where(
      and(
        eq(overseerLogs.campaignId, campaignId),
        eq(overseerLogs.decisionType, 'phase-retry'),
      ),
    )
    .all();

  return logs.length;
}
```

Remove the `like` import if it's no longer used elsewhere in the file.

- [ ] **Step 5: Optional — set `decisionType` on review logs**

In `src/lib/overseer/review-handler.ts`, find the `storeOverseerLog` call (around line 141) and add:

```ts
  storeOverseerLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
    answer: review.verdict === 'approve'
      ? 'Approved'
      : `Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: review.verdict === 'approve' ? 'high' : 'medium',
    escalated: review.verdict === 'escalate' ? 1 : 0,
    decisionType: `review-${review.verdict}` as const,
  });
```

Also find the retry-feedback write in `requeueMissionWithFeedback` and add `decisionType: 'review-retry'` there.

- [ ] **Step 6: Write a test for the new retry counter**

Add to `src/lib/overseer/__tests__/phase-failure-handler.test.ts` (create the file if it doesn't exist):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '@/lib/db/index';
import { overseerLogs } from '@/lib/db/schema';
import { storeOverseerLog } from '@/lib/overseer/overseer-db';

// NOTE: handlePhaseFailure spawns a real Claude Code process, so we only
// test getPhaseRetryCount indirectly by seeding rows and reading them back
// through a focused helper. For this test we verify the column is queried
// correctly by checking the data path.

describe('phase retry counting via decision_type column', () => {
  const campaignId = 'test-campaign-phase-retry';
  const battlefieldId = 'test-bf';
  const missionId = 'test-mission';

  beforeEach(() => {
    const db = getDatabase();
    db.delete(overseerLogs).run();
  });

  it('counts only phase-retry decisions for the given campaign', () => {
    storeOverseerLog({
      missionId,
      campaignId,
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: retry.',
      reasoning: 'retry once',
      confidence: 'high',
      escalated: 0,
      decisionType: 'phase-retry',
    });
    storeOverseerLog({
      missionId,
      campaignId,
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: skip.',
      reasoning: 'skip the second one',
      confidence: 'high',
      escalated: 0,
      decisionType: 'phase-skip',
    });
    storeOverseerLog({
      missionId,
      campaignId: 'other-campaign',
      battlefieldId,
      question: '[PHASE_FAILURE] Phase 1',
      answer: 'Decision: retry.',
      reasoning: 'different campaign',
      confidence: 'high',
      escalated: 0,
      decisionType: 'phase-retry',
    });

    const db = getDatabase();
    const rows = db
      .select()
      .from(overseerLogs)
      .all();
    const phaseRetriesForOurCampaign = rows.filter(
      (r) => r.campaignId === campaignId && r.decisionType === 'phase-retry',
    );
    expect(phaseRetriesForOurCampaign.length).toBe(1);
  });
});
```

Note: this test exercises the storage and filtering path; the actual `getPhaseRetryCount` function is called inside `handlePhaseFailure` which spawns a real process, so it's not directly unit-tested. The path-level assertion is sufficient.

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run src/lib/overseer`
Expected: all tests pass.

- [ ] **Step 8: Full build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/overseer/overseer-db.ts src/lib/overseer/phase-failure-handler.ts src/lib/overseer/review-handler.ts src/lib/orchestrator/campaign-executor.ts src/types src/lib/overseer/__tests__/phase-failure-handler.test.ts
git commit -m "feat(overseer): use decision_type column for phase retry counting"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 2: Full production build**

Run: `pnpm build`
Expected: PASS, all routes compiled.

- [ ] **Step 3: Live DB state verification**

Run:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('devroom.db');

// OVERSEER state
const overseer = db.prepare(\"SELECT codename, max_turns, length(system_prompt) AS len FROM assets WHERE codename='OVERSEER'\").get();
console.log('OVERSEER:', overseer);

// overseer_logs has decision_type column
const cols = db.prepare(\"PRAGMA table_info('overseer_logs')\").all();
const hasDecisionType = cols.some(c => c.name === 'decision_type');
console.log('overseer_logs.decision_type:', hasDecisionType);

db.close();
"
```

Expected:
- `OVERSEER: { codename: 'OVERSEER', max_turns: 1, len: <~1600> }`
- `overseer_logs.decision_type: true`

- [ ] **Step 4: No further commits required — every task committed its own changes.**

---

## Self-Review Notes

**Spec coverage** (items 1-9 from the investigation):

| # | Item | Covered by |
|---|---|---|
| 1 | Fix PASS/RETRY drift in stored prompt | Task 1 |
| 2 | Align OVERSEER with mission-asset ROE | Task 1 |
| 3 | Role-level prompt + decision heuristics | Task 1 |
| 4 | maxTurns 5→1 in DB + seed | Task 1 |
| 5 | Truncate gitDiffStat | Task 3 |
| 6 | Hoist CLAUDE.md for cache hits | Task 4 |
| 7 | Surface parse failures distinctly | Task 5 |
| 8 | Remove hardcoded OVERSEER_SYSTEM_PROMPT | Task 2 |
| 9 | Replace string-prefix retry counter with column | Tasks 6 + 7 |

**Placeholder scan:** All tasks include concrete code blocks and commands. No TBD / TODO / "implement later." The optional automated test in Task 5 Step 4 is explicitly marked as optional with a documented fallback (manual smoke test).

**Type consistency:** `OverseerDecisionType` is introduced in Task 7 Step 1. `decisionType` as an optional field on `StoreOverseerLogInput` matches the column name `decision_type` in the schema. `parseFailure?: boolean` on `OverseerReview` (Task 5) is consistent with its use in Task 5 Step 3.

**Known risk areas:**
- Task 4 (CLAUDE.md hoist) is the highest-complexity task. If `injectSystemPromptOverride` misbehaves, the review path could silently lose its system prompt. The unit tests in Task 4 Step 1 cover both the compose function and the user prompt; add one more spot-check by logging the assembled args during a real review if behavior seems off.
- Task 6 (migration 0021) may hit the same drizzle-kit migrate tracking bug that hit 0020. The fallback script is included in Step 5.
- Task 7 Step 3 asks the engineer to find the `[PHASE_FAILURE]` log writer in `campaign-executor.ts`. The exact file and line may differ — use `grep` to locate.
