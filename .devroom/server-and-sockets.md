# Server, Sockets & Agent Runtime

## Claude Code Invocation

Mission execution spawns a Claude Code CLI process per mission. The spawn lifecycle is split across two modules:

- **`src/control/spawn-asset.ts`** — low-level subprocess launcher. Handles isolated HOME, stream-JSON parsing, `LivenessMonitor` attachment, and `AbortSignal` cancellation.
- **`src/control/mission-runner.ts`** — per-mission state machine. Drives DEPLOYING → IN_COMBAT → MERGING → ACCOMPLISHED / COMPROMISED, with retry logic, OVERSEER consult, and gate enforcement.

### Spawn Pattern

```typescript
// From src/control/spawn-asset.ts (simplified)
const homeDir = await ensureIsolatedHome(opts.missionId);
// /tmp/claude-config/{missionId}

const args = buildClaudeArgs({
  asset,
  rulesOfEngagement,
  outputFormat: 'stream-json',
  extraFlags: [],
});

const child = spawn('claude', args, {
  cwd: opts.worktreePath,
  env: { ...process.env, HOME: homeDir },
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Briefing is written to stdin and stdin is closed.
child.stdin.end(opts.briefing);
```

Key details:
- The mission briefing is passed via **stdin**, not as a positional argument.
- Each mission gets an isolated `HOME` at `/tmp/claude-config/{missionId}` to prevent concurrent config and credential collisions.
- `--model`, `--max-turns`, and `--effort` all come from the asset's DB row. There is no hardcoded fallback inside `spawnAsset` — the asset must be fully configured.
- Stream output is parsed line-by-line as newline-delimited JSON. Each valid `tool_use` event increments a counter; each `assistant`+`text` event updates `finalMessage`; `result` events capture `stdoutResultSubtype` and `usage`.
- **Stall detection (L3)**: `LivenessMonitor` fires after `stdoutSilenceMs` (default: 5 minutes) of stdout silence → SIGTERM → SIGKILL after 5 s. Sets `killedByControl = true`. No Overseer consultation on stall.
- **Hard timeout (L5)**: `LivenessMonitor` fires after `attemptHardTimeoutMs` (default: 30 minutes) regardless of activity → SIGTERM → SIGKILL after 5 s. Sets `killedByControl = true`.
- **`killedByControl`** in `AssetRunResult` tells the exit classifier to categorize the exit as TIMEOUT, triggering worktree reset + retry policy.
- Post-exit `git status --porcelain` probe populates `hasDiff` (skipped for one-shot `--print` invocations).

### Asset CLI Builder

`src/control/assets/cli-builder.ts` exports `buildClaudeArgs()`, which translates an `AssetDefinition` into CLI flags:

| Flag | Source |
|------|--------|
| `--print` | Always set |
| `--dangerously-skip-permissions` | Always set |
| `--model` | `asset.model` |
| `--max-turns` | `asset.maxTurns` |
| `--effort` | `asset.effort` |
| `--output-format` | `'stream-json'` (or `'print'` for one-shots) |
| `--verbose` | Added when `outputFormat === 'stream-json'` |
| `--append-system-prompt` | `asset.systemPrompt` (prefixed with RoE for non-system assets) |
| `--plugin-dir` (per skill) | `asset.skills` — format: `"skillname@publisher"`, resolved to `~/.claude/plugins/cache/{publisher}/{skillname}` |
| `--mcp-config` | `asset.mcpServers` JSON (skipped if empty) |

For **non-system assets**, the Rules of Engagement string is prepended to the system prompt before being passed to `--append-system-prompt`. System assets (`isSystem = 1`) receive their system prompt directly.

### System Asset Lookup

`src/control/production-deps.ts` provides ad-hoc asset lookups (no separate registry module). `getOverseerAsset()` queries the DB by codename and maps the row to `AssetDefinition`. `makeProductionSpawnAsset()` does the same for any combat asset by codename at spawn time. There is no in-process TTL cache in CONTROL — each spawn fetches the current asset row.

The **GENERAL engine** (`src/lib/general/general-engine.ts`) maintains its own 60-second TTL in-memory cache for system asset lookups, shared across sessions in that process.

### One-Shot Invocations

`spawnClaudeOneShot()` (also in `spawn-asset.ts`) is a thin wrapper used by OVERSEER classification (exit classifier fallback) and QUARTERMASTER conflict resolution. It forces `--print` output-format with a bounded `--max-turns`, parses the final assistant message as JSON, and throws on non-zero exit, subprocess kill, or unparsable output. Callers map failures to COMPROMISED.

### Debrief Extraction

After a mission exits, the debrief is extracted from the agent's output:
- **`src/control/debrief/parse.ts`** — extracts the `<DEBRIEF>...</DEBRIEF>` block from the final assistant message.
- **`src/control/debrief/synthesize.ts`** — fallback synthesizer when no DEBRIEF block is present.

---

## Prompt Cache Optimization

Prompt structure — static at top, dynamic at bottom — maximizes Anthropic prompt cache hit rate across retries.

Prompt builders live in `src/control/prompt-builder.ts` as pure `(input) => string` functions with no I/O:

| Builder | When used |
|---------|-----------|
| `buildStandardCombatPrompt` | Standalone mission (no campaign) |
| `buildCampaignCombatPrompt` | Campaign mission — adds `## Campaign Context` and `## Previous Phase Results` |
| `buildReconPrompt` | Recon mission — no worktree, read-only boundary warning |
| `buildDeterministicRetryPrompt` | Attempts 2–3 after gate failure — includes gate stderr |
| `buildOverseerRedirectPrompt` | Attempt 4+ with OVERSEER-authored redirect prompt |
| `buildOverseerClassificationPrompt` | Ambiguous exit → OVERSEER classification |
| `buildOverseerConsultPrompt` | Retry budget exhausted → OVERSEER consult |
| `buildQuartermasterPrompt` | Merge conflict → QUARTERMASTER resolution |
| `composeRulesOfEngagement` | Substitutes `{{GATE_MANIFEST}}` in RoE text at CLI-build time |

Prompt structure for a standard combat mission:

1. **TOP (static, cached)**: Battlefield CLAUDE.md content.
2. **MIDDLE (from `--append-system-prompt`, cached)**: Rules of Engagement + asset system prompt.
3. **MIDDLE (semi-dynamic, stdin)**: Campaign context — previous phase debriefs (campaign missions only).
4. **BOTTOM (dynamic, stdin)**: Mission briefing + workspace context + retry feedback (if retrying).

---

## Structured Comms Emission

`src/control/comms.ts` exports `emitComm()` — the structured log emitter used throughout CONTROL.

```typescript
emitComm({
  missionId?: string,
  campaignId?: string,
  battlefieldId?: string,
  actor?: string,   // defaults to 'CONTROL'
  message: string,
  level?: 'info' | 'warn' | 'error',
})
```

- Persists every comm event to the `comms` DB table with a ULID.
- If `missionId` is set, emits `mission:log` to `mission:{missionId}` room.
- If `campaignId` is set, emits `campaign:log` to `campaign:{campaignId}` room.
- Used for all status transitions, classification results, retry decisions, and error messages within CONTROL.

---

## Socket.IO

### Architecture

- Attached to custom `server.ts` via `setupSocketIO(io)` from `src/lib/socket/server.ts`.
- Global singleton: `globalThis.io` — accessible from server actions, route handlers, and CONTROL subsystems.

### Rooms

| Room | Scope | Description |
|------|-------|-------------|
| `system:status` | Global | System health metrics (CPU, RAM, disk, active agents) |
| `hq:activity` | Global | All activity events — mission/campaign/phase status changes |
| `mission:{id}` | Per mission | Mission logs, status, debrief, tokens |
| `campaign:{id}` | Per campaign | Campaign and phase status changes, mission status within campaign |
| `battlefield:{id}` | Per battlefield | All mission/campaign status changes within battlefield |
| `briefing:{campaignId}` | Per briefing session | Campaign planning chat with STRATEGIST asset |
| `general:{sessionId}` | Per GENERAL session | Standalone GENERAL chat streaming |
| `devserver:{battlefieldId}` | Per battlefield | Dev server log output |
| `console:{battlefieldId}` | Per battlefield | Command console output |
| `deps:{battlefieldId}` | Per battlefield | Dependency audit output |
| `tests:{battlefieldId}` | Per battlefield | Test runner output |
| `telemetry:{battlefieldId}` | Per battlefield | Telemetry / observability output |

### Client → Server Events

| Event | Payload | Action |
|-------|---------|--------|
| `system:subscribe` | — | Join `system:status`, starts metrics emitter |
| `system:unsubscribe` | — | Leave `system:status` |
| `mission:subscribe` | `id` | Join `mission:{id}` |
| `mission:unsubscribe` | `id` | Leave `mission:{id}` |
| `campaign:subscribe` | `campaignId` | Join `campaign:{campaignId}` |
| `campaign:unsubscribe` | `campaignId` | Leave `campaign:{campaignId}` |
| `battlefield:subscribe` | `battlefieldId` | Join `battlefield:{battlefieldId}` |
| `battlefield:unsubscribe` | `battlefieldId` | Leave `battlefield:{battlefieldId}` |
| `hq:subscribe` | — | Join `hq:activity` |
| `hq:unsubscribe` | — | Leave `hq:activity` |
| `briefing:subscribe` | `campaignId` | Join `briefing:{campaignId}` |
| `briefing:unsubscribe` | `campaignId` | Leave `briefing:{campaignId}` |
| `briefing:send` | `{ campaignId, message }` | Send message to briefing engine |
| `general:subscribe` | `sessionId` | Join `general:{sessionId}` |
| `general:unsubscribe` | `sessionId` | Leave `general:{sessionId}` |
| `general:send` | `{ sessionId, message }` | Send message to GENERAL engine |
| `devserver:subscribe` | `battlefieldId` | Join `devserver:{battlefieldId}` |
| `devserver:unsubscribe` | `battlefieldId` | Leave `devserver:{battlefieldId}` |
| `console:subscribe` | `battlefieldId` | Join `console:{battlefieldId}` |
| `console:unsubscribe` | `battlefieldId` | Leave `console:{battlefieldId}` |
| `deps:subscribe` | `battlefieldId` | Join `deps:{battlefieldId}` |
| `deps:unsubscribe` | `battlefieldId` | Leave `deps:{battlefieldId}` |
| `tests:subscribe` | `battlefieldId` | Join `tests:{battlefieldId}` |
| `tests:unsubscribe` | `battlefieldId` | Leave `tests:{battlefieldId}` |
| `telemetry:subscribe` | `battlefieldId` | Join `telemetry:{battlefieldId}` |
| `telemetry:unsubscribe` | `battlefieldId` | Leave `telemetry:{battlefieldId}` |

### Server → Client Events

| Event | Rooms | Payload |
|-------|-------|---------|
| `system:metrics` | `system:status` | `SystemMetrics` — cores, ram, disk, uptime, active agents |
| `mission:log` | `mission:{id}` | `{ id, missionId, actor, message, level, createdAt }` — comms event |
| `campaign:log` | `campaign:{id}` | `{ id, campaignId, actor, message, level, createdAt }` — comms event |
| `mission:status` | `mission:{id}`, `battlefield:{bfId}`, `campaign:{cId}`, `hq:activity` | `{ missionId, status, timestamp, ...extra }` |
| `mission:debrief` | `mission:{id}` | `{ missionId, debrief }` |
| `mission:tokens` | `mission:{id}` | `{ missionId, input, output, cacheHit, cacheCreation, costUsd }` |
| `mission:suggestions` | `mission:{id}` | `{ missionId, suggestions }` |
| `phase:status` | `campaign:{cId}`, `battlefield:{bfId}`, `hq:activity` | `{ phaseId, status, timestamp }` |
| `campaign:status` | `campaign:{id}`, `battlefield:{bfId}`, `hq:activity` | `{ campaignId, status, timestamp }` |
| `battlefield:status` | `battlefield:{id}`, `hq:activity` | `{ battlefieldId, status, timestamp }` |
| `campaign:phase` | `campaign:{id}` | Phase progression event |
| `campaign:phase-debrief` | `campaign:{id}` | Phase debrief event |
| `campaign:phase-status` | `campaign:{id}` | Phase status within campaign |
| `campaign:mission-status` | `campaign:{id}` | Mission status within campaign |
| `briefing:chunk` | `briefing:{cId}` | Streaming text chunk |
| `briefing:complete` | `briefing:{cId}` | Briefing message complete |
| `briefing:error` | `briefing:{cId}` | Briefing engine error |
| `briefing:plan-ready` | `briefing:{cId}` | Campaign plan generated |
| `general:chunk` | `general:{sId}` | Streaming text chunk |
| `general:complete` | `general:{sId}` | GENERAL message complete |
| `general:error` | `general:{sId}` | GENERAL engine error |
| `general:system` | `general:{sId}` | System message (command output) |
| `activity:event` | `hq:activity` | `{ type, battlefieldCodename, missionTitle, timestamp, detail }` |
| `devserver:log` | `devserver:{bfId}` | Dev server log line |
| `devserver:status` | `devserver:{bfId}` | Dev server start/stop |
| `console:output` | `console:{bfId}` | Console output line |
| `console:exit` | `console:{bfId}` | Console process exited |
| `notification:new` | broadcast | New notification event |

### Centralized Status Emitter

`src/lib/socket/emit.ts` exports `emitStatusChange()` — a topology-aware emitter that resolves DB relationships and fans out to all relevant rooms.

```typescript
emitStatusChange(entity: Entity, id: string, status: string, extra?: Record<string, unknown>)
```

- **Entity types**: `'mission' | 'phase' | 'campaign' | 'battlefield'`
- **Room resolution**: Queries the DB to resolve `battlefieldId` and `campaignId` for the given entity. A mission status change emits to `mission:{id}`, `battlefield:{bfId}`, `campaign:{cId}`, and `hq:activity`.
- **Cache invalidation**: Calls `revalidatePath()` for all affected Next.js routes (mission detail, battlefield overview, campaign detail, root). Silently skips if called outside a Next.js request context.
- **No-op safety**: Gracefully no-ops when `globalThis.io` is not yet initialized (safe during server boot).

### System Metrics Emitter

`src/lib/system-metrics.ts` emits hardware metrics to the `system:status` room every 10 seconds:

- **CPU**: Per-core usage percentages (delta-based, not instantaneous).
- **RAM**: Active + wired + compressor pages on macOS (not inflated by file cache). Falls back to `os.totalmem() - os.freemem()` on Linux.
- **Disk**: Usage from `df` (targets `/System/Volumes/Data` on macOS, `/` on Linux).
- **Uptime**: Milliseconds since server boot (set via `setBootTimestamp()` called at startup).
- **Assets**: Active agent count vs max slots from CONTROL.

Auto-starts when a client subscribes to `system:status`. Auto-stops when the last subscriber leaves.

---

## Client-Side Socket

`src/components/providers/socket-provider.tsx` manages the client connection:

- **Global singleton**: A single `Socket` instance is created in a `useEffect` and stored in module-level state (`globalSocket`).
- **React integration**: Uses `useSyncExternalStore` to expose the socket and a `reconnectKey` counter to React without unnecessary re-renders.
- **Reconnect tracking**: On reconnect, `reconnectKey` increments, triggering re-subscription in consumer hooks (via `useEffect` dependencies).
- **Context**: `SocketProvider` wraps the app; consumers call `useSocketContext()` to get `{ socket, reconnectKey }`.

Consumer components subscribe to rooms in `useEffect` with `reconnectKey` as a dependency, ensuring re-subscription after reconnection.

---

## GENERAL Chat Engine

Standalone Claude Code chat sessions independent of campaigns. Accessible at `/general`.

- **Engine**: `src/lib/general/general-engine.ts` — spawns Claude Code CLI per message (session continues via `--resume`).
- **Asset CLI**: `src/lib/general/asset-cli.ts` builds CLI args from the GENERAL system asset. `--max-turns` and `--append-system-prompt` are stripped via `filterFlags` — GENERAL sets its own turn limit (50) and delivers persona via stdin rather than `--append-system-prompt`.
- **Resume**: Uses `--resume` with persisted session IDs for conversation continuity. Session HOME is persistent per session at `/tmp/claude-general-{sessionId}` (not wiped between messages).
- **Commands**: `/clear` (reset context), `/compact` (compress history), `/sitrep` (system status), `/diagnose <missionId>` (mission diagnostics) — parsed by `general-commands.ts`. Native Claude Code commands (`/cost`, `/status`, `/model`, `/memory`) are passed through.
- **Prompt**: `general-prompt.ts` builds a dynamic system prompt. If the session is linked to a battlefield, it includes project context (CLAUDE.md, repo info). Delivered as the leading content of stdin on the first message.
- **Streaming**: Output is parsed by `StreamParser` (`stream-parser.ts`), streamed via Socket.IO (`general:chunk`), and persisted to `generalMessages` on completion (`general:complete`).
- **Process lifecycle**: One Claude Code process per active message. `killSession(sessionId)` aborts via AbortController.

```typescript
// GENERAL invocation (simplified from general-engine.ts)
const cliArgs = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
  '--max-turns', '50',
  ...filteredAssetArgs,         // model, effort, skills, MCPs — no --max-turns or --append-system-prompt
  ...(sessionId ? ['--resume', sessionId] : []),
];

const proc = spawn(config.claudePath, cliArgs, {
  cwd: battlefieldPath || '/tmp',
  env: { ...process.env, HOME: persistentHome },
  stdio: ['pipe', 'pipe', 'pipe'],
});

proc.stdin.write(stdinContent);
proc.stdin.end();
```

---

## Custom Server

The `server.ts` entry point boots the full system. Startup sequence:

1. Initialize database (SQLite + WAL mode + Drizzle migrations).
2. Seed default assets if table is empty.
3. Prepare Next.js app (with Turbopack in both dev and prod mode).
4. Create HTTP server; attach Socket.IO at `/socket.io`.
5. Set boot timestamp on metrics emitter.
6. **Start CONTROL**: `buildProductionDeps(io)` wires all concrete subsystem implementations (spawn, gates, exit classifier, worktree, OVERSEER consult, merge). `new Control({ missionDeps })` creates the supervisor; `orchestrator.start()` runs startup recovery (watchdog sweep) then begins the dispatch loop.
7. Create `DevServerManager`.
8. **Startup recovery** (DB-level, separate from CONTROL's watchdog sweep):
   - Re-queue missions stuck in `in_combat` or `deploying` — reset `status = 'queued'`, clear `startedAt`.
   - Re-queue missions stuck in `reviewing` — CONTROL picks them up on the next dispatch tick.
   - Pause all `active` campaigns — Commander must explicitly resume after restart.
9. Auto-start dev servers for battlefields with `autoStartDevServer = 1`.
10. Start Scheduler (cron engine).
11. Start Telegram bot polling; attach callback handler for escalation replies.
12. Detect local IP; log startup banner.
13. Register graceful shutdown handler (SIGINT/SIGTERM → stop metrics emitter → stop Telegram → stop scheduler → stop dev servers → `orchestrator.stop()` → close Socket.IO → close HTTP server → close DB → exit). Force-exits after 5 seconds if graceful close hangs.

```typescript
// Simplified server.ts structure
const app = next({ dev, turbopack: true });
await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));
const io = new SocketIOServer(httpServer, { path: '/socket.io' });
globalThis.io = io;
setupSocketIO(io);
setBootTimestamp(SERVER_BOOT_TIME);

const missionDeps = buildProductionDeps(io);
const orchestrator = new Control({ missionDeps });
globalThis.orchestrator = orchestrator;
await orchestrator.start();   // async: runs watchdog sweep, then starts dispatch loop

// ... startup recovery, scheduler, telegram, auto-start ...

httpServer.listen(config.port, config.host);
```

`globalThis.orchestrator` is typed as `Control` — server actions and route handlers call `globalThis.orchestrator?.pauseAll()` / `resumeAll()` for Commander controls and auth-pause flows.
