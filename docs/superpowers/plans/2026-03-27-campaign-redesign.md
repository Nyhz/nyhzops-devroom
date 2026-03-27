# Campaign Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the campaign system around a conversational briefing with GENERAL, replacing the one-shot plan generator with an interactive chat that produces the campaign plan.

**Architecture:** New briefing session concept (separate from missions) with two DB tables, a briefing engine that spawns/resumes GENERAL via Claude CLI, Socket.IO streaming for real-time chat, and state-based campaign page rendering. The existing plan editor, phase/mission data model, and campaign executor are preserved.

**Tech Stack:** Drizzle ORM (SQLite), Claude CLI (`--print`, `--resume`, stdin piping), Socket.IO, Next.js App Router (Server + Client Components).

**Spec:** `docs/superpowers/specs/2026-03-27-campaign-redesign-design.md`

---

### Task 1: Schema — Briefing Session Tables

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/types/index.ts`
- Create: new Drizzle migration

- [ ] **Step 1: Add briefing tables to schema**

In `src/lib/db/schema.ts`, add after the `phases` table (after line 88):

```typescript
// ---------------------------------------------------------------------------
// Briefing Sessions (GENERAL 1-on-1 chat for campaign planning)
// ---------------------------------------------------------------------------
export const briefingSessions = sqliteTable('briefing_sessions', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  sessionId: text('session_id'),
  assetId: text('asset_id').references(() => assets.id),
  status: text('status').default('open'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const briefingMessages = sqliteTable('briefing_messages', {
  id: text('id').primaryKey(),
  briefingId: text('briefing_id').notNull().references(() => briefingSessions.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  timestamp: integer('timestamp').notNull(),
});
```

- [ ] **Step 2: Add types**

In `src/types/index.ts`, add:

```typescript
export type BriefingSession = InferSelectModel<typeof briefingSessions>;
export type BriefingMessage = InferSelectModel<typeof briefingMessages>;
```

Also update `CampaignStatus` — remove `'paused'`, add `'abandoned'`:

```typescript
export type CampaignStatus = 'draft' | 'planning' | 'active' | 'accomplished' | 'compromised' | 'abandoned';
```

- [ ] **Step 3: Generate and apply migration**

Run: `npx drizzle-kit generate`
Run: `npx drizzle-kit migrate`

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: May have errors if `'paused'` is referenced elsewhere. Fix any references to `'paused'` status — change to `'compromised'` where it means "failed" or remove where it was a UI control.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/types/index.ts src/lib/db/migrations/
git commit -m "feat: add briefing session tables, update CampaignStatus type"
```

---

### Task 2: Briefing Engine — Core

**Files:**
- Create: `src/lib/briefing/briefing-prompt.ts`
- Create: `src/lib/briefing/briefing-engine.ts`

- [ ] **Step 1: Create the briefing prompt builder**

Create `src/lib/briefing/briefing-prompt.ts`:

```typescript
import fs from 'fs';
import { getDatabase } from '@/lib/db/index';
import { assets, battlefields, campaigns } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { Asset } from '@/types';

export function buildBriefingPrompt(params: {
  campaignName: string;
  campaignObjective: string;
  battlefieldCodename: string;
  claudeMdPath: string | null;
  specMdPath: string | null;
  allAssets: Asset[];
}): string {
  const sections: string[] = [];

  sections.push(`You are GENERAL, a campaign planning and coordination specialist for NYHZ OPS DEVROOM.

You are in a briefing session with the Commander for campaign: "${params.campaignName}"
Battlefield: ${params.battlefieldCodename}

CAMPAIGN OBJECTIVE:
${params.campaignObjective}`);

  // Project context
  if (params.claudeMdPath) {
    try {
      const content = fs.readFileSync(params.claudeMdPath, 'utf-8');
      const trimmed = content.length > 8000 ? content.slice(0, 8000) + '\n\n[...truncated]' : content;
      sections.push(`PROJECT CONTEXT (CLAUDE.md):\n${trimmed}`);
    } catch { /* file may not exist */ }
  }

  if (params.specMdPath) {
    try {
      const content = fs.readFileSync(params.specMdPath, 'utf-8');
      const trimmed = content.length > 8000 ? content.slice(0, 8000) + '\n\n[...truncated]' : content;
      sections.push(`PROJECT SPEC (SPEC.md):\n${trimmed}`);
    } catch { /* file may not exist */ }
  }

  // Available assets
  const assetList = params.allAssets
    .filter(a => a.status === 'active' && a.codename !== 'GENERAL')
    .map(a => `- ${a.codename}: ${a.specialty}`)
    .join('\n');
  sections.push(`AVAILABLE ASSETS:\n${assetList}`);

  sections.push(`YOUR ORDERS:
- Ask the Commander clarifying questions to deeply understand the objective
- Discuss technical approach, risks, and trade-offs
- Propose a phased plan with concrete missions
- Consider inter-mission dependencies — what must complete before what
- Assign appropriate assets to each mission based on their specialties
- The Commander will give the order "GENERATE PLAN" when satisfied

When the Commander says "GENERATE PLAN", output the final plan as JSON:
{
  "summary": "Brief campaign summary",
  "phases": [
    {
      "name": "Phase name",
      "objective": "Phase objective",
      "missions": [
        {
          "title": "Mission title",
          "briefing": "Detailed mission briefing — the asset has NO context beyond what you write here",
          "assetCodename": "OPERATIVE",
          "priority": "normal",
          "dependsOn": ["Other mission title in same phase"]
        }
      ]
    }
  ]
}

Rules:
- Phases execute SEQUENTIALLY (Phase 1 completes before Phase 2 starts)
- Missions within a phase can execute IN PARALLEL if no dependencies
- dependsOn references mission titles within the SAME phase only
- Each mission briefing must be self-contained and detailed
- Assign assets by specialty: OPERATIVE for code, ASSERT for testing, DISTILL for docs, WATCHDOG for reviews`);

  return sections.join('\n\n---\n\n');
}

export function buildResumeContext(messages: { role: string; content: string }[]): string {
  return messages.map(m =>
    m.role === 'commander'
      ? `Commander: ${m.content}`
      : `GENERAL: ${m.content}`
  ).join('\n\n');
}
```

- [ ] **Step 2: Create the briefing engine**

Create `src/lib/briefing/briefing-engine.ts`:

```typescript
import { spawn } from 'child_process';
import { eq } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import {
  briefingSessions,
  briefingMessages,
  campaigns,
  battlefields,
  assets,
  phases,
  missions,
} from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildBriefingPrompt, buildResumeContext } from './briefing-prompt';
import type { Asset, PlanJSON } from '@/types';

// Active briefing processes (campaignId → AbortController)
const activeProcesses = new Map<string, AbortController>();

export async function sendBriefingMessage(
  campaignId: string,
  message: string,
  io: SocketIOServer,
): Promise<void> {
  const db = getDatabase();
  const room = `briefing:${campaignId}`;

  // Get or create briefing session
  let session = db.select().from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId)).get();

  if (!session) {
    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, campaignId)).get();
    if (!campaign) throw new Error('Campaign not found');

    const general = db.select().from(assets)
      .where(eq(assets.codename, 'GENERAL')).get();
    if (!general) throw new Error('GENERAL asset not found');

    const id = generateId();
    db.insert(briefingSessions).values({
      id,
      campaignId,
      assetId: general.id,
      status: 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    session = db.select().from(briefingSessions)
      .where(eq(briefingSessions.id, id)).get()!;
  }

  // Store commander message
  db.insert(briefingMessages).values({
    id: generateId(),
    briefingId: session.id,
    role: 'commander',
    content: message,
    timestamp: Date.now(),
  }).run();

  // Abort any previous in-flight response
  const prev = activeProcesses.get(campaignId);
  if (prev) prev.abort();

  const ac = new AbortController();
  activeProcesses.set(campaignId, ac);

  // Build args
  const general = db.select().from(assets)
    .where(eq(assets.codename, 'GENERAL')).get()!;

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--max-turns', '1',
    '--model', general.model || 'claude-opus-4-6',
  ];

  // Resume or first message
  if (session.sessionId) {
    args.push('--resume', session.sessionId);
  }

  const campaign = db.select().from(campaigns)
    .where(eq(campaigns.id, campaignId)).get()!;
  const battlefield = db.select().from(battlefields)
    .where(eq(battlefields.id, campaign.battlefieldId)).get()!;

  // For first message, build full system prompt + message
  // For resume, just send the message
  let stdinContent: string;
  if (!session.sessionId) {
    const allAssets = db.select().from(assets).all() as Asset[];
    const systemPrompt = buildBriefingPrompt({
      campaignName: campaign.name,
      campaignObjective: campaign.objective,
      battlefieldCodename: battlefield.codename,
      claudeMdPath: battlefield.claudeMdPath,
      specMdPath: battlefield.specMdPath,
      allAssets,
    });
    stdinContent = systemPrompt + '\n\n---\n\nCommander: ' + message;
  } else {
    stdinContent = message;
  }

  const proc = spawn(config.claudePath, args, {
    cwd: battlefield.repoPath,
    signal: ac.signal,
  });

  let fullResponse = '';
  let newSessionId: string | null = null;

  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    fullResponse += chunk;
    io.to(room).emit('briefing:chunk', { campaignId, content: chunk });
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    // Claude CLI outputs session ID to stderr
    const sessionMatch = text.match(/session_id:\s*(\S+)/);
    if (sessionMatch) {
      newSessionId = sessionMatch[1];
    }
  });

  proc.stdin?.write(stdinContent);
  proc.stdin?.end();

  proc.on('close', (code) => {
    activeProcesses.delete(campaignId);

    if (ac.signal.aborted) return;

    if (code === 0 && fullResponse.trim()) {
      // Store GENERAL's response
      const msgId = generateId();
      db.insert(briefingMessages).values({
        id: msgId,
        briefingId: session!.id,
        role: 'general',
        content: fullResponse.trim(),
        timestamp: Date.now(),
      }).run();

      // Update session ID for resume
      if (newSessionId) {
        db.update(briefingSessions).set({
          sessionId: newSessionId,
          updatedAt: Date.now(),
        }).where(eq(briefingSessions.id, session!.id)).run();
      }

      io.to(room).emit('briefing:complete', { campaignId, messageId: msgId });

      // Check if this was a GENERATE PLAN response
      if (message.toUpperCase().includes('GENERATE PLAN')) {
        const plan = extractPlan(fullResponse);
        if (plan) {
          insertPlanAndTransition(campaignId, plan);
          io.to(room).emit('briefing:plan-ready', { campaignId });
        }
      }
    } else {
      io.to(room).emit('briefing:error', {
        campaignId,
        error: `GENERAL process exited with code ${code}`,
      });
    }
  });

  proc.on('error', (err) => {
    activeProcesses.delete(campaignId);
    if (!ac.signal.aborted) {
      io.to(room).emit('briefing:error', {
        campaignId,
        error: err.message,
      });
    }
  });
}

function extractPlan(text: string): PlanJSON | null {
  // Try extracting JSON from the response
  // 1. Look for markdown fenced JSON
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]) as PlanJSON; } catch { /* continue */ }
  }

  // 2. Look for raw JSON object
  const braceMatch = text.match(/\{[\s\S]*"phases"[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]) as PlanJSON; } catch { /* continue */ }
  }

  return null;
}

function insertPlanAndTransition(campaignId: string, plan: PlanJSON): void {
  const db = getDatabase();

  // Delete existing plan data
  const existingPhases = db.select({ id: phases.id }).from(phases)
    .where(eq(phases.campaignId, campaignId)).all();
  for (const p of existingPhases) {
    db.delete(missions).where(eq(missions.phaseId, p.id)).run();
  }
  db.delete(phases).where(eq(phases.campaignId, campaignId)).run();

  // Insert new plan
  const now = Date.now();
  for (let pi = 0; pi < plan.phases.length; pi++) {
    const phase = plan.phases[pi];
    const phaseId = generateId();

    db.insert(phases).values({
      id: phaseId,
      campaignId,
      phaseNumber: pi + 1,
      name: phase.name,
      objective: phase.objective || '',
      status: 'standby',
      createdAt: now,
    }).run();

    for (const mission of phase.missions) {
      // Look up asset by codename
      const asset = db.select().from(assets)
        .where(eq(assets.codename, mission.assetCodename)).get();

      db.insert(missions).values({
        id: generateId(),
        battlefieldId: db.select({ bid: campaigns.battlefieldId }).from(campaigns)
          .where(eq(campaigns.id, campaignId)).get()!.bid,
        campaignId,
        phaseId,
        title: mission.title,
        briefing: mission.briefing,
        status: 'standby',
        priority: mission.priority || 'normal',
        assetId: asset?.id ?? null,
        dependsOn: mission.dependsOn?.length
          ? JSON.stringify(mission.dependsOn)
          : null,
        useWorktree: 1,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }

  // Transition campaign to planning
  db.update(campaigns).set({
    status: 'planning',
    updatedAt: now,
  }).where(eq(campaigns.id, campaignId)).run();
}

export function deleteBriefingData(campaignId: string): void {
  const db = getDatabase();
  const session = db.select().from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId)).get();
  if (session) {
    db.delete(briefingMessages).where(eq(briefingMessages.briefingId, session.id)).run();
    db.delete(briefingSessions).where(eq(briefingSessions.id, session.id)).run();
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/lib/briefing/
git commit -m "feat: add briefing engine and prompt builder for GENERAL campaign planning"
```

---

### Task 3: Briefing Server Actions

**Files:**
- Create: `src/actions/briefing.ts`

- [ ] **Step 1: Create briefing actions**

Create `src/actions/briefing.ts`:

```typescript
'use server';

import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { briefingSessions, briefingMessages } from '@/lib/db/schema';

export async function getBriefingMessages(campaignId: string) {
  const db = getDatabase();

  const session = db.select().from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId)).get();

  if (!session) return [];

  return db.select().from(briefingMessages)
    .where(eq(briefingMessages.briefingId, session.id))
    .orderBy(briefingMessages.timestamp)
    .all();
}

export async function getBriefingSession(campaignId: string) {
  const db = getDatabase();
  return db.select().from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId)).get() ?? null;
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/actions/briefing.ts
git commit -m "feat: add briefing server actions"
```

---

### Task 4: Socket.IO — Briefing Room

**Files:**
- Modify: `src/lib/socket/server.ts`

- [ ] **Step 1: Add briefing room handlers**

In `src/lib/socket/server.ts`, add after the `campaign:unsubscribe` handler (after line 47):

```typescript
    socket.on('briefing:subscribe', (campaignId: string) => {
      socket.join(`briefing:${campaignId}`);
    });

    socket.on('briefing:unsubscribe', (campaignId: string) => {
      socket.leave(`briefing:${campaignId}`);
    });

    socket.on('briefing:send', async (data: { campaignId: string; message: string }) => {
      try {
        const { sendBriefingMessage } = await import('@/lib/briefing/briefing-engine');
        await sendBriefingMessage(data.campaignId, data.message, io);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Briefing failed';
        socket.emit('briefing:error', { campaignId: data.campaignId, error: message });
      }
    });
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lib/socket/server.ts
git commit -m "feat: add briefing Socket.IO room handlers"
```

---

### Task 5: Briefing Chat Hook

**Files:**
- Create: `src/hooks/use-briefing.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/use-briefing.ts`:

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './use-socket';

interface BriefingMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export function useBriefing(campaignId: string, initialMessages: BriefingMessage[]) {
  const socket = useSocket();
  const [messages, setMessages] = useState<BriefingMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planReady, setPlanReady] = useState(false);
  const streamRef = useRef('');

  useEffect(() => {
    if (!socket) return;

    socket.emit('briefing:subscribe', campaignId);

    const handleChunk = (data: { campaignId: string; content: string }) => {
      if (data.campaignId === campaignId) {
        streamRef.current += data.content;
        setStreaming(streamRef.current);
      }
    };

    const handleComplete = (data: { campaignId: string; messageId: string }) => {
      if (data.campaignId === campaignId) {
        setMessages(prev => [
          ...prev,
          {
            id: data.messageId,
            role: 'general',
            content: streamRef.current,
            timestamp: Date.now(),
          },
        ]);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handleError = (data: { campaignId: string; error: string }) => {
      if (data.campaignId === campaignId) {
        setError(data.error);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handlePlanReady = (data: { campaignId: string }) => {
      if (data.campaignId === campaignId) {
        setPlanReady(true);
      }
    };

    socket.on('briefing:chunk', handleChunk);
    socket.on('briefing:complete', handleComplete);
    socket.on('briefing:error', handleError);
    socket.on('briefing:plan-ready', handlePlanReady);

    return () => {
      socket.off('briefing:chunk', handleChunk);
      socket.off('briefing:complete', handleComplete);
      socket.off('briefing:error', handleError);
      socket.off('briefing:plan-ready', handlePlanReady);
      socket.emit('briefing:unsubscribe', campaignId);
    };
  }, [socket, campaignId]);

  const sendMessage = useCallback((message: string) => {
    if (!socket || isLoading) return;

    setIsLoading(true);
    setError(null);
    setPlanReady(false);
    streamRef.current = '';
    setStreaming('');

    // Add commander message to local state immediately
    setMessages(prev => [
      ...prev,
      {
        id: `cmd-${Date.now()}`,
        role: 'commander',
        content: message,
        timestamp: Date.now(),
      },
    ]);

    socket.emit('briefing:send', { campaignId, message });
  }, [socket, campaignId, isLoading]);

  return { messages, streaming, isLoading, error, planReady, sendMessage };
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/hooks/use-briefing.ts
git commit -m "feat: add useBriefing hook for real-time chat"
```

---

### Task 6: Briefing Chat UI Component

**Files:**
- Create: `src/components/campaign/briefing-chat.tsx`

- [ ] **Step 1: Create the chat component**

Create `src/components/campaign/briefing-chat.tsx`:

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBriefing } from '@/hooks/use-briefing';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextarea } from '@/components/ui/tac-input';

interface BriefingChatProps {
  campaignId: string;
  initialMessages: { id: string; role: string; content: string; timestamp: number }[];
}

export function BriefingChat({ campaignId, initialMessages }: BriefingChatProps) {
  const router = useRouter();
  const { messages, streaming, isLoading, error, planReady, sendMessage } = useBriefing(campaignId, initialMessages);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Navigate to planning view when plan is ready
  useEffect(() => {
    if (planReady) {
      router.refresh();
    }
  }, [planReady, router]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput('');
    sendMessage(msg);
  };

  const handleGeneratePlan = () => {
    if (isLoading) return;
    sendMessage('GENERATE PLAN');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[600px] border border-dr-border bg-dr-bg">
      {/* Chat header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-dr-green text-xs">●</span>
          <span className="text-dr-amber font-tactical text-sm tracking-wider">
            GENERAL — BRIEFING SESSION
          </span>
        </div>
        <TacButton
          variant="success"
          size="sm"
          onClick={handleGeneratePlan}
          disabled={isLoading || messages.length < 2}
        >
          GENERATE PLAN
        </TacButton>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-dr-dim font-tactical text-sm text-center py-8">
            Begin your briefing with GENERAL. Describe your objective and GENERAL will help you plan the campaign.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'commander' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${
              msg.role === 'commander'
                ? 'bg-dr-elevated border border-dr-border'
                : 'bg-dr-surface border border-dr-amber/20'
            } p-3`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-tactical text-[10px] tracking-wider ${
                  msg.role === 'commander' ? 'text-dr-green' : 'text-dr-amber'
                }`}>
                  {msg.role === 'commander' ? 'COMMANDER' : 'GENERAL'}
                </span>
              </div>
              <div className="text-dr-text font-data text-sm whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-dr-surface border border-dr-amber/20 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-tactical text-[10px] tracking-wider text-dr-amber">
                  GENERAL
                </span>
                <span className="w-1.5 h-3 bg-dr-amber/70 animate-pulse" />
              </div>
              <div className="text-dr-text font-data text-sm whitespace-pre-wrap leading-relaxed">
                {streaming}
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streaming && (
          <div className="flex justify-start">
            <div className="bg-dr-surface border border-dr-amber/20 p-3">
              <span className="text-dr-amber font-tactical text-xs animate-pulse">
                GENERAL is thinking...
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-dr-red/10 border border-dr-red/30 p-3 text-dr-red font-data text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-dr-border bg-dr-surface p-3">
        <div className="flex gap-3">
          <TacTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Brief the GENERAL..."
            rows={2}
            className="flex-1 resize-none"
            disabled={isLoading}
          />
          <TacButton
            variant="primary"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="self-end"
          >
            SEND
          </TacButton>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/campaign/briefing-chat.tsx
git commit -m "feat: add briefing chat UI component"
```

---

### Task 7: Campaign Results Component

**Files:**
- Create: `src/components/campaign/campaign-results.tsx`

- [ ] **Step 1: Create the results component**

Create `src/components/campaign/campaign-results.tsx`:

```typescript
import { formatDuration } from '@/lib/utils';

interface ResultMission {
  id: string;
  title: string;
  status: string | null;
  assetCodename: string | null;
  costInput: number | null;
  costOutput: number | null;
  costCacheHit: number | null;
  durationMs: number | null;
  debrief: string | null;
  phaseName: string;
  phaseNumber: number;
}

interface CampaignResultsProps {
  campaignName: string;
  missions: ResultMission[];
}

export function CampaignResults({ campaignName, missions }: CampaignResultsProps) {
  const totalDuration = missions.reduce((sum, m) => sum + (m.durationMs || 0), 0);
  const totalInput = missions.reduce((sum, m) => sum + (m.costInput || 0), 0);
  const totalOutput = missions.reduce((sum, m) => sum + (m.costOutput || 0), 0);
  const totalCache = missions.reduce((sum, m) => sum + (m.costCacheHit || 0), 0);
  const totalTokens = totalInput + totalOutput + totalCache;
  const totalCostUsd = (totalInput * 3 + totalOutput * 15 + totalCache * 0.3) / 1_000_000;
  const totalInputContext = totalInput + totalCache;
  const cacheHitPercent = totalInputContext > 0 ? Math.round((totalCache / totalInputContext) * 100) : 0;

  const accomplished = missions.filter(m => m.status === 'accomplished').length;
  const compromised = missions.filter(m => m.status === 'compromised').length;

  // Group by phase
  const phaseMap = new Map<number, { name: string; missions: ResultMission[] }>();
  for (const m of missions) {
    if (!phaseMap.has(m.phaseNumber)) {
      phaseMap.set(m.phaseNumber, { name: m.phaseName, missions: [] });
    }
    phaseMap.get(m.phaseNumber)!.missions.push(m);
  }
  const phaseList = Array.from(phaseMap.entries()).sort((a, b) => a[0] - b[0]);

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="MISSIONS" value={String(missions.length)} />
        <StatCard label="ACCOMPLISHED" value={String(accomplished)} color="text-dr-green" />
        <StatCard label="COMPROMISED" value={String(compromised)} color="text-dr-red" />
        <StatCard label="DURATION" value={formatDuration(totalDuration)} />
        <StatCard label="TOKENS" value={formatTokens(totalTokens)} />
        <StatCard label="COST" value={`$${totalCostUsd.toFixed(2)}`} color="text-dr-amber" />
      </div>

      {/* Cache hit */}
      <div className="bg-dr-surface border border-dr-border p-3 flex items-center gap-4 text-xs font-tactical">
        <span className="text-dr-dim">CACHE HIT</span>
        <span className="text-dr-green">{cacheHitPercent}%</span>
        <div className="flex-1 h-1.5 bg-dr-bg overflow-hidden">
          <div className="h-full bg-dr-green" style={{ width: `${cacheHitPercent}%` }} />
        </div>
      </div>

      {/* Phase-by-phase breakdown */}
      {phaseList.map(([phaseNum, phase]) => (
        <div key={phaseNum} className="border border-dr-border border-l-2 border-l-dr-green">
          <div className="bg-dr-elevated px-4 py-2 border-b border-dr-border">
            <span className="text-dr-dim font-tactical text-[10px] tracking-wider mr-2">
              PHASE {phaseNum}
            </span>
            <span className="text-dr-amber font-tactical text-sm">{phase.name}</span>
          </div>

          <div className="divide-y divide-dr-border/50">
            {phase.missions.map((m) => (
              <div key={m.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${m.status === 'accomplished' ? 'text-dr-green' : 'text-dr-red'}`}>●</span>
                    <span className="text-dr-text font-tactical text-sm">{m.title}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-tactical text-dr-dim">
                    <span>{m.assetCodename ?? 'UNASSIGNED'}</span>
                    <span>{m.durationMs ? formatDuration(m.durationMs) : '—'}</span>
                    <span>{formatTokens((m.costInput || 0) + (m.costOutput || 0) + (m.costCacheHit || 0))} tok</span>
                  </div>
                </div>
                {m.debrief && (
                  <div className="text-dr-muted font-data text-xs pl-6 line-clamp-3">
                    {m.debrief.split('\n')[0]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-dr-surface border border-dr-border p-3 text-center">
      <div className={`text-lg font-tactical ${color ?? 'text-dr-text'}`}>{value}</div>
      <div className="text-dr-dim font-tactical text-[10px] tracking-wider mt-1">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/campaign/campaign-results.tsx
git commit -m "feat: add campaign results component"
```

---

### Task 8: Campaign Actions — Rewire

**Files:**
- Modify: `src/actions/campaign.ts`

- [ ] **Step 1: Remove `generateBattlePlan` and plan-generator import**

In `src/actions/campaign.ts`:
- Remove the import of `generatePlan` from `@/lib/orchestrator/plan-generator` (line 8)
- Remove the entire `generateBattlePlan` function (lines 312-346)

- [ ] **Step 2: Add `backToDraft` action**

Add after the existing `updateCampaign` function:

```typescript
export async function backToDraft(campaignId: string): Promise<void> {
  const db = getDatabase();
  const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'planning') throw new Error('Can only go back to draft from planning');

  db.update(campaigns).set({
    status: 'draft',
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();

  revalidatePath(`/battlefields/${campaign.battlefieldId}/campaigns/${campaignId}`);
}
```

- [ ] **Step 3: Update `launchCampaign` to delete briefing data**

In the existing `launchCampaign` function, add after the status transition to `active`:

```typescript
  // Delete briefing data — no longer needed once campaign is live
  const { deleteBriefingData } = await import('@/lib/briefing/briefing-engine');
  deleteBriefingData(campaignId);
```

- [ ] **Step 4: Update `abandonCampaign` to set status to `abandoned` (not `compromised`)**

In `abandonCampaign`, change the campaign status from `'compromised'` to `'abandoned'`.

- [ ] **Step 5: Remove `resumeCampaign` and `skipAndContinueCampaign` — replace with tactical override**

Remove both `resumeCampaign` and `skipAndContinueCampaign` functions. Add:

```typescript
export async function tacticalOverride(
  missionId: string,
  newBriefing: string,
): Promise<void> {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) throw new Error('Mission not found');
  if (mission.status !== 'compromised') throw new Error('Can only override compromised missions');

  const now = Date.now();

  // Reset mission for redeployment with updated briefing
  db.update(missions).set({
    briefing: newBriefing,
    status: 'queued',
    debrief: null,
    reviewAttempts: 0,
    completedAt: null,
    startedAt: null,
    updatedAt: now,
  }).where(eq(missions.id, missionId)).run();

  // If campaign is compromised, move back to active
  if (mission.campaignId) {
    const campaign = db.select().from(campaigns).where(eq(campaigns.id, mission.campaignId)).get();
    if (campaign && campaign.status === 'compromised') {
      db.update(campaigns).set({
        status: 'active',
        updatedAt: now,
      }).where(eq(campaigns.id, mission.campaignId)).run();
    }
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}`);

  // Trigger orchestrator
  globalThis.orchestrator?.onMissionQueued(missionId);
}

export async function skipMission(missionId: string): Promise<void> {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) throw new Error('Mission not found');
  if (mission.status !== 'compromised') throw new Error('Can only skip compromised missions');

  const now = Date.now();

  // Abandon this mission
  db.update(missions).set({
    status: 'abandoned',
    completedAt: now,
    updatedAt: now,
  }).where(eq(missions.id, missionId)).run();

  // Cascade-abandon dependent missions in same phase
  if (mission.phaseId) {
    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, mission.phaseId)).all();

    const abandonedTitles = new Set<string>([mission.title]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of phaseMissions) {
        if (m.status === 'standby' && m.dependsOn) {
          const deps = JSON.parse(m.dependsOn) as string[];
          if (deps.some(d => abandonedTitles.has(d))) {
            db.update(missions).set({
              status: 'abandoned',
              completedAt: now,
              updatedAt: now,
            }).where(eq(missions.id, m.id)).run();
            abandonedTitles.add(m.title);
            m.status = 'abandoned';
            changed = true;
          }
        }
      }
    }
  }

  // If campaign is compromised, move back to active
  if (mission.campaignId) {
    const campaign = db.select().from(campaigns).where(eq(campaigns.id, mission.campaignId)).get();
    if (campaign && campaign.status === 'compromised') {
      db.update(campaigns).set({
        status: 'active',
        updatedAt: now,
      }).where(eq(campaigns.id, mission.campaignId)).run();

      // Notify campaign executor to check phase completion
      const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
      if (executor && mission.phaseId) {
        executor.onCampaignMissionComplete(missionId).catch(console.error);
      }
    }
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}`);
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Fix any errors from removed functions (references in campaign-controls, campaign-executor, etc.).

- [ ] **Step 7: Commit**

```bash
git add src/actions/campaign.ts
git commit -m "feat: rewire campaign actions — add tactical override, skip, back-to-draft, remove old plan generator"
```

---

### Task 9: Campaign Controls — New Buttons

**Files:**
- Modify: `src/components/campaign/campaign-controls.tsx`

- [ ] **Step 1: Rewrite campaign controls for new flow**

Replace the full `campaign-controls.tsx` to reflect new status flow:

- **DRAFT**: DELETE only
- **PLANNING**: GREEN LIGHT, BACK TO BRIEFING, DELETE
- **ACTIVE**: ABANDON
- **COMPROMISED**: TACTICAL OVERRIDE (if there's a compromised mission), SKIP MISSION, ABANDON
- **ACCOMPLISHED**: REDEPLOY, SAVE AS TEMPLATE
- **ABANDONED**: REDEPLOY

Remove all references to `resumeCampaign`, `skipAndContinueCampaign`, `generateBattlePlan`. Import new actions: `backToDraft`, `tacticalOverride`, `skipMission`.

The TACTICAL OVERRIDE button should open a modal with a textarea pre-filled with the failed mission's original briefing + captain's concerns. SKIP MISSION should use the `useConfirm` hook.

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/campaign/campaign-controls.tsx
git commit -m "feat: campaign controls — GREEN LIGHT, BACK TO BRIEFING, TACTICAL OVERRIDE, SKIP MISSION"
```

---

### Task 10: Campaign Detail Page — State-Based Rendering

**Files:**
- Modify: `src/app/(hq)/battlefields/[id]/campaigns/[campaignId]/page.tsx`

- [ ] **Step 1: Rewrite the campaign detail page**

The page needs to render differently per status:

- **DRAFT**: Page header + `<BriefingChat>` component with initial messages from DB
- **PLANNING**: Page header + `<PlanEditor>` + campaign controls (GREEN LIGHT, BACK TO BRIEFING)
- **ACTIVE**: Page header + `<CampaignLiveView>` + campaign controls
- **COMPROMISED**: Same as ACTIVE but with red alert + TACTICAL OVERRIDE / SKIP / ABANDON
- **ACCOMPLISHED**: Page header + `<CampaignResults>` + campaign controls (REDEPLOY, SAVE AS TEMPLATE)
- **ABANDONED**: Page header + static view of what completed

Import `BriefingChat`, `CampaignResults`, `getBriefingMessages` from their respective modules. Remove `GeneratePlanButton` import.

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/app/(hq)/battlefields/[id]/campaigns/[campaignId]/page.tsx
git commit -m "feat: campaign detail page — state-based rendering with briefing chat and results"
```

---

### Task 11: Campaign Executor — Compromised → Not Paused

**Files:**
- Modify: `src/lib/orchestrator/campaign-executor.ts`

- [ ] **Step 1: Change pause to compromised**

In `campaign-executor.ts`, find the escalation block in `onPhaseComplete` (around lines 460-490) where it sets campaign status to `'paused'`. Change to `'compromised'`:

```typescript
db.update(campaigns).set({
  status: 'compromised',
  updatedAt: Date.now(),
}).where(eq(campaigns.id, this.campaignId)).run();
this.emitCampaignStatus('compromised');
```

Also update the escalation message from "Campaign Paused" to "Campaign Compromised".

- [ ] **Step 2: Remove references to `resumeCampaign` in the executor**

Search for any calls to `resume()` or references to `'paused'` status and update accordingly.

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lib/orchestrator/campaign-executor.ts
git commit -m "feat: campaign executor — compromised instead of paused on failure"
```

---

### Task 12: Cleanup — Remove Old Files

**Files:**
- Delete: `src/lib/orchestrator/plan-generator.ts`
- Delete: `src/components/campaign/generate-plan-button.tsx`

- [ ] **Step 1: Delete plan-generator.ts**

```bash
rm src/lib/orchestrator/plan-generator.ts
```

- [ ] **Step 2: Delete generate-plan-button.tsx**

```bash
rm src/components/campaign/generate-plan-button.tsx
```

- [ ] **Step 3: Remove any remaining imports**

Grep for `plan-generator` and `generate-plan-button` across the codebase. Remove any remaining imports.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Fix any remaining references.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove old plan generator and generate-plan button"
```

---

### Task 13: End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: Restart the dev server**

- [ ] **Step 2: Create a new campaign**

Navigate to a battlefield → Campaigns → + NEW CAMPAIGN. Enter name and objective.

- [ ] **Step 3: Verify briefing chat**

On the draft campaign page, verify:
- Chat UI appears with GENERAL header
- Type a message, GENERAL responds with streaming
- Multiple turns work (session resume)

- [ ] **Step 4: Generate plan**

Click GENERATE PLAN. Verify:
- GENERAL outputs JSON plan
- Campaign transitions to PLANNING
- Plan editor shows phases and missions

- [ ] **Step 5: Back to briefing**

Click BACK TO BRIEFING. Verify:
- Campaign goes back to DRAFT
- Chat history is preserved
- Can continue conversation

- [ ] **Step 6: Green light**

Click GREEN LIGHT. Verify:
- Campaign goes to ACTIVE
- Missions start executing
- Briefing messages are deleted from DB

- [ ] **Step 7: Verify results page**

After all missions complete, verify the ACCOMPLISHED view shows:
- Per-mission stats (asset, duration, cost, tokens, debrief)
- Campaign totals
- Phase-by-phase breakdown
