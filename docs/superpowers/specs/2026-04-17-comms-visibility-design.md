# COMMS Visibility Fix

**Date:** 2026-04-17
**Status:** Approved — ready for plan

## Problem

On mission detail pages, the COMMS stream shows only a single dense line of CONTROL status transitions:

```
10:05:01 [CONTROL] Status → DEPLOYING Status → IN_COMBAT Exit classified: CLEAN — success result event Status → MERGING Status → ACCOMPLISHED
```

Commander cannot see:
- Anything the OPERATIVE asset did (messages, thoughts, tool calls, tool results).
- That the worktree was cleaned.
- A final explicit "mission accomplished" beat from CONTROL.

Requirement: **one line per action**, live, with timestamps — agent messages, tool uses, tool results, plus CONTROL milestones (merge, worktree cleanup, final status).

## Root Causes

### RC1 — `formatCommsEvent` mis-parses real Claude stream-json

`src/control/comms.ts:21-50` matches against a flat event shape:

- `ev.type === 'assistant'` with top-level `ev.text`
- `ev.type === 'tool_use'` with top-level `ev.name` / `ev.input`
- `ev.type === 'tool_result'` with top-level `ev.content`

Real Claude Code stream-json nests content parts inside the message envelope:

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"…"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"…","name":"Bash","input":{…}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"…","content":"…","is_error":false}]}}
```

Every real OPERATIVE event falls through to `default: return null` and gets dropped. The existing test fixtures (`tests/control/fixtures/scenarios/*.json`) use the same fake flat shape, so tests pass while prod drops 100% of OPERATIVE activity.

### RC2 — `Terminal.groupLogs` coalesces same-actor lines

`src/components/ui/terminal.tsx:70-79` merges consecutive same-actor `comms`-type entries into a single row. This smashes CONTROL's distinct status transitions (each a separate DB row) into one visual line.

### RC3 — Missing CONTROL milestone comms

`src/control/mission-runner.ts` emits `Status → …` lines, but has no explicit comm for:
- "Merging worktree…" (only a status transition).
- "Worktree cleaned" (the `finally` block only `console.error`s on failure).
- "Mission accomplished / compromised / abandoned" — the terminal beat Commander needs to see.

## Solution

### 1. Fix `formatCommsEvent` to emit one line per content part

`formatCommsEvent` currently returns `string | null` (one message per event). Change the signature to **`string[]`** (zero or more messages per event), because a single `assistant` event can contain multiple content parts (e.g., a text part followed by a tool_use part).

Parsing rules:

- **`type: 'assistant'`** with `message.content[]`: iterate parts.
  - `part.type === 'text'` → push preview (trimmed, truncated at 400 chars).
  - `part.type === 'tool_use'` → push `⚙ <name>: <summary>` (reuse existing `summarizeToolInput`).
- **`type: 'user'`** with `message.content[]`: iterate parts.
  - `part.type === 'tool_result'` → push `✓ result: <preview>` (or `✗ result: …` when `is_error`).
- **Legacy flat shape** (top-level `ev.text`, `ev.name`, `ev.content`): keep existing behavior as a fallback so the scripted-claude test fixtures and recon paths still work.
- **`type: 'system' | 'stream_event' | 'result'`**: return `[]`.
- **Unknown**: return `[]`.

Update the caller in `mission-runner.ts:386-391` to iterate the returned array and `emitComm` each message separately. Same update in any other call site (grep for `formatCommsEvent`).

### 2. Remove same-actor coalesce in Terminal

Delete the "Coalesce consecutive text lines" branch in `src/components/ui/terminal.tsx:70-80`. Keep:

- The "Collapse repeated identical tool calls" branch — it's genuinely useful for tight tool-retry loops.
- Everything else.

Each comm row renders on its own line with its own timestamp.

### 3. Add CONTROL milestone comms

In `src/control/mission-runner.ts`:

- **Before merge** (just before `deps.merge.merge(...)`): `emitComm({ missionId, message: 'Merging worktree…' })`.
- **On success** (right before `transitionMission(..., 'accomplished', ...)`): no new comm needed — the `Mission accomplished.` final beat below covers it.
- **In `finally` cleanup** (after `deps.worktree.remove` succeeds): `emitComm({ missionId, message: 'Worktree cleaned.' })`.
- **Final beat** before each `return`: `emitComm({ missionId, message: 'Mission <status>.' })` for accomplished / compromised / abandoned terminal returns.

Status-transition comms (`Status → …`) stay — they are useful and now render as individual lines.

### 4. Regression test with real shape

Add `tests/control/unit/comms.format.test.ts` covering:

- `assistant` with nested `message.content[]` containing text → one message.
- `assistant` with `message.content[]` containing a `tool_use` part → one `⚙ Name: …` message.
- `assistant` with `message.content[]` containing **both** text and tool_use → two messages, in order.
- `user` with `message.content[]` containing `tool_result` → one `✓ result: …` message.
- `user` with `tool_result` where `is_error: true` → `✗ result: …`.
- Legacy flat `{type:'assistant', text:'...'}` → one message (back-compat).
- `system` / `stream_event` / `result` → empty array.

## Non-Goals

- No changes to the `comms` table schema.
- No changes to socket event names or payloads.
- No Overseer / gate-failure comm changes.
- No changes to recon or bootstrap comms wiring (they don't use `formatCommsEvent`).

## Files Touched

- `src/control/comms.ts` — rewrite `formatCommsEvent` signature and body.
- `src/control/mission-runner.ts` — update call site + add milestone comms.
- `src/components/ui/terminal.tsx` — remove same-actor coalesce branch.
- `tests/control/unit/comms.format.test.ts` — new test file.
- `src/components/ui/__tests__/terminal.test.tsx` — update/remove tests asserting coalesce behavior.

## Acceptance

On a successful mission, the COMMS panel shows (one row per line, each with its own timestamp):

```
10:05:01 [CONTROL] Status → DEPLOYING
10:05:02 [CONTROL] Status → IN_COMBAT
10:05:03 [OPERATIVE] I'll add the health route now.
10:05:04 [OPERATIVE] ⚙ Read: src/app/api/health/route.ts
10:05:04 [OPERATIVE] ✓ result: (file contents)
10:05:05 [OPERATIVE] ⚙ Edit: src/app/api/health/route.ts
10:05:05 [OPERATIVE] ✓ result
10:05:06 [CONTROL] Exit classified: CLEAN — success
10:05:06 [CONTROL] Status → MERGING
10:05:07 [CONTROL] Merging worktree…
10:05:08 [CONTROL] Status → ACCOMPLISHED
10:05:08 [CONTROL] Worktree cleaned.
10:05:08 [CONTROL] Mission accomplished.
```
