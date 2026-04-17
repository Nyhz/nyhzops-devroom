# Reliability Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close fourteen audited reliability and quality gaps in CONTROL, worktree, socket, merge, DB, and test layers — prioritized by blast radius.

**Architecture:** Seven phases of tightly scoped fixes. Phase 1 closes crash-safety holes that can leak worktrees or swallow mission audit trail. Phase 2 makes critical notifications and socket wiring deterministic. Phases 3–4 harden race-prone git and socket code with proper types and tri-state returns. Phase 5 addresses hot-query performance. Phase 6 clears tech-debt (`any` casts, stale TODO). Phase 7 adds missing integration and client-cleanup tests.

**Tech Stack:** TypeScript strict, Next.js 16 App Router, Drizzle ORM + better-sqlite3, Socket.IO, Vitest.

---

## Background (required reading before starting)

Baseline findings (from audit performed on HEAD `4c1fef3`):

- **mission-runner.ts** imports `removeMissionWorktree` (line 20) and declares `remove: typeof removeMissionWorktree` in `WorktreeDeps` (line 110), but `runMission()` never calls it. Only `watchdog.ts` sweeps worktrees on terminal missions — gapped by sweep cadence and dependent on the watchdog itself staying alive.
- **mission-runner.ts:443–445** calls `notifyAuthPause()` via dynamic import and fire-and-forget `.catch()`. It bypasses the `escalate()` path that records the event to the `notifications` table. Recent commit `71f9b0a` fixed the helper — but the call site still uses the old direct path.
- **server.ts:57** assigns `globalThis.io = io` but `setCommsEmitter()` (exported from `src/control/comms.ts:98`) is never called. Comms fall back to `globalThis.io` — works today, brittle if boot order shifts.
- **worktree.ts:22–35** detects "branch already exists" via `/already/i` string match on git stderr. Non-English locales or new git wording will mask real errors.
- **worktree.ts:59–68** treats any non-conflict rebase failure as a silent clean rebase.
- **merge.ts:87–107** drains the per-battlefield lock chain with `while (this.locks.has(bf)) await this.locks.get(bf)`.
- **exit-classifier.ts** already had AUTH gating tightened in commit `ec45d47`; additional coverage for tool-use-plus-stderr-auth collisions is missing.
- **comms.ts:98–114** documents the orphaned `setCommsEmitter` in its own comment.
- **schema.ts** lacks indexes on `missions.status`, `missions.battlefieldId`, `missionAttempts.missionId`, `notifications.read`, `overseerLogs.missionId`, and `comms.missionId`.

Full execution run: `pnpm build && pnpm test && pnpm test:e2e` after each phase, per the `Verify with pnpm build` and `Verify with pnpm dev` memories.

---

## File Structure

### Modify
- `src/control/mission-runner.ts` — finally-block cleanup, pre-consult classification capture, `escalate()` at auth pause, thread `attemptNumber` to avoid re-query.
- `src/control/worktree.ts` — structured exit-code detection for branch exists, tri-state rebase result.
- `src/control/merge.ts` — promise-queue for the per-battlefield lock chain.
- `src/control/comms.ts` — remove `globalThis.io` fallback once `setCommsEmitter` is wired.
- `server.ts` — call `setCommsEmitter(io.emit.bind(io))` right after IO attaches.
- `src/lib/socket/server.ts` — typed event map.
- `src/lib/socket/emit.ts` — emit helper re-typed to match.
- `src/lib/db/schema.ts` — add indexes on hot columns.
- `src/lib/db/migrations/0013_hot_indexes.sql` — drizzle-kit generated.
- `src/actions/telemetry.ts` — replace `as any` casts with typed global augmentation.
- `src/types/globals.d.ts` (new or existing) — augment `globalThis` with typed `io`, `orchestrator`, `scheduler`.
- `src/control/bootstrap/bootstrap.ts:29-31` — replace stale TODO with deferral note linking to CLAUDE.md §12.
- `CLAUDE.md` — mark §12 step 5 as deferred.

### Create
- `tests/control/mission-runner.cleanup.test.ts` — finally-block worktree removal.
- `tests/control/mission-runner.overseer-audit.test.ts` — consult-throws path records classification.
- `tests/control/mission-runner.auth-escalate.test.ts` — auth pause goes through `escalate()`.
- `tests/control/worktree.branch-race.test.ts` — branch exists via exit code, not string.
- `tests/control/worktree.rebase-tri-state.test.ts` — rebase returns `{ conflict, rebased, error? }`.
- `tests/control/merge.queue.test.ts` — ordered serialization of concurrent battlefield merges.
- `tests/control/control.loop.integration.test.ts` — 5 concurrent missions, one crash, watchdog heal, auth pause/resume.
- `tests/lib/socket/typed-events.test.ts` — typed event map compile assertions.
- `src/hooks/__tests__/use-mission-comms.cleanup.test.ts` — listener `.off()` on unmount.
- `src/hooks/__tests__/use-board.cleanup.test.ts` — same.

---

## Phase 1 — P0 Crash Safety

### Task 1: `runMission()` always cleans worktree

**Files:**
- Modify: `src/control/mission-runner.ts:291-873`
- Test: `tests/control/mission-runner.cleanup.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/control/mission-runner.cleanup.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runMission } from '@/control/mission-runner';
import { makeRunnerDeps } from './helpers/runner-fixture';

describe('runMission worktree cleanup', () => {
  it('calls worktree.remove on ACCOMPLISHED path', async () => {
    const deps = makeRunnerDeps({ outcome: 'accomplished' });
    await runMission({ missionId: 'M1', battlefieldId: 'B1' }, deps);
    expect(deps.worktree.remove).toHaveBeenCalledWith('M1');
  });

  it('calls worktree.remove on COMPROMISED path', async () => {
    const deps = makeRunnerDeps({ outcome: 'compromised' });
    await runMission({ missionId: 'M2', battlefieldId: 'B1' }, deps);
    expect(deps.worktree.remove).toHaveBeenCalledWith('M2');
  });

  it('calls worktree.remove even when retry loop throws', async () => {
    const deps = makeRunnerDeps({ outcome: 'throw' });
    await expect(runMission({ missionId: 'M3', battlefieldId: 'B1' }, deps)).rejects.toThrow();
    expect(deps.worktree.remove).toHaveBeenCalledWith('M3');
  });
});
```

- [ ] **Step 2: Run test, expect fail**

`pnpm test tests/control/mission-runner.cleanup.test.ts` → FAIL (remove never called).

- [ ] **Step 3: Wrap retry loop in try/finally**

In `mission-runner.ts`, locate the outer body of `runMission()` (around line 346–827). Surround with:

```ts
export async function runMission(input, deps) {
  // ... existing setup that depends on worktree existence ...
  try {
    // existing retry loop and terminal transitions
  } finally {
    try {
      await deps.worktree.remove(input.missionId);
    } catch (err) {
      console.error(`[CONTROL] worktree cleanup failed for ${input.missionId}:`, err);
    }
  }
}
```

The `try` must begin **after** the worktree is created and **before** the first attempt. `finally` must be best-effort — never rethrow from it.

- [ ] **Step 4: Run tests, expect pass**

`pnpm test tests/control/mission-runner.cleanup.test.ts` → PASS.
`pnpm test tests/control/` → full CONTROL suite still green.

- [ ] **Step 5: Verify build**

`pnpm build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/control/mission-runner.ts tests/control/mission-runner.cleanup.test.ts
git commit -m "fix(mission-runner): always remove worktree in finally block"
```

---

### Task 2: Capture classification before Overseer consult

**Files:**
- Modify: `src/control/mission-runner.ts:585-598` (`runOverseerConsult` call site)
- Test: `tests/control/mission-runner.overseer-audit.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/control/mission-runner.overseer-audit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runMission } from '@/control/mission-runner';
import { makeRunnerDeps } from './helpers/runner-fixture';

describe('Overseer consult failure', () => {
  it('records pre-consult classification when consult throws', async () => {
    const deps = makeRunnerDeps({
      attempts: 3, // force consult path on attempt 4
      overseerConsult: vi.fn().mockRejectedValue(new Error('db down')),
      preConsultClassification: 'SUBPROCESS_ERROR',
    });
    await runMission({ missionId: 'M4', battlefieldId: 'B1' }, deps);
    const attempts = deps.recordedAttempts();
    expect(attempts.at(-1)?.classification).toBe('SUBPROCESS_ERROR');
    expect(attempts.at(-1)?.finalMessage).toMatch(/consult failed/i);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Hoist classification capture before consult**

In `mission-runner.ts`, around the block that calls `runOverseerConsult(...)`:

```ts
// BEFORE calling consult, snapshot the classification & context.
const preConsultClassification = classification; // from local scope
const preConsultMessage = finalMessage ?? exit.message;

let consultResult = null;
try {
  consultResult = await runOverseerConsult(/* ... */);
} catch (err) {
  console.error('[CONTROL] overseer consult threw:', err);
  await deps.recordAttempt({
    missionId: input.missionId,
    attemptNumber,
    classification: preConsultClassification,
    finalMessage: `${preConsultMessage} (consult failed: ${(err as Error).message})`,
    outcome: 'compromised',
  });
  return { status: 'compromised', reason: preConsultClassification };
}
```

- [ ] **Step 4: Run full test + build**

`pnpm test tests/control/` and `pnpm build` → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(mission-runner): preserve classification when Overseer consult throws"
```

---

## Phase 2 — P1 One-Line, High-Impact

### Task 3: Route `notifyAuthPause` through `escalate()`

**Files:**
- Modify: `src/control/mission-runner.ts:442-445`
- Test: `tests/control/mission-runner.auth-escalate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/control/mission-runner.auth-escalate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runMission } from '@/control/mission-runner';
import { makeRunnerDeps } from './helpers/runner-fixture';

describe('AUTH classification escalation', () => {
  it('calls escalate so notification is persisted', async () => {
    const escalate = vi.fn().mockResolvedValue(undefined);
    const deps = makeRunnerDeps({ classifyAs: 'AUTH', escalate });
    await runMission({ missionId: 'M5', battlefieldId: 'B1' }, deps);
    expect(escalate).toHaveBeenCalledWith(expect.objectContaining({
      level: 'critical',
      title: expect.stringMatching(/auth/i),
      missionId: 'M5',
    }));
  });

  it('awaits escalate before returning', async () => {
    let resolved = false;
    const deps = makeRunnerDeps({
      classifyAs: 'AUTH',
      escalate: () => new Promise((r) => setTimeout(() => { resolved = true; r(undefined); }, 20)),
    });
    await runMission({ missionId: 'M6', battlefieldId: 'B1' }, deps);
    expect(resolved).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Replace fire-and-forget with awaited `escalate()`**

In `mission-runner.ts`, replace lines 442–445 (the `.then(({ notifyAuthPause })...).catch(...)` block) with:

```ts
await deps.escalate({
  level: 'critical',
  kind: 'AUTH_PAUSE',
  missionId: input.missionId,
  battlefieldId: input.battlefieldId,
  title: 'Claude auth expired — orchestrator paused',
  detail: exit.message ?? '',
});
```

Add `escalate: typeof escalate` to the runner's `Deps` type and default-wire it to `import('@/lib/notifier').then(m => m.escalate)` in `production-deps.ts`.

- [ ] **Step 4: Remove the dynamic `notifyAuthPause` import**

Delete the `import('@/lib/notifier')` branch at the former location. `grep 'notifyAuthPause' src/control` should return zero matches.

- [ ] **Step 5: Build and full test**

`pnpm build && pnpm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(mission-runner): await escalate() on AUTH so audit row is written"
```

---

### Task 4: Wire `setCommsEmitter()` at server boot

**Files:**
- Modify: `server.ts:55-60`
- Modify: `src/control/comms.ts:98-114` (remove the globalThis fallback comment once wired)
- Test: piggyback on existing comms tests + add a boot-order smoke test

- [ ] **Step 1: Write failing test**

```ts
// src/control/__tests__/comms.bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitComm, setCommsEmitter } from '@/control/comms';

describe('setCommsEmitter', () => {
  beforeEach(() => setCommsEmitter(null));
  it('is required — emitting without setup must throw loudly in non-prod', () => {
    // Simulate pre-boot state
    (globalThis as unknown as { io?: unknown }).io = undefined;
    expect(() => emitComm('M1', { kind: 'stdout', line: 'hi' })).toThrow(/setCommsEmitter/);
  });

  it('routes events through the set emitter', () => {
    const emit = vi.fn();
    setCommsEmitter(emit);
    emitComm('M1', { kind: 'stdout', line: 'hi' });
    expect(emit).toHaveBeenCalledWith('mission:M1:comm', expect.any(Object));
  });
});
```

- [ ] **Step 2: Run test, expect fail** (current fallback to `globalThis.io` swallows the throw).

- [ ] **Step 3: Update `comms.ts` — throw when unset outside the fallback shim**

```ts
// src/control/comms.ts
let emitter: Emitter | null = null;
export function setCommsEmitter(fn: Emitter | null): void { emitter = fn; }

function resolveEmitter(): Emitter {
  if (emitter) return emitter;
  const io = (globalThis as unknown as { io?: { emit: Emitter } }).io;
  if (io?.emit) return io.emit.bind(io);
  throw new Error(
    'CONTROL emit called before setCommsEmitter() — check server.ts boot order',
  );
}
```

- [ ] **Step 4: Call `setCommsEmitter` in `server.ts`**

After line 57 (`globalThis.io = io;`):

```ts
import { setCommsEmitter } from '@/control/comms';
// ...
const io = new SocketIOServer(httpServer, { path: '/socket.io' });
globalThis.io = io;
setCommsEmitter((event, payload) => io.emit(event, payload));
```

- [ ] **Step 5: Run tests + build**

`pnpm test src/control/__tests__/comms.bootstrap.test.ts` → PASS. `pnpm build`.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(comms): require setCommsEmitter() wired at boot, drop silent fallback"
```

---

## Phase 3 — P1 Git Correctness

### Task 5: Worktree branch-exists by exit code, not stderr match

**Files:**
- Modify: `src/control/worktree.ts:19-35`
- Test: `tests/control/worktree.branch-race.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/control/worktree.branch-race.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMissionWorktree } from '@/control/worktree';

const gitSpawn = vi.fn();
vi.mock('simple-git', () => ({ default: () => ({ raw: gitSpawn }) }));

describe('createMissionWorktree', () => {
  it('treats fatal localized non-conflict errors as failure', async () => {
    gitSpawn.mockRejectedValueOnce(Object.assign(new Error('fatal: corrupted index'), { code: 128 }));
    await expect(createMissionWorktree('bf1', 'M1')).rejects.toThrow(/corrupted index/);
  });

  it('detects existing branch only when git ref-parse confirms it', async () => {
    gitSpawn
      .mockResolvedValueOnce('abc123\n')      // ref-parse: ref exists
      .mockResolvedValueOnce('');              // worktree add --force
    const res = await createMissionWorktree('bf1', 'M1');
    expect(res.reused).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Replace string heuristic with `git rev-parse --verify` probe**

```ts
// src/control/worktree.ts
export async function createMissionWorktree(bfId: string, missionId: string) {
  const branch = `mission/${missionId}`;
  const git = simpleGit(bfPath(bfId));
  let reused = false;
  try {
    await git.raw(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    reused = true;
  } catch { /* branch missing — normal path */ }
  await git.raw([
    'worktree', 'add',
    '--force',
    wtPath(missionId),
    reused ? branch : '-b', reused ? '' : branch, reused ? '' : 'HEAD',
  ].filter(Boolean));
  return { path: wtPath(missionId), branch, reused };
}
```

- [ ] **Step 4: Tests + build**

`pnpm test tests/control/worktree.branch-race.test.ts && pnpm build` → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(worktree): detect existing branch via rev-parse, not stderr string"
```

---

### Task 6: `rebaseOntoTarget` returns tri-state

**Files:**
- Modify: `src/control/worktree.ts:59-68`
- Modify: all callers (grep `rebaseOntoTarget` → expect mission-runner + merge)
- Test: `tests/control/worktree.rebase-tri-state.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/control/worktree.rebase-tri-state.test.ts
import { describe, it, expect, vi } from 'vitest';
import { rebaseOntoTarget } from '@/control/worktree';

describe('rebaseOntoTarget', () => {
  it('returns conflict:true on merge conflict', async () => {
    mockGitRebase('CONFLICT (content): Merge conflict in foo.ts');
    expect(await rebaseOntoTarget('wt', 'main')).toEqual({ conflict: true, rebased: false });
  });
  it('returns rebased:true on clean rebase', async () => {
    mockGitRebase(''); // success
    expect(await rebaseOntoTarget('wt', 'main')).toEqual({ conflict: false, rebased: true });
  });
  it('returns error on other failures', async () => {
    mockGitRebase('fatal: unable to read tree', /* exitCode */ 128);
    const r = await rebaseOntoTarget('wt', 'main');
    expect(r).toMatchObject({ conflict: false, rebased: false });
    expect(r.error).toMatch(/unable to read tree/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Update return type and implementation**

```ts
// src/control/worktree.ts
export type RebaseResult =
  | { conflict: true; rebased: false }
  | { conflict: false; rebased: true }
  | { conflict: false; rebased: false; error: string };

export async function rebaseOntoTarget(wtPath: string, target: string): Promise<RebaseResult> {
  try {
    await simpleGit(wtPath).raw(['rebase', target]);
    return { conflict: false, rebased: true };
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (/conflict/i.test(msg)) return { conflict: true, rebased: false };
    return { conflict: false, rebased: false, error: msg };
  }
}
```

- [ ] **Step 4: Update callers**

Search: `grep -rn "rebaseOntoTarget(" src/`. For each hit, handle the `error` branch explicitly (log and return COMPROMISED with reason).

- [ ] **Step 5: Tests + build**

`pnpm test && pnpm build` → PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(worktree): rebaseOntoTarget returns tri-state, callers handle error branch"
```

---

## Phase 4 — P1 Socket & Merge Queue

### Task 7: Typed Socket.IO event map

**Files:**
- Modify: `src/lib/socket/server.ts`, `src/lib/socket/emit.ts`
- Create: `src/lib/socket/events.ts`
- Test: `tests/lib/socket/typed-events.test.ts`

- [ ] **Step 1: Define event map**

```ts
// src/lib/socket/events.ts
export interface SocketEventMap {
  'mission:status': { missionId: string; status: MissionStatus; at: number };
  'mission:comm':   { missionId: string; kind: 'stdout'|'stderr'|'event'; line: string; ts: number };
  'battlefield:update': { battlefieldId: string };
  'phase:update':   { phaseId: string; status: PhaseStatus };
  'campaign:update':{ campaignId: string; status: CampaignStatus };
  // ... cover every existing event name in src/lib/socket/server.ts
}
export type SocketEvent = keyof SocketEventMap;
```

Fill every `socket.on(...)` / `io.emit(...)` name currently in `src/lib/socket/server.ts:1-129` and `src/lib/socket/emit.ts`.

- [ ] **Step 2: Write compile-time test**

```ts
// tests/lib/socket/typed-events.test.ts
import { expectTypeOf } from 'vitest';
import type { SocketEventMap } from '@/lib/socket/events';

test('emit payload types are strict', () => {
  expectTypeOf<SocketEventMap['mission:status']>().toMatchTypeOf<{ missionId: string }>();
});
```

- [ ] **Step 3: Constrain `emit` and `on`**

```ts
// src/lib/socket/emit.ts
import type { SocketEventMap, SocketEvent } from './events';
export function emit<E extends SocketEvent>(event: E, payload: SocketEventMap[E]) {
  globalThis.io?.emit(event, payload);
}
```

Replace every callsite of the loose `io.emit` in `src/lib/socket/server.ts` with the typed `emit()` or with a narrowed overload.

- [ ] **Step 4: `pnpm build` — fix every resulting type error**

Type errors are the goal — each one is a latent payload mismatch. Fix in place.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(socket): typed event map, strict emit/listen signatures"
```

---

### Task 8: Replace merge-lock chain with promise queue

**Files:**
- Modify: `src/control/merge.ts:80-130`
- Test: `tests/control/merge.queue.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/control/merge.queue.test.ts
import { describe, it, expect } from 'vitest';
import { MergeLockManager } from '@/control/merge';

describe('MergeLockManager', () => {
  it('serializes acquisitions per battlefield in FIFO order', async () => {
    const mgr = new MergeLockManager();
    const order: number[] = [];
    const task = (n: number, ms: number) => mgr.withLock('bf', async () => {
      order.push(n);
      await new Promise(r => setTimeout(r, ms));
    });
    await Promise.all([task(1, 20), task(2, 5), task(3, 5)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('parallelizes across different battlefields', async () => {
    const mgr = new MergeLockManager();
    const t0 = Date.now();
    await Promise.all([
      mgr.withLock('A', () => new Promise(r => setTimeout(r, 30))),
      mgr.withLock('B', () => new Promise(r => setTimeout(r, 30))),
    ]);
    expect(Date.now() - t0).toBeLessThan(55);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Replace chain with tail-promise queue**

```ts
// src/control/merge.ts
export class MergeLockManager {
  private tails = new Map<string, Promise<unknown>>();
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => { release = r; });
    this.tails.set(key, prev.then(() => current));
    await prev;
    try { return await fn(); } finally {
      release();
      if (this.tails.get(key) === this.tails.get(key)) {
        // if nothing was chained after us, free the map entry
        queueMicrotask(() => { if (this.tails.get(key) === current) this.tails.delete(key); });
      }
    }
  }
}
```

- [ ] **Step 4: Tests + build**

`pnpm test tests/control/merge.queue.test.ts && pnpm build` → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(merge): promise-queue for per-battlefield serialization"
```

---

## Phase 5 — P2 Performance

### Task 9: Index hot query columns

**Files:**
- Modify: `src/lib/db/schema.ts`
- Generate: `src/lib/db/migrations/0013_hot_indexes.sql`

- [ ] **Step 1: Add index declarations in schema**

For each table listed, add index definitions (Drizzle v0.44+ syntax):

```ts
// src/lib/db/schema.ts
import { index } from 'drizzle-orm/sqlite-core';

export const missions = sqliteTable('missions', {
  // ... columns
}, (t) => ({
  byStatus: index('idx_missions_status').on(t.status),
  byBattlefield: index('idx_missions_battlefield').on(t.battlefieldId),
  byBattlefieldStatus: index('idx_missions_bf_status').on(t.battlefieldId, t.status),
}));

export const missionAttempts = sqliteTable('mission_attempts', {
  // ...
}, (t) => ({
  byMission: index('idx_mission_attempts_mission').on(t.missionId),
}));

export const notifications = sqliteTable('notifications', {
  // ...
}, (t) => ({
  byRead: index('idx_notifications_read').on(t.read, t.createdAt),
}));

export const overseerLogs = sqliteTable('overseer_logs', {
  // ...
}, (t) => ({
  byMission: index('idx_overseer_logs_mission').on(t.missionId),
}));

export const comms = sqliteTable('comms', {
  // ...
}, (t) => ({
  byMission: index('idx_comms_mission').on(t.missionId),
}));
```

- [ ] **Step 2: Generate migration**

```bash
pnpm drizzle-kit generate
# Rename produced file to 0013_hot_indexes.sql if necessary
```

- [ ] **Step 3: Run `pnpm dev` to apply migration**

Per the `Verify migrations with pnpm dev` memory: `tsc` alone won't catch migration failures. Start the dev server, confirm it boots clean, stop it.

- [ ] **Step 4: Smoke-test query plan**

```bash
sqlite3 data/devroom.db "EXPLAIN QUERY PLAN SELECT * FROM missions WHERE status = 'queued';"
# Expect: SEARCH missions USING INDEX idx_missions_status
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/
git commit -m "perf(db): add indexes on hot CONTROL query paths"
```

---

### Task 12: Thread attempt number through runMission loop

**Files:**
- Modify: `src/control/mission-runner.ts:271-278, 834`

- [ ] **Step 1: Read the fallthrough region**

Identify the `countAttempts()` call site around line 834 and trace back to the loop variable that already holds the current attempt number.

- [ ] **Step 2: Replace re-query with loop var**

Delete the local `countAttempts()` helper (or keep but stop calling it in the hot path). Pass `attemptNumber` — already incremented in the loop — directly into whatever consumed the count.

- [ ] **Step 3: Run full CONTROL tests**

`pnpm test tests/control/` → PASS. No behavior change, just cheaper.

- [ ] **Step 4: Commit**

```bash
git commit -am "perf(mission-runner): thread attemptNumber through loop, drop re-query"
```

---

## Phase 6 — P2 Tech Debt

### Task 11: Typed global augmentation for `io`, `orchestrator`, `scheduler`

**Files:**
- Create: `src/types/globals.d.ts`
- Modify: `src/actions/telemetry.ts` (and any other `as any` hit)

- [ ] **Step 1: Declare augmentation**

```ts
// src/types/globals.d.ts
import type { Server as SocketIOServer } from 'socket.io';
import type { Orchestrator } from '@/control/control';
import type { Scheduler } from '@/control/scheduler';

declare global {
  var io: SocketIOServer | undefined;
  var orchestrator: Orchestrator | undefined;
  var scheduler: Scheduler | undefined;
}
export {};
```

- [ ] **Step 2: Ensure it's included in `tsconfig.json`**

Confirm `tsconfig.json`'s `include` covers `src/types/**/*.d.ts`. If not, add it.

- [ ] **Step 3: Remove `as any` casts**

`grep -n "as any" src/actions/telemetry.ts` — for each hit, drop the cast. TypeScript should now know the types.

- [ ] **Step 4: Build**

`pnpm build` → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "chore(types): typed globals for io/orchestrator/scheduler, drop any casts"
```

---

### Task 14: Clear stale bootstrap TODO

**Files:**
- Modify: `src/control/bootstrap/bootstrap.ts:29-31`
- Modify: `CLAUDE.md` (Phase 12 section if present, else append a "Deferred work" note)

- [ ] **Step 1: Replace TODO comment with deferral note**

```ts
// src/control/bootstrap/bootstrap.ts
// DEFERRED: INTEL-driven CLAUDE.md/SPEC.md authoring is tracked as a
// standalone initiative. See CLAUDE.md § "Deferred work" for context.
```

- [ ] **Step 2: Add deferral section to `CLAUDE.md`**

Under a new `## Deferred Work` heading near the bottom, document:

```markdown
- **INTEL-driven CLAUDE.md / SPEC.md authoring** (was Phase 12 step 5) — out of current scope; bootstrap emits baseline docs only.
```

- [ ] **Step 3: Commit**

```bash
git commit -am "docs: mark INTEL-authored bootstrap as deferred work"
```

---

## Phase 7 — P2 Testing

### Task 10: CONTROL loop integration test

**Files:**
- Create: `tests/control/control.loop.integration.test.ts`

- [ ] **Step 1: Write integration test (real DB, stubbed spawn)**

```ts
// tests/control/control.loop.integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers/test-db';
import { Orchestrator } from '@/control/control';
import { stubSpawnAsset } from './helpers/stub-spawn';

describe('CONTROL integration', () => {
  let orch: Orchestrator;
  beforeEach(async () => {
    await makeTestDb();
    orch = new Orchestrator({ spawnAsset: stubSpawnAsset });
    orch.start();
  });

  it('dispatches 5 concurrent missions, recovers one crash via watchdog', async () => {
    const missions = await seedMissions(5);
    stubSpawnAsset.failOnce(missions[2].id);
    await orch.waitUntilSettled(30_000);
    const final = await loadMissions(missions.map(m => m.id));
    expect(final.filter(m => m.status === 'accomplished')).toHaveLength(4);
    expect(final.find(m => m.id === missions[2].id)?.status).toBe('compromised');
  });

  it('auth pause halts dispatch, resume continues', async () => {
    await seedMissions(2);
    stubSpawnAsset.classifyAs('AUTH');
    await orch.waitUntilPaused(5_000);
    expect(await pendingMissionCount()).toBe(2);
    await orch.resume();
    stubSpawnAsset.reset();
    await orch.waitUntilSettled(10_000);
    expect(await pendingMissionCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Write the helpers**

`tests/control/helpers/test-db.ts` spins up a tmpdir-backed SQLite + applies migrations (existing pattern in test setup per `e53d517` commit). `tests/control/helpers/stub-spawn.ts` exposes `failOnce`, `classifyAs`, `reset` to control stubbed asset outcomes.

- [ ] **Step 3: Run**

`pnpm test tests/control/control.loop.integration.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "test(control): integration coverage for concurrent, crash, and auth-pause paths"
```

---

### Task 13: Client socket cleanup tests

**Files:**
- Create: `src/hooks/__tests__/use-mission-comms.cleanup.test.ts`
- Create: `src/hooks/__tests__/use-board.cleanup.test.ts`

- [ ] **Step 1: Write cleanup assertion**

```ts
// src/hooks/__tests__/use-mission-comms.cleanup.test.ts
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMissionComms } from '@/hooks/use-mission-comms';

vi.mock('socket.io-client', () => {
  const on = vi.fn();
  const off = vi.fn();
  return { io: () => ({ on, off, emit: vi.fn(), disconnect: vi.fn() }), __spy: { on, off } };
});

describe('useMissionComms', () => {
  it('removes listeners on unmount', async () => {
    const { unmount } = renderHook(() => useMissionComms('M1'));
    const mod = await import('socket.io-client') as unknown as { __spy: { on: any; off: any } };
    unmount();
    expect(mod.__spy.off).toHaveBeenCalledTimes(mod.__spy.on.mock.calls.length);
  });
});
```

Repeat for `use-board`.

- [ ] **Step 2: Run, watch fail or pass**

If they fail, fix the hooks to return proper cleanup from `useEffect`.

- [ ] **Step 3: Commit**

```bash
git commit -am "test(hooks): assert socket listeners are cleaned up on unmount"
```

---

## Execution Order & Batching

| Phase | Tasks | Ship as | Depends on |
|-------|-------|---------|------------|
| 1 | 1, 2 | PR #1 "P0 crash safety" | — |
| 2 | 3, 4 | PR #2 "Deterministic notifications & socket boot" | — |
| 3 | 5, 6 | PR #3 "Git correctness" | — |
| 4 | 7, 8 | PR #4 "Typed sockets, proper merge queue" | 3 (merge queue touches rebase callers) |
| 5 | 9, 12 | PR #5 "DB indexes + cheap attempt count" | — |
| 6 | 11, 14 | PR #6 "Type cleanups + docs" | — |
| 7 | 10, 13 | PR #7 "Missing tests" | 1–4 merged so integration reflects final behavior |

Phases 1–3 can be worked in parallel by separate subagents (no shared files). Phase 4 must follow Phase 3. Phase 7 lands last.

---

## Definition of Done (whole plan)

- `pnpm build` clean.
- `pnpm test` green (including new tests).
- `pnpm dev` boots without migration errors; Commander sees live comms in HQ.
- `grep -rn "as any" src/` produces no new occurrences in modified files.
- `grep -rn "notifyAuthPause" src/control/` is empty.
- `EXPLAIN QUERY PLAN` on the dispatch loop query uses `idx_missions_status`.
- No worktree directory older than one watchdog interval present in `.worktrees/` after a full test run.
