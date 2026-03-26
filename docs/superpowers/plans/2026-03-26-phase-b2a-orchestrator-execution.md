# Phase B2a: Orchestrator + Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable missions to actually execute by spawning Claude Code processes, streaming output in real-time to the browser, and handling the full lifecycle from queue to debrief.

**Architecture:** Event-driven orchestrator singleton on `globalThis`. Executor spawns Claude Code CLI with `--output-format stream-json --include-partial-messages`. Stream parser emits typed events. Socket.IO streams deltas to mission rooms. Prompt builder assembles CLAUDE.md + asset + briefing for cache optimization.

**Tech Stack:** Claude Code CLI, child_process.spawn, Socket.IO, Drizzle ORM, Node.js readline

**Spec:** `docs/superpowers/specs/2026-03-26-phase-b2a-orchestrator-execution-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Types:**
- `src/types/index.ts` (modified — add stream parser and orchestrator types)

**Task 2 — Prompt Builder:**
- `src/lib/orchestrator/prompt-builder.ts`

**Task 3 — Stream Parser:**
- `src/lib/orchestrator/stream-parser.ts`

**Task 4 — Executor:**
- `src/lib/orchestrator/executor.ts`

**Task 5 — Orchestrator Engine:**
- `src/lib/orchestrator/orchestrator.ts`

**Task 6 — Server Integration:**
- `server.ts` (modified — add orchestrator init + shutdown)
- `src/actions/mission.ts` (modified — wire orchestrator calls)

**Task 7 — Mission Comms Hook:**
- `src/hooks/use-mission-comms.ts`

**Task 8 — Mission Comms UI:**
- `src/components/mission/mission-comms.tsx`
- `src/app/projects/[id]/missions/[missionId]/page.tsx` (modified)
- `src/components/mission/mission-actions.tsx` (modified)

**Task 9 — Integration Test:**
- Various fixes, final commit

---

## Task 1: Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add B2a types**

Append to `src/types/index.ts`:

```typescript
// === Phase B2a: Orchestrator + Execution Types ===

// Stream parser result (final message from Claude Code)
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

// Rate limit info from stream
export interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
}

// Per-turn token usage
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Live token data for Socket.IO
export interface LiveTokenData {
  missionId: string;
  input: number;
  output: number;
  cacheHit: number;
  cacheCreation: number;
  costUsd: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add B2a orchestrator and stream parser types"
```

---

## Task 2: Prompt Builder

**Files:**
- Create: `src/lib/orchestrator/prompt-builder.ts`

- [ ] **Step 1: Create prompt builder**

Create `src/lib/orchestrator/prompt-builder.ts`:

```typescript
import fs from 'fs';
import type { Mission, Battlefield, Asset } from '@/types';

export function buildPrompt(
  mission: Mission,
  battlefield: Battlefield,
  asset: Asset | null,
): string {
  const sections: string[] = [];

  // 1. CLAUDE.md from disk (STATIC — cached across missions)
  if (battlefield.claudeMdPath) {
    try {
      const claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      sections.push(claudeMd);
    } catch {
      // File doesn't exist or can't be read — skip
    }
  }

  // 2. Asset system prompt (SEMI-STATIC — cached per asset)
  if (asset?.systemPrompt) {
    sections.push(asset.systemPrompt);
  }

  // 3. Mission briefing (DYNAMIC — unique per mission)
  const briefingSection = [
    '## Mission Briefing',
    '',
    `**Mission**: ${mission.title}`,
    `**Battlefield**: ${battlefield.codename}`,
    `**Priority**: ${mission.priority || 'normal'}`,
    '',
    mission.briefing,
  ].join('\n');
  sections.push(briefingSection);

  // 4. Operational parameters (STATIC suffix)
  const parameters = [
    '## Operational Parameters',
    '',
    '- Execute the task described above.',
    '- Commit with clear, descriptive messages.',
    '- Upon completion, provide a debrief addressed to the Commander:',
    '  what was done, what changed, risks, and recommended next actions.',
  ].join('\n');
  sections.push(parameters);

  return sections.join('\n\n---\n\n');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/prompt-builder.ts
git commit -m "feat: add prompt builder with CLAUDE.md and asset system prompt support"
```

---

## Task 3: Stream Parser

**Files:**
- Create: `src/lib/orchestrator/stream-parser.ts`

- [ ] **Step 1: Create stream parser**

Create `src/lib/orchestrator/stream-parser.ts`. This is the most complex file in B2a — it parses Claude Code's `stream-json` output format.

**Design:** Class with callback registration and a `feed(line)` method.

```typescript
import type { StreamResult, RateLimitInfo, TokenUsage } from '@/types';

type DeltaCallback = (text: string) => void;
type AssistantTurnCallback = (content: string) => void;
type ToolUseCallback = (tool: string, input: unknown) => void;
type ToolResultCallback = (toolId: string, result: string, isError: boolean) => void;
type ErrorCallback = (error: string) => void;
type ResultCallback = (result: StreamResult) => void;
type RateLimitCallback = (info: RateLimitInfo) => void;
type TokensCallback = (usage: TokenUsage) => void;

export class StreamParser {
  private deltaCallbacks: DeltaCallback[] = [];
  private assistantTurnCallbacks: AssistantTurnCallback[] = [];
  private toolUseCallbacks: ToolUseCallback[] = [];
  private toolResultCallbacks: ToolResultCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private resultCallbacks: ResultCallback[] = [];
  private rateLimitCallbacks: RateLimitCallback[] = [];
  private tokensCallbacks: TokensCallback[] = [];

  private sessionId: string | null = null;
  private lastAssistantMessageId: string | null = null;
  private lastAssistantTextLength = 0;

  onDelta(cb: DeltaCallback) { this.deltaCallbacks.push(cb); }
  onAssistantTurn(cb: AssistantTurnCallback) { this.assistantTurnCallbacks.push(cb); }
  onToolUse(cb: ToolUseCallback) { this.toolUseCallbacks.push(cb); }
  onToolResult(cb: ToolResultCallback) { this.toolResultCallbacks.push(cb); }
  onError(cb: ErrorCallback) { this.errorCallbacks.push(cb); }
  onResult(cb: ResultCallback) { this.resultCallbacks.push(cb); }
  onRateLimit(cb: RateLimitCallback) { this.rateLimitCallbacks.push(cb); }
  onTokens(cb: TokensCallback) { this.tokensCallbacks.push(cb); }

  getSessionId(): string | null { return this.sessionId; }

  feed(line: string): void {
    // Parse each line independently
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // Skip non-JSON lines
    }

    const type = parsed.type;

    switch (type) {
      case 'system':
        this.handleSystem(parsed);
        break;
      case 'stream_event':
        this.handleStreamEvent(parsed);
        break;
      case 'assistant':
        this.handleAssistant(parsed);
        break;
      case 'user':
        this.handleUser(parsed);
        break;
      case 'rate_limit_event':
        this.handleRateLimit(parsed);
        break;
      case 'result':
        this.handleResult(parsed);
        break;
    }
  }

  private handleSystem(msg: any): void {
    if (msg.subtype === 'init') {
      this.sessionId = msg.session_id;
    }
  }

  private handleStreamEvent(msg: any): void {
    const event = msg.event;
    if (!event) return;

    // Content deltas for live streaming
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const text = event.delta.text;
      if (text) {
        this.deltaCallbacks.forEach(cb => cb(text));
      }
    }

    // Token usage from message_start or message_delta
    if (event.type === 'message_start' && event.message?.usage) {
      this.emitTokens(event.message.usage);
    }
    if (event.type === 'message_delta' && event.usage) {
      this.emitTokens(event.usage);
    }
  }

  private handleAssistant(msg: any): void {
    const message = msg.message;
    if (!message?.content) return;

    const messageId = message.id;

    // Check for text content
    const textBlocks = message.content.filter((b: any) => b.type === 'text');
    if (textBlocks.length > 0) {
      const fullText = textBlocks.map((b: any) => b.text).join('');

      // Deduplicate: only emit if this is new text
      if (messageId !== this.lastAssistantMessageId || fullText.length > this.lastAssistantTextLength) {
        this.lastAssistantMessageId = messageId;
        this.lastAssistantTextLength = fullText.length;
        this.assistantTurnCallbacks.forEach(cb => cb(fullText));
      }
    }

    // Check for tool use
    const toolBlocks = message.content.filter((b: any) => b.type === 'tool_use');
    for (const tool of toolBlocks) {
      this.toolUseCallbacks.forEach(cb => cb(tool.name, tool.input));
    }

    // Token usage per turn
    if (message.usage) {
      this.emitTokens(message.usage);
    }
  }

  private handleUser(msg: any): void {
    const content = msg.message?.content;
    if (!content) return;

    for (const block of content) {
      if (block.type === 'tool_result') {
        this.toolResultCallbacks.forEach(cb =>
          cb(block.tool_use_id, String(block.content || ''), !!block.is_error)
        );
      }
    }
  }

  private handleRateLimit(msg: any): void {
    const info = msg.rate_limit_info;
    if (info) {
      this.rateLimitCallbacks.forEach(cb => cb({
        status: info.status,
        resetsAt: info.resetsAt,
        rateLimitType: info.rateLimitType || info.rate_limit_type || '',
      }));
    }
  }

  private handleResult(msg: any): void {
    const result: StreamResult = {
      sessionId: msg.session_id || this.sessionId || '',
      result: msg.result || '',
      isError: !!msg.is_error,
      durationMs: msg.duration_ms || 0,
      durationApiMs: msg.duration_api_ms || 0,
      numTurns: msg.num_turns || 0,
      totalCostUsd: msg.total_cost_usd || 0,
      stopReason: msg.stop_reason || '',
      usage: {
        inputTokens: msg.usage?.input_tokens || 0,
        outputTokens: msg.usage?.output_tokens || 0,
        cacheCreationTokens: msg.usage?.cache_creation_input_tokens || 0,
        cacheReadTokens: msg.usage?.cache_read_input_tokens || 0,
      },
    };
    this.resultCallbacks.forEach(cb => cb(result));
  }

  private emitTokens(usage: any): void {
    if (!usage) return;
    const tokens: TokenUsage = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
    };
    this.tokensCallbacks.forEach(cb => cb(tokens));
  }
}
```

**Key decisions:**
- `any` is used for raw parsed JSON — this is unavoidable when parsing external CLI output with no type guarantees. Each handler extracts and validates the fields it needs.
- Deduplication: `assistant` messages may repeat with growing content arrays. Track `lastAssistantMessageId` and `lastAssistantTextLength` to avoid re-emitting the same text.
- Rate limit: emit to callbacks, let executor/orchestrator decide what to do.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/stream-parser.ts
git commit -m "feat: add Claude Code stream-json parser with delta streaming"
```

---

## Task 4: Executor

**Files:**
- Create: `src/lib/orchestrator/executor.ts`

- [ ] **Step 1: Create executor**

Create `src/lib/orchestrator/executor.ts`:

```typescript
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { eq } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { missions, missionLogs, battlefields, assets } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildPrompt } from './prompt-builder';
import { StreamParser } from './stream-parser';
import type { Mission, StreamResult } from '@/types';

export class RateLimitError extends Error {
  resetsAt: number;
  rateLimitType: string;

  constructor(message: string, resetsAt: number, rateLimitType: string) {
    super(message);
    this.name = 'RateLimitError';
    this.resetsAt = resetsAt;
    this.rateLimitType = rateLimitType;
  }
}

export async function executeMission(
  mission: Mission,
  io: SocketIOServer,
  abortController: AbortController,
): Promise<void> {
  const db = getDatabase();
  const room = `mission:${mission.id}`;
  let streamResult: StreamResult | null = null;
  let rateLimitDetected = false;
  let rateLimitInfo = { resetsAt: 0, rateLimitType: '' };

  // Helper: update mission in DB and emit status
  const updateStatus = (status: string, extra: Record<string, unknown> = {}) => {
    db.update(missions)
      .set({ status, updatedAt: Date.now(), ...extra })
      .where(eq(missions.id, mission.id))
      .run();
    io.to(room).emit('mission:status', { missionId: mission.id, status, timestamp: Date.now() });
  };

  // Helper: store a mission log
  const storeLog = (type: string, content: string) => {
    db.insert(missionLogs).values({
      id: generateId(),
      missionId: mission.id,
      timestamp: Date.now(),
      type,
      content,
    }).run();
  };

  // Helper: emit activity event
  const emitActivity = (type: string, detail: string) => {
    const bf = db.select({ codename: battlefields.codename })
      .from(battlefields)
      .where(eq(battlefields.id, mission.battlefieldId))
      .get();
    io.to('hq:activity').emit('activity:event', {
      type,
      battlefieldCodename: bf?.codename || 'UNKNOWN',
      missionTitle: mission.title,
      timestamp: Date.now(),
      detail,
    });
  };

  try {
    // Step 1: DEPLOYING
    updateStatus('deploying');
    emitActivity('mission:deploying', `Deploying mission: ${mission.title}`);

    // Step 2: Build prompt
    const battlefield = db.select().from(battlefields)
      .where(eq(battlefields.id, mission.battlefieldId)).get();
    if (!battlefield) throw new Error(`Battlefield not found: ${mission.battlefieldId}`);

    let asset = null;
    if (mission.assetId) {
      asset = db.select().from(assets)
        .where(eq(assets.id, mission.assetId)).get() || null;
    }

    const fullPrompt = buildPrompt(mission, battlefield, asset);

    // Step 3: Spawn Claude Code
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--max-turns', '50',
      ...(mission.sessionId ? ['--session-id', mission.sessionId] : []),
      '--prompt', fullPrompt,
    ];

    const proc = spawn(config.claudePath, args, {
      cwd: battlefield.repoPath,
      signal: abortController.signal,
    });

    // Step 4: IN COMBAT
    updateStatus('in_combat', { startedAt: Date.now() });
    emitActivity('mission:in_combat', `Mission in combat: ${mission.title}`);

    // Step 5: Parse stream
    const parser = new StreamParser();

    parser.onDelta((text) => {
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'log',
        content: text,
      });
    });

    parser.onAssistantTurn((content) => {
      storeLog('log', content);
    });

    parser.onToolUse((tool, _input) => {
      const msg = `Tool: ${tool}`;
      storeLog('log', msg);
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'log',
        content: msg + '\n',
      });
    });

    parser.onToolResult((_toolId, result, isError) => {
      if (isError) {
        storeLog('error', result);
      }
    });

    parser.onError((error) => {
      storeLog('error', error);
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'error',
        content: error,
      });
    });

    parser.onTokens((usage) => {
      io.to(room).emit('mission:tokens', {
        missionId: mission.id,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheHit: usage.cacheReadTokens,
        cacheCreation: usage.cacheCreationTokens,
        costUsd: 0, // Cost only available in final result
      });
    });

    parser.onRateLimit((info) => {
      if (info.status !== 'allowed') {
        rateLimitDetected = true;
        rateLimitInfo = { resetsAt: info.resetsAt, rateLimitType: info.rateLimitType };
      }
    });

    parser.onResult((result) => {
      streamResult = result;
    });

    // Read stdout line by line
    const rl = createInterface({ input: proc.stdout! });
    for await (const line of rl) {
      parser.feed(line);
    }

    // Capture stderr
    let stderrOutput = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    // Wait for process to fully close
    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1));
    });

    // Check for rate limit
    if (rateLimitDetected) {
      updateStatus('queued'); // Reset to queued for retry
      storeLog('status', `Rate limited (${rateLimitInfo.rateLimitType}). Awaiting retry.`);
      throw new RateLimitError(
        `Rate limited: ${rateLimitInfo.rateLimitType}`,
        rateLimitInfo.resetsAt,
        rateLimitInfo.rateLimitType,
      );
    }

    // Step 6: Process complete
    if (streamResult) {
      const r = streamResult;
      const finalStatus = r.isError ? 'compromised' : 'accomplished';

      db.update(missions).set({
        sessionId: r.sessionId,
        debrief: r.result,
        costInput: r.usage.inputTokens,
        costOutput: r.usage.outputTokens,
        costCacheHit: r.usage.cacheReadTokens,
        durationMs: r.durationMs,
        iterations: r.numTurns,
        status: finalStatus,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();

      io.to(room).emit('mission:status', {
        missionId: mission.id, status: finalStatus, timestamp: Date.now(),
      });
      io.to(room).emit('mission:debrief', {
        missionId: mission.id, debrief: r.result,
      });
      io.to(room).emit('mission:tokens', {
        missionId: mission.id,
        input: r.usage.inputTokens,
        output: r.usage.outputTokens,
        cacheHit: r.usage.cacheReadTokens,
        cacheCreation: r.usage.cacheCreationTokens,
        costUsd: r.totalCostUsd,
      });
      emitActivity(`mission:${finalStatus}`, `Mission ${finalStatus}: ${mission.title}`);

      // Update asset missions completed count
      if (mission.assetId && finalStatus === 'accomplished') {
        const currentAsset = db.select().from(assets)
          .where(eq(assets.id, mission.assetId)).get();
        if (currentAsset) {
          db.update(assets).set({
            missionsCompleted: (currentAsset.missionsCompleted || 0) + 1,
          }).where(eq(assets.id, mission.assetId)).run();
        }
      }
    } else {
      // No result message — process exited without proper completion
      updateStatus('compromised', {
        completedAt: Date.now(),
        debrief: `Process exited with code ${exitCode}. ${stderrOutput ? 'Stderr: ' + stderrOutput.slice(0, 500) : 'No output captured.'}`,
      });
      emitActivity('mission:compromised', `Mission compromised: ${mission.title}`);
    }

  } catch (err) {
    if (err instanceof RateLimitError) {
      throw err; // Re-throw for orchestrator to handle
    }

    // Determine if this was an abort (ABANDON)
    const isAbort = abortController.signal.aborted;
    const status = isAbort ? 'abandoned' : 'compromised';
    const errorMsg = err instanceof Error ? err.message : String(err);

    db.update(missions).set({
      status,
      completedAt: Date.now(),
      updatedAt: Date.now(),
      debrief: isAbort
        ? 'Mission abandoned by Commander.'
        : `Mission compromised: ${errorMsg}`,
    }).where(eq(missions.id, mission.id)).run();

    io.to(room).emit('mission:status', {
      missionId: mission.id, status, timestamp: Date.now(),
    });
    emitActivity(`mission:${status}`, `Mission ${status}: ${mission.title}`);

    if (!isAbort) {
      storeLog('error', errorMsg);
    }
  }
}
```

**IMPORTANT notes for the implementer:**
- The `for await (const line of rl)` loop reads stdout line by line. The readline interface ends when the process's stdout closes.
- stderr is captured separately via a data event handler — it may arrive after stdout closes, so we capture it in a string and include in error debriefs.
- The `RateLimitError` is re-thrown so the orchestrator can catch it and schedule retries.
- `any` type is used in the stream parser for raw JSON parsing — this is acceptable given the external CLI output.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "feat: add mission executor with Claude Code spawn and stream processing"
```

---

## Task 5: Orchestrator Engine

**Files:**
- Create: `src/lib/orchestrator/orchestrator.ts`

- [ ] **Step 1: Create orchestrator**

Create `src/lib/orchestrator/orchestrator.ts`:

```typescript
import { eq, sql, desc } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { missions } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { executeMission, RateLimitError } from './executor';
import type { Mission } from '@/types';

export class Orchestrator {
  public activeJobs: Map<string, AbortController> = new Map();
  private retryCount: Map<string, number> = new Map();
  private io: SocketIOServer;
  private maxAgents: number;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.maxAgents = config.maxAgents;
  }

  async onMissionQueued(missionId: string): Promise<void> {
    // Check capacity
    if (this.activeJobs.size >= this.maxAgents) {
      console.log(`[Orchestrator] All ${this.maxAgents} slots full. Mission ${missionId} stays queued.`);
      return;
    }

    // Get mission from DB
    const db = getDatabase();
    const mission = db.select().from(missions)
      .where(eq(missions.id, missionId)).get();

    if (!mission || mission.status !== 'queued') {
      console.log(`[Orchestrator] Mission ${missionId} not found or not queued. Skipping.`);
      return;
    }

    // Create abort controller and track
    const ac = new AbortController();
    this.activeJobs.set(missionId, ac);
    console.log(`[Orchestrator] Executing mission ${missionId} (${this.activeJobs.size}/${this.maxAgents} slots)`);

    // Execute (don't await — runs in background)
    executeMission(mission, this.io, ac)
      .catch((err) => {
        if (err instanceof RateLimitError) {
          this.handleRateLimit(missionId, err);
        } else {
          console.error(`[Orchestrator] Mission ${missionId} failed:`, err.message);
        }
      })
      .finally(() => {
        this.activeJobs.delete(missionId);
        console.log(`[Orchestrator] Mission ${missionId} done (${this.activeJobs.size}/${this.maxAgents} slots)`);
        this.drainQueue();
      });
  }

  async onMissionAbort(missionId: string): Promise<void> {
    const ac = this.activeJobs.get(missionId);
    if (ac) {
      console.log(`[Orchestrator] Aborting mission ${missionId}`);
      ac.abort();
    }
  }

  getActiveCount(): number {
    return this.activeJobs.size;
  }

  isExecuting(missionId: string): boolean {
    return this.activeJobs.has(missionId);
  }

  async shutdown(): Promise<void> {
    console.log(`[Orchestrator] Shutting down ${this.activeJobs.size} active missions...`);
    const db = getDatabase();

    for (const [missionId, ac] of this.activeJobs) {
      ac.abort();
      db.update(missions).set({
        status: 'abandoned',
        completedAt: Date.now(),
        updatedAt: Date.now(),
        debrief: 'Mission abandoned: DEVROOM server shutdown.',
      }).where(eq(missions.id, missionId)).run();
    }

    this.activeJobs.clear();
  }

  private async drainQueue(): Promise<void> {
    const slots = this.maxAgents - this.activeJobs.size;
    if (slots <= 0) return;

    const db = getDatabase();
    const queued = db.select().from(missions)
      .where(eq(missions.status, 'queued'))
      .orderBy(
        sql`CASE ${missions.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END`,
        missions.createdAt,
      )
      .limit(slots)
      .all();

    for (const mission of queued) {
      // Don't await — each mission runs independently
      this.onMissionQueued(mission.id);
    }
  }

  private handleRateLimit(missionId: string, err: RateLimitError): void {
    const retries = (this.retryCount.get(missionId) || 0) + 1;
    this.retryCount.set(missionId, retries);

    const db = getDatabase();

    if (retries > 5) {
      // Give up
      db.update(missions).set({
        status: 'compromised',
        completedAt: Date.now(),
        updatedAt: Date.now(),
        debrief: `Mission compromised: rate limit exceeded after 5 retries. Last limit type: ${err.rateLimitType}`,
      }).where(eq(missions.id, missionId)).run();

      this.io.to(`mission:${missionId}`).emit('mission:status', {
        missionId, status: 'compromised', timestamp: Date.now(),
      });
      this.retryCount.delete(missionId);
      console.log(`[Orchestrator] Mission ${missionId} compromised after 5 rate limit retries`);
      return;
    }

    // Exponential backoff: 60 * 2^(retry-1) seconds
    const delayMs = 60_000 * Math.pow(2, retries - 1);
    const delaySec = delayMs / 1000;

    console.log(`[Orchestrator] Mission ${missionId} rate limited. Retry ${retries}/5 in ${delaySec}s`);

    this.io.to(`mission:${missionId}`).emit('mission:log', {
      missionId,
      timestamp: Date.now(),
      type: 'status',
      content: `Rate limited. Retry ${retries}/5 in ${delaySec}s...\n`,
    });

    setTimeout(() => {
      this.onMissionQueued(missionId);
    }, delayMs);
  }
}
```

**Key details:**
- `activeJobs` is public so `server.ts` shutdown can iterate it (spec reviewer noted this)
- `drainQueue` is called in `finally` after each mission completes — picks up waiting queued missions
- Rate limit retries use `setTimeout` — fire-and-forget scheduling
- `shutdown()` method for graceful server termination

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/orchestrator.ts
git commit -m "feat: add event-driven orchestrator with rate limit handling"
```

---

## Task 6: Server Integration

**Files:**
- Modify: `server.ts`
- Modify: `src/actions/mission.ts`

- [ ] **Step 1: Add orchestrator to server.ts**

Read `server.ts`. After the Socket.IO setup (`setupSocketIO(io)` and `globalThis.io = io`), add:

```typescript
import { Orchestrator } from './src/lib/orchestrator/orchestrator';

declare global {
  var orchestrator: Orchestrator | undefined;
}

// After Socket.IO setup:
const orchestrator = new Orchestrator(io);
globalThis.orchestrator = orchestrator;
console.log(`[DEVROOM] Orchestrator online — ${config.maxAgents} agent slots`);
```

Combine the `global var io` and `global var orchestrator` declarations into one `declare global` block.

Update the shutdown handler to call `orchestrator.shutdown()` before closing Socket.IO:

```typescript
const shutdown = async () => {
  console.log('\n[DEVROOM] STANDING DOWN...');
  await orchestrator.shutdown();
  // ... existing io.close, closeDatabase, etc.
};
```

Update the startup banner to show orchestrator status.

- [ ] **Step 2: Wire orchestrator into mission actions**

Read `src/actions/mission.ts`. Make two changes:

**In `createAndDeployMission` (or the shared `_createMission` helper when status is `queued`):**
After inserting the mission, add:
```typescript
if (status === 'queued') {
  globalThis.orchestrator?.onMissionQueued(mission.id);
}
```

**In `abandonMission`:**
Extend to allow `in_combat` status. Change the validation from:
```typescript
if (current.status !== 'standby' && current.status !== 'queued') {
  throw new Error('...');
}
```
To:
```typescript
if (!['standby', 'queued', 'in_combat'].includes(current.status!)) {
  throw new Error('Can only abandon standby, queued, or in_combat missions');
}
```

And add abort logic:
```typescript
if (current.status === 'in_combat') {
  globalThis.orchestrator?.onMissionAbort(id);
  // The executor's abort handler will set the status — don't set it here
  return current as Mission; // Return current; status update happens async via executor
}
```

For `standby`/`queued`: keep existing behavior (direct status update).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Test basic execution**

Start `pnpm dev`. In the browser, create a mission with a simple briefing like "Create a file called test.txt with the content 'hello world'" and click SAVE & DEPLOY. Check:
- Server logs show orchestrator picking up the mission
- Mission status transitions visible in the DB
- Process spawns and completes

If `claude` CLI is not available in the test environment, this step can be skipped — verify in integration (Task 9).

- [ ] **Step 5: Commit**

```bash
git add server.ts src/actions/mission.ts
git commit -m "feat: integrate orchestrator with server and mission actions"
```

---

## Task 7: Mission Comms Hook

**Files:**
- Create: `src/hooks/use-mission-comms.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/use-mission-comms.ts`:

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { useSocket } from '@/hooks/use-socket';
import type { MissionLog, MissionStatus } from '@/types';

interface MissionTokens {
  input: number;
  output: number;
  cacheHit: number;
  cacheCreation: number;
  costUsd: number;
}

interface UseMissionCommsReturn {
  logs: MissionLog[];
  status: MissionStatus | null;
  debrief: string | null;
  tokens: MissionTokens | null;
}

export function useMissionComms(
  missionId: string,
  initialLogs: MissionLog[],
  initialStatus: string,
): UseMissionCommsReturn {
  const socket = useSocket();
  const [logs, setLogs] = useState<MissionLog[]>(initialLogs);
  const [status, setStatus] = useState<MissionStatus | null>(initialStatus as MissionStatus);
  const [debrief, setDebrief] = useState<string | null>(null);
  const [tokens, setTokens] = useState<MissionTokens | null>(null);
  const logIdCounter = useRef(0);

  useEffect(() => {
    if (!socket) return;

    socket.emit('mission:subscribe', missionId);

    const handleLog = (data: { missionId: string; timestamp: number; type: string; content: string }) => {
      if (data.missionId !== missionId) return;
      logIdCounter.current += 1;
      setLogs(prev => [...prev, {
        id: `live-${logIdCounter.current}`,
        missionId: data.missionId,
        timestamp: data.timestamp,
        type: data.type,
        content: data.content,
      }]);
    };

    const handleStatus = (data: { missionId: string; status: string }) => {
      if (data.missionId !== missionId) return;
      setStatus(data.status as MissionStatus);
    };

    const handleDebrief = (data: { missionId: string; debrief: string }) => {
      if (data.missionId !== missionId) return;
      setDebrief(data.debrief);
    };

    const handleTokens = (data: {
      missionId: string; input: number; output: number;
      cacheHit: number; cacheCreation: number; costUsd: number;
    }) => {
      if (data.missionId !== missionId) return;
      setTokens({
        input: data.input,
        output: data.output,
        cacheHit: data.cacheHit,
        cacheCreation: data.cacheCreation,
        costUsd: data.costUsd,
      });
    };

    socket.on('mission:log', handleLog);
    socket.on('mission:status', handleStatus);
    socket.on('mission:debrief', handleDebrief);
    socket.on('mission:tokens', handleTokens);

    return () => {
      socket.off('mission:log', handleLog);
      socket.off('mission:status', handleStatus);
      socket.off('mission:debrief', handleDebrief);
      socket.off('mission:tokens', handleTokens);
      socket.emit('mission:unsubscribe', missionId);
    };
  }, [socket, missionId]);

  return { logs, status, debrief, tokens };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-mission-comms.ts
git commit -m "feat: add useMissionComms hook for real-time mission updates"
```

---

## Task 8: Mission Comms UI

**Files:**
- Create: `src/components/mission/mission-comms.tsx`
- Modify: `src/app/projects/[id]/missions/[missionId]/page.tsx`
- Modify: `src/components/mission/mission-actions.tsx`

- [ ] **Step 1: Create MissionComms client component**

Create `src/components/mission/mission-comms.tsx` — Client Component:

Props:
```typescript
interface MissionCommsProps {
  missionId: string;
  initialLogs: MissionLog[];
  initialStatus: string;
  initialDebrief: string | null;
  initialTokens: {
    input: number;
    output: number;
    cacheHit: number;
    duration: number;
    costUsd?: number;
  };
  battlefieldId: string;
}
```

Uses `useMissionComms` hook. Renders:
1. **Status badge** — updates live when `status` changes
2. **Terminal** — shows `logs` array. For deltas, each log entry is a chunk of text. Auto-scrolls.
3. **Token stats** — card showing input, output, cache hit %, duration, cost. Updates live when `tokens` changes.
4. **Debrief** — appears when `debrief` is set (mission complete). Styled section with the Commander-addressed text.

When status changes to a terminal state (accomplished/compromised/abandoned), show a clear completion indicator and call `router.refresh()` to update the Server Component data.

- [ ] **Step 2: Update mission detail page**

Read `src/app/projects/[id]/missions/[missionId]/page.tsx`. Modify to:

1. Query mission logs from DB:
```typescript
const missionLogRows = db.select().from(missionLogs)
  .where(eq(missionLogs.missionId, missionId))
  .orderBy(missionLogs.timestamp)
  .all();
```

2. Replace the static Terminal/tokens/debrief sections with `<MissionComms>`:
```tsx
<MissionComms
  missionId={missionId}
  initialLogs={missionLogRows}
  initialStatus={mission.status}
  initialDebrief={mission.debrief}
  initialTokens={{
    input: mission.costInput,
    output: mission.costOutput,
    cacheHit: mission.costCacheHit,
    duration: mission.durationMs,
  }}
  battlefieldId={id}
/>
```

Keep the Server Component for the header and briefing sections. Only the comms/tokens/debrief/status are handled by the client component.

- [ ] **Step 3: Update MissionActions to support in_combat**

Read `src/components/mission/mission-actions.tsx`. Change the `canAbandon` check to include `in_combat`:

```typescript
const canAbandon = status === 'standby' || status === 'queued' || status === 'in_combat';
```

The component receives `status` as a prop. If the `MissionComms` component is tracking live status, pass the live status down or lift it to a shared parent. The simplest approach: `MissionComms` renders the `MissionActions` component internally and passes the live status.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/mission/ src/app/projects/[id]/missions/
git commit -m "feat: add live mission comms with real-time streaming and token updates"
```

---

## Task 9: Integration Verification

**Files:**
- Various fixes

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Build test**

```bash
pnpm build
```

- [ ] **Step 3: Full execution test**

Start `pnpm dev`. Test the complete flow:

1. Navigate to a battlefield
2. Type a simple briefing: "List all files in the current directory and tell me what you see"
3. Click SAVE & DEPLOY
4. Server logs should show: `[Orchestrator] Executing mission...`
5. Navigate to the mission detail page
6. Watch the live terminal — text should stream token-by-token
7. Status should transition: QUEUED → DEPLOYING → IN COMBAT → ACCOMPLISHED
8. Token stats should update during execution
9. Debrief should appear on completion
10. Stats bar on battlefield overview should update

If `claude` CLI is not available, test with a mock: temporarily replace the `spawn` call with a process that echoes valid `stream-json` output. Or test all non-execution paths (deploy form → queued status, abandon, etc.) and verify the orchestrator logs.

- [ ] **Step 4: Test abort (ABANDON in combat)**

1. Deploy a mission with a long briefing (something that takes > 30 seconds)
2. While IN COMBAT, click ABANDON
3. Verify: process killed, status → ABANDONED, debrief notes abandonment

- [ ] **Step 5: Test concurrency**

1. Deploy 2+ missions simultaneously (click SAVE & DEPLOY on multiple)
2. Verify: both execute (up to maxAgents), stats show 2 IN COMBAT
3. If more than maxAgents: extras stay QUEUED, drain when slots open

- [ ] **Step 6: Fix any issues**

Address bugs, TypeScript errors, styling issues.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase B2a — orchestrator and execution operational"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Prompt builder reads CLAUDE.md from disk when available
- [ ] Stream parser handles all message types (delta, assistant, tool, error, result, rate limit)
- [ ] Executor spawns Claude Code with correct flags
- [ ] Mission status transitions: QUEUED → DEPLOYING → IN COMBAT → ACCOMPLISHED/COMPROMISED
- [ ] Live terminal streams token-by-token via Socket.IO
- [ ] Mission logs stored in DB (turn-level, not delta-level)
- [ ] Token usage and cost tracked from result message
- [ ] Session ID captured from stream
- [ ] Debrief extracted from Claude's final output
- [ ] ABANDON works for in_combat missions (kills process)
- [ ] Orchestrator respects maxAgents concurrency limit
- [ ] Queue drains when slots open (event-driven, no polling)
- [ ] Rate limit → exponential backoff → retry up to 5 times
- [ ] Graceful shutdown aborts all active missions
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
