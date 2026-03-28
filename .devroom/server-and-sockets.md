# Server, Sockets & Agent Runtime

## Claude Code Invocation

```typescript
const proc = spawn(config.claudePath, [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
  '--max-turns', '50',
  ...(sessionId ? ['--session-id', sessionId] : []),
  fullPrompt,   // prompt as positional argument
], {
  cwd: workingDirectory,
  signal: abortController.signal,
});
```

Stream `proc.stdout` line by line. Parse JSON, emit via Socket.IO, store in `missionLogs`.

## Prompt Cache Optimization

Prompt structure — static at top, dynamic at bottom:

1. **TOP (static, cached)**: Battlefield CLAUDE.md content.
2. **MIDDLE (semi-static)**: Asset system prompt.
3. **MIDDLE (semi-dynamic)**: Previous phase debrief (campaign missions only).
4. **BOTTOM (dynamic)**: Mission briefing.

Target 90%+ cache hit rate.

## Socket.IO

- Attached to custom `server.ts`.
- Rooms: `mission:{id}` per mission, `campaign:{id}` per campaign, `briefing:{campaignId}` per briefing session, `general:{sessionId}` per GENERAL chat session, `hq:activity` for global, `devserver:{battlefieldId}` for dev server logs, `console:{battlefieldId}` for command output.
- Server → Client: `mission:log`, `mission:status`, `mission:debrief`, `mission:tokens`, `campaign:status`, `campaign:phase`, `briefing:chunk`, `briefing:complete`, `briefing:error`, `briefing:plan-ready`, `general:chunk`, `general:complete`, `general:error`, `general:system`, `activity:event`, `devserver:log`, `devserver:status`, `console:output`, `console:exit`, `notification`.
- Client → Server: `mission:subscribe`, `mission:unsubscribe`, `campaign:subscribe`, `campaign:unsubscribe`, `briefing:subscribe`, `briefing:unsubscribe`, `briefing:send`, `general:send`, `hq:subscribe`, `hq:unsubscribe`, `devserver:subscribe`, `devserver:unsubscribe`, `console:subscribe`, `console:unsubscribe`.

---

## GENERAL Chat Engine

Standalone Claude Code chat sessions independent of campaigns. Accessible at `/general`.

- **Engine**: `lib/general/general-engine.ts` — spawns Claude Code CLI per session.
- **Resume**: Uses `--resume` flag with persisted session IDs for conversation continuity.
- **Commands**: `/clear` (reset context), `/compact` (compress history) — parsed by `general-commands.ts`.
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
3. Prepare Next.js app.
4. Create HTTP server, attach Socket.IO at `/socket.io`.
5. Create Orchestrator (queue poll loop) and DevServerManager.
6. Pause any campaigns left `active` from previous run.
7. Auto-start dev servers for flagged battlefields.
8. Start Scheduler (cron engine + seed WORKTREE SWEEP daily task).
9. Start Telegram bot polling (if configured).
10. Detect local IP, log startup banner.
11. Register graceful shutdown handler (SIGINT/SIGTERM → abort missions → close DB → exit).

```typescript
// Simplified server.ts structure
const app = next({ dev: process.env.NODE_ENV !== 'production' });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new SocketIOServer(httpServer, { path: '/socket.io' });
  global.io = io;

  const orchestrator = new Orchestrator(io);
  globalThis.orchestrator = orchestrator;
  const devServerManager = new DevServerManager();
  globalThis.devServerManager = devServerManager;
  // ... scheduler, telegram, auto-start, etc.

  const port = parseInt(process.env.DEVROOM_PORT || '7777');
  httpServer.listen(port, '0.0.0.0');
});
```
