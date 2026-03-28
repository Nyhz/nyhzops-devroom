# GENERAL Chat — Design Spec

**Date:** 2026-03-28
**Status:** Approved

---

## Overview

A standalone chat page (`/general`) where the Commander can interact with GENERAL — a Claude Code instance with full DEVROOM admin access and a tactical advisor personality. GENERAL can query the database, browse battlefield repos, diagnose missions, and brainstorm ideas. Sessions are named, tabbed, and persistent.

This is not a campaign planner. It's the Commander's right hand — an always-available Claude Code terminal with personality, context, and DEVROOM awareness.

---

## Architecture

### Core Approach

Each session is a Claude Code process spawned with a system prompt that establishes GENERAL's personality and tells it where the DEVROOM database and battlefield repos live. Claude Code handles everything natively — reading SQLite, browsing files, running commands. No MCP server, no special tools, no status injection.

### Session Lifecycle

1. Commander creates a named session (optionally linked to a battlefield)
2. First message spawns Claude Code with `--system-prompt` + message
3. Claude Code returns a session ID — stored for `--resume` on subsequent messages
4. Commander can switch between sessions, each maintaining its own Claude Code conversation
5. Closing a session marks it inactive and kills any running process. History preserved in DB.

---

## System Prompt

```
You are GENERAL, senior strategic advisor and administrator of NYHZ OPS — DEVROOM,
an autonomous agent orchestration platform. You report directly to the Commander.

You are not a campaign planner here. You are the Commander's right hand — advisor,
diagnostician, architect, and operator. You have full access to this system.

DEVROOM DATABASE: /data/devroom.db (SQLite, WAL mode)
Key tables: battlefields, missions, campaigns, phases, assets, briefingSessions,
captainLogs, notifications, missionLogs, dossiers, scheduledTasks

BATTLEFIELD REPOS: /Users/nyhzdev/battlefields/

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
- Use tactical language naturally but don't overdo it
```

When a session is linked to a battlefield, the prompt appends:

```
ACTIVE BATTLEFIELD: {codename}
Repository: {repoPath}
Default branch: {defaultBranch}
The Commander opened this session from this battlefield's page. Focus your attention here unless directed otherwise.
```

---

## Database

### generalSessions

| Column | Type | Description |
|---|---|---|
| id | text PK | ULID |
| name | text | Commander-assigned session name |
| sessionId | text (nullable) | Claude Code resume session ID |
| battlefieldId | text (nullable) | FK to battlefields, if context-linked |
| status | text | 'active' \| 'closed' |
| createdAt | integer | Epoch ms |
| updatedAt | integer | Epoch ms |

### generalMessages

| Column | Type | Description |
|---|---|---|
| id | text PK | ULID |
| sessionId | text | FK to generalSessions.id |
| role | text | 'commander' \| 'general' \| 'system' |
| content | text | Message content |
| timestamp | integer | Epoch ms |

The `system` role is for visual markers like context cleared dividers.

---

## Commands

### Native Claude Code Commands

Passed through directly to the Claude Code process:

| Command | Description |
|---|---|
| `/clear` | Reset conversation context |
| `/compact` | Compress context to free tokens |
| `/cost` | Token usage for this session |
| `/status` | Model, tokens used, context remaining |
| `/model <name>` | Switch model mid-session |
| `/memory` | Show GENERAL's persistent memory |

### Custom DEVROOM Commands

Intercepted and expanded into full prompts before sending to Claude Code:

| Command | Expansion |
|---|---|
| `/sitrep` | "Give me a full situation report. Query the DEVROOM database at /data/devroom.db. Report: all active missions and their status, any stuck or failed missions in the last hour, active campaigns and their phase progress, asset deployment status, and any Captain escalations. Be concise — use tables where appropriate." |
| `/diagnose <missionId>` | "Investigate mission {missionId}. Query the DEVROOM database at /data/devroom.db. Read the mission record, its comms/logs from the missionLogs table, any Captain log entries from captainLogs, and the debrief if available. Tell me: what was the objective, what happened, where it went wrong (if it did), and what you recommend." |

---

## UI

### Page Route

`/general` — top-level page under the `(hq)` layout group.

### Navigation

- **Global nav:** New entry `◇ GENERAL` in the left sidebar, between HQ and bottom links
- **Battlefield pages:** "CONSULT GENERAL" link navigates to `/general?battlefield=<id>`

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Session A] [Session B] [Session C]  [+]              [?] Commands │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Chat header: SESSION NAME (editable)                               │
│  [CLEAR CONTEXT]  [COMPACT]  [END SESSION]                          │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │                                                                 │ │
│ │  GENERAL (amber, left-aligned):                                 │ │
│ │  Standing by, Commander. How can I assist?                      │ │
│ │                                                                 │ │
│ │                     Commander (green, right-aligned):            │ │
│ │                     /sitrep                                     │ │
│ │                                                                 │ │
│ │  GENERAL (amber, left-aligned):                                 │ │
│ │  ┌──────────────────────────────────┐                           │ │
│ │  │ SITUATION REPORT — 2026-03-28    │                           │ │
│ │  │ Active Missions: 2              │                           │ │
│ │  │ ...                             │                           │ │
│ │  └──────────────────────────────────┘                           │ │
│ │                                                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ [TacTextareaWithImages input]                          [SEND]  │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Tab Bar

- Each active session is a tab showing its name
- `×` on tab triggers confirmation modal
- `+` button opens new session modal (name input + optional battlefield selector + CREATE)
- Active tab is highlighted with green underline

### Chat Header

- Session name — click to edit inline
- `CLEAR CONTEXT` button — sends `/clear`, inserts system message divider `── CONTEXT CLEARED ──`
- `COMPACT` button — sends `/compact`, inserts system message divider `── CONTEXT COMPACTED ──`
- `END SESSION` button (red) — confirmation modal, marks session closed, removes tab

### Close Session Modal

"End session **[name]**? The conversation history will be preserved but GENERAL will lose context of this session."

Buttons: `CANCEL` | `END SESSION` (red)

Triggered by both the `×` tab button and the `END SESSION` header button.

### Messages

- Commander: right-aligned, green accent, monospace
- GENERAL: left-aligned, amber accent, markdown rendered (tables, code blocks, lists)
- System: centered, dim text, used for dividers (context cleared, context compacted)
- Streaming: GENERAL's in-progress response shows with a pulse indicator

### Command Reference Card

Triggered by `?` button in the top-right of the tab bar. Slides out as a panel (or overlays). Groups:

**Context**
- `/clear` — Reset conversation context
- `/compact` — Compress context to free tokens

**Info**
- `/cost` — Token usage for this session
- `/status` — Model, tokens, context remaining
- `/model <name>` — Switch model mid-session
- `/memory` — GENERAL's persistent memory

**DEVROOM Shortcuts**
- `/sitrep` — Full situation report on all operations
- `/diagnose <id>` — Deep-dive a specific mission

Visible by default when no sessions exist. Collapsible once chatting.

### Empty State

When no active sessions exist, the page shows:

Centered content: GENERAL's codename in large tactical font, a brief description ("Your strategic advisor and DEVROOM administrator"), and a `NEW SESSION` button.

---

## Engine

### general-engine.ts

Located at `src/lib/general/general-engine.ts`.

**`sendGeneralMessage(io, sessionId, message)`**
1. Load session from DB
2. If message starts with `/` — check if it's a custom command, expand if so
3. Spawn Claude Code:
   - First message: `--system-prompt <prompt> --print --verbose --output-format stream-json --include-partial-messages --dangerously-skip-permissions --max-turns 50 --model <GENERAL's model>`
   - Subsequent: add `--resume <claudeSessionId>`
4. Stream response via Socket.IO to room `general:<sessionId>`
5. Store both commander and general messages in `generalMessages`
6. Extract and persist Claude's session ID on first response

**`killSession(sessionId)`**
- Abort active Claude Code process if running
- Clean up from active process map

**Active process tracking:** `Map<sessionId, { process, abortController }>`

### general-prompt.ts

Located at `src/lib/general/general-prompt.ts`.

**`buildGeneralPrompt(battlefieldId?)`**
- Base prompt (personality, DB location, capabilities)
- If battlefieldId: append battlefield context block

---

## Socket.IO Events

Added to `src/lib/socket/server.ts`:

| Event | Direction | Payload |
|---|---|---|
| `general:subscribe` | Client → Server | `sessionId` |
| `general:unsubscribe` | Client → Server | `sessionId` |
| `general:send` | Client → Server | `{ sessionId, message }` |
| `general:chunk` | Server → Client | `{ sessionId, content }` |
| `general:complete` | Server → Client | `{ sessionId, content }` |
| `general:error` | Server → Client | `{ sessionId, error }` |

---

## Server Actions

Located at `src/actions/general.ts`:

| Action | Description |
|---|---|
| `createGeneralSession(name, battlefieldId?)` | Creates session record, returns session |
| `closeGeneralSession(sessionId)` | Marks closed, kills process, revalidates |
| `renameGeneralSession(sessionId, name)` | Updates name |
| `getActiveSessions()` | Returns all active sessions |
| `getSessionMessages(sessionId)` | Returns message history ordered by timestamp |

---

## Hooks

### use-general.ts

Located at `src/hooks/use-general.ts`. Same pattern as `use-briefing.ts`:

- Subscribes to `general:<sessionId>` room
- Listens for `general:chunk`, `general:complete`, `general:error`
- Emits `general:send` with `{ sessionId, message }`
- Manages state: messages, streaming, isLoading, error
- Accumulates streaming chunks via ref

---

## New Files

```
src/lib/general/general-engine.ts       — Claude Code process management
src/lib/general/general-prompt.ts       — System prompt builder
src/actions/general.ts                  — Server actions (CRUD sessions + messages)
src/hooks/use-general.ts               — Socket.IO streaming hook
src/app/(hq)/general/page.tsx          — Page (server component, loads sessions)
src/components/general/general-chat.tsx — Main chat client component
src/components/general/session-tabs.tsx — Tab bar with session management
src/components/general/command-reference.tsx — Slide-out command reference panel
src/components/general/new-session-modal.tsx — Create session modal
src/components/general/close-session-modal.tsx — Confirm close modal
```

**Modified files:**
- `src/lib/db/schema.ts` — Add generalSessions + generalMessages tables
- `src/lib/socket/server.ts` — Add general:* event handlers
- `src/components/layout/global-nav.tsx` — Add GENERAL nav item
- Battlefield layout or page — Add "CONSULT GENERAL" link
