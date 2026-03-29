# GENERAL Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/general` chat page where the Commander interacts with GENERAL — a Claude Code instance with full DEVROOM admin access, tabbed sessions, and custom commands.

**Architecture:** Claude Code process per session, spawned with a system prompt establishing GENERAL's personality and DEVROOM context. Sessions persist via `--resume`. Socket.IO streams responses in real-time. Parallel to the existing briefing engine but decoupled from campaigns.

**Tech Stack:** Next.js App Router, Socket.IO, Claude Code CLI (`--print --output-format stream-json --resume`), Drizzle ORM (SQLite), TacTextareaWithImages

**Spec:** `docs/superpowers/specs/2026-03-28-general-chat-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/lib/db/schema.ts` | Add `generalSessions` + `generalMessages` tables (modify) |
| `src/lib/general/general-engine.ts` | Spawn/resume Claude Code, stream output, handle commands |
| `src/lib/general/general-prompt.ts` | Build GENERAL system prompt with optional battlefield context |
| `src/lib/general/general-commands.ts` | Custom command definitions and prompt expansion |
| `src/actions/general.ts` | Server actions: CRUD sessions + messages |
| `src/hooks/use-general.ts` | Socket.IO streaming hook |
| `src/app/(hq)/general/page.tsx` | Page server component |
| `src/components/general/general-chat.tsx` | Main client component (tabs + chat + input) |
| `src/components/general/command-reference.tsx` | Slide-out command reference panel |
| `src/components/general/new-session-modal.tsx` | Create session modal |
| `src/components/general/close-session-modal.tsx` | Confirm close modal |

### Modified Files
| File | Change |
|---|---|
| `src/lib/socket/server.ts` | Add `general:*` event handlers |
| `src/components/layout/global-nav.tsx` | Add GENERAL nav item |

---

### Task 1: Database Schema — generalSessions + generalMessages

**Files:**
- Modify: `src/lib/db/schema.ts` (append after line 214)

- [ ] **Step 1: Add generalSessions and generalMessages tables to schema**

Add at the end of `src/lib/db/schema.ts`, before the closing of the file:

```typescript
// ---------------------------------------------------------------------------
// General Sessions (standalone GENERAL chat)
// ---------------------------------------------------------------------------
export const generalSessions = sqliteTable('general_sessions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sessionId: text('session_id'),               // Claude Code resume session ID
  battlefieldId: text('battlefield_id').references(() => battlefields.id),
  status: text('status').default('active'),    // 'active' | 'closed'
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const generalMessages = sqliteTable('general_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => generalSessions.id),
  role: text('role').notNull(),                // 'commander' | 'general' | 'system'
  content: text('content').notNull(),
  timestamp: integer('timestamp').notNull(),
});
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
pnpm db:generate
pnpm db:migrate
```

Expected: New migration file created in `drizzle/` with `CREATE TABLE general_sessions` and `CREATE TABLE general_messages`.

Note: The dev Docker container mounts source code and runs the migration on startup via `server.ts` → `runMigrations()`. After generating, the container will pick up the migration on next restart.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(general): add generalSessions and generalMessages tables"
```

---

### Task 2: System Prompt Builder

**Files:**
- Create: `src/lib/general/general-prompt.ts`

- [ ] **Step 1: Create the prompt builder**

```typescript
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';

export function buildGeneralPrompt(battlefieldId?: string | null): string {
  const sections: string[] = [];

  sections.push(`You are GENERAL, senior strategic advisor and administrator of NYHZ OPS — DEVROOM, an autonomous agent orchestration platform. You report directly to the Commander.

You are not a campaign planner here. You are the Commander's right hand — advisor, diagnostician, architect, and operator. You have full access to this system.

DEVROOM DATABASE: /data/devroom.db (SQLite, WAL mode)
Key tables: battlefields, missions, campaigns, phases, assets, briefingSessions, captainLogs, notifications, missionLogs, dossiers, scheduledTasks

BATTLEFIELD REPOS: /Users/nyhzdev/devroom/battlefields/

YOUR CAPABILITIES:
- Query the database directly to inspect missions, campaigns, assets, logistics
- Read battlefield code, git history, diffs, worktrees
- Diagnose stuck or failed missions by reading their comms/logs
- Suggest DEVROOM improvements, new features, architectural changes
- Brainstorm ideas, discuss strategy, or just talk

PERSONALITY:
- Address the user as Commander
- Speak with military brevity — concise, direct, no fluff
- You are confident, experienced, and opinionated when asked for recommendations
- Use tactical language naturally but don't overdo it`);

  if (battlefieldId) {
    const db = getDatabase();
    const bf = db.select().from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
    if (bf) {
      sections.push(`ACTIVE BATTLEFIELD: ${bf.codename}
Repository: ${bf.repoPath}
Default branch: ${bf.defaultBranch || 'main'}
The Commander opened this session from this battlefield's page. Focus your attention here unless directed otherwise.`);
    }
  }

  return sections.join('\n\n---\n\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/general/general-prompt.ts
git commit -m "feat(general): add system prompt builder"
```

---

### Task 3: Custom Commands

**Files:**
- Create: `src/lib/general/general-commands.ts`

- [ ] **Step 1: Create the command definitions and expansion logic**

```typescript
interface CustomCommand {
  name: string;
  description: string;
  usage: string;
  expand: (args: string) => string;
}

const CUSTOM_COMMANDS: CustomCommand[] = [
  {
    name: 'sitrep',
    description: 'Full situation report on all operations',
    usage: '/sitrep',
    expand: () =>
      'Give me a full situation report. Query the DEVROOM database at /data/devroom.db. Report: all active missions and their status, any stuck or failed missions in the last hour, active campaigns and their phase progress, asset deployment status, and any Captain escalations. Be concise — use tables where appropriate.',
  },
  {
    name: 'diagnose',
    description: 'Deep-dive a specific mission',
    usage: '/diagnose <missionId>',
    expand: (args: string) =>
      `Investigate mission ${args.trim()}. Query the DEVROOM database at /data/devroom.db. Read the mission record, its comms/logs from the missionLogs table (type column has 'log', 'status', 'error'), any Captain log entries from captainLogs, and the debrief if available. Tell me: what was the objective, what happened, where it went wrong (if it did), and what you recommend.`,
  },
];

const NATIVE_COMMANDS = ['clear', 'compact', 'cost', 'status', 'model', 'memory'];

export interface ParsedCommand {
  type: 'native' | 'custom' | 'message';
  original: string;
  expanded: string;
  commandName?: string;
  /** For native commands like /clear that need client-side visual feedback */
  systemMessage?: string;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return { type: 'message', original: trimmed, expanded: trimmed };
  }

  const spaceIndex = trimmed.indexOf(' ');
  const commandName = (spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)).toLowerCase();
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  // Check custom commands first
  const custom = CUSTOM_COMMANDS.find((c) => c.name === commandName);
  if (custom) {
    return {
      type: 'custom',
      original: trimmed,
      expanded: custom.expand(args),
      commandName,
    };
  }

  // Check native commands
  if (NATIVE_COMMANDS.includes(commandName)) {
    let systemMessage: string | undefined;
    if (commandName === 'clear') systemMessage = '── CONTEXT CLEARED ──';
    if (commandName === 'compact') systemMessage = '── CONTEXT COMPACTED ──';

    return {
      type: 'native',
      original: trimmed,
      expanded: trimmed, // pass through as-is
      commandName,
      systemMessage,
    };
  }

  // Unknown slash — treat as a regular message
  return { type: 'message', original: trimmed, expanded: trimmed };
}

/** Returns all commands for the reference card UI */
export function getAllCommands() {
  return {
    native: [
      { name: '/clear', description: 'Reset conversation context' },
      { name: '/compact', description: 'Compress context to free tokens' },
      { name: '/cost', description: 'Token usage for this session' },
      { name: '/status', description: 'Model, tokens, context remaining' },
      { name: '/model <name>', description: 'Switch model mid-session' },
      { name: '/memory', description: "GENERAL's persistent memory" },
    ],
    custom: CUSTOM_COMMANDS.map((c) => ({ name: `/${c.usage.replace(/^\//, '')}`, description: c.description })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/general/general-commands.ts
git commit -m "feat(general): add command parser with /sitrep and /diagnose"
```

---

### Task 4: General Engine — Claude Code Process Management

**Files:**
- Create: `src/lib/general/general-engine.ts`

- [ ] **Step 1: Create the engine**

```typescript
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { generalSessions, generalMessages, assets } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildGeneralPrompt } from './general-prompt';
import { parseCommand } from './general-commands';

// ---------------------------------------------------------------------------
// Active process tracking
// ---------------------------------------------------------------------------

interface ActiveProcess {
  proc: ChildProcessWithoutNullStreams;
  abort: AbortController;
}

const activeProcesses = new Map<string, ActiveProcess>();

// ---------------------------------------------------------------------------
// sendGeneralMessage — core entry point
// ---------------------------------------------------------------------------

export async function sendGeneralMessage(
  io: SocketIOServer,
  sessionId: string,
  rawMessage: string,
): Promise<void> {
  const db = getDatabase();

  // 1. Load session
  const session = db
    .select()
    .from(generalSessions)
    .where(eq(generalSessions.id, sessionId))
    .get();

  if (!session) {
    throw new Error(`sendGeneralMessage: session ${sessionId} not found`);
  }

  if (session.status === 'closed') {
    throw new Error(`sendGeneralMessage: session ${sessionId} is closed`);
  }

  // 2. Parse command
  const parsed = parseCommand(rawMessage);
  const room = `general:${sessionId}`;
  const now = Date.now();

  // 3. Store Commander's message (show original, not expanded)
  db.insert(generalMessages)
    .values({
      id: generateId(),
      sessionId,
      role: 'commander',
      content: parsed.original,
      timestamp: now,
    })
    .run();

  // 4. If command has a system message (like /clear), store and emit it
  if (parsed.systemMessage) {
    const sysMsgId = generateId();
    db.insert(generalMessages)
      .values({
        id: sysMsgId,
        sessionId,
        role: 'system',
        content: parsed.systemMessage,
        timestamp: now + 1,
      })
      .run();
    io.to(room).emit('general:system', { sessionId, content: parsed.systemMessage, messageId: sysMsgId });
  }

  // 5. Find GENERAL asset for model
  const generalAsset = db
    .select()
    .from(assets)
    .where(eq(assets.codename, 'GENERAL'))
    .get();
  const model = generalAsset?.model || 'claude-opus-4-6';

  // 6. Build CLI args
  const isFirstMessage = !session.sessionId;
  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--max-turns', '50',
    '--model', model,
  ];

  if (!isFirstMessage && session.sessionId) {
    cliArgs.push('--resume', session.sessionId);
  }

  // 7. Build stdin content
  let stdinContent: string;

  if (isFirstMessage) {
    const systemPrompt = buildGeneralPrompt(session.battlefieldId);
    stdinContent = systemPrompt + '\n\n---\n\nCommander says: ' + parsed.expanded;
  } else {
    stdinContent = parsed.expanded;
  }

  // 8. Determine working directory
  let cwd = '/tmp';
  if (session.battlefieldId) {
    const { battlefields } = await import('@/lib/db/schema');
    const bf = db.select().from(battlefields).where(eq(battlefields.id, session.battlefieldId)).get();
    if (bf) cwd = bf.repoPath;
  }

  // 9. Spawn Claude process
  const abortController = new AbortController();
  const proc = spawn(config.claudePath, cliArgs, {
    cwd,
    signal: abortController.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcesses.set(sessionId, { proc, abort: abortController });

  let fullResponse = '';
  let extractedSessionId: string | null = null;
  let lineBuffer = '';

  // Parse stream-json output line by line
  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        if (event.session_id && !extractedSessionId) {
          extractedSessionId = event.session_id;
        }

        if (event.type === 'stream_event' && event.event) {
          const inner = event.event;
          if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
            fullResponse += inner.delta.text;
            io.to(room).emit('general:chunk', { sessionId, content: inner.delta.text });
          }
        }

        if (event.type === 'result') {
          if (event.session_id) extractedSessionId = event.session_id;
          if (!fullResponse && event.result && typeof event.result === 'string') {
            fullResponse = event.result;
            io.to(room).emit('general:chunk', { sessionId, content: event.result });
          }
        }
      } catch {
        // Not valid JSON — ignore
      }
    }
  });

  let stderrOutput = '';
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  // Write message to stdin and close
  proc.stdin.write(stdinContent);
  proc.stdin.end();

  // Wait for process to complete
  return new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      activeProcesses.delete(sessionId);

      // Process remaining buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer);
          if (event.session_id && !extractedSessionId) {
            extractedSessionId = event.session_id;
          }
          if (event.type === 'result') {
            if (event.session_id) extractedSessionId = event.session_id;
            if (!fullResponse && event.result && typeof event.result === 'string') {
              fullResponse = event.result;
            }
          }
        } catch { /* ignore */ }
      }

      // Persist Claude's session ID for --resume
      if (extractedSessionId) {
        db.update(generalSessions)
          .set({ sessionId: extractedSessionId, updatedAt: Date.now() })
          .where(eq(generalSessions.id, session!.id))
          .run();
      }

      if (code !== 0 && code !== null) {
        const errorMsg = `GENERAL process exited with code ${code}: ${stderrOutput.slice(0, 500)}`;
        io.to(room).emit('general:error', { sessionId, error: errorMsg });
        reject(new Error(errorMsg));
        return;
      }

      const responseText = fullResponse.trim();

      // Store GENERAL's response
      const msgId = generateId();
      db.insert(generalMessages)
        .values({
          id: msgId,
          sessionId: session!.id,
          role: 'general',
          content: responseText,
          timestamp: Date.now(),
        })
        .run();

      io.to(room).emit('general:complete', { sessionId, messageId: msgId, content: responseText });
      resolve();
    });

    proc.on('error', (err) => {
      activeProcesses.delete(sessionId);
      io.to(room).emit('general:error', { sessionId, error: err.message });
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// killSession — abort an active GENERAL process
// ---------------------------------------------------------------------------

export function killSession(sessionId: string): boolean {
  const active = activeProcesses.get(sessionId);
  if (!active) return false;

  active.abort.abort();
  activeProcesses.delete(sessionId);
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/general/general-engine.ts
git commit -m "feat(general): add engine for Claude Code process management"
```

---

### Task 5: Server Actions

**Files:**
- Create: `src/actions/general.ts`

- [ ] **Step 1: Create the server actions**

```typescript
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/lib/db/index';
import { generalSessions, generalMessages } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';

export async function createGeneralSession(name: string, battlefieldId?: string | null) {
  const db = getDatabase();
  const now = Date.now();
  const id = generateId();

  db.insert(generalSessions)
    .values({
      id,
      name,
      sessionId: null,
      battlefieldId: battlefieldId ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  revalidatePath('/general');
  return db.select().from(generalSessions).where(eq(generalSessions.id, id)).get()!;
}

export async function closeGeneralSession(sessionId: string) {
  const db = getDatabase();

  // Kill active process if running
  const { killSession } = await import('@/lib/general/general-engine');
  killSession(sessionId);

  db.update(generalSessions)
    .set({ status: 'closed', updatedAt: Date.now() })
    .where(eq(generalSessions.id, sessionId))
    .run();

  revalidatePath('/general');
}

export async function renameGeneralSession(sessionId: string, name: string) {
  const db = getDatabase();

  db.update(generalSessions)
    .set({ name, updatedAt: Date.now() })
    .where(eq(generalSessions.id, sessionId))
    .run();

  revalidatePath('/general');
}

export async function getActiveSessions() {
  const db = getDatabase();
  return db
    .select()
    .from(generalSessions)
    .where(eq(generalSessions.status, 'active'))
    .orderBy(generalSessions.createdAt)
    .all();
}

export async function getSessionMessages(sessionId: string) {
  const db = getDatabase();
  return db
    .select()
    .from(generalMessages)
    .where(eq(generalMessages.sessionId, sessionId))
    .orderBy(generalMessages.timestamp)
    .all();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/general.ts
git commit -m "feat(general): add server actions for session CRUD"
```

---

### Task 6: Socket.IO Event Handlers

**Files:**
- Modify: `src/lib/socket/server.ts` (add before `socket.on('disconnect', ...`)

- [ ] **Step 1: Add general:* events to the socket server**

Add these handlers in `setupSocketIO`, before the `disconnect` handler (before line 65):

```typescript
    socket.on('general:subscribe', (sessionId: string) => {
      socket.join(`general:${sessionId}`);
    });

    socket.on('general:unsubscribe', (sessionId: string) => {
      socket.leave(`general:${sessionId}`);
    });

    socket.on('general:send', async (data: { sessionId: string; message: string }) => {
      try {
        const { sendGeneralMessage } = await import('@/lib/general/general-engine');
        await sendGeneralMessage(io, data.sessionId, data.message);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'GENERAL session failed';
        socket.emit('general:error', { sessionId: data.sessionId, error: message });
      }
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/socket/server.ts
git commit -m "feat(general): add Socket.IO event handlers"
```

---

### Task 7: Client Hook — useGeneral

**Files:**
- Create: `src/hooks/use-general.ts`

- [ ] **Step 1: Create the hook**

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './use-socket';

interface GeneralMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export function useGeneral(sessionId: string | null, initialMessages: GeneralMessage[]) {
  const socket = useSocket();
  const [messages, setMessages] = useState<GeneralMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef('');

  // Reset messages when session changes
  useEffect(() => {
    setMessages(initialMessages);
    setStreaming('');
    setIsLoading(false);
    setError(null);
    streamRef.current = '';
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit('general:subscribe', sessionId);

    const handleChunk = (data: { sessionId: string; content: string }) => {
      if (data.sessionId === sessionId) {
        streamRef.current += data.content;
        setStreaming(streamRef.current);
      }
    };

    const handleComplete = (data: { sessionId: string; messageId: string; content?: string }) => {
      if (data.sessionId === sessionId) {
        const finalContent = streamRef.current || data.content || '';
        setMessages((prev) => [
          ...prev,
          {
            id: data.messageId,
            role: 'general',
            content: finalContent,
            timestamp: Date.now(),
          },
        ]);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handleError = (data: { sessionId: string; error: string }) => {
      if (data.sessionId === sessionId) {
        setError(data.error);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handleSystem = (data: { sessionId: string; content: string; messageId: string }) => {
      if (data.sessionId === sessionId) {
        setMessages((prev) => [
          ...prev,
          {
            id: data.messageId,
            role: 'system',
            content: data.content,
            timestamp: Date.now(),
          },
        ]);
      }
    };

    socket.on('general:chunk', handleChunk);
    socket.on('general:complete', handleComplete);
    socket.on('general:error', handleError);
    socket.on('general:system', handleSystem);

    return () => {
      socket.off('general:chunk', handleChunk);
      socket.off('general:complete', handleComplete);
      socket.off('general:error', handleError);
      socket.off('general:system', handleSystem);
      socket.emit('general:unsubscribe', sessionId);
    };
  }, [socket, sessionId]);

  const sendMessage = useCallback(
    (message: string) => {
      if (!socket || !sessionId || isLoading) return;

      setIsLoading(true);
      setError(null);
      streamRef.current = '';
      setStreaming('');

      // Optimistic: add commander message immediately
      setMessages((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          role: 'commander',
          content: message,
          timestamp: Date.now(),
        },
      ]);

      socket.emit('general:send', { sessionId, message });
    },
    [socket, sessionId, isLoading],
  );

  return { messages, streaming, isLoading, error, sendMessage };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-general.ts
git commit -m "feat(general): add useGeneral Socket.IO hook"
```

---

### Task 8: Navigation — Add GENERAL to Global Nav

**Files:**
- Modify: `src/components/layout/global-nav.tsx`

- [ ] **Step 1: Add GENERAL link to GLOBAL_LINKS**

Change the `GLOBAL_LINKS` array (line 7-9) from:

```typescript
const GLOBAL_LINKS = [
  { href: '/', icon: '◉', label: 'HQ', exact: true },
] as const;
```

To:

```typescript
const GLOBAL_LINKS = [
  { href: '/', icon: '◉', label: 'HQ', exact: true },
  { href: '/general', icon: '◇', label: 'GENERAL', exact: false },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/global-nav.tsx
git commit -m "feat(general): add GENERAL to global nav"
```

---

### Task 9: UI Components — Modals

**Files:**
- Create: `src/components/general/new-session-modal.tsx`
- Create: `src/components/general/close-session-modal.tsx`

- [ ] **Step 1: Create the new session modal**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { TacButton } from '@/components/ui/tac-button';

interface Battlefield {
  id: string;
  codename: string;
}

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, battlefieldId?: string) => void;
  battlefields: Battlefield[];
}

export function NewSessionModal({ open, onClose, onCreate, battlefields }: NewSessionModalProps) {
  const [name, setName] = useState('');
  const [battlefieldId, setBattlefieldId] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setBattlefieldId('');
    }
  }, [open]);

  if (!open) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, battlefieldId || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-dr-surface border border-dr-border w-[420px] p-6 space-y-4"
        onKeyDown={handleKeyDown}
      >
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
          NEW SESSION
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-dr-muted font-tactical text-xs block mb-1">SESSION NAME</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Auth Refactor Discussion"
              className="w-full bg-dr-bg border border-dr-border text-dr-text font-mono text-sm px-3 py-2 focus:border-dr-amber focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="text-dr-muted font-tactical text-xs block mb-1">
              BATTLEFIELD CONTEXT <span className="text-dr-dim">(optional)</span>
            </label>
            <select
              value={battlefieldId}
              onChange={(e) => setBattlefieldId(e.target.value)}
              className="w-full bg-dr-bg border border-dr-border text-dr-text font-mono text-sm px-3 py-2 focus:border-dr-amber focus:outline-none"
            >
              <option value="">None — general conversation</option>
              {battlefields.map((bf) => (
                <option key={bf.id} value={bf.id}>
                  {bf.codename}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <TacButton variant="ghost" size="sm" onClick={onClose}>
            CANCEL
          </TacButton>
          <TacButton variant="success" size="sm" onClick={handleCreate} disabled={!name.trim()}>
            CREATE
          </TacButton>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the close session modal**

```typescript
'use client';

import { TacButton } from '@/components/ui/tac-button';

interface CloseSessionModalProps {
  open: boolean;
  sessionName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function CloseSessionModal({ open, sessionName, onClose, onConfirm }: CloseSessionModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-dr-surface border border-dr-border w-[420px] p-6 space-y-4">
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
          END SESSION
        </div>

        <p className="text-dr-text font-mono text-sm">
          End session <span className="text-dr-amber font-bold">{sessionName}</span>?
          The conversation history will be preserved but GENERAL will lose context of this session.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <TacButton variant="ghost" size="sm" onClick={onClose}>
            CANCEL
          </TacButton>
          <TacButton variant="danger" size="sm" onClick={onConfirm}>
            END SESSION
          </TacButton>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/general/new-session-modal.tsx src/components/general/close-session-modal.tsx
git commit -m "feat(general): add new session and close session modals"
```

---

### Task 10: UI Component — Command Reference Card

**Files:**
- Create: `src/components/general/command-reference.tsx`

- [ ] **Step 1: Create the command reference panel**

```typescript
'use client';

import { getAllCommands } from '@/lib/general/general-commands';

interface CommandReferenceProps {
  open: boolean;
  onClose: () => void;
}

export function CommandReference({ open, onClose }: CommandReferenceProps) {
  if (!open) return null;

  const commands = getAllCommands();

  return (
    <div className="absolute right-0 top-0 h-full w-72 bg-dr-surface border-l border-dr-border z-40 overflow-y-auto">
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
            COMMANDS
          </span>
          <button
            onClick={onClose}
            className="text-dr-dim hover:text-dr-text text-sm font-mono"
          >
            ✕
          </button>
        </div>

        {/* Context */}
        <div className="space-y-2">
          <div className="text-dr-muted font-tactical text-[10px] tracking-widest uppercase">
            CONTEXT
          </div>
          {commands.native
            .filter((c) => ['/clear', '/compact'].includes(c.name))
            .map((cmd) => (
              <CommandRow key={cmd.name} name={cmd.name} description={cmd.description} />
            ))}
        </div>

        {/* Info */}
        <div className="space-y-2">
          <div className="text-dr-muted font-tactical text-[10px] tracking-widest uppercase">
            INFO
          </div>
          {commands.native
            .filter((c) => !['/clear', '/compact'].includes(c.name))
            .map((cmd) => (
              <CommandRow key={cmd.name} name={cmd.name} description={cmd.description} />
            ))}
        </div>

        {/* DEVROOM Shortcuts */}
        <div className="space-y-2">
          <div className="text-dr-muted font-tactical text-[10px] tracking-widest uppercase">
            DEVROOM SHORTCUTS
          </div>
          {commands.custom.map((cmd) => (
            <CommandRow key={cmd.name} name={cmd.name} description={cmd.description} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-dr-green font-mono text-xs">{name}</div>
      <div className="text-dr-dim font-mono text-[11px]">{description}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/general/command-reference.tsx
git commit -m "feat(general): add command reference panel"
```

---

### Task 11: UI Component — Main Chat (general-chat.tsx)

**Files:**
- Create: `src/components/general/general-chat.tsx`

This is the largest component — tabs, chat area, input, header controls, modals. All wired together.

- [ ] **Step 1: Create the main chat component**

```typescript
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGeneral } from '@/hooks/use-general';
import { createGeneralSession, closeGeneralSession, renameGeneralSession, getSessionMessages } from '@/actions/general';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';
import { NewSessionModal } from './new-session-modal';
import { CloseSessionModal } from './close-session-modal';
import { CommandReference } from './command-reference';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Session {
  id: string;
  name: string;
  sessionId: string | null;
  battlefieldId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

interface Battlefield {
  id: string;
  codename: string;
}

interface GeneralChatProps {
  initialSessions: Session[];
  initialMessages: Message[];
  initialActiveSessionId: string | null;
  battlefields: Battlefield[];
}

export function GeneralChat({
  initialSessions,
  initialMessages,
  initialActiveSessionId,
  battlefields,
}: GeneralChatProps) {
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialActiveSessionId);
  const [sessionMessages, setSessionMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<Session | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const { messages, streaming, isLoading, error, sendMessage } = useGeneral(
    activeSessionId,
    sessionMessages,
  );

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Auto-create session if opened from battlefield with ?battlefield=<id>
  useEffect(() => {
    const bfId = searchParams.get('battlefield');
    if (bfId && sessions.length === 0) {
      const bf = battlefields.find((b) => b.id === bfId);
      handleCreateSession(bf?.codename ? `${bf.codename} Session` : 'New Session', bfId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateSession = async (name: string, battlefieldId?: string) => {
    const session = await createGeneralSession(name, battlefieldId);
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    setSessionMessages([]);
    setShowNewModal(false);
  };

  const handleCloseSession = async () => {
    if (!closeTarget) return;
    await closeGeneralSession(closeTarget.id);
    setSessions((prev) => prev.filter((s) => s.id !== closeTarget.id));
    if (activeSessionId === closeTarget.id) {
      const remaining = sessions.filter((s) => s.id !== closeTarget.id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      if (remaining.length > 0) {
        const msgs = await getSessionMessages(remaining[0].id);
        setSessionMessages(msgs);
      } else {
        setSessionMessages([]);
      }
    }
    setCloseTarget(null);
  };

  const handleSwitchSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    const msgs = await getSessionMessages(sessionId);
    setSessionMessages(msgs);
  };

  const handleRename = async () => {
    if (!activeSession || !editName.trim()) return;
    await renameGeneralSession(activeSession.id, editName.trim());
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, name: editName.trim() } : s)),
    );
    setEditingName(false);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !activeSessionId) return;
    sendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Empty state — no sessions
  if (sessions.length === 0 && !showNewModal) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-center space-y-3">
          <div className="text-dr-amber font-tactical text-3xl tracking-[0.3em]">GENERAL</div>
          <div className="text-dr-muted font-mono text-sm">
            Your strategic advisor and DEVROOM administrator
          </div>
        </div>
        <TacButton variant="success" onClick={() => setShowNewModal(true)}>
          NEW SESSION
        </TacButton>
        <NewSessionModal
          open={showNewModal}
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreateSession}
          battlefields={battlefields}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Tab bar */}
      <div className="flex items-center border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex-1 flex items-center overflow-x-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSwitchSession(session.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 font-tactical text-xs tracking-wider border-b-2 transition-colors shrink-0',
                session.id === activeSessionId
                  ? 'border-dr-green text-dr-green bg-dr-elevated'
                  : 'border-transparent text-dr-muted hover:text-dr-text hover:bg-dr-elevated',
              )}
            >
              <span className="truncate max-w-[160px]">{session.name}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setCloseTarget(session);
                }}
                className="text-dr-dim hover:text-dr-red ml-1 text-[10px]"
              >
                ✕
              </span>
            </button>
          ))}
          <button
            onClick={() => setShowNewModal(true)}
            className="px-4 py-2.5 text-dr-dim hover:text-dr-amber font-mono text-sm transition-colors shrink-0"
          >
            +
          </button>
        </div>
        <button
          onClick={() => setShowCommands((v) => !v)}
          className={cn(
            'px-4 py-2.5 font-mono text-sm transition-colors shrink-0',
            showCommands ? 'text-dr-amber' : 'text-dr-dim hover:text-dr-amber',
          )}
        >
          ?
        </button>
      </div>

      {/* Chat header */}
      {activeSession && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-dr-border bg-dr-surface shrink-0">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="bg-dr-bg border border-dr-amber text-dr-text font-tactical text-sm px-2 py-1 focus:outline-none"
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setEditName(activeSession.name);
                  setEditingName(true);
                }}
                className="text-dr-text font-tactical text-sm hover:text-dr-amber transition-colors"
              >
                {activeSession.name}
              </button>
            )}
            {activeSession.battlefieldId && (
              <span className="text-dr-dim font-mono text-[10px]">
                BATTLEFIELD LINKED
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => sendMessage('/clear')}
              disabled={isLoading}
            >
              CLEAR CONTEXT
            </TacButton>
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => sendMessage('/compact')}
              disabled={isLoading}
            >
              COMPACT
            </TacButton>
            <TacButton
              variant="danger"
              size="sm"
              onClick={() => setCloseTarget(activeSession)}
            >
              END SESSION
            </TacButton>
          </div>
        </div>
      )}

      {/* Chat body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {/* Streaming response */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-1">
              <div className="text-dr-amber font-tactical text-[10px] tracking-widest">GENERAL</div>
              <div className="text-dr-text font-mono text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                <span className="inline-block w-2 h-4 bg-dr-amber animate-pulse ml-0.5" />
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streaming && (
          <div className="flex justify-start">
            <div className="text-dr-dim font-mono text-sm animate-pulse">
              GENERAL is thinking...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-dr-red/10 border border-dr-red/30 text-dr-red font-mono text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* Command reference overlay */}
        <CommandReference open={showCommands} onClose={() => setShowCommands(false)} />
      </div>

      {/* Input */}
      {activeSession && (
        <div className="border-t border-dr-border bg-dr-surface p-3 shrink-0">
          <div className="flex gap-3">
            <TacTextareaWithImages
              value={input}
              onChange={setInput}
              onKeyDown={handleKeyDown}
              placeholder="Talk to GENERAL..."
              rows={2}
              disabled={isLoading}
              className="flex-1"
            />
            <TacButton
              variant="success"
              size="sm"
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="self-end"
            >
              SEND
            </TacButton>
          </div>
        </div>
      )}

      {/* Modals */}
      <NewSessionModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreate={handleCreateSession}
        battlefields={battlefields}
      />
      <CloseSessionModal
        open={!!closeTarget}
        sessionName={closeTarget?.name ?? ''}
        onClose={() => setCloseTarget(null)}
        onConfirm={handleCloseSession}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ role, content }: { role: string; content: string }) {
  if (role === 'system') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-dr-dim font-mono text-[11px] tracking-widest">{content}</span>
      </div>
    );
  }

  const isCommander = role === 'commander';

  return (
    <div className={cn('flex', isCommander ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] space-y-1')}>
        <div
          className={cn(
            'font-tactical text-[10px] tracking-widest',
            isCommander ? 'text-dr-green text-right' : 'text-dr-amber',
          )}
        >
          {isCommander ? 'COMMANDER' : 'GENERAL'}
        </div>
        <div
          className={cn(
            'font-mono text-sm leading-relaxed',
            isCommander
              ? 'text-dr-text bg-dr-elevated border border-dr-border px-3 py-2'
              : 'text-dr-text prose prose-invert prose-sm max-w-none',
          )}
        >
          {isCommander ? (
            content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/general/general-chat.tsx
git commit -m "feat(general): add main chat component with tabs, messages, and controls"
```

---

### Task 12: Page — /general

**Files:**
- Create: `src/app/(hq)/general/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { getActiveSessions, getSessionMessages } from '@/actions/general';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { GeneralChat } from '@/components/general/general-chat';

export default async function GeneralPage({
  searchParams,
}: {
  searchParams: Promise<{ battlefield?: string }>;
}) {
  const params = await searchParams;
  const sessions = await getActiveSessions();
  const db = getDatabase();

  // Load battlefields for the session modal dropdown
  const allBattlefields = db
    .select({ id: battlefields.id, codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.status, 'active'))
    .all();

  // Determine initial active session
  let activeSessionId: string | null = null;
  let initialMessages: { id: string; role: string; content: string; timestamp: number }[] = [];

  if (sessions.length > 0) {
    // If battlefield param, try to find a session linked to it
    if (params.battlefield) {
      const linked = sessions.find((s) => s.battlefieldId === params.battlefield);
      activeSessionId = linked?.id ?? sessions[sessions.length - 1].id;
    } else {
      activeSessionId = sessions[sessions.length - 1].id;
    }

    initialMessages = await getSessionMessages(activeSessionId);
  }

  return (
    <div className="h-full flex flex-col">
      <GeneralChat
        initialSessions={sessions}
        initialMessages={initialMessages}
        initialActiveSessionId={activeSessionId}
        battlefields={allBattlefields}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the page loads**

Run: Open `https://devroom.lan/general` in the browser.
Expected: Empty state with "GENERAL" title, description, and "NEW SESSION" button.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(hq\)/general/page.tsx
git commit -m "feat(general): add /general page"
```

---

### Task 13: Integration Test — End-to-End Flow

- [ ] **Step 1: Test session creation**

Open `https://devroom.lan/general`. Click NEW SESSION. Enter a name. Click CREATE.
Expected: Tab appears, chat area shows empty, header shows session name with controls.

- [ ] **Step 2: Test sending a message**

Type "Hello GENERAL, report for duty." and press Enter.
Expected: Commander message appears right-aligned in green. Loading indicator shows. GENERAL responds in amber with military brevity.

- [ ] **Step 3: Test tab switching**

Create a second session via the + button. Switch between tabs.
Expected: Each tab shows its own conversation history. No cross-contamination.

- [ ] **Step 4: Test session close**

Click the × on a tab. Confirm in the modal.
Expected: Tab disappears. If it was active, switches to another tab (or empty state if last).

- [ ] **Step 5: Test /sitrep command**

Type `/sitrep` and send.
Expected: GENERAL queries the database and returns a situation report with tables showing mission/campaign status.

- [ ] **Step 6: Test command reference**

Click the `?` button in the tab bar.
Expected: Command reference panel slides out on the right showing all available commands grouped by category.

- [ ] **Step 7: Test CLEAR CONTEXT**

Click the CLEAR CONTEXT button in the chat header.
Expected: System message divider `── CONTEXT CLEARED ──` appears in the chat. GENERAL loses prior context on next message.

- [ ] **Step 8: Test battlefield-linked session**

Navigate to a battlefield page, find the CONSULT GENERAL link (or manually go to `/general?battlefield=<id>`).
Expected: Auto-creates a session named after the battlefield codename. GENERAL knows which battlefield to focus on.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat(general): complete standalone GENERAL chat page"
```

---

## Summary

| Task | Description | Files |
|---|---|---|
| 1 | Database schema | `schema.ts` + migration |
| 2 | System prompt builder | `general-prompt.ts` |
| 3 | Custom commands | `general-commands.ts` |
| 4 | Engine (process management) | `general-engine.ts` |
| 5 | Server actions | `actions/general.ts` |
| 6 | Socket.IO events | `socket/server.ts` |
| 7 | Client hook | `use-general.ts` |
| 8 | Navigation | `global-nav.tsx` |
| 9 | Modals | `new-session-modal.tsx`, `close-session-modal.tsx` |
| 10 | Command reference | `command-reference.tsx` |
| 11 | Main chat component | `general-chat.tsx` |
| 12 | Page | `general/page.tsx` |
| 13 | Integration test | Manual end-to-end verification |
