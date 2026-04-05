# Server, Sockets & Agent Runtime

## Claude Code Invocation

Mission execution spawns a Claude Code CLI process per mission via `src/lib/orchestrator/executor.ts`.

```typescript
const args = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
];

// Asset-specific args (model, max-turns, effort, system prompt, skills, MCPs)
if (asset) {
  args.push(...buildAssetCliArgs(asset, skillOverrides));
} else {
  args.push('--max-turns', '100');
}

args.push(fullPrompt);   // prompt as positional argument

const proc = spawn(config.claudePath, args, {
  cwd: workingDirectory,
  signal: abortController.signal,
  env: { ...process.env, HOME: missionHome },
});
```

Key details:
- `--max-turns` comes from the asset's `maxTurns` field (not hardcoded). Falls back to 100 only if no asset is assigned.
- Each mission gets an isolated `HOME` directory at `/tmp/claude-config/{missionId}` to prevent concurrent config corruption and session collisions.
- Auth credentials are extracted from macOS Keychain via `extractKeychainCredentials()` and written into the isolated HOME.
- A **30-minute hard timeout** kills the process via AbortController if it hangs.
- **Stall detection**: checks every 5 seconds for 2 minutes of silence without tool use. On stall, the Overseer is consulted and its response is piped to the agent's stdin.
- **Debrief candidate tracking**: the executor tracks the best debrief candidate from assistant turns (messages matching debrief patterns) rather than relying solely on the final output.
- Stream output is parsed line-by-line via `StreamParser`, emitted to Socket.IO, and persisted to `missionLogs`.

### Asset CLI Builder

`src/lib/orchestrator/asset-cli.ts` translates an Asset config (plus optional skill overrides) into CLI flags:

| Flag | Source |
|------|--------|
| `--model` | `asset.model` |
| `--max-turns` | `asset.maxTurns` |
| `--effort` | `asset.effort` |
| `--append-system-prompt` | `asset.systemPrompt` |
| `--plugin-dir` (per skill) | `asset.skills` JSON array, resolved to `~/.claude/plugins/cache/{publisher}/{name}/{version}`. Skill overrides (`skillOverrides.added` / `skillOverrides.removed`) are applied before resolution. |
| `--mcp-config` | `asset.mcpServers` JSON (skipped if empty/invalid) |

### System Asset Lookup

`src/lib/orchestrator/system-asset.ts` provides cached lookups for system assets (OVERSEER, STRATEGIST, QUARTERMASTER). Uses a 60-second TTL in-memory cache to avoid repeated DB queries.

```typescript
getSystemAsset('OVERSEER')  // returns Asset, throws if not found
```

### Pre-flight Auth Check

Before spending resources on worktree creation and prompt building, the executor runs `checkCliAuth()` (`auth-check.ts`). If auth fails, the mission is re-queued, the orchestrator is paused, and a critical escalation is sent via Telegram.

---

## Prompt Cache Optimization

Prompt structure — static at top, dynamic at bottom:

1. **TOP (static, cached)**: Battlefield CLAUDE.md content.
2. **MIDDLE (semi-static)**: Asset system prompt (via `--append-system-prompt`).
3. **MIDDLE (semi-dynamic)**: Campaign context — previous phase debriefs, sibling missions, upcoming phases.
4. **BOTTOM (dynamic)**: Mission briefing + workspace context + Overseer retry feedback (if retrying).

For campaign missions, `prompt-builder.ts` queries previous phase debriefs, sibling mission status, and future phases to give the agent full operational awareness.

---

## Socket.IO

### Architecture

- Attached to custom `server.ts` via `setupSocketIO(io)` from `src/lib/socket/server.ts`.
- Global singleton: `globalThis.io` — accessible from server actions, executors, and route handlers.

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

### Server → Client Events

| Event | Rooms | Payload |
|-------|-------|---------|
| `system:metrics` | `system:status` | `SystemMetrics` — cores, ram, disk, uptime, active agents |
| `mission:log` | `mission:{id}` | `{ missionId, timestamp, type, content }` |
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
| `orchestrator:agents` | `hq:activity` | Agent slot update |
| `orchestrator:paused` | `hq:activity` | Orchestrator paused |
| `orchestrator:resumed` | `hq:activity` | Orchestrator resumed |
| `activity:event` | `hq:activity` | `{ type, battlefieldCodename, missionTitle, timestamp, detail }` |
| `devserver:log` | `devserver:{bfId}` | Dev server log line |
| `devserver:status` | `devserver:{bfId}` | Dev server start/stop |
| `console:output` | `console:{bfId}` | Console output line |
| `console:exit` | `console:{bfId}` | Console process exited |
| `notification:new` | broadcast | New notification event |

### Centralized Status Emitter

`src/lib/socket/emit.ts` provides `emitStatusChange()` — a topology-aware emitter that automatically resolves which rooms to notify based on DB relationships.

```typescript
emitStatusChange(entity: Entity, id: string, status: string, extra?: Record<string, unknown>)
```

- **Entity types**: `'mission' | 'phase' | 'campaign' | 'battlefield'`
- **Room resolution**: Queries the DB to resolve `battlefieldId` and `campaignId` for the given entity. A mission status change emits to `mission:{id}`, `battlefield:{bfId}`, `campaign:{cId}`, and `hq:activity`.
- **Cache invalidation**: Calls `revalidatePath()` for all affected Next.js routes (mission detail, battlefield overview, campaign detail, root). Silently skips if called outside a Next.js request context.
- **No-op safety**: Gracefully no-ops when `globalThis.io` is not yet initialized (safe during server boot).
- **Usage**: Called from executor status updates, Overseer review handlers, Quartermaster merge flow, and server actions.

### System Metrics Emitter

`src/lib/system-metrics.ts` emits hardware metrics to the `system:status` room every 10 seconds:

- **CPU**: Per-core usage percentages (delta-based, not instantaneous).
- **RAM**: Active + wired + compressor pages on macOS (not inflated by file cache). Falls back to `os.totalmem() - os.freemem()` on Linux.
- **Disk**: Usage from `df` (targets `/System/Volumes/Data` on macOS, `/` on Linux).
- **Uptime**: Milliseconds since server boot.
- **Assets**: Active agent count vs max slots from orchestrator.

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

- **Engine**: `lib/general/general-engine.ts` — spawns Claude Code CLI per session.
- **Resume**: Uses `--resume` flag with persisted session IDs for conversation continuity.
- **Commands**: `/clear` (reset context), `/compact` (compress history), `/sitrep` (system status), `/diagnose <missionId>` (mission diagnostics) — parsed by `general-commands.ts`. Native commands (`/cost`, `/status`, `/model`, `/memory`) are passed through to Claude Code.
- **Prompt**: `general-prompt.ts` builds a dynamic system prompt. If the session is linked to a battlefield, it includes project context (CLAUDE.md, repo info).
- **Streaming**: Output is streamed via Socket.IO (`general:chunk`) and persisted to `generalMessages` on completion (`general:complete`).
- **Process lifecycle**: One Claude Code process per active session. `killSession(sessionId)` aborts the process via AbortController.

```typescript
// GENERAL invocation (simplified)
const proc = spawn(config.claudePath, [
  '--print',
  '--output-format', 'stream-json',
  '--dangerously-skip-permissions',
  ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  prompt,
], { cwd: battlefieldPath || process.cwd(), signal });
```

---

## Custom Server

The `server.ts` entry point boots the full system. Startup sequence:

1. Initialize database (SQLite + WAL mode + Drizzle migrations).
2. Seed default assets if table is empty.
3. Prepare Next.js app (with Turbopack in dev mode).
4. Create HTTP server, attach Socket.IO at `/socket.io`.
5. Create Orchestrator (queue poll loop) and DevServerManager.
6. **Startup recovery**:
   - Re-queue orphaned missions (stuck in `in_combat` or `deploying` from previous run).
   - Re-trigger Overseer review for missions stuck in `reviewing`.
   - Pause active campaigns (Commander must explicitly resume after restart).
7. Auto-start dev servers for flagged battlefields.
8. Start Scheduler (cron engine).
9. Start Telegram bot polling (if configured).
10. Detect local IP, log startup banner.
11. Register graceful shutdown handler (SIGINT/SIGTERM → stop metrics emitter → stop Telegram → stop scheduler → stop dev servers → abort all missions → close Socket.IO → close HTTP server → close DB → exit). Force-exits after 5 seconds if graceful close hangs.

```typescript
// Simplified server.ts structure
const app = next({ dev: process.env.NODE_ENV !== 'production', turbopack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new SocketIOServer(httpServer, { path: '/socket.io' });
  globalThis.io = io;
  setupSocketIO(io);

  const orchestrator = new Orchestrator(io);
  globalThis.orchestrator = orchestrator;
  const devServerManager = new DevServerManager();
  globalThis.devServerManager = devServerManager;
  // ... startup recovery, scheduler, telegram, auto-start, etc.

  httpServer.listen(config.port, config.host);
});
```
