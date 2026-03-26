# Phase B2a: Orchestrator + Execution — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** B2a (Orchestrator + Execution, no worktrees)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase B1 (Battlefields + Mission CRUD) — complete

---

## Overview

Phase B2a adds the mission execution engine: an event-driven orchestrator that spawns Claude Code processes when missions are queued, streams their output in real-time to the browser, tracks token usage and costs, generates debriefs, and handles rate limits with exponential backoff. All missions run on the repo root (no worktrees). Worktrees and session reuse come in B2b.

---

## 1. Prompt Builder

**File:** `src/lib/orchestrator/prompt-builder.ts`

**Function:** `buildPrompt(mission, battlefield, asset?): string`

Assembles the full prompt for Claude Code, structured for Anthropic API cache optimization (static at top, dynamic at bottom).

### Prompt Structure

```
{BATTLEFIELD_CLAUDE_MD}                    ← STATIC (cached across missions)
---
{ASSET_SYSTEM_PROMPT}                      ← SEMI-STATIC (cached per asset)
---
## Mission Briefing

**Mission**: {title}
**Battlefield**: {codename}
**Priority**: {priority}

{briefing}                                 ← DYNAMIC (unique per mission)
---
## Operational Parameters

- Execute the task described above.
- Commit with clear, descriptive messages.
- Upon completion, provide a debrief addressed to the Commander:
  what was done, what changed, risks, and recommended next actions.
```

### CLAUDE.md Loading

- If `battlefield.claudeMdPath` is set and file exists on disk: read via `fs.readFileSync(path, 'utf-8')`
- If file doesn't exist or path not set: omit that section
- Only CLAUDE.md goes in the prompt (not SPEC.md)

### Asset System Prompt

- If mission has `assetId`: query asset from DB, use `asset.systemPrompt`
- If no asset assigned: omit that section

Pure function, no side effects. Inputs: mission record, battlefield record, optional asset record. Output: string.

---

## 2. Stream-JSON Parser

**File:** `src/lib/orchestrator/stream-parser.ts`

Parses line-by-line JSON output from Claude Code's `--output-format stream-json --include-partial-messages` format.

### Event Emitter Interface

```typescript
interface StreamParser {
  onDelta(cb: (text: string) => void): void;
  onAssistantTurn(cb: (content: string) => void): void;
  onToolUse(cb: (tool: string, input: unknown) => void): void;
  onToolResult(cb: (toolId: string, result: string, isError: boolean) => void): void;
  onError(cb: (error: string) => void): void;
  onResult(cb: (result: StreamResult) => void): void;
  onRateLimit(cb: (info: RateLimitInfo) => void): void;
  onTokens(cb: (usage: TokenUsage) => void): void;
  feed(line: string): void;
}
```

### Types

```typescript
interface StreamResult {
  sessionId: string;
  result: string;           // final text output (debrief content)
  isError: boolean;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

interface RateLimitInfo {
  status: string;           // 'allowed' | 'rate_limited' | etc.
  resetsAt: number;         // unix timestamp
  rateLimitType: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}
```

### Parsing Logic (per JSON line)

| Message type | Action |
|-------------|--------|
| `system` (subtype: `init`) | Capture `session_id` |
| `stream_event` (`content_block_delta` with `text_delta`) | Emit `onDelta(text)` |
| `stream_event` (`message_start` or `message_delta` with usage) | Emit `onTokens(usage)` |
| `assistant` (content has `type: "text"`) | Aggregate text blocks, emit `onAssistantTurn(fullText)` |
| `assistant` (content has `type: "tool_use"`) | Emit `onToolUse(name, input)` |
| `user` (content has `type: "tool_result"`) | Emit `onToolResult(toolId, content, isError)` |
| `rate_limit_event` | Emit `onRateLimit(info)` |
| `result` | Map to `StreamResult`, emit `onResult` |
| Other types (`system` hooks, etc.) | Ignore |

### Deduplication

Multiple `assistant` messages may be emitted for the same API message ID as content blocks accumulate. Track the last seen `message.id` and only emit `onAssistantTurn` for new text content (compare content array length).

---

## 3. Executor

**File:** `src/lib/orchestrator/executor.ts`

Spawns a Claude Code process for a mission and manages its full lifecycle.

### Function

```typescript
async function executeMission(
  mission: Mission,
  io: SocketIOServer,
  abortController: AbortController
): Promise<void>
```

### Execution Flow

**Step 1 — DEPLOYING:**
- Update mission status to `deploying` in DB
- Emit `mission:status` to `mission:{id}` Socket.IO room
- Emit `activity:event` to `hq:activity`

**Step 2 — Build prompt:**
- Query battlefield from DB
- Query asset from DB (if `assetId` set)
- Call `buildPrompt(mission, battlefield, asset)`

**Step 3 — Spawn Claude Code:**

```typescript
const proc = spawn(config.claudePath, [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
  '--max-turns', '50',
  ...(mission.sessionId ? ['--session-id', mission.sessionId] : []),
  '--prompt', fullPrompt,
], {
  cwd: battlefield.repoPath,
  signal: abortController.signal,
});
```

**Step 4 — IN COMBAT:**
- Update mission status to `in_combat`, set `startedAt = Date.now()`
- Emit `mission:status`

**Step 5 — Stream stdout through parser:**

Create a `StreamParser` instance. Read `proc.stdout` line by line.

| Parser event | Action |
|-------------|--------|
| `onDelta(text)` | Emit `mission:log` to Socket.IO: `{ missionId, timestamp, type: 'log', content: text }` |
| `onAssistantTurn(content)` | Store in `missionLogs` table: `{ type: 'log', content }` |
| `onToolUse(tool, input)` | Store in `missionLogs`: `{ type: 'log', content: 'Tool: {tool}' }`. Emit `mission:log`. |
| `onToolResult(id, result, isError)` | If `isError`: store in `missionLogs` as `{ type: 'error' }` |
| `onTokens(usage)` | Emit `mission:tokens` to Socket.IO: `{ missionId, input, output, cacheHit, cacheCreation }` |
| `onError(error)` | Store in `missionLogs`: `{ type: 'error', content: error }` |
| `onRateLimit(info)` | If `info.status !== 'allowed'`: throw `RateLimitError` (caught by orchestrator) |
| `onResult(result)` | Capture for final processing |

**Step 6 — Process close (normal completion):**

Extract `StreamResult` from parser's `onResult` callback.

Update mission in DB:
- `sessionId` = `result.sessionId`
- `debrief` = `result.result` (the final text output — Commander-addressed debrief)
- `costInput` = `result.usage.inputTokens`
- `costOutput` = `result.usage.outputTokens`
- `costCacheHit` = `result.usage.cacheReadTokens`
- `durationMs` = `result.durationMs`
- `iterations` = `result.numTurns`
- `status` = `result.isError ? 'compromised' : 'accomplished'`
- `completedAt` = `Date.now()`

Emit to Socket.IO:
- `mission:status` with final status
- `mission:debrief` with `{ missionId, debrief }`
- `mission:tokens` with final token counts
- `activity:event` to `hq:activity`

**Step 7 — Process error (spawn failure, abort):**

- Status → `compromised` (or `abandoned` if abort signal)
- Store error message in debrief
- `completedAt = Date.now()`
- Emit `mission:status` and `activity:event`

### Stderr Handling

Capture `proc.stderr` and append to mission logs as `type: 'error'`. Claude Code may emit warnings or errors to stderr that are not in the JSON stream.

---

## 4. Orchestrator Engine

**File:** `src/lib/orchestrator/orchestrator.ts`

Event-driven singleton managing mission execution lifecycle.

### Class Design

```typescript
class Orchestrator {
  private activeJobs: Map<string, AbortController>;
  private retryCount: Map<string, number>;
  private io: SocketIOServer;
  private maxAgents: number;

  constructor(io: SocketIOServer);

  // Called by createAndDeployMission Server Action
  async onMissionQueued(missionId: string): Promise<void>;

  // Called by abandonMission Server Action
  async onMissionAbort(missionId: string): Promise<void>;

  // Called internally after mission completes to drain queue
  private async drainQueue(): Promise<void>;

  // Get current state
  getActiveCount(): number;
  isExecuting(missionId: string): boolean;
}
```

### `onMissionQueued(missionId)`

1. If `activeJobs.size >= maxAgents`: mission stays `queued` in DB. It will be picked up by `drainQueue()` when a slot opens. Return.
2. Create `AbortController`, add to `activeJobs`.
3. Call `executeMission(mission, io, ac)` with `.then/.catch/.finally`:
   - `.catch(RateLimitError)`: handle rate limit (see §6)
   - `.catch(other)`: log error, ensure mission is `compromised`
   - `.finally()`: remove from `activeJobs`, call `drainQueue()`

### `drainQueue()`

Called after any mission completes (in the `finally` block).

1. Calculate available slots: `maxAgents - activeJobs.size`
2. If no slots: return
3. Query DB: `SELECT * FROM missions WHERE status = 'queued' ORDER BY priority CASE, createdAt ASC LIMIT {slots}`
4. For each: call `onMissionQueued(mission.id)`

### `onMissionAbort(missionId)`

1. If `activeJobs.has(missionId)`: get AbortController, call `.abort()`
2. The executor's error handler catches the abort and sets status to `abandoned`

### Integration Points

**`server.ts`:**
```typescript
import { Orchestrator } from './src/lib/orchestrator/orchestrator';

declare global {
  var orchestrator: Orchestrator | undefined;
}

// After Socket.IO setup:
const orchestrator = new Orchestrator(io);
globalThis.orchestrator = orchestrator;
```

**`src/actions/mission.ts` — `createAndDeployMission`:**
Add after insert: `globalThis.orchestrator?.onMissionQueued(mission.id)`

**`src/actions/mission.ts` — `abandonMission`:**
- Extend to allow `in_combat` status (not just `standby`/`queued`)
- If `in_combat`: call `globalThis.orchestrator?.onMissionAbort(id)`
- If `standby`/`queued`: update status directly (existing behavior)

---

## 5. Mission Comms (Live UI)

### New Hook: `src/hooks/use-mission-comms.ts`

```typescript
function useMissionComms(missionId: string, initialLogs: MissionLog[]): {
  logs: MissionLog[];
  status: MissionStatus | null;
  debrief: string | null;
  tokens: { input: number; output: number; cacheHit: number; costUsd: number } | null;
}
```

- Subscribes to `mission:{id}` Socket.IO room on mount
- Listens for `mission:log`, `mission:status`, `mission:debrief`, `mission:tokens`
- Merges live events with `initialLogs`
- Returns reactive state
- Unsubscribes on unmount

### New Component: `src/components/mission/mission-comms.tsx`

Client Component that wraps the live mission experience.

**Props:** `missionId: string`, `initialLogs: MissionLog[]`, `initialStatus: string`, `initialTokens: { ... }`, `initialDebrief: string | null`

**Renders:**
- Status badge (updates live)
- Terminal component with growing logs (live deltas stream in)
- Token stats card (updates live after each turn)
- Debrief section (appears when mission completes)

### Modify: Mission Detail Page

`src/app/projects/[id]/missions/[missionId]/page.tsx`:

The Server Component queries initial data and passes to `MissionComms` client component:
- Query mission logs from `missionLogs` table
- Pass mission status, debrief, token data as initial values
- The client component takes over for real-time updates

### Socket.IO Events (emitted by executor)

| Event | Payload | Room |
|-------|---------|------|
| `mission:log` | `{ missionId, timestamp, type, content }` | `mission:{missionId}` |
| `mission:status` | `{ missionId, status, timestamp }` | `mission:{missionId}` |
| `mission:debrief` | `{ missionId, debrief }` | `mission:{missionId}` |
| `mission:tokens` | `{ missionId, input, output, cacheHit, cacheCreation, costUsd }` | `mission:{missionId}` |
| `activity:event` | `{ type, battlefieldCodename, missionTitle, timestamp, detail }` | `hq:activity` |

---

## 6. Rate Limit Handling

Integrated into executor and orchestrator.

### Detection

The stream parser emits `onRateLimit` when a `rate_limit_event` JSON line has `status !== 'allowed'`. The executor throws a `RateLimitError` containing the reset timestamp.

Additionally, if the Claude Code process exits with rate-limit content in the result (e.g., `result.is_error === true` with rate limit text), this is also treated as a rate limit.

### Custom Error

```typescript
class RateLimitError extends Error {
  resetsAt: number;
  rateLimitType: string;
}
```

### Orchestrator Handling

The orchestrator's `onMissionQueued` catch block handles `RateLimitError`:

1. Increment `retryCount` map for this mission ID
2. If retries < 5:
   - Set mission status back to `queued` in DB
   - Store `missionLog` entry: "Rate limited. Retry {n}/5 in {delay}s"
   - Emit `mission:status` (queued) and `mission:log` (rate limit notice)
   - `setTimeout(() => this.onMissionQueued(missionId), delay)`
3. If retries >= 5:
   - Set mission status to `compromised`
   - Debrief: "Mission compromised: rate limit exceeded after 5 retries"
   - Emit `mission:status` and `mission:debrief`

### Backoff Schedule

| Retry | Delay |
|-------|-------|
| 1 | 60s |
| 2 | 120s |
| 3 | 240s |
| 4 | 480s |
| 5 | 960s |
| 6+ | compromised |

Formula: `60 * 2^(retry - 1)` seconds.

### In-Memory State

`Map<string, number>` on the Orchestrator. Lost on server restart — acceptable since no startup sweep. If the server restarts during backoff, the mission stays `queued` in DB but won't be picked up (by design — Commander can manually redeploy).

---

## 7. Modified Server Actions

### `createAndDeployMission` (in `src/actions/mission.ts`)

After creating the mission with status `queued`, add:
```typescript
globalThis.orchestrator?.onMissionQueued(mission.id);
```

### `abandonMission` (in `src/actions/mission.ts`)

Extend status validation:
- **`standby` or `queued`**: update status directly to `abandoned` (existing behavior)
- **`in_combat`**: call `globalThis.orchestrator?.onMissionAbort(id)`, then update status to `abandoned`
- **Other statuses**: throw error (can't abandon completed/compromised missions)

---

## 8. Modified `server.ts`

Add orchestrator creation after Socket.IO setup:

```typescript
import { Orchestrator } from './src/lib/orchestrator/orchestrator';

declare global {
  var orchestrator: Orchestrator | undefined;
}

// After setupSocketIO(io):
const orchestrator = new Orchestrator(io);
globalThis.orchestrator = orchestrator;
console.log(`[DEVROOM] Orchestrator online — ${config.maxAgents} agent slots`);
```

Update graceful shutdown to abort all active missions:
```typescript
// In shutdown handler, before closing Socket.IO:
for (const [missionId, ac] of orchestrator.activeJobs) {
  ac.abort();
  // Update mission status to abandoned with shutdown note
}
```

Update startup banner agent count to reflect orchestrator state.

---

## 9. New Types

**Added to `src/types/index.ts`:**

```typescript
// Stream parser types
export interface StreamResult {
  sessionId: string;
  result: string;
  isError: boolean;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

export interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Rate limit error
// (Defined in executor, not types — it's an implementation detail)
```

---

## 10. What Is NOT Built in Phase B2a

- Git worktree management (create/merge/cleanup) — Phase B2b
- Session reuse / Continue Mission / Redeploy — Phase B2b
- Conflict resolution (spawn Claude for merge conflicts) — Phase B2b
- Bootstrap flow (CLAUDE.md/SPEC.md generation) — Phase B3
- Campaign execution (multi-phase orchestration) — Phase C
- Phase debrief generation — Phase C
- Image paste in briefing textarea — deferred (tracked in memory)
- Startup sweep of queued missions — deferred by design choice

---

## 11. End State

After Phase B2a is complete:
1. Commander deploys a mission → orchestrator picks it up immediately (event-driven)
2. Claude Code spawns with correct prompt (CLAUDE.md + asset + briefing)
3. Mission terminal streams token-by-token in real-time via Socket.IO
4. Status transitions visible live: QUEUED → DEPLOYING → IN COMBAT → ACCOMPLISHED/COMPROMISED
5. Token usage and costs update after each turn
6. Debrief appears on completion (extracted from Claude's final output)
7. Mission logs stored for later review (turn-level, not delta-level)
8. Rate limits handled gracefully with exponential backoff (up to 5 retries)
9. Commander can abort in-combat missions via ABANDON button
10. Graceful server shutdown aborts all running missions
11. Concurrency controlled by `DEVROOM_MAX_AGENTS` (default 5)
12. Session IDs captured for future B2b session reuse
