# STRATEGIST Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate STRATEGIST's planning contract and asset roster into single sources of truth, hoist stable context into the system-prompt slot for prompt caching, pin truncation caps, and add GENERATE PLAN parse retry with a distinct failure notification.

**Architecture:** Two new pure-function modules (`briefing-contract.ts`, `asset-roster.ts`) become the only place STRATEGIST's planning rules, JSON schema, and asset listing are defined. `briefing-prompt.ts` is rewritten to compose from these modules and returns the system prompt separately from the volatile user message. `briefing-engine.ts` passes the composed system prompt via `--append-system-prompt` (filtering out the seed value that `buildAssetCliArgs` emits) and adds a bounded retry on GENERATE PLAN parse failures with a distinct socket event. The stored seed prompt in `scripts/seed.ts` collapses to a short stub that explicitly defers to runtime composition.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM, better-sqlite3, Socket.IO, Claude Code CLI via `child_process.spawn`.

**Related spec:** `docs/superpowers/specs/2026-04-05-strategist-hardening-design.md`

---

## File Structure

**New files:**
- `src/lib/briefing/briefing-contract.ts` — Exports `BRIEFING_CONTRACT`, `GENERATE_PLAN_CONTRACT`, `SEED_CONTRACT_SUMMARY`, `CLAUDE_MD_CAP`, `SPEC_MD_CAP`. Pure strings and numeric constants, no runtime logic.
- `src/lib/briefing/asset-roster.ts` — Exports `formatAssetRoster(allAssets)` and `extractAssetIdentityLine(systemPrompt)`. Pure functions, no database access.
- `src/lib/briefing/__tests__/briefing-contract.test.ts` — Pins contract invariants (key strings present, summary length bounded).
- `src/lib/briefing/__tests__/asset-roster.test.ts` — Unit tests for roster formatting and identity-line extraction.
- `src/lib/briefing/__tests__/briefing-prompt.test.ts` — Tests for system-prompt composition and truncation caps.

**Modified files:**
- `src/lib/briefing/briefing-prompt.ts` — Replaces the monolithic `buildBriefingPrompt` with two functions: `buildBriefingSystemPrompt` (stable, goes to `--append-system-prompt`) and `buildBriefingUserMessage` (volatile, goes to stdin).
- `src/lib/briefing/briefing-engine.ts` — Filters the seed `--append-system-prompt` from `buildAssetCliArgs` output, replaces it with the composed system prompt, routes GENERATE PLAN through `GENERATE_PLAN_CONTRACT`, adds bounded parse retry + distinct `briefing:plan-parse-failed` event.
- `scripts/seed.ts` — STRATEGIST entry uses `SEED_CONTRACT_SUMMARY`.

---

## Task 1: Create `briefing-contract.ts` with tests

**Files:**
- Create: `src/lib/briefing/briefing-contract.ts`
- Create: `src/lib/briefing/__tests__/briefing-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/briefing/__tests__/briefing-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  BRIEFING_CONTRACT,
  GENERATE_PLAN_CONTRACT,
  SEED_CONTRACT_SUMMARY,
  CLAUDE_MD_CAP,
  SPEC_MD_CAP,
} from '../briefing-contract';

describe('briefing-contract', () => {
  describe('BRIEFING_CONTRACT', () => {
    it('describes both mission types', () => {
      expect(BRIEFING_CONTRACT).toContain('direct_action');
      expect(BRIEFING_CONTRACT).toContain('verification');
    });

    it('includes all JSON schema keys STRATEGIST must emit', () => {
      expect(BRIEFING_CONTRACT).toContain('summary');
      expect(BRIEFING_CONTRACT).toContain('phases');
      expect(BRIEFING_CONTRACT).toContain('missions');
      expect(BRIEFING_CONTRACT).toContain('assetCodename');
      expect(BRIEFING_CONTRACT).toContain('dependsOn');
      expect(BRIEFING_CONTRACT).toContain('priority');
      expect(BRIEFING_CONTRACT).toContain('type');
    });

    it('states the conversation rule (stop and wait)', () => {
      expect(BRIEFING_CONTRACT.toLowerCase()).toContain('wait');
    });

    it('forbids markdown code fences inside briefing strings', () => {
      expect(BRIEFING_CONTRACT).toMatch(/no.*code fence/i);
    });
  });

  describe('GENERATE_PLAN_CONTRACT', () => {
    it('demands raw JSON only', () => {
      expect(GENERATE_PLAN_CONTRACT).toMatch(/raw json/i);
    });

    it('includes the JSON schema', () => {
      expect(GENERATE_PLAN_CONTRACT).toContain('summary');
      expect(GENERATE_PLAN_CONTRACT).toContain('phases');
      expect(GENERATE_PLAN_CONTRACT).toContain('assetCodename');
    });

    it('defines both mission types', () => {
      expect(GENERATE_PLAN_CONTRACT).toContain('direct_action');
      expect(GENERATE_PLAN_CONTRACT).toContain('verification');
    });
  });

  describe('SEED_CONTRACT_SUMMARY', () => {
    it('is short enough for a seed stub (<1000 chars)', () => {
      expect(SEED_CONTRACT_SUMMARY.length).toBeLessThan(1000);
    });

    it('notes that the full contract is supplied at runtime', () => {
      expect(SEED_CONTRACT_SUMMARY.toLowerCase()).toContain('runtime');
    });

    it('identifies STRATEGIST', () => {
      expect(SEED_CONTRACT_SUMMARY).toContain('STRATEGIST');
    });
  });

  describe('truncation caps', () => {
    it('pins CLAUDE_MD_CAP to exactly 4000 characters', () => {
      expect(CLAUDE_MD_CAP).toBe(4000);
    });

    it('pins SPEC_MD_CAP to exactly 4000 characters', () => {
      expect(SPEC_MD_CAP).toBe(4000);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- briefing-contract --run`
Expected: FAIL — `Cannot find module '../briefing-contract'`.

- [ ] **Step 3: Create the contract module**

Create `src/lib/briefing/briefing-contract.ts`:

```ts
/**
 * Single source of truth for STRATEGIST's planning contract.
 *
 * - BRIEFING_CONTRACT is hoisted into --append-system-prompt on every
 *   briefing invocation so it is prompt-cache eligible.
 * - GENERATE_PLAN_CONTRACT is the subset needed when STRATEGIST is asked
 *   to emit the final plan from a fresh (non-resumed) process.
 * - SEED_CONTRACT_SUMMARY is the short stub stored in the assets table
 *   for UI display; the runtime always replaces it with BRIEFING_CONTRACT.
 */

export const CLAUDE_MD_CAP = 4000;
export const SPEC_MD_CAP = 4000;

const JSON_SCHEMA_BLOCK = `JSON schema:
{
  "summary": "Brief campaign summary",
  "phases": [
    {
      "name": "Phase name",
      "objective": "Phase objective",
      "missions": [
        {
          "title": "Mission title",
          "briefing": "Detailed mission briefing in plain text — the asset has NO context beyond what you write here. Describe code changes in prose, reference file paths and types by name, never use code fences.",
          "assetCodename": "OPERATIVE",
          "priority": "routine",
          "type": "direct_action",
          "dependsOn": ["Other mission title in same phase"]
        }
      ]
    }
  ]
}`;

const MISSION_TYPE_RULES = `MISSION TYPES (the "type" field):
- "direct_action" (default — use when in doubt): the mission modifies code, files, or configuration. It MUST produce at least one commit. On success the Quartermaster merges its branch back into the default branch.
- "verification": the mission is strictly read-only — runs tests, type-checks, audits, spot-checks, sanity reviews, and reports results. It MUST NOT modify code. No merge is performed. Verification missions with zero commits and a passing Overseer review are the expected happy path.
- Use "verification" whenever the briefing verbs are "run", "check", "verify", "confirm", "audit", "report", "spot-check". Use "direct_action" whenever the briefing asks the asset to write, edit, refactor, fix, or implement anything.
- Pair mutating phases with a following "verification" phase when end-to-end correctness matters.`;

const PLANNING_RULES = `PLANNING RULES:
- Phases execute SEQUENTIALLY (Phase 1 completes before Phase 2 starts).
- Missions within a phase can execute IN PARALLEL if no dependencies.
- dependsOn references mission titles within the SAME phase only.
- Each mission briefing must be self-contained and detailed (plain text, no code fences) — the asset has NO context beyond what you write.
- Each mission must be atomic: one clear deliverable, one asset, one scope. Assets execute only what is in the briefing and will report anything else as out-of-scope — never bundle extras ("and while you're there, also fix X") into a mission.
- Route missions by specialty — consult the asset roster provided below.`;

const STRICT_JSON_RULES = `CRITICAL FORMAT RULES FOR GENERATE PLAN:
- Your response must start with \`{\` and end with \`}\`.
- Do NOT wrap the JSON in a code fence (\`\`\`json ... \`\`\`) — output raw JSON only.
- Do NOT include any text, greetings, or explanations — ONLY the JSON object.
- Mission briefing values must be plain text — do NOT use markdown code fences (\`\`\`) inside briefing strings. Use plain prose to describe code changes. Reference file paths, function names, and types by name without code blocks.
- All special characters in JSON strings must be properly escaped (newlines as \\n, quotes as \\", backslashes as \\\\).`;

export const BRIEFING_CONTRACT = `You are STRATEGIST, a campaign planning and coordination specialist for NYHZ OPS DEVROOM.

YOUR ORDERS:
- This is a CONVERSATION. Each time you respond, STOP and WAIT for the Commander's reply. Do NOT use tools or explore the codebase unless the Commander explicitly asks you to.
- Ask the Commander clarifying questions to deeply understand the objective.
- Discuss technical approach, risks, and trade-offs.
- Propose a phased plan with concrete missions.
- Consider inter-mission dependencies — what must complete before what.
- Assign appropriate assets to each mission based on their specialties (see roster).
- Keep each response concise and focused — ask 2-3 questions at most per turn.
- The Commander will give the order "GENERATE PLAN" when satisfied.

${PLANNING_RULES}

${MISSION_TYPE_RULES}

When the Commander says "GENERATE PLAN", you MUST respond with ONLY the JSON plan — no preamble, no markdown, no commentary, no text before or after the JSON block. Your entire response must be exactly one valid JSON object, nothing else.

${STRICT_JSON_RULES}

${JSON_SCHEMA_BLOCK}`;

export const GENERATE_PLAN_CONTRACT = `The Commander has issued GENERATE PLAN. Output ONLY a single raw JSON object. Your ENTIRE response must start with { and end with } — no markdown, no code fences, no backticks, no preamble, no commentary.

${MISSION_TYPE_RULES}

${STRICT_JSON_RULES}

${JSON_SCHEMA_BLOCK}`;

export const SEED_CONTRACT_SUMMARY = `You are STRATEGIST — the campaign planning specialist for DEVROOM.

Your role is to receive a high-level objective from the Commander, interrogate it, and decompose it into a structured campaign plan with sequential phases and atomic missions routed to the right specialist assets.

Note: the runtime briefing chat supplies the full planning contract — JSON schema, mission types, planning rules, and the live asset roster — via the system prompt on every invocation. This stored prompt exists for reference and UI display.`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- briefing-contract --run`
Expected: PASS (all 13 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing/briefing-contract.ts src/lib/briefing/__tests__/briefing-contract.test.ts
git commit -m "feat(briefing): add briefing-contract SSOT module"
```

---

## Task 2: Create `asset-roster.ts` with tests

**Files:**
- Create: `src/lib/briefing/asset-roster.ts`
- Create: `src/lib/briefing/__tests__/asset-roster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/briefing/__tests__/asset-roster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatAssetRoster, extractAssetIdentityLine } from '../asset-roster';
import type { Asset } from '@/types';

function makeAsset(overrides: Partial<Asset>): Asset {
  return {
    id: overrides.id ?? 'id-' + (overrides.codename ?? 'X'),
    codename: overrides.codename ?? 'TEST',
    specialty: overrides.specialty ?? 'testing',
    systemPrompt: overrides.systemPrompt ?? null,
    model: overrides.model ?? 'claude-sonnet-4-6',
    status: overrides.status ?? 'active',
    missionsCompleted: overrides.missionsCompleted ?? 0,
    skills: overrides.skills ?? null,
    mcpServers: overrides.mcpServers ?? null,
    maxTurns: overrides.maxTurns ?? null,
    effort: overrides.effort ?? null,
    isSystem: overrides.isSystem ?? 0,
    memory: overrides.memory ?? null,
    createdAt: overrides.createdAt ?? 0,
  } as Asset;
}

describe('extractAssetIdentityLine', () => {
  it('returns empty string for null prompt', () => {
    expect(extractAssetIdentityLine(null)).toBe('');
  });

  it('returns empty string for empty prompt', () => {
    expect(extractAssetIdentityLine('')).toBe('');
  });

  it('returns the first non-empty line', () => {
    const prompt = '\n\nYou are CIPHER — the backend specialist.\n\nMore details here.';
    expect(extractAssetIdentityLine(prompt)).toBe('the backend specialist.');
  });

  it('strips the "You are CODENAME — " prefix (em dash)', () => {
    expect(extractAssetIdentityLine('You are CIPHER — backend engineer.')).toBe('backend engineer.');
  });

  it('strips the "You are CODENAME - " prefix (hyphen)', () => {
    expect(extractAssetIdentityLine('You are CIPHER - backend engineer.')).toBe('backend engineer.');
  });

  it('leaves lines without the prefix untouched', () => {
    expect(extractAssetIdentityLine('Backend specialist for the API layer.')).toBe(
      'Backend specialist for the API layer.',
    );
  });

  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(500);
    const result = extractAssetIdentityLine(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('formatAssetRoster', () => {
  it('excludes system assets', () => {
    const all = [
      makeAsset({ codename: 'OVERSEER', isSystem: 1, specialty: 'review' }),
      makeAsset({ codename: 'CIPHER', isSystem: 0, specialty: 'backend' }),
    ];
    const roster = formatAssetRoster(all);
    expect(roster).not.toContain('OVERSEER');
    expect(roster).toContain('CIPHER');
  });

  it('excludes inactive assets', () => {
    const all = [
      makeAsset({ codename: 'RETIRED', status: 'inactive', isSystem: 0 }),
      makeAsset({ codename: 'CIPHER', status: 'active', isSystem: 0 }),
    ];
    expect(formatAssetRoster(all)).not.toContain('RETIRED');
  });

  it('sorts entries by codename ascending', () => {
    const all = [
      makeAsset({ codename: 'VANGUARD', isSystem: 0 }),
      makeAsset({ codename: 'ARCHITECT', isSystem: 0 }),
      makeAsset({ codename: 'CIPHER', isSystem: 0 }),
    ];
    const roster = formatAssetRoster(all);
    const idxA = roster.indexOf('ARCHITECT');
    const idxC = roster.indexOf('CIPHER');
    const idxV = roster.indexOf('VANGUARD');
    expect(idxA).toBeLessThan(idxC);
    expect(idxC).toBeLessThan(idxV);
  });

  it('renders codename, specialty, and identity line when systemPrompt present', () => {
    const all = [
      makeAsset({
        codename: 'CIPHER',
        specialty: 'Backend / APIs / data / auth',
        systemPrompt: 'You are CIPHER — the backend, API, and data specialist.',
        isSystem: 0,
      }),
    ];
    const roster = formatAssetRoster(all);
    expect(roster).toContain('CIPHER');
    expect(roster).toContain('Backend / APIs / data / auth');
    expect(roster).toContain('the backend, API, and data specialist.');
  });

  it('falls back to codename + specialty only when systemPrompt is null', () => {
    const all = [
      makeAsset({
        codename: 'OPERATIVE',
        specialty: 'Generalist / catch-all',
        systemPrompt: null,
        isSystem: 0,
      }),
    ];
    const roster = formatAssetRoster(all);
    expect(roster).toContain('OPERATIVE');
    expect(roster).toContain('Generalist / catch-all');
    // No trailing ": " with empty identity
    expect(roster).not.toMatch(/OPERATIVE.*:\s*$/m);
  });

  it('returns an empty-state placeholder when no assets match', () => {
    expect(formatAssetRoster([])).toBe('(no active mission assets)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- asset-roster --run`
Expected: FAIL — `Cannot find module '../asset-roster'`.

- [ ] **Step 3: Create the roster module**

Create `src/lib/briefing/asset-roster.ts`:

```ts
import type { Asset } from '@/types';

const IDENTITY_LINE_CAP = 200;

/**
 * Extract the first meaningful line of an asset's system prompt,
 * stripped of the "You are CODENAME — " identity prefix and capped.
 */
export function extractAssetIdentityLine(systemPrompt: string | null): string {
  if (!systemPrompt) return '';

  // First non-empty line
  const firstLine = systemPrompt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) return '';

  // Strip "You are X — " / "You are X - " prefix (handles em-dash and hyphen)
  const stripped = firstLine.replace(
    /^You are\s+[A-Z][A-Z0-9_\- ]*\s*[—-]\s*/,
    '',
  );

  return stripped.length > IDENTITY_LINE_CAP
    ? stripped.slice(0, IDENTITY_LINE_CAP)
    : stripped;
}

/**
 * Render the set of mission assets STRATEGIST is allowed to assign.
 * Filters out system assets and inactive assets, sorts by codename for
 * deterministic output (matters for prompt caching), and includes each
 * asset's first-line identity from its system prompt when available.
 */
export function formatAssetRoster(allAssets: Asset[]): string {
  const mission = allAssets
    .filter((a) => a.status === 'active' && a.isSystem === 0)
    .slice()
    .sort((a, b) => a.codename.localeCompare(b.codename));

  if (mission.length === 0) return '(no active mission assets)';

  return mission
    .map((a) => {
      const identity = extractAssetIdentityLine(a.systemPrompt);
      const head = `- ${a.codename} (${a.specialty})`;
      return identity ? `${head}: ${identity}` : head;
    })
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- asset-roster --run`
Expected: PASS (all 14 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing/asset-roster.ts src/lib/briefing/__tests__/asset-roster.test.ts
git commit -m "feat(briefing): add asset roster SSOT helper"
```

---

## Task 3: Rewrite `briefing-prompt.ts` to split system vs user content

**Files:**
- Modify: `src/lib/briefing/briefing-prompt.ts` (complete rewrite)
- Create: `src/lib/briefing/__tests__/briefing-prompt.test.ts`

The new contract: two exports. `buildBriefingSystemPrompt` returns the stable block for `--append-system-prompt` (identity + contract + CLAUDE.md + SPEC.md + roster). `buildBriefingUserMessage` returns the volatile block for stdin (campaign/battlefield header + Commander's message).

- [ ] **Step 1: Write the failing test**

Create `src/lib/briefing/__tests__/briefing-prompt.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildBriefingSystemPrompt,
  buildBriefingUserMessage,
} from '../briefing-prompt';
import { CLAUDE_MD_CAP, SPEC_MD_CAP } from '../briefing-contract';
import type { Asset } from '@/types';

function makeAsset(codename: string, specialty: string, systemPrompt?: string | null): Asset {
  return {
    id: 'id-' + codename,
    codename,
    specialty,
    systemPrompt: systemPrompt ?? null,
    model: 'claude-sonnet-4-6',
    status: 'active',
    missionsCompleted: 0,
    skills: null,
    mcpServers: null,
    maxTurns: null,
    effort: null,
    isSystem: 0,
    memory: null,
    createdAt: 0,
  } as Asset;
}

describe('buildBriefingSystemPrompt', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'briefing-prompt-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  const baseParams = {
    campaignName: 'Operation Dawn',
    campaignObjective: 'Rebuild the ingest pipeline',
    battlefieldCodename: 'FOUNDRY',
    claudeMdPath: null,
    specMdPath: null,
    allAssets: [
      makeAsset('CIPHER', 'Backend / APIs / data / auth', 'You are CIPHER — the backend specialist.'),
    ],
  };

  it('includes STRATEGIST identity', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('STRATEGIST');
  });

  it('includes the planning contract (direct_action and verification)', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('direct_action');
    expect(sp).toContain('verification');
  });

  it('includes the JSON schema keys', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('assetCodename');
    expect(sp).toContain('dependsOn');
  });

  it('includes the asset roster with identity lines', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('CIPHER');
    expect(sp).toContain('the backend specialist.');
  });

  it('omits the CLAUDE.md section when path is null', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).not.toContain('PROJECT CONTEXT (CLAUDE.md)');
  });

  it('omits the SPEC.md section when path is null', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).not.toContain('PROJECT SPEC (SPEC.md)');
  });

  it('silently tolerates a missing CLAUDE.md file on disk', () => {
    const sp = buildBriefingSystemPrompt({
      ...baseParams,
      claudeMdPath: join(workdir, 'does-not-exist.md'),
    });
    expect(sp).not.toContain('PROJECT CONTEXT (CLAUDE.md)');
  });

  it('pins CLAUDE.md truncation to exactly CLAUDE_MD_CAP characters', () => {
    const bigFile = join(workdir, 'CLAUDE.md');
    writeFileSync(bigFile, 'A'.repeat(CLAUDE_MD_CAP + 5000));

    const sp = buildBriefingSystemPrompt({ ...baseParams, claudeMdPath: bigFile });

    const marker = 'PROJECT CONTEXT (CLAUDE.md):\n';
    const start = sp.indexOf(marker) + marker.length;
    const truncMarker = '\n\n[...truncated]';
    const end = sp.indexOf(truncMarker, start);
    expect(end).toBeGreaterThan(start);
    const body = sp.slice(start, end);
    expect(body.length).toBe(CLAUDE_MD_CAP);
  });

  it('pins SPEC.md truncation to exactly SPEC_MD_CAP characters', () => {
    const bigFile = join(workdir, 'SPEC.md');
    writeFileSync(bigFile, 'B'.repeat(SPEC_MD_CAP + 5000));

    const sp = buildBriefingSystemPrompt({ ...baseParams, specMdPath: bigFile });

    const marker = 'PROJECT SPEC (SPEC.md):\n';
    const start = sp.indexOf(marker) + marker.length;
    const truncMarker = '\n\n[...truncated]';
    const end = sp.indexOf(truncMarker, start);
    expect(end).toBeGreaterThan(start);
    const body = sp.slice(start, end);
    expect(body.length).toBe(SPEC_MD_CAP);
  });

  it('does not truncate files shorter than the cap', () => {
    const smallFile = join(workdir, 'CLAUDE.md');
    writeFileSync(smallFile, 'short content');
    const sp = buildBriefingSystemPrompt({ ...baseParams, claudeMdPath: smallFile });
    expect(sp).toContain('short content');
    expect(sp).not.toContain('[...truncated]');
  });
});

describe('buildBriefingUserMessage', () => {
  it('contains campaign name, battlefield, objective, and commander message', () => {
    const msg = buildBriefingUserMessage({
      campaignName: 'Operation Dawn',
      campaignObjective: 'Rebuild the ingest pipeline',
      battlefieldCodename: 'FOUNDRY',
      commanderMessage: 'What do you think about starting with the parser?',
    });

    expect(msg).toContain('Operation Dawn');
    expect(msg).toContain('FOUNDRY');
    expect(msg).toContain('Rebuild the ingest pipeline');
    expect(msg).toContain('What do you think about starting with the parser?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- briefing-prompt --run`
Expected: FAIL — imports `buildBriefingSystemPrompt` / `buildBriefingUserMessage` don't exist yet (the old file exports `buildBriefingPrompt`).

- [ ] **Step 3: Rewrite `briefing-prompt.ts`**

Replace the entire contents of `src/lib/briefing/briefing-prompt.ts`:

```ts
import fs from 'fs';
import type { Asset } from '@/types';
import { BRIEFING_CONTRACT, CLAUDE_MD_CAP, SPEC_MD_CAP } from './briefing-contract';
import { formatAssetRoster } from './asset-roster';

export interface BriefingSystemPromptParams {
  campaignName: string;
  campaignObjective: string;
  battlefieldCodename: string;
  claudeMdPath: string | null;
  specMdPath: string | null;
  allAssets: Asset[];
}

export interface BriefingUserMessageParams {
  campaignName: string;
  campaignObjective: string;
  battlefieldCodename: string;
  commanderMessage: string;
}

/**
 * Compose the stable block for --append-system-prompt.
 *
 * Contents (all stable within a briefing session and across briefings on the
 * same battlefield, so eligible for prompt caching):
 *   - STRATEGIST identity and planning contract (BRIEFING_CONTRACT)
 *   - CLAUDE.md (truncated to CLAUDE_MD_CAP)
 *   - SPEC.md (truncated to SPEC_MD_CAP)
 *   - Asset roster (formatAssetRoster)
 *
 * Campaign-specific volatile data (name, objective, battlefield, Commander
 * message) is delivered via buildBriefingUserMessage instead.
 */
export function buildBriefingSystemPrompt(params: BriefingSystemPromptParams): string {
  const sections: string[] = [BRIEFING_CONTRACT];

  const claudeMd = readTruncated(params.claudeMdPath, CLAUDE_MD_CAP);
  if (claudeMd !== null) {
    sections.push(`PROJECT CONTEXT (CLAUDE.md):\n${claudeMd}`);
  }

  const specMd = readTruncated(params.specMdPath, SPEC_MD_CAP);
  if (specMd !== null) {
    sections.push(`PROJECT SPEC (SPEC.md):\n${specMd}`);
  }

  sections.push(`AVAILABLE MISSION ASSETS:\n${formatAssetRoster(params.allAssets)}`);

  return sections.join('\n\n---\n\n');
}

/**
 * Compose the volatile first-message stdin content: campaign header + the
 * Commander's actual message. For subsequent messages in a briefing, callers
 * send only the raw Commander message (no header needed — the session has it).
 */
export function buildBriefingUserMessage(params: BriefingUserMessageParams): string {
  return `Campaign: "${params.campaignName}" | Battlefield: ${params.battlefieldCodename}

CAMPAIGN OBJECTIVE:
${params.campaignObjective}

---

Commander says: ${params.commanderMessage}`;
}

function readTruncated(path: string | null, cap: number): string | null {
  if (!path) return null;
  try {
    const content = fs.readFileSync(path, 'utf-8');
    return content.length > cap
      ? content.slice(0, cap) + '\n\n[...truncated]'
      : content;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- briefing-prompt --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing/briefing-prompt.ts src/lib/briefing/__tests__/briefing-prompt.test.ts
git commit -m "feat(briefing): split briefing prompt into system and user parts"
```

---

## Task 4: Rewire `briefing-engine.ts` to use the composed system prompt

**Files:**
- Modify: `src/lib/briefing/briefing-engine.ts`

This task wires the new modules into the runtime. No test changes — existing action tests (`src/actions/__tests__/briefing.test.ts`) already cover the pure-data paths; the spawn-level logic is verified manually per the spec's verification plan. The retry logic in Task 5 will be exercised by a dedicated integration test.

- [ ] **Step 1: Update imports at the top of `briefing-engine.ts`**

Replace the existing `buildBriefingPrompt` import:

```ts
import {
  buildBriefingSystemPrompt,
  buildBriefingUserMessage,
} from './briefing-prompt';
import { GENERATE_PLAN_CONTRACT } from './briefing-contract';
import { formatAssetRoster } from './asset-roster';
```

- [ ] **Step 2: Extend the arg-filter helper to also strip the seed `--append-system-prompt`**

Replace the call-site section (currently around lines 121-122 of `briefing-engine.ts`):

```ts
  // Build asset CLI args. We strip:
  //  - --max-turns: we set our own below.
  //  - --append-system-prompt: buildAssetCliArgs emits the stored seed prompt,
  //    but we always replace it at runtime with the composed system prompt
  //    (identity + contract + CLAUDE.md + SPEC.md + roster). Passing both
  //    would duplicate the identity section.
  const assetArgs = buildAssetCliArgs(strategistAsset);
  const filteredAssetArgs = filterFlags(assetArgs, [
    '--max-turns',
    '--append-system-prompt',
  ]);
```

The existing `filterFlags` at `briefing-engine.ts:36-44` already handles this pattern — no function changes needed.

- [ ] **Step 3: Compose the system prompt and add it to `cliArgs`**

Replace the section that currently builds `cliArgs` (around lines 130-146):

```ts
  const isFirstMessage = !session.sessionId;
  const isGeneratePlan = message.trim().toUpperCase().includes('GENERATE PLAN');

  // Composed system prompt: stable across turns within a briefing and across
  // briefings on the same battlefield, so eligible for prompt caching.
  const composedSystemPrompt = buildBriefingSystemPrompt({
    campaignName: campaign.name,
    campaignObjective: campaign.objective,
    battlefieldCodename: battlefield.codename,
    claudeMdPath: battlefield.claudeMdPath,
    specMdPath: battlefield.specMdPath,
    allAssets,
  });

  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--max-turns', '3',
    '--append-system-prompt', composedSystemPrompt,
    ...filteredAssetArgs,
  ];

  // Resume the existing session for normal conversation messages only.
  // GENERATE PLAN always starts fresh — the old session's system prompt
  // may not match the current composed contract.
  if (!isFirstMessage && session.sessionId && !isGeneratePlan) {
    cliArgs.push('--resume', session.sessionId);
  }
```

- [ ] **Step 4: Rewrite the stdin-content branches to use the new helpers**

Replace the `stdinContent` construction block (currently lines 148-198):

```ts
  // Build stdin content. The stable contract + CLAUDE.md + SPEC.md + roster
  // are already in --append-system-prompt, so stdin only carries volatile
  // per-turn content.
  let stdinContent: string;

  if (isGeneratePlan) {
    // GENERATE PLAN runs fresh (no --resume), so it needs enough context to
    // re-ground itself: the conversation history plus the strict format rules.
    const history = db
      .select({ role: briefingMessages.role, content: briefingMessages.content })
      .from(briefingMessages)
      .where(eq(briefingMessages.briefingId, session.id))
      .all();

    const conversationLines = history.map((m) =>
      m.role === 'commander'
        ? `Commander: ${m.content}`
        : `STRATEGIST: ${m.content.slice(0, 2000)}`,
    );

    stdinContent = `Campaign: "${campaign.name}" | Battlefield: ${battlefield.codename}

CAMPAIGN OBJECTIVE:
${campaign.objective}

AVAILABLE MISSION ASSETS:
${formatAssetRoster(allAssets)}

BRIEFING CONVERSATION SUMMARY:
${conversationLines.join('\n\n')}

---

${GENERATE_PLAN_CONTRACT}`;
  } else if (isFirstMessage) {
    stdinContent = buildBriefingUserMessage({
      campaignName: campaign.name,
      campaignObjective: campaign.objective,
      battlefieldCodename: battlefield.codename,
      commanderMessage: message,
    });
  } else {
    stdinContent = message;
  }
```

- [ ] **Step 5: Run the full test suite to verify nothing regressed**

Run: `pnpm test --run`
Expected: PASS. The new `briefing-*` tests all pass; no existing test should break.

- [ ] **Step 6: Run the production build**

Run: `pnpm build`
Expected: Build succeeds. (Per the user's feedback memory: `tsc` alone misses Next.js errors; always run `pnpm build`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/briefing/briefing-engine.ts
git commit -m "feat(briefing): hoist STRATEGIST contract into --append-system-prompt"
```

---

## Task 5: Add GENERATE PLAN parse retry and distinct failure event

**Files:**
- Modify: `src/lib/briefing/briefing-engine.ts` (retry path + new socket event)

Current failure path (around `briefing-engine.ts:340-354`): `extractPlanJSON` returns null or throws → `io.emit('briefing:error', ...)`. New flow: on the first parse failure, spawn a single retry with a stricter re-prompt. On the retry's parse failure, emit a distinct `briefing:plan-parse-failed` event.

The cleanest implementation is to extract the current plan-handling block into a helper and call it from both the primary path and a single retry spawn.

- [ ] **Step 1: Extract a `spawnStrategistPlan` helper**

At the bottom of `briefing-engine.ts` (before `extractPlanJSON`), add:

```ts
/**
 * Spawn a one-shot STRATEGIST process for GENERATE PLAN. Returns the raw
 * response text. Used by the primary GENERATE PLAN path and by the retry.
 */
async function spawnStrategistPlan(params: {
  battlefieldRepoPath: string;
  persistentHome: string;
  cliArgs: string[];
  stdinContent: string;
}): Promise<{ text: string; code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.claudePath, params.cliArgs, {
      cwd: params.battlefieldRepoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: params.persistentHome },
    });

    let text = '';
    let stderr = '';
    let lineBuffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'stream_event' && event.event) {
            const inner = event.event;
            if (
              inner.type === 'content_block_delta' &&
              inner.delta?.type === 'text_delta' &&
              inner.delta.text
            ) {
              text += inner.delta.text;
            }
          }
          if (event.type === 'result') {
            if (!text && event.result && typeof event.result === 'string') {
              text = event.result;
            }
          }
        } catch { /* ignore non-JSON lines */ }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.stdin.write(params.stdinContent);
    proc.stdin.end();

    proc.on('close', (code) => resolve({ text, code, stderr }));
    proc.on('error', reject);
  });
}
```

Note: this helper is intentionally NOT plumbed into active-process tracking or streaming emits — retries are brief and silent (the user already saw the primary attempt stream). The primary GENERATE PLAN attempt continues to use the existing streaming path.

- [ ] **Step 2: Wrap the existing plan-handling block in a retry path**

Locate the block inside the `proc.on('close', ...)` handler that starts with `if (isGeneratePlan) {` (currently around line 311) and replace it with:

```ts
      // For GENERATE PLAN: extract the plan first, then store a formatted
      // summary in the chat instead of the raw JSON blob. If extraction
      // fails, attempt one silent retry with a stricter re-prompt before
      // giving up with a distinct failure notification.
      let storedContent = responseText;
      if (isGeneratePlan) {
        let planText = responseText;
        let plan = tryExtractAndValidatePlan(planText);

        if (!plan) {
          console.warn(
            `[BRIEFING] Plan parse failed for campaign ${campaignId}; retrying once with stricter re-prompt`,
          );
          try {
            const retryStdin = `Your previous response was not valid JSON. Output ONLY the JSON object now — no prose, no code fences, no backticks, no preamble.\n\n${stdinContent}`;
            const retry = await spawnStrategistPlan({
              battlefieldRepoPath: battlefield.repoPath,
              persistentHome,
              cliArgs,
              stdinContent: retryStdin,
            });
            planText = retry.text;
            plan = tryExtractAndValidatePlan(planText);
          } catch (retryErr) {
            console.error(`[BRIEFING] Retry spawn failed:`, retryErr);
          }
        }

        if (plan) {
          const totalMissions = plan.phases.reduce((s, p) => s + p.missions.length, 0);
          console.log(
            `[BRIEFING] Plan generated for campaign ${campaignId}: ${plan.phases.length} phases, ${totalMissions} missions`,
          );
          insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);

          db.update(campaigns)
            .set({ status: 'planning', updatedAt: Date.now() })
            .where(eq(campaigns.id, campaignId))
            .run();

          storedContent = formatPlanSummary(plan);

          io.to(room).emit('briefing:plan-ready', { campaignId, plan });
        } else {
          console.error(
            `[BRIEFING] Plan extraction failed after retry for campaign ${campaignId}`,
          );
          io.to(room).emit('briefing:plan-parse-failed', {
            campaignId,
            error:
              "STRATEGIST's plan could not be parsed as JSON after one retry. Ask the STRATEGIST to output the plan as a single JSON object with a \"summary\" key.",
          });
        }
      }
```

- [ ] **Step 3: Add the `tryExtractAndValidatePlan` helper**

Immediately after `spawnStrategistPlan` in `briefing-engine.ts`, add:

```ts
/**
 * Combined extract + validate for a STRATEGIST plan response. Returns a
 * valid PlanJSON on success, or null on any failure (parse error, cycle
 * detected, insert-time validation error). Errors are logged so retries
 * and final failures are attributable.
 */
function tryExtractAndValidatePlan(text: string): PlanJSON | null {
  try {
    const plan = extractPlanJSON(text);
    if (!plan) return null;

    const allMissions = plan.phases.flatMap((p) =>
      p.missions.map((m) => ({ title: m.title, dependsOn: m.dependsOn ?? [] })),
    );
    const cycle = detectCycle(allMissions);
    if (cycle) {
      console.warn(`[BRIEFING] Plan contains circular dependencies: ${cycle}`);
      return null;
    }

    return plan;
  } catch (err) {
    console.warn(
      '[BRIEFING] Plan extraction/validation threw:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
```

- [ ] **Step 4: Make the `proc.on('close', ...)` handler async**

The new retry block uses `await`, so the handler must be async. In `briefing-engine.ts`, change the signature at the top of the handler (currently around line 270):

```ts
    proc.on('close', async (code) => {
```

(just the `async` keyword added before `(code)`)

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test --run`
Expected: PASS. No existing tests should break — the retry path only triggers when extraction fails, and current tests do not exercise the spawn path.

- [ ] **Step 6: Run the production build**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/briefing/briefing-engine.ts
git commit -m "feat(briefing): retry once on GENERATE PLAN parse failure

Emits distinct briefing:plan-parse-failed socket event on final failure
(mirrors overseer 32d59e3). Extracts spawnStrategistPlan helper for the
silent retry spawn and tryExtractAndValidatePlan to share the parse +
cycle-detection path between primary and retry attempts."
```

---

## Task 6: Update stored seed prompt to use `SEED_CONTRACT_SUMMARY`

**Files:**
- Modify: `scripts/seed.ts` (STRATEGIST entry, lines 124-170)

- [ ] **Step 1: Add the import**

At the top of `scripts/seed.ts`, add:

```ts
import { SEED_CONTRACT_SUMMARY } from '../src/lib/briefing/briefing-contract';
```

(If the file already has imports, place this alongside them. If it uses `.ts` extension imports or a different style, match the existing pattern.)

- [ ] **Step 2: Replace the STRATEGIST `systemPrompt` value**

Find the STRATEGIST entry (currently at `scripts/seed.ts:124-170`) and replace its `systemPrompt` field:

```ts
  {
    codename: 'STRATEGIST',
    specialty: 'Campaign planning',
    model: 'claude-opus-4-6',
    maxTurns: 3,
    isSystem: 1,
    systemPrompt: SEED_CONTRACT_SUMMARY,
  },
```

Everything else about the entry stays identical.

- [ ] **Step 3: Re-seed a dev database to confirm the script runs**

Run: `pnpm seed` (or whatever the project's seed command is — check `package.json` if unsure; fall back to `tsx scripts/seed.ts` if there's no npm script).

Expected: seed completes without error, STRATEGIST row updated.

If `pnpm seed` does not exist as a script, run:
```bash
tsx scripts/seed.ts
```

- [ ] **Step 4: Run the production build**

Run: `pnpm build`
Expected: Build succeeds. (This catches any import-path drift introduced by pulling from `src/` into `scripts/`.)

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test --run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts
git commit -m "refactor(seed): STRATEGIST prompt defers to runtime contract"
```

---

## Task 7: End-to-end verification on a real battlefield

**Files:** none (manual verification)

This is the final gate before declaring the feature complete. The spec's verification plan requires manual smoke tests because the spawn path is not unit-tested.

- [ ] **Step 1: Confirm the build is green**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Confirm all tests pass**

Run: `pnpm test --run`
Expected: All tests pass, including the new `briefing-contract`, `asset-roster`, and `briefing-prompt` suites.

- [ ] **Step 3: Manually verify CIPHER routing in a briefing**

Start the dev server (`pnpm dev` or `devroom dev`), open a battlefield in the UI, create a new campaign with a backend-flavored objective like "Rebuild the auth token refresh endpoint."

In STRATEGIST's first response, confirm it references **CIPHER** for backend work (not OPERATIVE). If STRATEGIST still routes backend to OPERATIVE, inspect the composed system prompt in the process logs — the asset roster section should show CIPHER with its identity line.

- [ ] **Step 4: Manually verify GENERATE PLAN happy path**

In the same briefing, drive the conversation until a plan emerges, then issue `GENERATE PLAN`. Confirm:
- The plan parses.
- Mission assignments match the roster.
- At least one mission uses `type: "verification"` if the objective warrants it (e.g. ask STRATEGIST to add a final audit phase).

- [ ] **Step 5: Manually verify the retry path**

This is harder to force deterministically. Skip if no natural failure occurs during testing — the logged "Plan parse failed ... retrying once" message is the signal if it does trigger. The distinct `briefing:plan-parse-failed` socket event can be verified by temporarily forcing `tryExtractAndValidatePlan` to return null in a local-only patch, confirming the event fires, then reverting the patch.

- [ ] **Step 6: Final commit (none expected)**

No code changes in this task. If any fixes are needed, commit each as a separate fix commit with a clear message.

---

## Self-review notes

- Spec coverage: §1 → Task 2; §2 → Task 1; §3 → Task 3; §4 → Task 4; §5 → Task 5; §6 → Tasks 1 + 3; §7 → Task 5; §8 → Task 6; §9 → Tasks 1/2/3 (tests inline); verification plan → Task 7.
- The `Asset` type is assumed to expose `isSystem`, `status`, `systemPrompt`, `codename`, and `specialty` fields matching `src/lib/db/schema.ts:126-141`. If the exported `@/types` Asset omits any field, widen the type in that file first — no guessing.
- Prompt-cache benefit depends on `--append-system-prompt` being stable across calls. The asset roster is sorted by codename (Task 2) to keep the string deterministic even if the DB returns rows in a different order.
- The retry in Task 5 is bounded to one attempt by construction (no loop, single conditional spawn). This is intentional — cascading retries would amplify token cost on misbehaving STRATEGIST responses.
