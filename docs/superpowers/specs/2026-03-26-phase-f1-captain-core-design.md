# Phase F1: Captain Core — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** F1 (Captain Core)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Phase F1 adds the Captain — an AI decision layer that autonomously answers agent questions during mission execution. When a Claude Code agent pauses to ask a design or architecture question, the Captain detects the stall via stream-json protocol state, makes a decision using project context, writes the answer to the agent's stdin, and logs the decision for Commander review.

---

## 1. Captain Decision Engine

**File:** `src/lib/captain/captain.ts`

### Interface

```typescript
interface CaptainDecision {
  answer: string;
  reasoning: string;
  escalate: boolean;
  confidence: 'high' | 'medium' | 'low';
}

async function askCaptain(params: {
  question: string;
  missionBriefing: string;
  claudeMd: string | null;
  recentOutput: string;
  captainHistory: CaptainLog[];
  campaignContext?: string;
}): Promise<CaptainDecision>
```

### Implementation

Spawns Claude Code with `--print --dangerously-skip-permissions --max-turns 1`:
- Write prompt to temp file (same pattern as plan generator)
- `cwd`: battlefield repo path (so Captain can reference project structure)
- Parse JSON response: `{ answer, reasoning, escalate, confidence }`
- Fallback if JSON parse fails: use raw output as answer, set confidence to 'low'

### Captain's System Prompt

```
You are the CAPTAIN of DEVROOM operations, serving under the Commander.
Your role is to make tactical decisions for AI agents executing missions.

RULES:
- Be decisive. Never hedge or ask for more information.
- Align decisions with the project's conventions (CLAUDE.md provided).
- Align with the mission briefing objectives.
- Choose the simplest approach that satisfies the requirements.
- If the question involves a MAJOR architectural change that contradicts
  CLAUDE.md or the mission briefing, set escalate=true.
- If you're genuinely uncertain between two valid approaches, set
  confidence='low' and escalate=true.
- Keep answers concise — the agent is waiting.
- Log your reasoning clearly — the Commander reviews your decisions.

Respond ONLY with a JSON object:
{
  "answer": "Your decisive response to the agent",
  "reasoning": "Why you chose this approach (1-2 sentences)",
  "escalate": false,
  "confidence": "high"
}
```

### Context Assembly

The prompt sent to the Captain includes:
1. Captain's system prompt (above)
2. CLAUDE.md content (if exists) — project conventions
3. Mission briefing — what the agent was asked to do
4. Campaign context (if campaign mission) — objective, phase, previous debrief
5. Recent agent output — last ~2000 chars showing what the agent has been doing
6. The question — what the agent is asking
7. Captain's recent history — last 5 captain log entries for this mission (so it doesn't contradict itself)

---

## 2. Agent Stdin Mediation

**Modify:** `src/lib/orchestrator/executor.ts`

### Detection: Stream-JSON Protocol State

The reliable signal that an agent is waiting for input:

1. An `assistant` message was emitted
2. The message's content does NOT contain a `tool_use` block (agent didn't call a tool)
3. No new `stream_event`, `assistant`, or `user` messages arrive for 15 seconds
4. No `result` message has been received (process is still running)

This combination means: Claude finished speaking, didn't invoke a tool, and is waiting for human input.

### Implementation

Add to the executor, after the stream parser setup:

**New state variables:**
```typescript
let lastAssistantContent = '';
let lastActivityTime = Date.now();
let waitingForInput = false;
let lastMessageHadToolUse = false;
let stallCheckInterval: NodeJS.Timeout;
```

**Update on each parsed event:**
- `onDelta`, `onAssistantTurn`, `onToolUse`, `onToolResult`, `onResult`: set `lastActivityTime = Date.now()`
- `onAssistantTurn(content)`: set `lastAssistantContent = content`, `lastMessageHadToolUse = false`
- `onToolUse`: set `lastMessageHadToolUse = true`
- `onResult`: set `waitingForInput = false` (process is done)

**Stall detection interval (every 5 seconds):**
```typescript
stallCheckInterval = setInterval(async () => {
  if (waitingForInput) return; // Already handling a stall

  const silenceMs = Date.now() - lastActivityTime;

  if (
    silenceMs > 15_000 &&          // 15 seconds of silence
    lastAssistantContent &&         // There was an assistant message
    !lastMessageHadToolUse &&       // It didn't call a tool
    !streamResult                   // No result yet (process still running)
  ) {
    waitingForInput = true;

    try {
      // Get Captain's decision
      const decision = await askCaptain({
        question: lastAssistantContent,
        missionBriefing: mission.briefing,
        claudeMd: claudeMdContent,
        recentOutput: recentOutputBuffer.slice(-2000),
        captainHistory: await getRecentCaptainLogs(mission.id, 5),
        campaignContext: campaignContextString || undefined,
      });

      // Store in captain log
      await storeCaptainLog({
        missionId: mission.id,
        campaignId: mission.campaignId,
        battlefieldId: mission.battlefieldId,
        question: lastAssistantContent,
        answer: decision.answer,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        escalated: decision.escalate ? 1 : 0,
      });

      // Show in mission comms
      const captainMsg = `[CAPTAIN] ${decision.answer}\n(confidence: ${decision.confidence})`;
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'status',
        content: captainMsg + '\n',
      });
      storeLog('status', captainMsg);

      // Write to agent's stdin
      proc.stdin?.write(decision.answer + '\n');

      // Reset detection
      lastAssistantContent = '';
      lastActivityTime = Date.now();

      // Handle escalation
      if (decision.escalate) {
        io.to('hq:activity').emit('activity:event', {
          type: 'captain:escalation',
          battlefieldCodename: battlefield?.codename || 'UNKNOWN',
          missionTitle: mission.title,
          timestamp: Date.now(),
          detail: `Captain escalation: ${decision.reasoning}`,
        });
      }
    } finally {
      waitingForInput = false;
    }
  }
}, 5_000);
```

**Cleanup:** Clear `stallCheckInterval` when the process closes (in the `proc.on('close')` handler and in the catch block).

**Recent output buffer:** Maintain a rolling string of the last ~2000 chars:
```typescript
let recentOutputBuffer = '';
// In onDelta callback:
recentOutputBuffer += text;
if (recentOutputBuffer.length > 3000) {
  recentOutputBuffer = recentOutputBuffer.slice(-2000);
}
```

---

## 3. Captain's Log Schema

**New table in `src/lib/db/schema.ts`:**

```typescript
export const captainLogs = sqliteTable('captain_logs', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  reasoning: text('reasoning').notNull(),
  confidence: text('confidence').notNull(),  // 'high' | 'medium' | 'low'
  escalated: integer('escalated').default(0),
  timestamp: integer('timestamp').notNull(),
});
```

Requires a Drizzle migration.

### Types

Add to `src/types/index.ts`:
```typescript
export type CaptainLog = InferSelectModel<typeof captainLogs>;
export type CaptainConfidence = 'high' | 'medium' | 'low';
```

---

## 4. Captain Server Actions

**File:** `src/actions/captain.ts`

```typescript
'use server';
```

### Actions

**`getCaptainLogs(filters?)`:**
- Optional filters: `missionId`, `battlefieldId`, `campaignId`, `escalatedOnly: boolean`
- Order by `timestamp` desc
- Return `CaptainLog[]`

**`getCaptainStats()`:**
- Total decisions count
- Escalation count + rate
- Confidence distribution (high/medium/low counts)
- Return summary object

**`getRecentCaptainLogs(missionId, limit)`:**
- Last N captain logs for a mission
- Used by the Captain itself for context (its own history)

---

## 5. Captain's Log UI

### Per-Mission View

**Modify:** `src/components/mission/mission-comms.tsx`

Captain messages already appear inline in the comms terminal (emitted as `mission:log` with `type: 'status'` and `[CAPTAIN]` prefix). No additional change needed for inline display.

**Add:** A `[CAPTAIN'S LOG]` toggle/tab on the mission detail page that shows only Captain decisions for this mission:

- Each entry: timestamp, question (in a dim block), answer (green), reasoning (muted italic), confidence badge (green/amber/red), escalation flag
- Query via `getCaptainLogs({ missionId })`

### Global Captain's Log Page

**New route:** `/captain-log`

**New page:** `src/app/captain-log/page.tsx` — Server Component

**Layout:**
- Header: `CAPTAIN'S LOG` (amber)
- Stats bar: total decisions, escalation rate, confidence distribution
- Filters: battlefield dropdown, campaign dropdown, confidence level, escalated-only toggle
- Log entries: scrollable list, each showing mission title, question, answer, reasoning, confidence, timestamp
- Click an entry → links to the mission detail page

**New sidebar link:** `⚓ CAPTAIN'S LOG` → `/captain-log` (in the global section alongside LOGISTICS)

---

## 6. What Is NOT Built in F1

- Telegram notifications for escalations — Phase F2
- Captain auto-reviewing debriefs — Phase F3
- Captain handling campaign failures autonomously — Phase F3
- In-app notification panel — Phase F3
- Commander reply handling — Phase F2

In F1, escalations are emitted as `activity:event` (visible in HQ activity feed) but no Telegram notification.

---

## 7. End State

After F1:
1. Agent asks a question → 15 seconds of silence detected → Captain called
2. Captain reads project context + mission briefing + its own history → makes a decision
3. Decision written to agent's stdin → agent continues executing
4. Decision logged in `captainLogs` table with question, answer, reasoning, confidence
5. Decision visible in mission comms terminal as `[CAPTAIN]` message
6. Per-mission Captain's Log viewable on mission detail page
7. Global Captain's Log page for auditing all decisions
8. Escalation events emitted to HQ activity feed
