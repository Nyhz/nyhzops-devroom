# COMMS Visibility Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mission COMMS panel show one line per action (agent messages, tool uses, tool results, CONTROL milestones) instead of a single squashed CONTROL line.

**Architecture:** Fix three bugs in sequence: (1) `formatCommsEvent` parses real Claude stream-json `message.content[]` parts and returns an array of messages; (2) `Terminal.groupLogs` stops merging consecutive same-actor rows; (3) mission-runner emits missing milestone comms (merging, worktree cleaned, final beat).

**Tech Stack:** TypeScript, Vitest (unit), React Testing Library (component).

Spec: `docs/superpowers/specs/2026-04-17-comms-visibility-design.md`

---

## File Structure

- Modify `src/control/comms.ts` — change `formatCommsEvent` to return `string[]`, add nested-content parsing.
- Modify `src/control/mission-runner.ts` — iterate the array from `formatCommsEvent`; add milestone comms (merge start, worktree cleaned, final beat).
- Modify `src/components/ui/terminal.tsx` — remove same-actor coalesce branch.
- Create `tests/control/unit/comms.format.test.ts` — regression coverage for real stream-json shape.
- Modify `src/components/ui/__tests__/terminal.test.tsx` — drop/replace any test that depended on same-actor coalesce.

---

## Task 1: Regression test for `formatCommsEvent` (real Claude shape)

**Files:**
- Create: `tests/control/unit/comms.format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/control/unit/comms.format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatCommsEvent } from '@/control/comms';
import type { StreamJsonEvent } from '@/control/spawn-asset';

describe('formatCommsEvent — real Claude stream-json shape', () => {
  it('extracts text from nested assistant.message.content[]', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Adding health route now.' }],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['Adding health route now.']);
  });

  it('extracts tool_use from nested assistant content', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'pnpm build' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Bash: pnpm build']);
  });

  it('emits one message per content part, preserving order', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: "I'll read the file." },
          {
            type: 'tool_use',
            id: 't1',
            name: 'Read',
            input: { file_path: 'src/x.ts' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual([
      "I'll read the file.",
      '⚙ Read: src/x.ts',
    ]);
  });

  it('extracts tool_result from nested user.message.content[]', () => {
    const ev = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: 'file contents here',
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['✓ result: file contents here']);
  });

  it('marks errored tool_result with ✗', () => {
    const ev = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: 'boom',
            is_error: true,
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['✗ result: boom']);
  });

  it('supports legacy flat assistant shape (back-compat with test fixtures)', () => {
    const ev = { type: 'assistant', text: 'Starting task' } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['Starting task']);
  });

  it('returns [] for system / stream_event / result', () => {
    expect(formatCommsEvent({ type: 'system' } as StreamJsonEvent)).toEqual([]);
    expect(formatCommsEvent({ type: 'stream_event' } as StreamJsonEvent)).toEqual([]);
    expect(formatCommsEvent({ type: 'result' } as StreamJsonEvent)).toEqual([]);
  });

  it('returns [] for assistant with empty content array', () => {
    const ev = {
      type: 'assistant',
      message: { content: [] },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm vitest run tests/control/unit/comms.format.test.ts`

Expected: All tests fail (current `formatCommsEvent` returns `string | null`, does not understand nested shape).

---

## Task 2: Rewrite `formatCommsEvent` to handle nested content and return an array

**Files:**
- Modify: `src/control/comms.ts`

- [ ] **Step 1: Replace `formatCommsEvent` and helpers**

Open `src/control/comms.ts` and replace the existing `formatCommsEvent` function (currently lines 15-50) and keep the existing helpers `summarizeToolInput` / `summarizeToolResult` (lines 52-93). The new body:

```typescript
/**
 * Convert a Claude Code stream-json event into zero or more human-readable
 * single-line comm messages. Real Claude output nests text, tool_use, and
 * tool_result parts inside `event.message.content[]`; a single event can
 * produce multiple comm lines (e.g. a text thought followed by a tool_use).
 *
 * Legacy flat shape (`{type:'assistant', text:'...'}`) is supported as a
 * fallback so scripted-claude test fixtures keep working.
 */
export function formatCommsEvent(ev: StreamJsonEvent): string[] {
  const out: string[] = [];

  // Nested real-Claude shape: walk message.content[]
  const msg = (ev as { message?: unknown }).message;
  if (msg && typeof msg === 'object') {
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        const ptype = p.type;
        if (ptype === 'text' && typeof p.text === 'string') {
          const t = p.text.trim();
          if (t) out.push(t.length > 400 ? `${t.slice(0, 400)}…` : t);
        } else if (ptype === 'tool_use') {
          const name = typeof p.name === 'string' ? p.name : 'tool';
          const summary = summarizeToolInput(name, p.input);
          out.push(summary ? `⚙ ${name}: ${summary}` : `⚙ ${name}`);
        } else if (ptype === 'tool_result') {
          const preview = summarizeToolResult(p.content);
          const glyph = p.is_error === true ? '✗' : '✓';
          out.push(preview ? `${glyph} result: ${preview}` : `${glyph} result`);
        }
      }
      return out;
    }
  }

  // Legacy flat shape fallback (scripted-claude fixtures, older events)
  switch (ev.type) {
    case 'assistant': {
      const text = typeof ev.text === 'string' ? ev.text.trim() : '';
      if (!text) return [];
      return [text.length > 400 ? `${text.slice(0, 400)}…` : text];
    }
    case 'tool_use': {
      const name = typeof ev.name === 'string' ? ev.name : 'tool';
      const input = (ev as { input?: unknown }).input;
      const summary = summarizeToolInput(name, input);
      return [summary ? `⚙ ${name}: ${summary}` : `⚙ ${name}`];
    }
    case 'tool_result': {
      const content = (ev as { content?: unknown }).content;
      const preview = summarizeToolResult(content);
      const isError = (ev as { is_error?: boolean }).is_error === true;
      const glyph = isError ? '✗' : '✓';
      return [preview ? `${glyph} result: ${preview}` : `${glyph} result`];
    }
    default:
      return [];
  }
}
```

- [ ] **Step 2: Run the new tests and verify they pass**

Run: `pnpm vitest run tests/control/unit/comms.format.test.ts`

Expected: All tests pass.

- [ ] **Step 3: Run the existing comms tests to verify no regression**

Run: `pnpm vitest run tests/control/unit/comms.test.ts tests/control/unit/comms.bootstrap.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/control/comms.ts tests/control/unit/comms.format.test.ts
git commit -m "fix(comms): parse nested Claude stream-json content parts"
```

---

## Task 3: Update `formatCommsEvent` call site in mission-runner

**Files:**
- Modify: `src/control/mission-runner.ts` (around line 386-391)

- [ ] **Step 1: Update the `onCommsEvent` handler to iterate**

In `src/control/mission-runner.ts`, find the `onCommsEvent` handler in the `deps.spawnAsset({...})` call (currently lines 386-391):

```typescript
        onCommsEvent: (ev) => {
          const message = formatCommsEvent(ev);
          if (message) {
            emitComm({ missionId, actor: 'OPERATIVE', message });
          }
        },
```

Replace with:

```typescript
        onCommsEvent: (ev) => {
          for (const message of formatCommsEvent(ev)) {
            emitComm({ missionId, actor: 'OPERATIVE', message });
          }
        },
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm build`

Expected: build succeeds, no TS errors.

- [ ] **Step 3: Run full unit suite**

Run: `pnpm vitest run tests/control/unit`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/control/mission-runner.ts
git commit -m "fix(comms): emit one comm per stream-json content part"
```

---

## Task 4: Remove same-actor coalesce in Terminal

**Files:**
- Modify: `src/components/ui/terminal.tsx`
- Modify: `src/components/ui/__tests__/terminal.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `src/components/ui/__tests__/terminal.test.tsx` and add a new test after the existing `'does not coalesce comms from different actors'` test (after line 106):

```typescript
  it('does not coalesce consecutive comms from the same actor', () => {
    renderWithProviders(
      <Terminal
        logs={[
          makeLog('Status → DEPLOYING', 'comms', 'CONTROL', 1000),
          makeLog('Status → IN_COMBAT', 'comms', 'CONTROL', 2000),
          makeLog('Status → MERGING', 'comms', 'CONTROL', 3000),
        ]}
      />,
    );
    // Each transition must render on its own row
    expect(screen.getByText(/DEPLOYING/)).toBeInTheDocument();
    expect(screen.getByText(/IN_COMBAT/)).toBeInTheDocument();
    expect(screen.getByText(/MERGING/)).toBeInTheDocument();
    // Three separate [CONTROL] labels
    expect(screen.getAllByText('[CONTROL]')).toHaveLength(3);
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run src/components/ui/__tests__/terminal.test.tsx`

Expected: The new test fails — `[CONTROL]` appears once because rows get coalesced.

- [ ] **Step 3: Remove the coalesce branch in Terminal**

Open `src/components/ui/terminal.tsx` and replace the body of `groupLogs` (currently lines 52-87) with:

```typescript
function groupLogs(logs: LogEntry[]): DisplayEntry[] {
  const result: DisplayEntry[] = [];

  for (const entry of logs) {
    const prev = result[result.length - 1];
    const trimmed = entry.content.trim();
    const isToolCall = TOOL_PATTERN.test(trimmed);

    if (
      isToolCall &&
      prev &&
      prev.content.trim() === trimmed &&
      prev.type === entry.type &&
      prev.actor === entry.actor
    ) {
      // Collapse repeated identical tool calls — tight retry loops become "(N)"
      prev.count++;
      prev.timestamp = entry.timestamp;
    } else {
      result.push({ ...entry, count: 1 });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the Terminal tests and verify they pass**

Run: `pnpm vitest run src/components/ui/__tests__/terminal.test.tsx`

Expected: all tests pass (including the new one and the existing "collapses repeated identical tool calls").

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/terminal.tsx src/components/ui/__tests__/terminal.test.tsx
git commit -m "fix(terminal): stop coalescing same-actor comms into one line"
```

---

## Task 5: Emit `Merging worktree…` milestone

**Files:**
- Modify: `src/control/mission-runner.ts` (around line 808-813)

- [ ] **Step 1: Add the comm before the merge call**

In `src/control/mission-runner.ts`, find the merge site (currently line 808-813):

```typescript
    // Gates pass → MERGING.
    transitionMission(missionId, 'merging', deps.now());

    let merge: MergeResult;
    try {
      merge = await deps.mergeFn({
```

Replace with:

```typescript
    // Gates pass → MERGING.
    transitionMission(missionId, 'merging', deps.now());
    emitComm({ missionId, message: 'Merging worktree…' });

    let merge: MergeResult;
    try {
      merge = await deps.mergeFn({
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`

Expected: build succeeds.

- [ ] **Step 3: Run control tests**

Run: `pnpm vitest run tests/control`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/control/mission-runner.ts
git commit -m "feat(comms): emit 'Merging worktree…' milestone"
```

---

## Task 6: Emit `Worktree cleaned.` and final mission beat

**Files:**
- Modify: `src/control/mission-runner.ts` (the `finally` block around lines 937-952, plus tracking `finalStatus`)

Context: every terminal `return` in `runCombat` follows a `transitionMission(missionId, '<terminal>', ...)` call. The `finally` block runs after the `return`; it currently only `console.error`s cleanup failures. We want the sequence:

```
Status → ACCOMPLISHED
Worktree cleaned.
Mission accomplished.
```

Approach: track the most recent terminal status via a local variable updated by a small wrapper, then emit the final beat in the `finally` after cleanup.

- [ ] **Step 1: Add a `finalStatus` tracker and wrapper near the top of `runCombat`**

In `src/control/mission-runner.ts`, locate the start of the `runCombat` function (find the line `async function runCombat(` or similar — the function that contains the `try { ... } finally { ... }` around lines 937-952). Just after the opening `try {` that wraps the main body, add:

```typescript
    let finalStatus: 'accomplished' | 'compromised' | 'abandoned' | null = null;
    const markTerminal = (
      status: 'accomplished' | 'compromised' | 'abandoned',
      now: number,
    ): void => {
      finalStatus = status;
      transitionMission(missionId, status, now);
    };
```

- [ ] **Step 2: Replace terminal `transitionMission` calls with `markTerminal`**

In the same function, find every `transitionMission(missionId, 'accomplished', ...)`, `transitionMission(missionId, 'compromised', ...)`, and `transitionMission(missionId, 'abandoned', ...)` call inside `runCombat` and replace with `markTerminal('<status>', <now>)`.

Use grep to find them:

Run: `grep -n "transitionMission(missionId, 'accomplished'\|transitionMission(missionId, 'compromised'\|transitionMission(missionId, 'abandoned'" src/control/mission-runner.ts`

Replace each match. Leave non-terminal transitions (`'deploying'`, `'in_combat'`, `'merging'`) untouched — they use `transitionMission` as before.

- [ ] **Step 3: Update the `finally` block**

Find the `finally` block (currently around lines 937-952):

```typescript
  } finally {
    // Best-effort worktree cleanup — never rethrow. The watchdog sweep
    // handles any leaks this misses.
    try {
      // Keep the branch for Commander inspection — the worktree directory is
      // what leaks onto disk. Watchdog sweep handles branch cleanup later.
      await deps.worktree.remove({
        repoPath: battlefield.repoPath,
        worktreePath,
        branch,
        deleteBranch: false,
      });
    } catch (err) {
      console.error('[CONTROL] worktree cleanup failed for', missionId, err);
    }
  }
```

Replace with:

```typescript
  } finally {
    // Best-effort worktree cleanup — never rethrow. The watchdog sweep
    // handles any leaks this misses.
    let cleanedOk = false;
    try {
      // Keep the branch for Commander inspection — the worktree directory is
      // what leaks onto disk. Watchdog sweep handles branch cleanup later.
      await deps.worktree.remove({
        repoPath: battlefield.repoPath,
        worktreePath,
        branch,
        deleteBranch: false,
      });
      cleanedOk = true;
    } catch (err) {
      console.error('[CONTROL] worktree cleanup failed for', missionId, err);
      emitComm({
        missionId,
        message: `Worktree cleanup failed: ${(err as Error).message}`,
        level: 'warn',
      });
    }
    if (cleanedOk) {
      emitComm({ missionId, message: 'Worktree cleaned.' });
    }
    if (finalStatus) {
      emitComm({ missionId, message: `Mission ${finalStatus}.` });
    }
  }
```

- [ ] **Step 4: Verify the build**

Run: `pnpm build`

Expected: build succeeds.

- [ ] **Step 5: Run control tests**

Run: `pnpm vitest run tests/control`

Expected: all tests pass. If any pre-existing test asserts the exact comm sequence, update it to include the new `Worktree cleaned.` + `Mission <status>.` beats.

- [ ] **Step 6: Commit**

```bash
git add src/control/mission-runner.ts
git commit -m "feat(comms): emit 'Worktree cleaned' and final mission beat"
```

---

## Task 7: End-to-end verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: all tests pass.

- [ ] **Step 2: Run `pnpm build`**

Run: `pnpm build`

Expected: build succeeds with no TS errors.

- [ ] **Step 3: Manual smoke test against live DEVROOM**

Run: `pnpm dev` in another terminal (or restart the devroom service).

Trigger a fresh short mission via the UI (a bootstrap-style mission like "add a no-op file to src/x.ts" is ideal). Open the mission detail page BEFORE the mission runs and watch COMMS live.

Verify you see, on separate rows with live timestamps:

- Multiple `[CONTROL] Status → …` rows (DEPLOYING, IN_COMBAT, MERGING, ACCOMPLISHED) — each its own line.
- Multiple `[OPERATIVE] …` rows interleaved — assistant text, `⚙ ToolName: …`, `✓ result: …`.
- A final `[CONTROL] Merging worktree…` row just before MERGING.
- A final `[CONTROL] Worktree cleaned.` row.
- A final `[CONTROL] Mission accomplished.` row.

If live streaming works but reload-after-finish shows the same rows from the DB (because `initialComms` is loaded server-side), the fix is fully landed.

- [ ] **Step 4: Commit any test updates from Task 6 Step 5 (if not already committed)**

If you had to update existing tests to accommodate the new milestones, make sure they're committed:

```bash
git status
# If there are staged test changes not yet committed:
git commit -m "test(control): update expected comm sequence for milestones"
```

---

## Notes for the implementer

- The spec lives at `docs/superpowers/specs/2026-04-17-comms-visibility-design.md`. Refer back if anything in this plan is ambiguous.
- `formatCommsEvent` must be tolerant of unknown part types inside `message.content[]` (skip them silently) — real Claude may emit `thinking` or other part types we don't model here.
- Do NOT change the socket payload shape, the `comms` schema, or Overseer wiring.
- The `grep` in Task 6 Step 2 is the most delicate edit — verify each replacement visually rather than blindly sed'ing, because `transitionMission` may appear inside comments or in call sites that take a variable for `status`.
