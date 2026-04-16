# CONTROL Reliability Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DEVROOM's current orchestrator/overseer/quartermaster subsystems with the new CONTROL architecture specified in `docs/superpowers/specs/2026-04-16-control-reliability-refactor-design.md`. The result is an autonomous, reliability-first mission execution system with deterministic gates, bounded LLM calls, and no-hang guarantees.

**Architecture:** A new Node.js supervisor (`CONTROL`) dispatches combat/recon assets as `child_process.spawn('claude', ...)` subprocesses, classifies exits deterministically with an LLM fallback for unknown patterns, enforces test/build gates as the source of truth, and uses a bounded retry policy (3 deterministic + 1 OVERSEER-redirected) before escalating to `COMPROMISED` for Commander review. All LLM judgment calls are exception-path-only. See the spec for full design rationale.

**Tech Stack:** Node.js 20+, TypeScript strict, Drizzle ORM + better-sqlite3, Vitest, Playwright, simple-git, Next.js 16 App Router, Socket.IO.

---

## Spec reference

This plan implements the design spec verbatim. Every task references the relevant spec section. Keep the spec open in a second window while executing:
`docs/superpowers/specs/2026-04-16-control-reliability-refactor-design.md`

---

## File Structure

New code lives under `src/control/` and is written fresh — no logic is lifted from the existing `src/lib/orchestrator/`, `src/lib/overseer/`, or `src/lib/quartermaster/`, which are deleted at cutover (Phase 10).

```
src/control/
  index.ts                    Public API entry for Server Actions.
  control.ts                  Dispatch loop, slot accounting, startup recovery.
  mission-runner.ts           Per-mission lifecycle state machine.
  liveness.ts                 L1 (exit event) / L3 (stdout silence) / L5 (wall clock) monitor.
  exit-classifier.ts          Fast-path regex + OVERSEER classification fallback.
  retry-policy.ts             Deterministic retries, OVERSEER consult, infra backoff.
  gates.ts                    Sequential fail-fast gate runner.
  merge.ts                    Rebase-then-merge + merge lock + QUARTERMASTER path.
  recon.ts                    Recon-specific lifecycle.
  worktree.ts                 git worktree create/remove/rebase with timeouts.
  watchdog.ts                 L6 sweep + startup rehydration + post-resolution cleanup.
  comms.ts                    Structured comms emission under CONTROL identity.
  prompt-builder.ts           Assembles mission, retry, OVERSEER, QM prompts.
  config.ts                   Reads tunables from settings table with hardcoded fallbacks.

src/control/debrief/
  schema.ts                   DEBRIEF block JSON schema + zod validator.
  parse.ts                    Extract block from final assistant message.
  synthesize.ts               Deterministic fallback from git state.

src/control/assets/
  registry.ts                 6-asset roster seed data.
  prompts/combat/             OPERATIVE, VANGUARD, INTEL system prompts.
  prompts/system/             OVERSEER (classify + consult), QUARTERMASTER, STRATEGIST prompts.
  cli-builder.ts              Translate asset config to claude CLI flags.

src/control/bootstrap/
  detect.ts                   Probe repo for existing test/build/lint infra.
  scaffold.ts                 Install missing infra via INTEL.
  verify.ts                   Run gates on HEAD, seal manifest, set mainIsRed if red.
  frameworks.ts               Curated per-language framework config.

src/control/campaign/
  executor.ts                 Phase progression, dependency unblocking.
  debrief.ts                  Deterministic phase debrief composition.
  dependency-graph.ts         Validation, cycle detection, transitive cascade.

tests/control/
  unit/                       Per-module tests (vitest).
  integration/                Real-git + scripted-claude full-lifecycle tests.
  e2e/                        End-to-end scenario tests.
  fixtures/
    scripted-claude/          Mock claude binary.
    scenarios/                Scripted scenario files.
    repos/                    Disposable test repositories.

src/actions/                  Rewritten: mission.ts, campaign.ts, battlefield.ts
src/app/battlefields/[id]/settings/  New page for gate manifest + main-red override.

src/lib/telegram/
  bot.ts                      Long-polling update handler with callback_query support.
  notifier.ts                 Notification policy dispatch.

src/lib/db/migrations/
  0024_mission_attempts.sql
  0025_new_columns.sql
  0026_drop_deprecated.sql
  0027_clean_slate.sql

scripts/seed.ts               Updated for 6-asset roster, new RoE text.
```

**Deleted at cutover (Phase 10):**
```
src/lib/orchestrator/         Replaced by src/control/
src/lib/overseer/             Replaced by exit-classifier + retry-policy
src/lib/quartermaster/        Replaced by merge.ts
```

---

## Phase 1 — Schema migration + scripted-claude fixture

Goal: Lay the DB schema for the new model and build the testing infrastructure that Phases 2–7 depend on. No production logic yet.

### Task 1.1: Drizzle schema — `mission_attempts` table

**Files:**
- Modify: `src/lib/db/schema.ts`
- Generate: `src/lib/db/migrations/0024_mission_attempts.sql`

- [ ] **Step 1: Add `missionAttempts` table definition to schema**

Append to `src/lib/db/schema.ts`:

```ts
export const missionAttempts = sqliteTable('mission_attempts', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  attemptNumber: integer('attempt_number').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  endReason: text('end_reason', {
    enum: ['clean', 'timeout', 'silence-kill', 'infrastructure', 'rate-limit', 'auth', 'turn-limit', 'gate-failure'],
  }),
  classification: text('classification'), // JSON
  gateResults: text('gate_results'), // JSON
  debriefSynthesized: integer('debrief_synthesized').notNull().default(0),
  autoCommitted: integer('auto_committed').notNull().default(0),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  tokensCache: integer('tokens_cache').notNull().default(0),
  durationMs: integer('duration_ms'),
  sessionId: text('session_id'),
  targetHeadAtStart: text('target_head_at_start'),
});

export type MissionAttempt = typeof missionAttempts.$inferSelect;
export type NewMissionAttempt = typeof missionAttempts.$inferInsert;
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate`
Expected: A new file `src/lib/db/migrations/0024_*.sql` containing `CREATE TABLE mission_attempts`.

- [ ] **Step 3: Inspect the generated SQL to verify correctness**

Read the generated file. Check that the columns match the schema definition above and the types are `text` / `integer` matching SQLite.

- [ ] **Step 4: Apply migration locally**

Run: `pnpm db:migrate`
Expected: no errors. Table created.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "feat(db): add mission_attempts table for per-attempt lifecycle audit"
```

### Task 1.2: Drizzle schema — new columns on existing tables

**Files:**
- Modify: `src/lib/db/schema.ts`
- Generate: `src/lib/db/migrations/0025_new_columns.sql`

- [ ] **Step 1: Add columns to `battlefields` and `missions` tables**

In `schema.ts`, add these columns to the existing `battlefields` table definition:

```ts
gateManifest: text('gate_manifest'), // JSON: { build, test, lint, typecheck }
needsGateManifest: integer('needs_gate_manifest').notNull().default(0),
mainIsRed: integer('main_is_red').notNull().default(0),
overrideMainRedGuard: integer('override_main_red_guard').notNull().default(0),
```

Add these columns to the existing `missions` table definition:

```ts
debriefStructured: text('debrief_structured'), // JSON
nextAttemptAt: integer('next_attempt_at'),
infrastructureRetryCount: integer('infrastructure_retry_count').notNull().default(0),
type: text('type', { enum: ['combat', 'recon'] }).notNull().default('combat'),
reconViolatedReadonly: integer('recon_violated_readonly').notNull().default(0),
currentSortieAttempts: integer('current_sortie_attempts').notNull().default(0),
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate`
Expected: migration file adds columns with `ALTER TABLE` statements.

- [ ] **Step 3: Apply migration locally**

Run: `pnpm db:migrate`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "feat(db): add battlefields gate manifest + missions lifecycle columns"
```

### Task 1.3: **DEFERRED to Phase 10** — drop deprecated columns

Originally this task dropped `reviewAttempts` / `compromiseReason` / `mergeRetryAt` in Phase 1. Deferred to Phase 10 because these columns are still referenced by the old orchestrator/overseer/quartermaster code (which remains live until Phase 10 cutover). Dropping them in Phase 1 would require either gutting the old code early (out of scope for Phase 1) or adding shims (ugly transitional code). Cleaner to drop columns in the same migration that deletes the referencing code. The column drops are now merged into the cutover migration at Task 10.2 — see that task for the consolidated SQL.

### Task 1.4: Clean-slate wipe migration

**Files:**
- Create: `src/lib/db/migrations/0027_clean_slate.sql` (handwritten, not generated)

- [ ] **Step 1: Handwrite the clean-slate migration**

Drizzle generate does not do this kind of migration (data deletion + flag updates). Write manually.

Create `src/lib/db/migrations/0027_clean_slate.sql`:

```sql
-- Clean-slate migration for CONTROL refactor cutover.
-- Preserves: battlefields (flagged needs_gate_manifest), assets (reseeded), dossiers, settings, scheduledTasks.
-- Wipes: all operational data.

DELETE FROM mission_attempts;
DELETE FROM comms;
DELETE FROM mission_logs;
DELETE FROM overseer_logs;
DELETE FROM follow_up_suggestions;
DELETE FROM intel_notes WHERE mission_id IS NOT NULL;
DELETE FROM missions;
DELETE FROM phases;
DELETE FROM campaigns;

-- Flag all existing battlefields for gate manifest establishment.
UPDATE battlefields SET needs_gate_manifest = 1, main_is_red = 0, override_main_red_guard = 0, gate_manifest = NULL;

-- Assets will be reseeded by scripts/seed.ts after migration.
DELETE FROM assets;
```

- [ ] **Step 2: Register the migration in `meta/_journal.json`**

Run: `pnpm db:generate` — it will detect the new SQL file and wire it in. If it doesn't, copy the structure from an adjacent migration's journal entry and add by hand.

- [ ] **Step 3: DO NOT apply this migration yet**

This migration runs only at Phase 10 cutover, not now. Locally, it's present on disk but unapplied. Tests that need clean-slate do their own truncation.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/migrations/
git commit -m "feat(db): add clean-slate migration (applied at cutover only)"
```

### Task 1.4b: Drizzle schema — `comms` table

**Files:**
- Modify: `src/lib/db/schema.ts`
- Generate: `src/lib/db/migrations/0026_*.sql`

Rationale: Spec §4 names CONTROL's event stream `comms`. Task 2.2's emitter writes to a `comms` table; clean-slate migration (Task 1.4) already references `DELETE FROM comms`. The existing `mission_logs` table is mission-scoped and tied to the old orchestrator — `comms` is a fresh table that also carries campaign- and battlefield-scoped events under a named actor (CONTROL, OPERATIVE, OVERSEER, etc.).

- [ ] **Step 1: Add `comms` table definition**

Append to `src/lib/db/schema.ts` (after `missionAttempts`):

```ts
export const comms = sqliteTable('comms', {
  id: text('id').primaryKey(),
  missionId: text('mission_id'),
  campaignId: text('campaign_id'),
  battlefieldId: text('battlefield_id'),
  actor: text('actor').notNull(),
  message: text('message').notNull(),
  level: text('level', { enum: ['info', 'warn', 'error'] }).notNull().default('info'),
  createdAt: integer('created_at').notNull(),
});

export type Comm = typeof comms.$inferSelect;
export type NewComm = typeof comms.$inferInsert;
```

- [ ] **Step 2: Generate migration** — `pnpm db:generate`.
- [ ] **Step 3: Apply migration** — `pnpm db:migrate`.
- [ ] **Step 4: Commit** — `feat(db): add comms table for CONTROL event stream`.

### Task 1.5: Build scripted-claude fixture

**Files:**
- Create: `tests/control/fixtures/scripted-claude/scripted-claude.ts`
- Create: `tests/control/fixtures/scripted-claude/scenario.ts`
- Create: `tests/control/fixtures/scripted-claude/README.md`

- [ ] **Step 1: Define scenario file schema**

Create `tests/control/fixtures/scripted-claude/scenario.ts`:

```ts
export interface Scenario {
  /** Events emitted as JSON lines to stdout, in order. */
  events: ScenarioEvent[];
  /** Final exit code. Defaults to 0. */
  exitCode?: number;
  /** Optional stderr to emit before exit. */
  stderr?: string;
  /** Optional hang: if set, process sleeps this many ms before exit/final event. */
  hangMs?: number;
}

export type ScenarioEvent =
  | { type: 'assistant'; text: string; delayMs?: number }
  | { type: 'tool_use'; name: string; delayMs?: number }
  | { type: 'result'; subtype: 'success' | 'error_max_turns' | 'error_during_execution'; delayMs?: number; duration_ms?: number; num_turns?: number; total_cost_usd?: number; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number } };

export function loadScenario(path: string): Scenario {
  const fs = require('node:fs');
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
```

- [ ] **Step 2: Write the scripted-claude executable**

Create `tests/control/fixtures/scripted-claude/scripted-claude.ts`:

```ts
#!/usr/bin/env tsx
// Scripted claude stand-in. Reads a scenario path from env var SCRIPTED_CLAUDE_SCENARIO
// and emits pre-canned JSON stream events with optional delays.
import { loadScenario } from './scenario';

async function main() {
  const scenarioPath = process.env.SCRIPTED_CLAUDE_SCENARIO;
  if (!scenarioPath) {
    process.stderr.write('SCRIPTED_CLAUDE_SCENARIO env var required\n');
    process.exit(2);
  }
  const scenario = loadScenario(scenarioPath);

  if (scenario.hangMs) {
    await new Promise(resolve => setTimeout(resolve, scenario.hangMs));
  }

  for (const event of scenario.events) {
    if (event.delayMs) {
      await new Promise(resolve => setTimeout(resolve, event.delayMs));
    }
    const line = JSON.stringify(event);
    process.stdout.write(line + '\n');
  }

  if (scenario.stderr) {
    process.stderr.write(scenario.stderr + '\n');
  }

  process.exit(scenario.exitCode ?? 0);
}

main().catch(err => {
  process.stderr.write(`scripted-claude error: ${err.message}\n`);
  process.exit(2);
});
```

- [ ] **Step 3: Write a sample scenario + smoke test**

Create `tests/control/fixtures/scenarios/happy-path-combat.json`:

```json
{
  "events": [
    { "type": "assistant", "text": "Starting task", "delayMs": 50 },
    { "type": "tool_use", "name": "Read", "delayMs": 100 },
    { "type": "tool_use", "name": "Edit", "delayMs": 100 },
    { "type": "assistant", "text": "Done. <DEBRIEF>{\"summary\":\"ok\",\"commits\":[],\"files_touched\":[],\"confidence\":\"high\"}</DEBRIEF>", "delayMs": 50 },
    { "type": "result", "subtype": "success", "duration_ms": 300, "num_turns": 2, "total_cost_usd": 0.001, "usage": { "input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 900 } }
  ],
  "exitCode": 0
}
```

Create `tests/control/fixtures/scripted-claude/__tests__/scripted-claude.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

describe('scripted-claude fixture', () => {
  it('emits scenario events as JSON lines and exits with specified code', async () => {
    const scenarioPath = path.join(__dirname, '../../scenarios/happy-path-combat.json');
    const scriptPath = path.join(__dirname, '../scripted-claude.ts');

    const result = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn('tsx', [scriptPath], {
        env: { ...process.env, SCRIPTED_CLAUDE_SCENARIO: scenarioPath },
      });
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.on('close', (code) => resolve({ code, stdout }));
    });

    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[lines.length - 1].type).toBe('result');
    expect(lines[lines.length - 1].subtype).toBe('success');
  });
});
```

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm test tests/control/fixtures/scripted-claude/__tests__/scripted-claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/control/fixtures/
git commit -m "feat(test): scripted-claude fixture for deterministic control tests"
```

### Task 1.6: Disposable repo fixture materializer

**Files:**
- Create: `tests/control/fixtures/repos/materialize.ts`
- Create: `tests/control/fixtures/repos/templates/ts-with-tests/` (directory with a minimal Vitest project)
- Create: `tests/control/fixtures/repos/templates/ts-no-tests/`
- Create: `tests/control/fixtures/repos/templates/red-main/`

- [ ] **Step 1: Create template repos**

Create `tests/control/fixtures/repos/templates/ts-with-tests/package.json`:

```json
{
  "name": "ts-with-tests-fixture",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "*",
    "typescript": "*"
  }
}
```

Create `tests/control/fixtures/repos/templates/ts-with-tests/src/index.ts`:

```ts
export function add(a: number, b: number): number { return a + b; }
```

Create `tests/control/fixtures/repos/templates/ts-with-tests/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { add } from './index';

describe('add', () => {
  it('sums two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
```

Add `tsconfig.json`, `vitest.config.ts` minimal content appropriate for a standalone Vitest project.

Repeat for `ts-no-tests/` (same but no `test` script, no test files) and `red-main/` (add a test file that deliberately fails).

- [ ] **Step 2: Write the materializer**

Create `tests/control/fixtures/repos/materialize.ts`:

```ts
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';

export interface MaterializedRepo {
  path: string;
  cleanup: () => Promise<void>;
}

export async function materializeRepo(template: 'ts-with-tests' | 'ts-no-tests' | 'red-main'): Promise<MaterializedRepo> {
  const dir = await mkdtemp(path.join(tmpdir(), 'devroom-fixture-'));
  const src = path.join(__dirname, 'templates', template);
  await cp(src, dir, { recursive: true });

  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'fixture@local');
  await git.addConfig('user.name', 'Fixture');
  await git.add('.');
  await git.commit('initial fixture state');

  return {
    path: dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 3: Write smoke test for materializer**

Create `tests/control/fixtures/repos/__tests__/materialize.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import simpleGit from 'simple-git';
import { materializeRepo, MaterializedRepo } from '../materialize';

describe('materializeRepo', () => {
  let repo: MaterializedRepo;
  afterEach(async () => { if (repo) await repo.cleanup(); });

  it('materializes ts-with-tests template as a git repo with initial commit', async () => {
    repo = await materializeRepo('ts-with-tests');
    expect(existsSync(repo.path)).toBe(true);
    expect(existsSync(`${repo.path}/package.json`)).toBe(true);
    const log = await simpleGit(repo.path).log();
    expect(log.all.length).toBe(1);
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm test tests/control/fixtures/repos/__tests__/materialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/control/fixtures/repos/
git commit -m "feat(test): disposable repo fixture materializer for integration tests"
```

---

## Phase 2 — `src/control/` skeleton (unit-tested modules)

Goal: Build each CONTROL module with TDD. No wiring to the rest of DEVROOM yet. Every module has unit tests with high coverage of its logic branches.

### Task 2.1: `config.ts` — settings table reader with hardcoded fallbacks

**Files:**
- Create: `src/control/config.ts`
- Test: `tests/control/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/control/unit/config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getControlConfig, clearConfigCache } from '@/control/config';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';

describe('getControlConfig', () => {
  beforeEach(() => {
    clearConfigCache();
    db.delete(settings).where(undefined as any).run?.();
  });

  it('returns hardcoded defaults when no settings exist', () => {
    const cfg = getControlConfig();
    expect(cfg.maxAgents).toBe(3);
    expect(cfg.attemptHardTimeoutMs).toBe(1_800_000);
    expect(cfg.stdoutSilenceMs).toBe(300_000);
    expect(cfg.infraRetryBackoffMs).toEqual([30_000, 120_000, 600_000, 1_800_000]);
    expect(cfg.gateSuiteTimeoutMs).toBe(900_000);
    expect(cfg.gatePerCommandTimeoutMs).toBe(300_000);
    expect(cfg.reconStdoutSilenceMs).toBe(600_000);
    expect(cfg.quartermasterTimeoutMs).toBe(600_000);
  });

  it('reads overrides from settings table for tunable keys', () => {
    db.insert(settings).values({ key: 'devroom_max_agents', value: '5' }).run();
    clearConfigCache();
    expect(getControlConfig().maxAgents).toBe(5);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test tests/control/unit/config.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `config.ts`**

Create `src/control/config.ts`:

```ts
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface ControlConfig {
  maxAgents: number;
  attemptHardTimeoutMs: number;
  stdoutSilenceMs: number;
  reconStdoutSilenceMs: number;
  infraRetryBackoffMs: number[];
  gateSuiteTimeoutMs: number;
  gatePerCommandTimeoutMs: number;
  quartermasterTimeoutMs: number;
}

const DEFAULTS: ControlConfig = {
  maxAgents: 3,
  attemptHardTimeoutMs: 1_800_000,
  stdoutSilenceMs: 300_000,
  reconStdoutSilenceMs: 600_000,
  infraRetryBackoffMs: [30_000, 120_000, 600_000, 1_800_000],
  gateSuiteTimeoutMs: 900_000,
  gatePerCommandTimeoutMs: 300_000,
  quartermasterTimeoutMs: 600_000,
};

let cache: ControlConfig | null = null;

export function clearConfigCache(): void { cache = null; }

export function getControlConfig(): ControlConfig {
  if (cache) return cache;
  const rows = db.select().from(settings).all();
  const map = new Map(rows.map(r => [r.key, r.value]));

  const cfg: ControlConfig = {
    ...DEFAULTS,
    maxAgents: parseInt(map.get('devroom_max_agents') ?? '', 10) || DEFAULTS.maxAgents,
    attemptHardTimeoutMs: parseInt(map.get('attempt_hard_timeout_ms') ?? '', 10) || DEFAULTS.attemptHardTimeoutMs,
    stdoutSilenceMs: parseInt(map.get('stdout_silence_ms') ?? '', 10) || DEFAULTS.stdoutSilenceMs,
  };
  cache = cfg;
  return cfg;
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test tests/control/unit/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/config.ts tests/control/unit/config.test.ts
git commit -m "feat(control): config reader with hardcoded defaults + settings overrides"
```

### Task 2.2: `comms.ts` — structured comms emitter

**Files:**
- Create: `src/control/comms.ts`
- Test: `tests/control/unit/comms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { emitComm, setCommsEmitter } from '@/control/comms';
import { db } from '@/lib/db';
import { comms } from '@/lib/db/schema';

describe('emitComm', () => {
  beforeEach(() => {
    db.delete(comms).run();
    setCommsEmitter(null); // no socket.io in unit tests
  });

  it('writes a comms row with CONTROL as actor when no actor override', () => {
    emitComm({ missionId: 'm1', message: 'Deploying mission' });
    const rows = db.select().from(comms).all();
    expect(rows.length).toBe(1);
    expect(rows[0].actor).toBe('CONTROL');
    expect(rows[0].message).toBe('Deploying mission');
    expect(rows[0].missionId).toBe('m1');
  });

  it('accepts actor override for asset-emitted events', () => {
    emitComm({ missionId: 'm1', actor: 'OPERATIVE', message: 'Running tests' });
    const rows = db.select().from(comms).all();
    expect(rows[0].actor).toBe('OPERATIVE');
  });

  it('invokes socket.io emitter when registered', () => {
    let emitted: any = null;
    setCommsEmitter((room, event, payload) => { emitted = { room, event, payload }; });
    emitComm({ missionId: 'm1', message: 'Hello' });
    expect(emitted?.room).toBe('mission:m1');
    expect(emitted?.event).toBe('mission:log');
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `comms.ts`**

```ts
import { db } from '@/lib/db';
import { comms } from '@/lib/db/schema';
import { ulid } from 'ulidx';

export interface CommEvent {
  missionId?: string;
  campaignId?: string;
  battlefieldId?: string;
  actor?: string; // defaults to 'CONTROL'
  message: string;
  level?: 'info' | 'warn' | 'error';
}

type Emitter = (room: string, event: string, payload: unknown) => void;
let emitter: Emitter | null = null;

export function setCommsEmitter(fn: Emitter | null): void { emitter = fn; }

export function emitComm(ev: CommEvent): void {
  const row = {
    id: ulid(),
    missionId: ev.missionId ?? null,
    campaignId: ev.campaignId ?? null,
    battlefieldId: ev.battlefieldId ?? null,
    actor: ev.actor ?? 'CONTROL',
    message: ev.message,
    level: ev.level ?? 'info',
    createdAt: Date.now(),
  };
  db.insert(comms).values(row).run();

  if (emitter && ev.missionId) {
    emitter(`mission:${ev.missionId}`, 'mission:log', row);
  }
  if (emitter && ev.campaignId) {
    emitter(`campaign:${ev.campaignId}`, 'campaign:log', row);
  }
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(control): comms emitter with socket.io hook"
```

### Task 2.3: `liveness.ts` — L1/L3/L5 monitor

**Files:**
- Create: `src/control/liveness.ts`
- Test: `tests/control/unit/liveness.test.ts`

- [ ] **Step 1: Define the interface**

```ts
// src/control/liveness.ts
import type { ChildProcess } from 'node:child_process';

export type LivenessEvent =
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'silence-kill'; silenceMs: number }
  | { type: 'timeout'; elapsedMs: number };

export interface LivenessOptions {
  stdoutSilenceMs: number;   // L3 threshold
  hardTimeoutMs: number;     // L5 threshold
  onEvent: (ev: LivenessEvent) => void;
}

export interface LivenessMonitor {
  /** Call on each JSON line received from stdout. Resets L3 timer. */
  notifyStdout(): void;
  /** Cancel all timers. Idempotent. */
  dispose(): void;
}

export function attachLivenessMonitor(
  process: ChildProcess,
  opts: LivenessOptions,
): LivenessMonitor {
  // implementation below
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/control/unit/liveness.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { attachLivenessMonitor, LivenessEvent } from '@/control/liveness';

function makeFakeProcess(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  (ee as any).kill = vi.fn();
  return ee;
}

describe('attachLivenessMonitor', () => {
  it('fires exit event when child process closes', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    (proc as unknown as EventEmitter).emit('close', 0, null);
    expect(events).toEqual([{ type: 'exit', code: 0, signal: null }]);
    vi.useRealTimers();
  });

  it('fires silence-kill after stdoutSilenceMs of no notifyStdout', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    vi.advanceTimersByTime(4999);
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(events.some(e => e.type === 'silence-kill')).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('notifyStdout resets silence timer', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    const mon = attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    vi.advanceTimersByTime(4000);
    mon.notifyStdout();
    vi.advanceTimersByTime(4000);
    expect(events.length).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(events.some(e => e.type === 'silence-kill')).toBe(true);
    vi.useRealTimers();
  });

  it('fires timeout after hardTimeoutMs regardless of activity', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    const mon = attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 10000, onEvent: e => events.push(e) });
    for (let t = 0; t < 10000; t += 1000) {
      mon.notifyStdout();
      vi.advanceTimersByTime(1000);
    }
    mon.notifyStdout(); vi.advanceTimersByTime(1);
    expect(events.some(e => e.type === 'timeout')).toBe(true);
    vi.useRealTimers();
  });

  it('dispose cancels all pending timers', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    const mon = attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    mon.dispose();
    vi.advanceTimersByTime(60000);
    expect(events).toHaveLength(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run — fail**

- [ ] **Step 4: Implement `liveness.ts`**

```ts
import type { ChildProcess } from 'node:child_process';

export type LivenessEvent =
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'silence-kill'; silenceMs: number }
  | { type: 'timeout'; elapsedMs: number };

export interface LivenessOptions {
  stdoutSilenceMs: number;
  hardTimeoutMs: number;
  onEvent: (ev: LivenessEvent) => void;
}

export interface LivenessMonitor {
  notifyStdout(): void;
  dispose(): void;
}

export function attachLivenessMonitor(
  process: ChildProcess,
  opts: LivenessOptions,
): LivenessMonitor {
  let disposed = false;
  let silenceTimer: NodeJS.Timeout | null = null;
  let hardTimer: NodeJS.Timeout | null = null;
  const startedAt = Date.now();

  const resetSilence = () => {
    if (disposed) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (disposed) return;
      opts.onEvent({ type: 'silence-kill', silenceMs: opts.stdoutSilenceMs });
      process.kill('SIGTERM');
      setTimeout(() => { if (!disposed) process.kill('SIGKILL'); }, 5000);
    }, opts.stdoutSilenceMs);
  };

  hardTimer = setTimeout(() => {
    if (disposed) return;
    opts.onEvent({ type: 'timeout', elapsedMs: Date.now() - startedAt });
    process.kill('SIGTERM');
    setTimeout(() => { if (!disposed) process.kill('SIGKILL'); }, 5000);
  }, opts.hardTimeoutMs);

  process.on('close', (code, signal) => {
    opts.onEvent({ type: 'exit', code, signal });
    dispose();
  });

  resetSilence();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (silenceTimer) clearTimeout(silenceTimer);
    if (hardTimer) clearTimeout(hardTimer);
  }

  return {
    notifyStdout: () => resetSilence(),
    dispose,
  };
}
```

- [ ] **Step 5: Run — pass all cases**

Run: `pnpm test tests/control/unit/liveness.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(control): liveness monitor (L1 exit, L3 silence, L5 wall clock)"
```

### Task 2.4: `exit-classifier.ts` — fast-path regex + OVERSEER fallback

**Files:**
- Create: `src/control/exit-classifier.ts`
- Test: `tests/control/unit/exit-classifier.test.ts`

- [ ] **Step 1: Write failing tests covering every category**

```ts
import { describe, it, expect, vi } from 'vitest';
import { classifyExit, ExitCategory } from '@/control/exit-classifier';

describe('classifyExit (fast-path)', () => {
  it('CLEAN on exit 0 with success result event', async () => {
    const r = await classifyExit({ exitCode: 0, stderr: '', stdoutResultSubtype: 'success', killedByControl: false, elapsedMs: 5000, toolUseCount: 3, hasDiff: true });
    expect(r.category).toBe('CLEAN');
  });
  it('TURN_LIMIT on error_max_turns subtype', async () => {
    const r = await classifyExit({ exitCode: 0, stderr: '', stdoutResultSubtype: 'error_max_turns', killedByControl: false, elapsedMs: 5000, toolUseCount: 3, hasDiff: true });
    expect(r.category).toBe('TURN_LIMIT');
  });
  it('TIMEOUT when killedByControl flag is set', async () => {
    const r = await classifyExit({ exitCode: 143, stderr: '', stdoutResultSubtype: null, killedByControl: true, elapsedMs: 30_000, toolUseCount: 0, hasDiff: false });
    expect(r.category).toBe('TIMEOUT');
  });
  it('INFRASTRUCTURE on 5xx stderr pattern', async () => {
    const r = await classifyExit({ exitCode: 1, stderr: 'Error: 503 Service Unavailable', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 2000, toolUseCount: 0, hasDiff: false });
    expect(r.category).toBe('INFRASTRUCTURE');
  });
  it('INFRASTRUCTURE on ECONNRESET', async () => {
    const r = await classifyExit({ exitCode: 1, stderr: 'ECONNRESET', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 2000, toolUseCount: 0, hasDiff: false });
    expect(r.category).toBe('INFRASTRUCTURE');
  });
  it('INFRASTRUCTURE on unclassified quick-exit (crash-like)', async () => {
    const r = await classifyExit({ exitCode: 2, stderr: 'weird unknown', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 500, toolUseCount: 0, hasDiff: false });
    expect(r.category).toBe('INFRASTRUCTURE');
  });
  it('RATE_LIMIT on 429', async () => {
    const r = await classifyExit({ exitCode: 1, stderr: '429 Too Many Requests', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 1000, toolUseCount: 0, hasDiff: false });
    expect(r.category).toBe('RATE_LIMIT');
  });
  it('AUTH on 401', async () => {
    const r = await classifyExit({ exitCode: 1, stderr: '401 unauthorized', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 1000, toolUseCount: 0, hasDiff: false });
    expect(r.category).toBe('AUTH');
  });
});

describe('classifyExit (OVERSEER fallback)', () => {
  it('invokes OVERSEER classifier when no fast-path matches', async () => {
    const overseerSpy = vi.fn().mockResolvedValue({ category: 'AGENT_FAILURE', reasoning: 'test' });
    const r = await classifyExit(
      { exitCode: 1, stderr: 'genuinely novel error', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 60_000, toolUseCount: 10, hasDiff: true },
      { overseerClassify: overseerSpy },
    );
    expect(overseerSpy).toHaveBeenCalledOnce();
    expect(r.category).toBe('AGENT_FAILURE');
  });
  it('returns NEEDS_COMMANDER when OVERSEER classifier itself errors', async () => {
    const overseerSpy = vi.fn().mockRejectedValue(new Error('overseer down'));
    const r = await classifyExit(
      { exitCode: 1, stderr: 'genuinely novel', stdoutResultSubtype: null, killedByControl: false, elapsedMs: 60_000, toolUseCount: 10, hasDiff: true },
      { overseerClassify: overseerSpy },
    );
    expect(r.category).toBe('NEEDS_COMMANDER');
    expect(r.reasoning).toContain('overseer');
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `exit-classifier.ts`**

```ts
export type ExitCategory = 'CLEAN' | 'TURN_LIMIT' | 'TIMEOUT' | 'INFRASTRUCTURE' | 'RATE_LIMIT' | 'AUTH' | 'AGENT_FAILURE' | 'NEEDS_COMMANDER';

export interface ExitContext {
  exitCode: number | null;
  stderr: string;
  stdoutResultSubtype: 'success' | 'error_max_turns' | 'error_during_execution' | null;
  killedByControl: boolean;
  elapsedMs: number;
  toolUseCount: number;
  hasDiff: boolean;
}

export interface Classification { category: ExitCategory; reasoning: string; }

export interface ClassifierDeps {
  overseerClassify?: (ctx: ExitContext) => Promise<{ category: 'INFRASTRUCTURE' | 'AGENT_FAILURE' | 'NEEDS_COMMANDER'; reasoning: string }>;
}

const INFRA = /\b5\d\d\b|overload|server.?busy|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|stream aborted/i;
const RATE = /\b429\b|rate.?limit|too many requests/i;
const AUTH = /\b40[13]\b|unauthori[sz]ed|invalid.?credential|keychain/i;

export async function classifyExit(ctx: ExitContext, deps: ClassifierDeps = {}): Promise<Classification> {
  if (ctx.killedByControl) return { category: 'TIMEOUT', reasoning: 'killed by CONTROL supervision' };
  if (ctx.stdoutResultSubtype === 'success') return { category: 'CLEAN', reasoning: 'success result event' };
  if (ctx.stdoutResultSubtype === 'error_max_turns') return { category: 'TURN_LIMIT', reasoning: 'max turns reached' };
  if (AUTH.test(ctx.stderr)) return { category: 'AUTH', reasoning: 'auth pattern in stderr' };
  if (RATE.test(ctx.stderr)) return { category: 'RATE_LIMIT', reasoning: 'rate-limit pattern in stderr' };
  if (INFRA.test(ctx.stderr)) return { category: 'INFRASTRUCTURE', reasoning: 'infra pattern in stderr' };
  if (ctx.exitCode !== 0 && ctx.elapsedMs < 30_000 && ctx.toolUseCount === 0 && !ctx.hasDiff) {
    return { category: 'INFRASTRUCTURE', reasoning: 'fast-exit with no activity (crash-like)' };
  }

  // Fallback: OVERSEER classification.
  if (!deps.overseerClassify) return { category: 'NEEDS_COMMANDER', reasoning: 'no classifier available for unknown exit' };
  try {
    const o = await deps.overseerClassify(ctx);
    return { category: o.category, reasoning: `overseer: ${o.reasoning}` };
  } catch (err) {
    return { category: 'NEEDS_COMMANDER', reasoning: `overseer classification failed: ${(err as Error).message}` };
  }
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(control): exit-classifier with regex fast-paths + overseer fallback"
```

### Task 2.5: `retry-policy.ts` — attempt budget state machine

**Files:**
- Create: `src/control/retry-policy.ts`
- Test: `tests/control/unit/retry-policy.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest';
import { decideNextAction, RetryState } from '@/control/retry-policy';

describe('decideNextAction', () => {
  it('attempt 1 gate pass → COMPLETE', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'gate-pass', lastDiffHash: 'x', priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('COMPLETE');
  });
  it('attempt 1 gate fail → DETERMINISTIC_RETRY', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'gate-fail', lastDiffHash: 'x', priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('DETERMINISTIC_RETRY');
  });
  it('attempt 2 gate fail with same diff → OVERSEER_CONSULT (skip attempt 3)', () => {
    const r = decideNextAction({ sortieAttempt: 2, lastOutcome: 'gate-fail', lastDiffHash: 'x', priorDiffHash: 'x', overseerConsulted: false });
    expect(r.action).toBe('OVERSEER_CONSULT');
  });
  it('attempt 2 gate fail with different diff → DETERMINISTIC_RETRY (attempt 3)', () => {
    const r = decideNextAction({ sortieAttempt: 2, lastOutcome: 'gate-fail', lastDiffHash: 'y', priorDiffHash: 'x', overseerConsulted: false });
    expect(r.action).toBe('DETERMINISTIC_RETRY');
  });
  it('attempt 3 gate fail (haven\'t consulted) → OVERSEER_CONSULT', () => {
    const r = decideNextAction({ sortieAttempt: 3, lastOutcome: 'gate-fail', lastDiffHash: 'z', priorDiffHash: 'y', overseerConsulted: false });
    expect(r.action).toBe('OVERSEER_CONSULT');
  });
  it('attempt 4 gate fail after consult → COMPROMISED', () => {
    const r = decideNextAction({ sortieAttempt: 4, lastOutcome: 'gate-fail', lastDiffHash: 'w', priorDiffHash: 'z', overseerConsulted: true });
    expect(r.action).toBe('COMPROMISED');
  });
  it('infrastructure outcome at any attempt → INFRA_BACKOFF', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'infrastructure', lastDiffHash: null, priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('INFRA_BACKOFF');
  });
  it('rate-limit outcome → RATE_LIMIT_BACKOFF', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'rate-limit', lastDiffHash: null, priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('RATE_LIMIT_BACKOFF');
  });
  it('auth outcome → AUTH_PAUSE', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'auth', lastDiffHash: null, priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('AUTH_PAUSE');
  });
});

describe('infra backoff', () => {
  it('returns next backoff delay from schedule', () => {
    const { nextInfraBackoffMs } = require('@/control/retry-policy');
    expect(nextInfraBackoffMs(0, [30_000, 120_000])).toBe(30_000);
    expect(nextInfraBackoffMs(1, [30_000, 120_000])).toBe(120_000);
    expect(nextInfraBackoffMs(2, [30_000, 120_000])).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `retry-policy.ts`**

```ts
export type AttemptOutcome = 'gate-pass' | 'gate-fail' | 'infrastructure' | 'rate-limit' | 'auth' | 'timeout' | 'turn-limit';
export type NextAction = 'COMPLETE' | 'DETERMINISTIC_RETRY' | 'OVERSEER_CONSULT' | 'COMPROMISED' | 'INFRA_BACKOFF' | 'RATE_LIMIT_BACKOFF' | 'AUTH_PAUSE';

export interface RetryState {
  sortieAttempt: number;
  lastOutcome: AttemptOutcome;
  lastDiffHash: string | null;
  priorDiffHash: string | null;
  overseerConsulted: boolean;
}

export function decideNextAction(state: RetryState): { action: NextAction; reason: string } {
  if (state.lastOutcome === 'auth') return { action: 'AUTH_PAUSE', reason: 'auth failure' };
  if (state.lastOutcome === 'infrastructure') return { action: 'INFRA_BACKOFF', reason: 'infra exit' };
  if (state.lastOutcome === 'rate-limit') return { action: 'RATE_LIMIT_BACKOFF', reason: 'rate limit' };

  if (state.lastOutcome === 'gate-pass') return { action: 'COMPLETE', reason: 'gates green' };

  // gate-fail, timeout, turn-limit all treated as "attempt failed, retry-budget applies"
  if (state.sortieAttempt >= 4 && state.overseerConsulted) {
    return { action: 'COMPROMISED', reason: 'overseer-redirect attempt failed' };
  }
  if (state.sortieAttempt >= 3 && !state.overseerConsulted) {
    return { action: 'OVERSEER_CONSULT', reason: 'deterministic budget exhausted' };
  }
  if (state.sortieAttempt === 2 && state.lastDiffHash === state.priorDiffHash) {
    return { action: 'OVERSEER_CONSULT', reason: 'no-progress signal — identical diff to prior attempt' };
  }
  return { action: 'DETERMINISTIC_RETRY', reason: 'retry with gate output' };
}

export function nextInfraBackoffMs(attemptIdx: number, schedule: number[]): number | null {
  if (attemptIdx < 0 || attemptIdx >= schedule.length) return null;
  return schedule[attemptIdx];
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(control): retry-policy state machine with TDD coverage"
```

### Task 2.6: `gates.ts` — sequential fail-fast runner

**Files:**
- Create: `src/control/gates.ts`
- Test: `tests/control/unit/gates.test.ts`

- [ ] **Step 1: Define interface**

```ts
// src/control/gates.ts
export interface GateManifest {
  build: string | null;
  test: string | null;
  lint: string | null;
  typecheck: string | null;
}

export interface GateResult {
  gate: 'build' | 'test' | 'lint' | 'typecheck';
  status: 'pass' | 'fail' | 'skipped' | 'timeout' | 'command-missing';
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface GateRunResults {
  results: GateResult[];
  overallStatus: 'pass' | 'fail';
}

export interface RunGatesOptions {
  manifest: GateManifest;
  workingDir: string;
  perCommandTimeoutMs: number;
  suiteTimeoutMs: number;
  /** Injected for tests. */
  spawnShell?: (cmd: string, opts: { cwd: string; timeout: number }) => Promise<{ code: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; commandMissing: boolean }>;
}

export async function runGates(opts: RunGatesOptions): Promise<GateRunResults> {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write tests (TDD)**

```ts
// tests/control/unit/gates.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runGates } from '@/control/gates';

describe('runGates', () => {
  const manifest = { lint: 'pnpm lint', typecheck: 'tsc --noEmit', build: 'pnpm build', test: 'pnpm test' };

  it('runs in order lint → typecheck → build → test and stops on first fail', async () => {
    const calls: string[] = [];
    const spawn = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      return { code: cmd.includes('build') ? 1 : 0, stdout: '', stderr: cmd.includes('build') ? 'broken' : '', durationMs: 10, timedOut: false, commandMissing: false };
    });
    const r = await runGates({ manifest, workingDir: '/tmp', perCommandTimeoutMs: 1000, suiteTimeoutMs: 10000, spawnShell: spawn });
    expect(calls).toEqual(['pnpm lint', 'tsc --noEmit', 'pnpm build']); // stops before test
    expect(r.overallStatus).toBe('fail');
    expect(r.results[2].status).toBe('fail');
    expect(r.results.find(x => x.gate === 'test')).toBeUndefined();
  });

  it('skips gates whose command is null', async () => {
    const manifestNoLint = { ...manifest, lint: null };
    const spawn = vi.fn(async () => ({ code: 0, stdout: '', stderr: '', durationMs: 10, timedOut: false, commandMissing: false }));
    const r = await runGates({ manifest: manifestNoLint, workingDir: '/tmp', perCommandTimeoutMs: 1000, suiteTimeoutMs: 10000, spawnShell: spawn });
    expect(r.results.find(x => x.gate === 'lint')?.status).toBe('skipped');
  });

  it('all pass → overallStatus pass', async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: '', stderr: '', durationMs: 10, timedOut: false, commandMissing: false }));
    const r = await runGates({ manifest, workingDir: '/tmp', perCommandTimeoutMs: 1000, suiteTimeoutMs: 10000, spawnShell: spawn });
    expect(r.overallStatus).toBe('pass');
  });

  it('reports command-missing when spawnShell reports commandMissing', async () => {
    const spawn = vi.fn(async () => ({ code: 127, stdout: '', stderr: 'command not found', durationMs: 5, timedOut: false, commandMissing: true }));
    const r = await runGates({ manifest, workingDir: '/tmp', perCommandTimeoutMs: 1000, suiteTimeoutMs: 10000, spawnShell: spawn });
    expect(r.results[0].status).toBe('command-missing');
  });

  it('reports timeout when spawnShell reports timedOut', async () => {
    const spawn = vi.fn(async () => ({ code: null, stdout: '', stderr: 'killed', durationMs: 1000, timedOut: true, commandMissing: false }));
    const r = await runGates({ manifest, workingDir: '/tmp', perCommandTimeoutMs: 500, suiteTimeoutMs: 10000, spawnShell: spawn });
    expect(r.results[0].status).toBe('timeout');
    expect(r.overallStatus).toBe('fail');
  });
});
```

- [ ] **Step 3: Run — fail**

- [ ] **Step 4: Implement runGates**

```ts
// src/control/gates.ts
import { spawn as nodeSpawn } from 'node:child_process';

// Types from Step 1 unchanged; add default spawnShell implementation.

export async function runGates(opts: RunGatesOptions): Promise<GateRunResults> {
  const shell = opts.spawnShell ?? defaultSpawnShell;
  const order: Array<keyof GateManifest> = ['lint', 'typecheck', 'build', 'test'];
  const results: GateResult[] = [];
  const suiteStart = Date.now();

  for (const gate of order) {
    const cmd = opts.manifest[gate];
    if (!cmd) {
      results.push({ gate, status: 'skipped', stdout: '', stderr: '', durationMs: 0 });
      continue;
    }
    const elapsed = Date.now() - suiteStart;
    if (elapsed >= opts.suiteTimeoutMs) {
      results.push({ gate, status: 'timeout', stdout: '', stderr: 'suite timeout', durationMs: 0 });
      return { results, overallStatus: 'fail' };
    }
    const remaining = Math.min(opts.perCommandTimeoutMs, opts.suiteTimeoutMs - elapsed);
    const outcome = await shell(cmd, { cwd: opts.workingDir, timeout: remaining });
    let status: GateResult['status'];
    if (outcome.commandMissing) status = 'command-missing';
    else if (outcome.timedOut) status = 'timeout';
    else if (outcome.code === 0) status = 'pass';
    else status = 'fail';
    results.push({ gate, status, stdout: outcome.stdout, stderr: outcome.stderr, durationMs: outcome.durationMs });
    if (status !== 'pass' && status !== 'skipped') {
      return { results, overallStatus: 'fail' };
    }
  }
  return { results, overallStatus: 'pass' };
}

async function defaultSpawnShell(cmd: string, opts: { cwd: string; timeout: number }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; commandMissing: boolean }>((resolve) => {
    const start = Date.now();
    const child = nodeSpawn('sh', ['-c', cmd], { cwd: opts.cwd });
    let stdout = '', stderr = '', timedOut = false, commandMissing = false;
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    const to = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }, opts.timeout);
    child.on('error', (err) => {
      clearTimeout(to);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') commandMissing = true;
      resolve({ code: null, stdout, stderr: stderr + (err.message ?? ''), durationMs: Date.now() - start, timedOut, commandMissing });
    });
    child.on('close', (code) => {
      clearTimeout(to);
      if (code === 127) commandMissing = true;
      resolve({ code, stdout, stderr, durationMs: Date.now() - start, timedOut, commandMissing });
    });
  });
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(control): sequential fail-fast gate runner with timeouts"
```

### Task 2.7: `worktree.ts` — git worktree helpers

**Files:**
- Create: `src/control/worktree.ts`
- Test: `tests/control/unit/worktree.test.ts`

- [ ] **Step 1: Write integration-style tests using real git + fixture repos**

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { materializeRepo, MaterializedRepo } from '@/../tests/control/fixtures/repos/materialize';
import simpleGit from 'simple-git';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createMissionWorktree, removeMissionWorktree, resetWorktreeToHead, sanitizeBranchForPath } from '@/control/worktree';

describe('sanitizeBranchForPath', () => {
  it('replaces non [a-zA-Z0-9._-] with -', () => {
    expect(sanitizeBranchForPath('devroom/fix-auth/01h')).toBe('devroom-fix-auth-01h');
    expect(sanitizeBranchForPath('feat foo')).toBe('feat-foo');
  });
});

describe('createMissionWorktree', () => {
  let repo: MaterializedRepo;
  beforeEach(async () => { repo = await materializeRepo('ts-with-tests'); });
  afterEach(async () => { if (repo) await repo.cleanup(); });

  it('creates a worktree branched off target', async () => {
    const w = await createMissionWorktree({ repoPath: repo.path, targetBranch: 'master', missionBranch: 'devroom/m1/fix' });
    expect(existsSync(w.path)).toBe(true);
    expect(w.branch).toBe('devroom/m1/fix');
    const branches = await simpleGit(repo.path).branch();
    expect(branches.all).toContain('devroom/m1/fix');
  });

  it('reuses existing worktree when branch already exists', async () => {
    await createMissionWorktree({ repoPath: repo.path, targetBranch: 'master', missionBranch: 'devroom/m1/fix' });
    const w2 = await createMissionWorktree({ repoPath: repo.path, targetBranch: 'master', missionBranch: 'devroom/m1/fix' });
    expect(w2.path).toMatch(/devroom-m1-fix$/);
  });

  it('resetWorktreeToHead discards dirty + untracked files', async () => {
    const w = await createMissionWorktree({ repoPath: repo.path, targetBranch: 'master', missionBranch: 'devroom/m1/fix' });
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(w.path, 'dirty.txt'), 'garbage');
    await fs.appendFile(path.join(w.path, 'src/index.ts'), '\n// edit\n');
    await resetWorktreeToHead(w.path);
    expect(existsSync(path.join(w.path, 'dirty.txt'))).toBe(false);
    const idx = await fs.readFile(path.join(w.path, 'src/index.ts'), 'utf8');
    expect(idx).not.toContain('// edit');
  });

  it('removeMissionWorktree removes worktree directory and branch', async () => {
    const w = await createMissionWorktree({ repoPath: repo.path, targetBranch: 'master', missionBranch: 'devroom/m1/fix' });
    await removeMissionWorktree({ repoPath: repo.path, worktreePath: w.path, branch: 'devroom/m1/fix', deleteBranch: true });
    expect(existsSync(w.path)).toBe(false);
    const branches = await simpleGit(repo.path).branch();
    expect(branches.all).not.toContain('devroom/m1/fix');
  });
});
```

Note: fixture repos use `master` as the initial branch (git's pre-config default). If your system's git defaults to `main`, adjust.

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `worktree.ts`**

```ts
import simpleGit, { SimpleGit } from 'simple-git';
import path from 'node:path';

export function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export interface WorktreeInfo { path: string; branch: string; }

export interface CreateWorktreeOpts { repoPath: string; targetBranch: string; missionBranch: string; }

export async function createMissionWorktree(opts: CreateWorktreeOpts): Promise<WorktreeInfo> {
  const git = simpleGit(opts.repoPath);
  const wtPath = path.join(opts.repoPath, '.worktrees', sanitizeBranchForPath(opts.missionBranch));
  const branches = await git.branch();
  const alreadyExists = branches.all.includes(opts.missionBranch);
  try {
    if (alreadyExists) {
      await git.raw(['worktree', 'add', wtPath, opts.missionBranch]);
    } else {
      await git.raw(['worktree', 'add', '-b', opts.missionBranch, wtPath, opts.targetBranch]);
    }
  } catch (err) {
    // If the path is already registered, ignore; else rethrow.
    if (!(err as Error).message.includes('already')) throw err;
  }
  return { path: wtPath, branch: opts.missionBranch };
}

export async function resetWorktreeToHead(worktreePath: string): Promise<void> {
  const git = simpleGit(worktreePath);
  await git.reset(['--hard', 'HEAD']);
  await git.raw(['clean', '-fdx']);
}

export async function rebaseOntoTarget(worktreePath: string, targetBranch: string): Promise<{ rebased: boolean; conflict: boolean }> {
  const git = simpleGit(worktreePath);
  try {
    await git.fetch();
    const before = (await git.revparse(['HEAD'])).trim();
    await git.rebase([targetBranch]);
    const after = (await git.revparse(['HEAD'])).trim();
    return { rebased: before !== after, conflict: false };
  } catch (err) {
    // Abort the rebase if it left the worktree mid-rebase.
    try { await git.rebase(['--abort']); } catch {}
    if (/conflict/i.test((err as Error).message)) return { rebased: false, conflict: true };
    throw err;
  }
}

export async function autoCommitSweep(worktreePath: string, missionId: string): Promise<{ swept: boolean; filesChanged: number }> {
  const git = simpleGit(worktreePath);
  const status = await git.status();
  if (status.files.length === 0) return { swept: false, filesChanged: 0 };
  await git.add('.');
  await git.env('GIT_AUTHOR_NAME', 'DEVROOM').env('GIT_AUTHOR_EMAIL', 'devroom@local')
    .env('GIT_COMMITTER_NAME', 'DEVROOM').env('GIT_COMMITTER_EMAIL', 'devroom@local')
    .raw(['commit', '--no-verify', '-m', `chore(mission): sweep uncommitted work [${missionId}]`]);
  return { swept: true, filesChanged: status.files.length };
}

export async function removeMissionWorktree(opts: { repoPath: string; worktreePath: string; branch: string; deleteBranch: boolean }): Promise<void> {
  const git = simpleGit(opts.repoPath);
  try { await git.raw(['worktree', 'remove', '--force', opts.worktreePath]); } catch {}
  if (opts.deleteBranch) {
    try { await git.raw(['branch', '-D', opts.branch]); } catch {}
  }
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(control): git worktree helpers (create/reset/rebase/sweep/remove)"
```

### Task 2.8: `watchdog.ts` — stale state sweep + startup recovery

**Files:**
- Create: `src/control/watchdog.ts`
- Test: `tests/control/unit/watchdog.test.ts`

- [ ] **Step 1: Write tests**

Tests should cover: (a) stale `IN_COMBAT` mission with no live pid → healed to infrastructure classification + re-queued; (b) ACCOMPLISHED mission with orphaned worktree dir → worktree cleaned; (c) ABANDONED mission branch still exists → deleted.

Use an in-memory "pid map" mock and a temp repo fixture.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sweepStaleMissions, WatchdogDeps } from '@/control/watchdog';
import { db } from '@/lib/db';
import { missions, battlefields, missionAttempts } from '@/lib/db/schema';
import { materializeRepo, MaterializedRepo } from '@/../tests/control/fixtures/repos/materialize';

describe('sweepStaleMissions', () => {
  let repo: MaterializedRepo;
  beforeEach(async () => {
    db.delete(missionAttempts).run();
    db.delete(missions).run();
    db.delete(battlefields).run();
    repo = await materializeRepo('ts-with-tests');
  });
  afterEach(async () => { if (repo) await repo.cleanup(); });

  it('heals IN_COMBAT mission with no live pid', async () => {
    const bfId = 'bf-1';
    db.insert(battlefields).values({ id: bfId, codename: 'TEST', repoPath: repo.path, defaultBranch: 'master', needsGateManifest: 0, mainIsRed: 0, overrideMainRedGuard: 0 } as any).run();
    db.insert(missions).values({ id: 'm1', battlefieldId: bfId, status: 'in_combat', type: 'combat', updatedAt: Date.now() - 60 * 60 * 1000 } as any).run();
    await sweepStaleMissions({ livePids: new Map(), now: () => Date.now(), staleThresholdMs: 30 * 60 * 1000 } as WatchdogDeps);
    const m = db.select().from(missions).where(/* eq(missions.id, 'm1') */ undefined as any).all();
    // Expect mission back to queued with new attempt recording infra end-reason
  });
});
```

(Flesh out the rest of the tests — the engineer executing this task should extend coverage to include orphaned-artifact cleanup and branch deletion paths.)

- [ ] **Step 2: Implement `watchdog.ts`**

Implementation scans:
1. Missions in `deploying | in_combat | merging` with no entry in `livePids` AND `updatedAt` older than `staleThresholdMs` → mark last attempt as infrastructure, set status to `queued` with `nextAttemptAt` based on infra backoff.
2. Missions in `accomplished | abandoned` with worktree/branch still present in `.worktrees/` or `.git/worktrees/` → call `removeMissionWorktree`.
3. Log each heal to comms under CONTROL.

Full implementation:

```ts
import { db } from '@/lib/db';
import { missions, missionAttempts, battlefields } from '@/lib/db/schema';
import { eq, and, inArray, lt } from 'drizzle-orm';
import { removeMissionWorktree } from './worktree';
import { emitComm } from './comms';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ulid } from 'ulidx';

export interface WatchdogDeps {
  livePids: Map<string, number>; // missionId -> pid
  now: () => number;
  staleThresholdMs: number;
}

export async function sweepStaleMissions(deps: WatchdogDeps): Promise<{ healed: number; cleaned: number }> {
  const cutoff = deps.now() - deps.staleThresholdMs;
  const stale = db.select().from(missions).where(
    and(
      inArray(missions.status, ['deploying', 'in_combat', 'merging']),
      lt(missions.updatedAt, cutoff),
    ),
  ).all();

  let healed = 0;
  for (const m of stale) {
    if (deps.livePids.has(m.id)) continue;
    db.insert(missionAttempts).values({
      id: ulid(),
      missionId: m.id,
      attemptNumber: (await getNextAttemptNumber(m.id)),
      startedAt: m.updatedAt,
      endedAt: deps.now(),
      endReason: 'infrastructure',
      classification: JSON.stringify({ reason: 'watchdog-heal: no live pid' }),
    } as any).run();
    db.update(missions).set({ status: 'queued', updatedAt: deps.now() }).where(eq(missions.id, m.id)).run();
    emitComm({ missionId: m.id, message: `Watchdog healed stale mission (was ${m.status}).` });
    healed++;
  }

  // Orphaned artifact cleanup
  const terminal = db.select().from(missions).where(inArray(missions.status, ['accomplished', 'abandoned'])).all();
  let cleaned = 0;
  for (const m of terminal) {
    if (!m.worktreeBranch) continue;
    const bf = db.select().from(battlefields).where(eq(battlefields.id, m.battlefieldId)).get();
    if (!bf) continue;
    const wtDir = path.join(bf.repoPath, '.worktrees', m.worktreeBranch.replace(/[^a-zA-Z0-9._-]/g, '-'));
    if (existsSync(wtDir)) {
      await removeMissionWorktree({ repoPath: bf.repoPath, worktreePath: wtDir, branch: m.worktreeBranch, deleteBranch: true });
      emitComm({ missionId: m.id, message: 'Watchdog cleaned orphaned worktree.' });
      cleaned++;
    }
  }
  return { healed, cleaned };
}

async function getNextAttemptNumber(missionId: string): Promise<number> {
  const existing = db.select().from(missionAttempts).where(eq(missionAttempts.missionId, missionId)).all();
  return existing.length + 1;
}
```

- [ ] **Step 3: Run tests — pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(control): watchdog sweep for stale transient states and orphaned artifacts"
```

### Task 2.9: `debrief/` — schema, parse, synthesize

**Files:**
- Create: `src/control/debrief/schema.ts`
- Create: `src/control/debrief/parse.ts`
- Create: `src/control/debrief/synthesize.ts`
- Tests: `tests/control/unit/debrief-parse.test.ts`, `tests/control/unit/debrief-synthesize.test.ts`

- [ ] **Step 1: Define schema with zod**

```ts
// src/control/debrief/schema.ts
import { z } from 'zod';

export const DebriefSchema = z.object({
  summary: z.string().min(1),
  commits: z.array(z.string()),
  files_touched: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  open_questions: z.array(z.object({
    title: z.string(),
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
  })).optional().default([]),
});

export type Debrief = z.infer<typeof DebriefSchema>;
```

Run: `pnpm add zod ulidx` (if not already installed; ulidx is already used elsewhere, verify).

- [ ] **Step 2: Write parse tests**

```ts
// tests/control/unit/debrief-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseDebrief } from '@/control/debrief/parse';

const valid = `Some text before\n<DEBRIEF>\n${JSON.stringify({
  summary: 'did it',
  commits: ['abc123def456'],
  files_touched: ['a.ts'],
  confidence: 'high',
  open_questions: [],
})}\n</DEBRIEF>\nmore after`;

describe('parseDebrief', () => {
  it('extracts and validates a well-formed block', () => {
    const r = parseDebrief(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.summary).toBe('did it');
  });
  it('returns not-ok when no block', () => {
    expect(parseDebrief('just prose').ok).toBe(false);
  });
  it('returns not-ok when block present but JSON invalid', () => {
    expect(parseDebrief('<DEBRIEF>not json</DEBRIEF>').ok).toBe(false);
  });
  it('returns not-ok when schema invalid', () => {
    expect(parseDebrief('<DEBRIEF>{"summary":""}</DEBRIEF>').ok).toBe(false);
  });
});
```

- [ ] **Step 3: Implement parse**

```ts
// src/control/debrief/parse.ts
import { DebriefSchema, Debrief } from './schema';

export type ParseResult = { ok: true; data: Debrief } | { ok: false; reason: string };

export function parseDebrief(finalMessage: string): ParseResult {
  const match = finalMessage.match(/<DEBRIEF>([\s\S]*?)<\/DEBRIEF>/);
  if (!match) return { ok: false, reason: 'block missing' };
  let raw: unknown;
  try { raw = JSON.parse(match[1].trim()); }
  catch (err) { return { ok: false, reason: `json parse: ${(err as Error).message}` }; }
  const parsed = DebriefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.message}` };
  return { ok: true, data: parsed.data };
}
```

- [ ] **Step 4: Write synthesize tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { synthesizeDebrief } from '@/control/debrief/synthesize';
import { materializeRepo, MaterializedRepo } from '@/../tests/control/fixtures/repos/materialize';
import simpleGit from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('synthesizeDebrief', () => {
  let repo: MaterializedRepo;
  beforeEach(async () => { repo = await materializeRepo('ts-with-tests'); });
  afterEach(async () => { if (repo) await repo.cleanup(); });

  it('synthesizes commits and files_touched from git log + diff', async () => {
    const git = simpleGit(repo.path);
    await git.checkoutLocalBranch('feature');
    await fs.writeFile(path.join(repo.path, 'src/new.ts'), 'export const x = 1;');
    await git.add('.');
    await git.commit('add new file');
    const r = await synthesizeDebrief({ repoPath: repo.path, targetBranch: 'master', sourceBranch: 'feature', finalMessageText: 'I did some stuff.' });
    expect(r.summary).toContain('did some stuff');
    expect(r.commits.length).toBeGreaterThan(0);
    expect(r.files_touched).toContain('src/new.ts');
    expect(r.confidence).toBe('unknown');
    expect(r.open_questions).toEqual([]);
  });
});
```

- [ ] **Step 5: Implement synthesize**

```ts
// src/control/debrief/synthesize.ts
import simpleGit from 'simple-git';
import { Debrief } from './schema';

export async function synthesizeDebrief(opts: { repoPath: string; targetBranch: string; sourceBranch: string; finalMessageText: string | null }): Promise<Debrief> {
  const git = simpleGit(opts.repoPath);
  const logRaw = await git.raw(['log', `--format=%h`, '--abbrev=12', `${opts.targetBranch}..${opts.sourceBranch}`]).catch(() => '');
  const commits = logRaw.split('\n').map(l => l.trim()).filter(Boolean);
  const diffNames = await git.raw(['diff', '--name-only', `${opts.targetBranch}..${opts.sourceBranch}`]).catch(() => '');
  const files_touched = diffNames.split('\n').map(l => l.trim()).filter(Boolean);
  const summary = opts.finalMessageText?.slice(0, 2000) ?? 'No structured debrief provided by agent.';
  return { summary, commits, files_touched, confidence: 'unknown', open_questions: [] };
}
```

- [ ] **Step 6: Run both test files — pass**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(control): debrief schema, parser, deterministic synthesis fallback"
```

### Task 2.10: `mission-runner.ts` + `control.ts` — dispatch loop scaffold

These tie everything together. At this phase we wire them with mocked subprocess spawning so we can end-to-end unit test the state machine without needing real claude.

**Files:**
- Create: `src/control/mission-runner.ts`
- Create: `src/control/control.ts`
- Tests: `tests/control/unit/mission-runner.test.ts`

- [ ] **Step 1: Define mission-runner interface**

```ts
// src/control/mission-runner.ts
export interface MissionRunnerDeps {
  spawnAsset: (opts: SpawnAssetOpts) => Promise<AssetRunResult>;
  runGatesFn: typeof import('./gates').runGates;
  classifyExitFn: typeof import('./exit-classifier').classifyExit;
  worktree: {
    create: typeof import('./worktree').createMissionWorktree;
    reset: typeof import('./worktree').resetWorktreeToHead;
    rebase: typeof import('./worktree').rebaseOntoTarget;
    sweep: typeof import('./worktree').autoCommitSweep;
    remove: typeof import('./worktree').removeMissionWorktree;
  };
  overseerConsult: (input: OverseerConsultInput) => Promise<OverseerVerdict>;
  mergeFn: (opts: MergeOpts) => Promise<MergeResult>;
  now: () => number;
}

export interface SpawnAssetOpts { /* prompt, worktreePath, sessionId?, assetCodename */ }
export interface AssetRunResult { /* exitCode, stderr, finalMessage, toolUseCount, sessionId, usage */ }
// ... (see spec §5 for full signatures)
```

- [ ] **Step 2: Implement mission-runner with full state machine**

The implementation follows the lifecycle in spec §5:
1. DEPLOYING (create worktree, rebase, spawn asset)
2. IN_COMBAT (stream output, supervision, wait for exit)
3. Classify exit (via exit-classifier)
4. If CLEAN/TURN_LIMIT: auto-commit sweep → run gates → if pass → merge, else → retry policy decides next
5. If TIMEOUT: reset worktree → retry policy
6. If INFRASTRUCTURE: schedule backoff → re-queue (no budget burn)
7. If RATE_LIMIT: schedule delay → re-queue
8. If AUTH: orchestrator-wide pause
9. If retry policy says OVERSEER_CONSULT → invoke, get verdict, route
10. If COMPROMISED → set status, emit event, stop

Full implementation: approximately 300–400 lines. Reference spec §5.1–§5.7 and §6 step-by-step.

Engineer must write this carefully — it's the heart of the refactor. Break into private helpers for each transition (`transitionDeploying`, `runAttempt`, `handleClean`, `handleRetry`, etc.).

- [ ] **Step 3: Write integration-level tests with scripted-claude**

Use `tests/control/fixtures/scripted-claude/` + `materializeRepo` to exercise:
- Happy path combat (scenario: agent commits, gates pass, merge clean → ACCOMPLISHED)
- Agent forgets commit (scenario: dirty working tree at exit → auto-sweep, gates pass, ACCOMPLISHED, attempt row has autoCommitted=1)
- Gate fail attempt 1 pass attempt 2
- All deterministic retries fail same diff → OVERSEER consult invoked
- OVERSEER redirect → retry 4 passes
- OVERSEER redirect → retry 4 fails → COMPROMISED

Each test uses a fresh materializeRepo('ts-with-tests') and drives the runner through `runMission(missionId, deps)`.

(The engineer should write 6–10 such tests. Each is ~30–50 lines. This is the primary validation of the runner.)

- [ ] **Step 4: Implement `control.ts` (dispatch loop)**

```ts
// src/control/control.ts
import { db } from '@/lib/db';
import { missions } from '@/lib/db/schema';
import { eq, and, inArray, lte, isNull, or } from 'drizzle-orm';
import { runMission } from './mission-runner';
import { sweepStaleMissions } from './watchdog';
import { getControlConfig } from './config';
import { emitComm } from './comms';

class Control {
  private live = new Map<string, number>(); // missionId -> pid
  private running = false;
  private paused = false;
  private watchdogTimer?: NodeJS.Timeout;

  async start() {
    this.running = true;
    // Startup recovery
    await sweepStaleMissions({ livePids: this.live, now: () => Date.now(), staleThresholdMs: getControlConfig().attemptHardTimeoutMs });
    this.watchdogTimer = setInterval(() => {
      sweepStaleMissions({ livePids: this.live, now: () => Date.now(), staleThresholdMs: getControlConfig().attemptHardTimeoutMs }).catch(err => console.error('watchdog error', err));
    }, 60_000);
    this.loop();
  }

  async stop() {
    this.running = false;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }

  pauseAll(reason: string) { this.paused = true; emitComm({ message: `Orchestrator paused: ${reason}` }); }
  resumeAll() { this.paused = false; emitComm({ message: 'Orchestrator resumed.' }); }

  private async loop() {
    while (this.running) {
      if (this.paused) { await sleep(2000); continue; }
      const cfg = getControlConfig();
      const slot = this.live.size < cfg.maxAgents;
      if (!slot) { await sleep(1000); continue; }
      const next = this.pickQueuedMission();
      if (!next) { await sleep(1000); continue; }
      this.live.set(next.id, 0); // pid filled by runner on spawn via callback
      runMission(next.id, { /* deps, pidCallback: (pid) => this.live.set(next.id, pid) */ }).finally(() => this.live.delete(next.id));
    }
  }

  private pickQueuedMission() {
    const now = Date.now();
    return db.select().from(missions).where(and(
      eq(missions.status, 'queued'),
      or(isNull(missions.nextAttemptAt), lte(missions.nextAttemptAt, now)),
    )).limit(1).get();
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const control = new Control();
```

- [ ] **Step 5: Run all Phase 2 tests — pass**

Run: `pnpm test tests/control/unit/ tests/control/fixtures/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(control): mission-runner state machine + control dispatch loop"
```

---

## Phase 3 — Asset roster + prompts

### Task 3.1: New Rules of Engagement

**Files:**
- Modify: `src/lib/settings/default-rules-of-engagement.ts`

- [ ] **Step 1: Rewrite the default RoE text**

Replace the file contents with new text that includes:
1. Top-of-file banner about being a DEVROOM combat asset
2. Worktree boundary directive
3. Gate awareness (inject per-mission at prompt build time — `{{GATE_MANIFEST}}` placeholder)
4. **FINAL STEP CHECKLIST at top** (prominent, 3 items: commit, DEBRIEF, stop)
5. Detailed sections on each directive
6. **FINAL STEP CHECKLIST at bottom** (repeated verbatim)

Approximately 80–120 lines. Follow the format from the spec §11 "Rules of Engagement" section.

- [ ] **Step 2: Commit**

```bash
git add src/lib/settings/default-rules-of-engagement.ts
git commit -m "feat(prompts): new rules of engagement with closure ritual"
```

### Task 3.2: Reseed asset registry

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Replace the asset seed block with the new roster**

In `scripts/seed.ts`, replace the asset definitions with:

```ts
const ASSETS = [
  { codename: 'OPERATIVE', specialty: 'General backend, fullstack, refactors, test-writing', model: 'claude-sonnet-4-6', isSystem: 0, maxTurns: 100, effort: 'medium', systemPrompt: loadPrompt('combat/operative.md') },
  { codename: 'VANGUARD', specialty: 'Frontend — UI, styling, UX', model: 'claude-sonnet-4-6', isSystem: 0, maxTurns: 100, effort: 'medium', systemPrompt: loadPrompt('combat/vanguard.md') },
  { codename: 'INTEL', specialty: 'Docs, analysis, specs, bootstrap', model: 'claude-sonnet-4-6', isSystem: 0, maxTurns: 100, effort: 'medium', systemPrompt: loadPrompt('combat/intel.md') },
  { codename: 'STRATEGIST', specialty: 'Campaign planning', model: 'claude-opus-4-6', isSystem: 1, maxTurns: 3, effort: 'high', systemPrompt: loadPrompt('system/strategist.md') },
  { codename: 'OVERSEER', specialty: 'Exit classification + gate-failure consult', model: 'claude-sonnet-4-6', isSystem: 1, maxTurns: 2, effort: 'medium', systemPrompt: loadPrompt('system/overseer.md') },
  { codename: 'QUARTERMASTER', specialty: 'Merge conflict resolution', model: 'claude-sonnet-4-6', isSystem: 1, maxTurns: 15, effort: 'medium', systemPrompt: loadPrompt('system/quartermaster.md') },
];

function loadPrompt(relPath: string): string {
  return readFileSync(path.join(__dirname, '..', 'src/control/assets/prompts', relPath), 'utf8');
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(seed): reseed 6-asset roster for CONTROL refactor"
```

### Task 3.3: Author combat asset prompts

**Files:**
- Create: `src/control/assets/prompts/combat/operative.md`
- Create: `src/control/assets/prompts/combat/vanguard.md`
- Create: `src/control/assets/prompts/combat/intel.md`

- [ ] **Step 1: Write each prompt**

Each prompt is ~30–60 lines of markdown covering:
- Identity / specialty
- Code conventions for their domain
- Emphasis on following the Rules of Engagement
- No duplicate information (RoE is prepended at runtime by `cli-builder.ts`)

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(prompts): OPERATIVE, VANGUARD, INTEL system prompts"
```

### Task 3.4: Author system asset prompts

**Files:**
- Create: `src/control/assets/prompts/system/overseer.md` (covers both classify and consult modes — invoked via different user prompts)
- Create: `src/control/assets/prompts/system/quartermaster.md`
- Create: `src/control/assets/prompts/system/strategist.md`

- [ ] **Step 1: Write OVERSEER prompt**

OVERSEER's system prompt states identity ("You are the OVERSEER of DEVROOM operations") and its two jobs. The user-level prompt (from `prompt-builder.ts`) specifies which job on each invocation.

Content per spec §11 "OVERSEER classification prompt" and "OVERSEER consult prompt" — those are the *user* prompts. The *system* prompt is shorter:

```md
You are the OVERSEER of DEVROOM operations, serving under the Commander.

You have two jobs, each invoked separately by CONTROL:

1. **Classify** an ambiguous subprocess exit. Output: `{ category, reasoning }`.
2. **Consult** on a combat asset that exhausted deterministic retries. Output: `{ verdict: 'redirect'|'escalate', ... }`.

Rules:
- Be decisive. No hedging.
- You do NOT decide whether a mission should continue — that is the Commander's call. Never output "abort".
- Align your reasoning with the project's CLAUDE.md conventions when provided.
- Respond ONLY with a JSON object matching the requested schema.
- DO NOT use any tools. No reads. No commands. Analyze the provided text only.
```

- [ ] **Step 2: Write QUARTERMASTER prompt**

Content per spec §6.3. Identity + narrow authority (conflict resolution only, single commit, may not run tests or make new changes).

- [ ] **Step 3: Write STRATEGIST prompt**

Update the existing STRATEGIST prompt (preserved from current system) to include the `type: "combat" | "recon"` field in the plan schema it produces. Add guidance on when to propose recon.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(prompts): OVERSEER, QUARTERMASTER, STRATEGIST system prompts"
```

### Task 3.5: `cli-builder.ts`

**Files:**
- Create: `src/control/assets/cli-builder.ts`
- Test: `tests/control/unit/cli-builder.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs } from '@/control/assets/cli-builder';

describe('buildClaudeArgs', () => {
  it('produces flags for a combat asset with RoE prepended', () => {
    const args = buildClaudeArgs({
      asset: { codename: 'OPERATIVE', model: 'claude-sonnet-4-6', maxTurns: 100, effort: 'medium', isSystem: 0, systemPrompt: 'You are OPERATIVE.', skills: [], mcpServers: [] } as any,
      rulesOfEngagement: 'ROE-TEXT',
      outputFormat: 'stream-json',
      extraFlags: [],
    });
    expect(args).toContain('--model'); expect(args).toContain('claude-sonnet-4-6');
    expect(args).toContain('--max-turns'); expect(args).toContain('100');
    expect(args).toContain('--effort'); expect(args).toContain('medium');
    expect(args).toContain('--output-format'); expect(args).toContain('stream-json');
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(args[sysIdx + 1]).toContain('ROE-TEXT');
    expect(args[sysIdx + 1]).toContain('You are OPERATIVE.');
  });

  it('omits RoE for system assets', () => {
    const args = buildClaudeArgs({
      asset: { codename: 'OVERSEER', model: 'claude-sonnet-4-6', maxTurns: 2, effort: 'medium', isSystem: 1, systemPrompt: 'OVERSEER prompt', skills: [], mcpServers: [] } as any,
      rulesOfEngagement: 'ROE-TEXT',
      outputFormat: 'print',
      extraFlags: ['--print'],
    });
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(args[sysIdx + 1]).not.toContain('ROE-TEXT');
    expect(args).toContain('--print');
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function buildClaudeArgs(opts: {
  asset: { codename: string; model: string; maxTurns: number; effort: string; isSystem: number; systemPrompt: string; skills: string[]; mcpServers: unknown[] };
  rulesOfEngagement: string;
  outputFormat: 'stream-json' | 'print';
  extraFlags: string[];
}): string[] {
  const args: string[] = [];
  args.push('--model', opts.asset.model);
  args.push('--max-turns', String(opts.asset.maxTurns));
  args.push('--effort', opts.asset.effort);
  args.push('--output-format', opts.outputFormat);

  const sys = opts.asset.isSystem
    ? opts.asset.systemPrompt
    : `${opts.rulesOfEngagement}\n\n${opts.asset.systemPrompt}`;
  args.push('--append-system-prompt', sys);

  for (const skill of opts.asset.skills) {
    const pluginDir = resolveSkillPluginDir(skill);
    if (pluginDir) args.push('--plugin-dir', pluginDir);
  }
  if (opts.asset.mcpServers.length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: opts.asset.mcpServers }));
  }
  args.push(...opts.extraFlags);
  return args;
}

function resolveSkillPluginDir(skill: string): string | null {
  // skill format: "skillname@publisher"
  const match = skill.match(/^(.+)@(.+)$/);
  if (!match) return null;
  return `${process.env.HOME}/.claude/plugins/cache/${match[2]}/${match[1]}`;
}
```

- [ ] **Step 3: Run — pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(control): asset CLI builder with RoE composition and skill resolution"
```

---

## Phase 4 — Bootstrap + gates

### Task 4.1: `bootstrap/detect.ts`

**Files:**
- Create: `src/control/bootstrap/detect.ts`
- Test: `tests/control/unit/bootstrap-detect.test.ts`

- [ ] **Step 1: Write tests for JS/TS / Python / Go / empty projects**

Use `materializeRepo` with templates extended for each language. Assertions:
- TS project with `pnpm test` script → detect returns `{ test: 'pnpm test', build: 'tsc --noEmit' (or 'pnpm build' if present), ... }`.
- TS project with no test script → returns `{ test: null, ... }`.
- Python project with pytest configured → detects pytest.
- Totally empty repo → returns `{ build: null, test: null, lint: null, typecheck: null }`.

- [ ] **Step 2: Implement detect**

```ts
// src/control/bootstrap/detect.ts
import fs from 'node:fs/promises';
import path from 'node:path';

export interface DetectedGates {
  build: string | null;
  test: string | null;
  lint: string | null;
  typecheck: string | null;
}

export async function detectGates(repoPath: string): Promise<DetectedGates> {
  const hasFile = async (p: string) => fs.access(path.join(repoPath, p)).then(() => true).catch(() => false);

  let pkg: any = null;
  if (await hasFile('package.json')) {
    try { pkg = JSON.parse(await fs.readFile(path.join(repoPath, 'package.json'), 'utf8')); } catch {}
  }

  const scripts = pkg?.scripts ?? {};
  const gates: DetectedGates = { build: null, test: null, lint: null, typecheck: null };

  // TS/JS detection
  if (pkg) {
    if (scripts.test) gates.test = 'pnpm test';
    if (scripts.build) gates.build = 'pnpm build';
    if (scripts.lint) gates.lint = 'pnpm lint';
    if (scripts.typecheck) gates.typecheck = 'pnpm typecheck';
    else if (await hasFile('tsconfig.json')) gates.typecheck = 'tsc --noEmit';
  }

  // Python
  if (!gates.test && (await hasFile('pyproject.toml') || await hasFile('pytest.ini') || await hasFile('setup.py'))) {
    gates.test = 'pytest';
  }

  // Go
  if (!gates.test && await hasFile('go.mod')) {
    gates.test = 'go test ./...';
    if (!gates.build) gates.build = 'go build ./...';
  }

  // Rust
  if (!gates.test && await hasFile('Cargo.toml')) {
    gates.test = 'cargo test';
    if (!gates.build) gates.build = 'cargo build';
  }

  return gates;
}
```

- [ ] **Step 3: Run — pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(bootstrap): detect existing gate commands from repo structure"
```

### Task 4.2: `bootstrap/verify.ts`

**Files:**
- Create: `src/control/bootstrap/verify.ts`
- Test: `tests/control/unit/bootstrap-verify.test.ts`

- [ ] **Step 1: Implement verify that runs each detected command and returns pass/fail**

```ts
import { runGates } from '@/control/gates';
import type { GateManifest, GateRunResults } from '@/control/gates';

export async function verifyGatesOnHead(opts: { repoPath: string; manifest: GateManifest }): Promise<GateRunResults> {
  return runGates({
    manifest: opts.manifest,
    workingDir: opts.repoPath,
    perCommandTimeoutMs: 300_000,
    suiteTimeoutMs: 900_000,
  });
}
```

Tests use `materializeRepo('ts-with-tests')` (all pass) and `materializeRepo('red-main')` (test fails).

- [ ] **Step 2: Run — pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bootstrap): verify gate manifest on HEAD"
```

### Task 4.3: `bootstrap/scaffold.ts` — framework install via INTEL

**Files:**
- Create: `src/control/bootstrap/scaffold.ts`
- Create: `src/control/bootstrap/frameworks.ts`
- Tests: scaffold requires real INTEL runs — add to integration suite Phase 5 rather than unit

- [ ] **Step 1: Define curated frameworks config**

```ts
// src/control/bootstrap/frameworks.ts
export interface FrameworkConfig {
  language: 'ts' | 'py' | 'go' | 'rust' | 'ruby' | 'java' | 'csharp';
  testCommand: string;
  installBriefing: string; // briefing used when INTEL is asked to scaffold this framework
}

export const FRAMEWORKS: Record<string, FrameworkConfig> = {
  ts: { language: 'ts', testCommand: 'pnpm test', installBriefing: 'Install Vitest + add a minimal smoke test. Update package.json with a `test` script. Ensure `pnpm test` exits 0.' },
  py: { language: 'py', testCommand: 'pytest', installBriefing: 'Install pytest + add a minimal smoke test in tests/test_smoke.py. Ensure `pytest` exits 0.' },
  // ... go, rust, ruby, java, csharp
};
```

- [ ] **Step 2: Implement scaffold**

```ts
// src/control/bootstrap/scaffold.ts
import { FRAMEWORKS } from './frameworks';
import { runMission } from '@/control/mission-runner';
// ... (spawn INTEL with the install briefing, wait for completion, verify gate exits 0)
```

Implementation: create a one-off INTEL mission with the `installBriefing` text, dispatch via `runMission`, await completion, then re-verify the gate. If still red → bootstrap fails loud.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bootstrap): scaffold test infrastructure via INTEL"
```

### Task 4.4: Full bootstrap orchestration

**Files:**
- Create: `src/control/bootstrap/bootstrap.ts` (orchestrator)
- Test: `tests/control/integration/bootstrap.test.ts`

- [ ] **Step 1: Implement `bootstrapBattlefield(battlefieldId)`**

Per spec §12 flow:
1. Set status to INITIALIZING
2. Call detectGates
3. For missing gates (test/build required): call scaffold
4. Generate CLAUDE.md + SPEC.md via INTEL (existing prompt flow; keep reused)
5. verifyGatesOnHead
6. Set gate manifest
7. Set status to ACTIVE
8. If any gate red on HEAD → set mainIsRed=1

- [ ] **Step 2: Write integration tests**

Run through: fresh TS repo (all gates pass), TS repo without tests (scaffold fires), red-main repo (bootstrap completes with mainIsRed=1).

- [ ] **Step 3: Run — pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(bootstrap): full battlefield bootstrap orchestration"
```

---

## Phase 5 — Mission lifecycle integration tests + recon + prompt-builder

### Task 5.1: `prompt-builder.ts`

**Files:**
- Create: `src/control/prompt-builder.ts`
- Test: `tests/control/unit/prompt-builder.test.ts`

- [ ] **Step 1: Implement standard / campaign / recon / retry / OVERSEER / QM prompt builders**

Follows spec §11 templates verbatim. Each builder is a pure function taking a structured input and returning a string. Easy to unit test.

- [ ] **Step 2: Unit tests — each builder produces expected structure**

Assert specific sections are present, template vars are substituted.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(control): prompt-builder (standard/campaign/recon/retry/overseer/qm)"
```

### Task 5.2: `recon.ts`

**Files:**
- Create: `src/control/recon.ts`
- Tests: integration tests in `tests/control/integration/recon.test.ts`

- [ ] **Step 1: Implement recon lifecycle**

Per spec §7:
1. Spawn asset in repo root (no worktree).
2. Supervision L1/L3/L5 with elevated L3 = reconStdoutSilenceMs.
3. On exit: `git status --porcelain` on repo root; if dirty → `git reset --hard && git clean -fdx`, set reconViolatedReadonly=1.
4. Parse DEBRIEF; if summary present → ACCOMPLISHED.
5. If not → retry policy same as combat (but OVERSEER consult omits diff/gate fields).

- [ ] **Step 2: Integration tests**

Scenarios: happy recon, recon violates readonly (agent writes a file), recon with no summary.

- [ ] **Step 3: Run — pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(control): recon mission lifecycle with readonly enforcement"
```

### Task 5.3: Comprehensive combat integration tests

**Files:**
- Create: `tests/control/integration/combat-lifecycle.test.ts`

- [ ] **Step 1: Write the scenarios that exercise every retry path**

Each test drives `runMission` end-to-end with different scripted-claude scenarios + fixture repos. Minimum 10 tests:

1. Happy path (agent commits, gates pass, merge clean)
2. Agent forgets commit → auto-sweep → gates pass
3. Gates fail attempt 1 → retry attempt 2 passes
4. Same diff attempts 1+2 → skip to OVERSEER → redirect → pass
5. Same diff attempts 1+2 → OVERSEER escalate → COMPROMISED with question
6. All attempts fail → COMPROMISED
7. Infrastructure error → free retry → success
8. Rate limit with retry-after → delayed retry
9. AUTH error → orchestrator paused
10. Timeout (scripted hang) → killed, reset, fresh retry, succeeds

- [ ] **Step 2: Run — pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "test(control): comprehensive integration tests for combat mission lifecycle"
```

---

## Phase 6 — Merge + QUARTERMASTER

### Task 6.1: `merge.ts`

**Files:**
- Create: `src/control/merge.ts`
- Test: `tests/control/integration/merge.test.ts`

- [ ] **Step 1: Implement merge lock + rebase + decision logic**

Per spec §6.2 and §6.3:

```ts
import { rebaseOntoTarget } from './worktree';
import { runGates } from './gates';
import simpleGit from 'simple-git';

class MergeLockManager {
  private locks = new Map<string, Promise<void>>();
  async acquire<T>(battlefieldId: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(battlefieldId)) await this.locks.get(battlefieldId);
    let release: () => void = () => {};
    const lock = new Promise<void>(r => { release = r; });
    this.locks.set(battlefieldId, lock);
    try { return await fn(); } finally { this.locks.delete(battlefieldId); release(); }
  }
}
const lockMgr = new MergeLockManager();

export async function runMerge(opts: { battlefieldId: string; repoPath: string; targetBranch: string; sourceBranch: string; targetHeadAtStart: string; manifest: GateManifest; onQuartermaster?: (input: QMInput) => Promise<QMResult> }): Promise<{ status: 'accomplished' | 'compromised'; reason?: string }> {
  return lockMgr.acquire(opts.battlefieldId, async () => {
    const git = simpleGit(opts.repoPath);
    const currentTarget = (await git.revparse([opts.targetBranch])).trim();
    const targetAdvanced = currentTarget !== opts.targetHeadAtStart;

    if (!targetAdvanced) {
      // Fast-forward merge
      await git.checkout(opts.targetBranch);
      await git.merge(['--ff-only', opts.sourceBranch]);
      return { status: 'accomplished' };
    }

    const worktreePath = /* derive from sourceBranch */;
    const rebase = await rebaseOntoTarget(worktreePath, opts.targetBranch);

    if (rebase.conflict) {
      if (!opts.onQuartermaster) return { status: 'compromised', reason: 'merge-conflict' };
      const qm = await opts.onQuartermaster({ /* briefing, debrief, conflict diff, etc. */ });
      if (!qm.resolved) return { status: 'compromised', reason: 'merge-conflict' };
      // Re-run gates on resolved state
      const gates = await runGates({ manifest: opts.manifest, workingDir: worktreePath, perCommandTimeoutMs: 300_000, suiteTimeoutMs: 900_000 });
      if (gates.overallStatus !== 'pass') return { status: 'compromised', reason: 'post-qm-gate-failure' };
    } else if (rebase.rebased) {
      // Re-run gates on rebased state
      const gates = await runGates({ manifest: opts.manifest, workingDir: worktreePath, perCommandTimeoutMs: 300_000, suiteTimeoutMs: 900_000 });
      if (gates.overallStatus !== 'pass') return { status: 'compromised', reason: 'post-rebase-gate-failure' };
    }

    await git.checkout(opts.targetBranch);
    await git.merge(['--ff-only', opts.sourceBranch]);
    return { status: 'accomplished' };
  });
}
```

- [ ] **Step 2: Integration tests**

Scenarios:
- Clean fast-forward (target didn't advance)
- Target advanced, rebase clean, gates pass → merge
- Target advanced, rebase clean, gates fail → COMPROMISED
- Rebase conflict, QUARTERMASTER resolves, gates pass → merge
- Rebase conflict, QUARTERMASTER fails → COMPROMISED
- Concurrent merges on same battlefield serialize correctly (use Promise.all with two runMerge calls)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(control): merge with lock, rebase, and QUARTERMASTER conflict path"
```

### Task 6.2: QUARTERMASTER spawn integration

**Files:**
- Modify: `src/control/merge.ts` (onQuartermaster default implementation)

- [ ] **Step 1: Wire up QUARTERMASTER spawn via mission-runner spawnAsset**

Build the conflict prompt per spec §11 "QUARTERMASTER conflict prompt". Spawn with `--print` output. Bounded: 15 max turns, 10-minute timeout (`quartermasterTimeoutMs` from config).

- [ ] **Step 2: Test with a real conflict-inducing scenario**

Use a fixture repo + scripted scenario where QUARTERMASTER's scenario file has it emit conflict-resolving edits and exit cleanly.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(control): QUARTERMASTER spawn for merge-conflict resolution"
```

---

## Phase 7 — Campaign executor

### Task 7.1: `dependency-graph.ts`

**Files:**
- Create: `src/control/campaign/dependency-graph.ts`
- Test: `tests/control/unit/dependency-graph.test.ts`

- [ ] **Step 1: Implement validator + cycle detection + transitive cascade**

```ts
export interface MissionNode { title: string; dependsOn: string[]; }

export function detectCycle(nodes: MissionNode[]): string[] | null {
  // DFS-based; return the cycle path if found, else null
}

export function validatePlan(nodes: MissionNode[]): { ok: boolean; errors: string[] } {
  // - All dependsOn references exist
  // - No self-dependency
  // - No cycles
}

export function findTransitiveDependents(originId: string, missions: { id: string; dependsOn: string[]; status: string }[]): string[] {
  // BFS through dependsOn graph, return STANDBY missions that should cascade
}
```

- [ ] **Step 2: Unit tests**

Cover: valid plan, missing-reference plan, self-dep, simple cycle, transitive cascade with 3-deep chain, partial cascade (some running missions not cascaded).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(campaign): dependency graph validation + transitive cascade"
```

### Task 7.2: `campaign/debrief.ts`

**Files:**
- Create: `src/control/campaign/debrief.ts`
- Test: `tests/control/unit/campaign-debrief.test.ts`

- [ ] **Step 1: Implement deterministic composition**

Per spec §10 "Phase debrief composition":

```ts
export function composePhaseDebrief(input: { phase: { id: string; name: string; order: number; status: string }; missions: { title: string; status: string; debriefStructured: Debrief | null }[]; durationMs: number; totalTokens: number; totalPhases: number }): string {
  const lines: string[] = [];
  lines.push(`# Phase ${input.phase.order}: ${input.phase.name}`);
  lines.push(`Status: ${input.phase.status.toUpperCase()}`);
  lines.push(`Duration: ${formatDuration(input.durationMs)} | Tokens: ${input.totalTokens}`);
  lines.push('');
  for (const m of input.missions) {
    lines.push(`## Mission: ${m.title} (${m.status})`);
    if (m.debriefStructured) {
      lines.push(m.debriefStructured.summary);
      lines.push('');
      lines.push(`Files touched: ${m.debriefStructured.files_touched.length}`);
      lines.push(`Commits: ${m.debriefStructured.commits.length}`);
      if (m.debriefStructured.open_questions?.length) {
        lines.push(`Open questions: ${m.debriefStructured.open_questions.length}`);
      }
    } else {
      lines.push('(no debrief)');
    }
    lines.push('\n---\n');
  }
  return lines.join('\n');
}
```

- [ ] **Step 2: Unit tests**

Given a phase with 2 missions (1 accomplished, 1 compromised), assert the output string structure.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(campaign): deterministic phase debrief composition"
```

### Task 7.3: `campaign/executor.ts`

**Files:**
- Create: `src/control/campaign/executor.ts`
- Test: `tests/control/integration/campaign.test.ts`

- [ ] **Step 1: Implement phase progression**

Per spec §8:
- On campaign launch: phase 1 → ACTIVE; missions without dependsOn → QUEUED; others → STANDBY
- On mission ACCOMPLISHED: call `checkDependencies()` to unblock STANDBY missions
- On mission COMPROMISED: other missions continue; when phase settles, determine campaign state
- On phase completion: compose phase debrief; advance to next phase
- On campaign settle: compose campaign debrief (concat of phase debriefs)
- Cascade on ABANDONED (transitive, via dependency-graph)

- [ ] **Step 2: Integration E2E tests with scripted-claude**

- 3-phase campaign, all missions succeed → ACCOMPLISHED
- Phase 1 one mission COMPROMISED → campaign COMPROMISED, Commander resolves via Tactical Override → resumes → ACCOMPLISHED
- ABANDONED mission with 2-deep dependent chain → all cascade to ABANDONED
- Recon phase followed by combat phase (STRATEGIST-proposed pattern) → recon debrief passed to combat phase

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(campaign): phase-by-phase executor with dependency and cascade handling"
```

---

## Phase 8 — Server Actions + UI wiring

### Task 8.1: Rewrite `src/actions/mission.ts`

**Files:**
- Replace entirely: `src/actions/mission.ts`

- [ ] **Step 1: Replace with thin wrappers over `src/control/`**

Exported Server Actions:
- `createMission(input)` → inserts to DB, emits comm, returns mission ID. Does NOT spawn — `control.loop()` picks it up.
- `abandonMission(missionId)` → sets status to ABANDONED, cascades via dependency-graph, cleans worktree.
- `tacticalOverride(missionId, newBriefing)` → updates briefing, resets `currentSortieAttempts=0`, status → QUEUED.
- `acceptMergeOverride(missionId)` → Commander force-merges a COMPROMISED mission.
- `answerEscalation(missionId, answer)` → injects Commander answer into next retry prompt; status → QUEUED.
- `continueMission(missionId)` → creates new mission reusing `sessionId`.

Each action does its DB updates + enqueues for CONTROL to pick up. Revalidate relevant paths.

Test file: `tests/control/integration/mission-actions.test.ts` — verify each action's DB effects.

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor(actions): rewrite mission server actions against CONTROL API"
```

### Task 8.2: Rewrite `src/actions/campaign.ts`

**Files:**
- Replace entirely: `src/actions/campaign.ts`

- [ ] **Step 1: Replace with thin wrappers**

- `createCampaign`, `launchCampaign` (validates + starts phase 1), `abandonCampaign`, `acceptCampaign` (force accomplishment).
- Campaign-level resolution actions delegate to the campaign executor.

- [ ] **Step 2: Test + commit**

```bash
git commit -m "refactor(actions): rewrite campaign server actions against CONTROL API"
```

### Task 8.3: Rewrite `src/actions/battlefield.ts`

**Files:**
- Replace entirely: `src/actions/battlefield.ts`

- [ ] **Step 1: Replace**

- `createBattlefield` (spawns bootstrap)
- `establishGates(battlefieldId)` (re-runs bootstrap detection + scaffold)
- `updateGateManifest(battlefieldId, manifest)` with optional "verify against HEAD" flow
- `toggleMainRedOverride(battlefieldId, enabled)`
- `pruneForensicBranches(battlefieldId, daysOld)`

- [ ] **Step 2: Test + commit**

```bash
git commit -m "refactor(actions): battlefield server actions with gate manifest editing"
```

### Task 8.4: Mission detail UI update

**Files:**
- Modify: `src/app/battlefields/[id]/missions/[missionId]/page.tsx` and child client components

- [ ] **Step 1: Update states, actions, debrief rendering**

Changes:
- Replace old status names (`reviewing`, `approved`, `merging` retry semantics) with new states.
- Show 3 Commander-action buttons on COMPROMISED: Tactical Override, Accept & Merge, Abandon.
- Show OVERSEER escalation question inline with an answer form when present.
- Show structured debrief panel (summary, commits list, files touched, confidence badge, open questions cards).
- Show "debrief synthesized" banner when `mission.debriefSynthesized = true`.
- Show comms stream with actor labels (CONTROL, OPERATIVE, OVERSEER, COMMANDER).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(ui): mission detail page for new CONTROL states and actions"
```

### Task 8.5: Campaign detail UI update

**Files:**
- Modify: `src/app/battlefields/[id]/campaigns/[campaignId]/page.tsx`

- [ ] **Step 1: Update for new phase/campaign states**

Phase cards render deterministic debrief; mission cards within phases render structured debriefs. New campaign states.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(ui): campaign detail page for deterministic phase debriefs"
```

### Task 8.6: Battlefield settings page (new)

**Files:**
- Create: `src/app/battlefields/[id]/settings/page.tsx`
- Create: `src/app/battlefields/[id]/settings/GateManifestEditor.tsx`

- [ ] **Step 1: Gate manifest editor with verify flow**

Form with 4 fields, `[VERIFY AGAINST HEAD]` button calls a Server Action that runs `runGates` and returns per-gate results. Save disabled until verify passes or Commander explicitly overrides.

- [ ] **Step 2: Main-red guard override toggle + forensic prune**

Simple toggle + prune form with N-days input.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ui): battlefield settings page with gate manifest editor"
```

### Task 8.7: Remove obsolete UI paths

**Files:**
- Delete: any UI components specific to old `reviewing` status / old overseer flow / old quartermaster follow-ups.

- [ ] **Step 1: Grep for dead references**

```bash
grep -r "reviewing\|compromiseReason\|mergeRetryAt" src/app src/components --include="*.tsx" --include="*.ts"
```

Fix or delete each.

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(ui): remove obsolete components from old orchestrator states"
```

---

## Phase 9 — Telegram bot + inline escalations

### Task 9.1: `src/lib/telegram/bot.ts`

**Files:**
- Create: `src/lib/telegram/bot.ts`
- Test: `tests/integration/telegram-bot.test.ts` (uses mocked Telegram API)

- [ ] **Step 1: Implement long-polling loop**

```ts
import { getControlConfig } from '@/control/config';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';

export class TelegramBot {
  private offset = 0;
  private running = false;
  private handlers: { [event: string]: ((payload: any) => void | Promise<void>)[] } = {};

  async start() {
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const u of updates) await this.handleUpdate(u);
      } catch (err) {
        console.error('telegram poll error', err);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  stop() { this.running = false; }

  on(event: 'callback_query' | 'message', fn: (payload: any) => void | Promise<void>) {
    (this.handlers[event] ??= []).push(fn);
  }

  private async getUpdates(): Promise<any[]> {
    const token = this.token();
    if (!token) return [];
    const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${this.offset}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return [];
    for (const u of data.result) if (u.update_id >= this.offset) this.offset = u.update_id + 1;
    return data.result;
  }

  private async handleUpdate(update: any) {
    if (update.callback_query) {
      for (const fn of this.handlers.callback_query ?? []) await fn(update.callback_query);
    } else if (update.message) {
      for (const fn of this.handlers.message ?? []) await fn(update.message);
    }
  }

  private token(): string | null {
    const row = db.select().from(settings).where(/* eq(settings.key, 'telegram_bot_token') */ undefined as any).get();
    return row?.value ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
  }

  async send(chatId: number | string, text: string, replyMarkup?: any): Promise<{ message_id: number } | null> {
    const token = this.token();
    if (!token) return null;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup, parse_mode: 'Markdown' }),
    });
    const data = await res.json();
    return data.ok ? { message_id: data.result.message_id } : null;
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    const token = this.token();
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  }
}

export const telegramBot = new TelegramBot();
```

- [ ] **Step 2: Tests with mocked fetch**

Covers: polling loop advances offset, callback_query dispatched to handler, send sends correct payload.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(telegram): long-polling bot with callback_query support"
```

### Task 9.2: Notifier policy

**Files:**
- Create: `src/lib/telegram/notifier.ts`

- [ ] **Step 1: Implement notification dispatcher**

```ts
export async function notifyMissionCompromised(missionId: string, question?: { text: string; options?: string[] }): Promise<void> {
  // Build inline keyboard if options present
  // Call telegramBot.send(chatId, text, replyMarkup)
  // Store message_id in oversight_log for later reference
}
export async function notifyCampaignCompromised(campaignId: string): Promise<void> { /* loud ping */ }
export async function notifyCampaignAccomplished(campaignId: string): Promise<void> { /* quiet ping */ }
export async function notifyAuthPause(): Promise<void> { /* loud ping */ }
```

- [ ] **Step 2: Wire notifier into CONTROL transitions**

In mission-runner and campaign-executor, call the appropriate notifier on state transitions.

- [ ] **Step 3: Callback handler — answer escalation inline**

On `callback_query` containing `"answer:<missionId>:<option>"`, call `answerEscalation(missionId, option)` Server Action, then `telegramBot.answerCallbackQuery(id, 'Sending to CONTROL...')`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(telegram): tier-B notification policy + inline escalation answers"
```

### Task 9.3: Start bot on DEVROOM startup

**Files:**
- Modify: `server.ts` (existing custom server)

- [ ] **Step 1: Start telegramBot on server boot**

Import and start the bot alongside Socket.IO + CONTROL. Stop on SIGTERM.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(server): start telegram bot on boot"
```

---

## Phase 10 — Cutover

### Task 10.1: Delete obsolete subsystems

**Files:**
- Delete: `src/lib/orchestrator/` (entire directory)
- Delete: `src/lib/overseer/` (entire directory)
- Delete: `src/lib/quartermaster/` (entire directory)
- Delete: `src/lib/briefing/` IF unused (verify first — STRATEGIST session logic may still live here; keep if referenced from new campaign/ module)

- [ ] **Step 1: Grep for any remaining imports from the obsolete paths**

```bash
grep -r "from '@/lib/orchestrator\|from '@/lib/overseer\|from '@/lib/quartermaster" src/ tests/
```

Fix or migrate each reference. They should all be either (a) already-replaced Server Actions, (b) UI components already deleted in Phase 8.7, or (c) legitimate leftovers to be migrated now.

- [ ] **Step 2: Delete directories**

```bash
rm -rf src/lib/orchestrator src/lib/overseer src/lib/quartermaster
```

- [ ] **Step 3: Run full build to verify no broken imports**

```bash
pnpm build
```

Fix any errors.

- [ ] **Step 4: Run all tests**

```bash
pnpm test:all
```

All green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(cutover): delete obsolete orchestrator/overseer/quartermaster subsystems"
```

### Task 10.2: Run clean-slate migration + drop deprecated columns

**Files:**
- Use: `src/lib/db/migrations/0027_clean_slate.sql` (created in Task 1.4)
- Modify: `src/lib/db/schema.ts` — remove deprecated column declarations
- Generate: `src/lib/db/migrations/0028_drop_deprecated.sql` (after Task 10.1 deletes the referencing code)

The drop-deprecated-columns step was deferred from Task 1.3 (Phase 1) to this point, because the columns (`missions.reviewAttempts`, `missions.compromiseReason`, `missions.mergeRetryAt`) were referenced throughout the old orchestrator/overseer/quartermaster code. Task 10.1 deletes that code; this task drops the now-unreferenced columns.

- [ ] **Step 0: Drop deprecated columns (performed AFTER Task 10.1 deletes old code)**

Verify no remaining references:

```bash
grep -r "reviewAttempts\|compromiseReason\|mergeRetryAt" src/ tests/ --include="*.ts" --include="*.tsx"
```

Expected: zero matches (all references were in code deleted by Task 10.1). If any remain, fix or delete them before proceeding.

In `src/lib/db/schema.ts`, remove these column declarations from the `missions` table definition:
- `reviewAttempts`
- `compromiseReason`
- `mergeRetryAt`

Generate migration:

```bash
pnpm db:generate
```

Expected: a new migration (numbered after the latest — at this point likely `0028_*.sql`) containing `ALTER TABLE ... DROP COLUMN ...` statements (or SQLite's table-rebuild equivalent) for the three columns. Inspect the generated SQL to confirm only these three columns are dropped and nothing else.

- [ ] **Step 1: Back up production DB before proceeding**

```bash
cp data/devroom.db data/devroom.db.pre-cutover-$(date +%Y%m%d-%H%M%S)
```

- [ ] **Step 2: Apply migration**

```bash
pnpm db:migrate
```

- [ ] **Step 3: Run seed to reseed assets**

```bash
pnpm seed
```

- [ ] **Step 4: Verify DB state**

Open `pnpm db:studio`, confirm:
- All battlefields have `needs_gate_manifest = 1`
- Assets table has 6 rows (new roster)
- Settings table has `rules_of_engagement` with new text
- Missions, campaigns, phases, comms tables are empty

- [ ] **Step 5: Commit the DB backup script if new**

```bash
git commit -m "chore(cutover): apply clean-slate migration and reseed roster"
```

### Task 10.3: Production deployment

- [ ] **Step 1: Rebuild native deployment**

```bash
pnpm build
devroom restart
```

- [ ] **Step 2: Verify service status**

```bash
devroom status
```

Uptime starts fresh. No errors in `devroom logs`.

- [ ] **Step 3: Smoke test**

1. Open `https://devroom.lan`
2. Visit a pre-existing battlefield — should see "Gate manifest not established" banner
3. Click `[ESTABLISH GATES]` on one battlefield → bootstrap runs
4. Once complete, launch a trivial combat mission → observe comms, see mission accomplish end-to-end

- [ ] **Step 4: Commit cutover notes**

```bash
# (If you added release notes or runbook to docs/)
git commit -m "docs(cutover): CONTROL refactor cutover notes"
```

---

## Phase 11 — Follow-ups (post-cutover)

Not scripted into this plan. Ongoing:

- Observe `mission_attempts.classification` for recurring "unknown" patterns → promote to fast-path regex in `exit-classifier.ts`.
- Extend scripted-claude scenarios as new failure modes are encountered.
- Evaluate whether `gate_suite_timeout_ms`, `gate_per_command_timeout_ms`, `infra_retry_backoff_ms` need to become settings-table entries based on operational feedback.
- Consider promoting `pnpm test:e2e:real` to weekly cron after observing drift.

---

## Self-review notes

Checked this plan against the spec; coverage per section:

- §1 Mission Brief — no implementation needed (principles guide every task).
- §2 Terminology — Phase 3 roster + prompts cover the roles; `comms.ts` identity names match.
- §3 State Model — migrations + runner enforce. Tests in Phase 5 validate transitions.
- §4 Architecture — module structure matches Phase 2 file layout.
- §5 Combat Mission Lifecycle — Phase 2 (modules) + Phase 5 (integration).
- §6 Special paths (AUTH, Merge, QUARTERMASTER) — Phase 6.
- §7 Recon — Phase 5 Task 5.2.
- §8 Campaign Lifecycle — Phase 7.
- §9 Notifications — Phase 9.
- §10 Debrief Format — Phase 2 Task 2.9 (debrief/) + Phase 7 Task 7.2 (phase debrief composition).
- §11 Prompt Architecture — Phase 3 (RoE + prompts) + Phase 5 Task 5.1 (prompt-builder).
- §12 Bootstrap — Phase 4.
- §13 Worktree Lifecycle — Phase 2 Task 2.7 (worktree.ts) + Phase 2 Task 2.8 (watchdog).
- §14 DB Schema — Phase 1 Tasks 1.1–1.4.
- §15 Testing Strategy — integrated throughout; Phase 1 builds fixtures; Phases 2–7 write tests.
- §16 Implementation Plan — this document is the execution of that plan.
- §17 Settings — Phase 8 Task 8.6 (UI) + `config.ts` reads from settings table.
- §18 Non-goals — no tasks, by definition.
- §19 Resolved decisions — informs config defaults and test strategy.

**Known gaps accepted as future follow-ups (not blockers):**
- UI E2E tests in Phase 15.4 (Playwright flows for resolving COMPROMISED from UI, answering OVERSEER question from mission page) are not explicitly enumerated above — these can be added at Phase 8 task granularity once UI is stable.
- The exact wording of each combat/system prompt in Phase 3 is left to the executor's judgment within the scaffolds provided.
- Some integration test scenarios in Phase 5 are sketched but not fully coded — the executor extends coverage as needed; target is "every retry path has a test."
