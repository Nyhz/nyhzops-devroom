# Phase F2: Telegram Escalation — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** F2 (Telegram Escalation)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase F1 (Captain Core) — complete

---

## Overview

Phase F2 adds a dedicated Telegram bot for Commander notifications. The Captain sends urgent escalations via Telegram, and the Commander can reply directly in Telegram to approve, retry, or abort. Also adds an in-app notification panel for non-Telegram events.

---

## 1. Telegram Bot Integration

**File:** `src/lib/telegram/telegram.ts`

Lightweight Telegram Bot API client — just HTTP calls, no heavy SDK.

### Functions

```typescript
// Send a message to the Commander
async function sendMessage(text: string, replyMarkup?: InlineKeyboard): Promise<number>
// Returns message_id for tracking

// Send with action buttons (inline keyboard)
async function sendEscalation(params: {
  title: string;
  detail: string;
  options: Array<{ label: string; callbackData: string }>;
}): Promise<number>

// Edit a sent message (e.g., mark as resolved)
async function editMessage(messageId: number, text: string): Promise<void>

// Start polling for Commander replies
function startPolling(handler: (callbackData: string, messageId: number) => void): void

// Stop polling
function stopPolling(): void
```

### Configuration

New env vars in `.env.local`:
```
DEVROOM_TELEGRAM_BOT_TOKEN=        # From BotFather
DEVROOM_TELEGRAM_CHAT_ID=          # Commander's chat ID
DEVROOM_TELEGRAM_ENABLED=false     # Opt-in, disabled by default
```

Add to `src/lib/config.ts`:
```typescript
telegramBotToken: process.env.DEVROOM_TELEGRAM_BOT_TOKEN || '',
telegramChatId: process.env.DEVROOM_TELEGRAM_CHAT_ID || '',
telegramEnabled: process.env.DEVROOM_TELEGRAM_ENABLED === 'true',
```

### Message Format

Escalation messages use Markdown formatting:

```
⚠️ *DEVROOM — ESCALATION*

*Campaign:* Op. Clean Sweep
*Phase 3:* Strike
*Mission:* Implement payment flow

Captain decision (confidence: low):
_"Use REST endpoints — but the codebase has GraphQL patterns too"_

Reply with action:
```

With inline keyboard buttons: `[APPROVE] [RETRY] [ABORT] [OVERRIDE]`

### Reply Handling

Use Telegram's `getUpdates` long polling (not webhooks — LAN-only server can't receive webhooks).

Poll every 5 seconds for `callback_query` updates. When the Commander taps a button:
- Parse `callbackData` (format: `action:entityType:entityId`, e.g., `approve:mission:01ABC123`)
- Route to the appropriate handler
- Edit the original message to show the Commander's decision: "✅ Commander approved"

---

## 2. Escalation Manager

**File:** `src/lib/captain/escalation.ts`

Centralizes all escalation logic — decides what gets sent where.

### Escalation Levels

```typescript
type EscalationLevel = 'info' | 'warning' | 'critical';
```

| Level | Telegram | In-App | When |
|-------|----------|--------|------|
| `info` | No | Yes | Captain made a low-confidence decision |
| `warning` | Yes | Yes | Mission compromised, campaign paused |
| `critical` | Yes (with buttons) | Yes | Campaign compromised, multiple failures, cost threshold |

### Functions

```typescript
async function escalate(params: {
  level: EscalationLevel;
  title: string;
  detail: string;
  entityType: 'mission' | 'campaign' | 'phase';
  entityId: string;
  battlefieldId: string;
  actions?: Array<{ label: string; handler: string }>;
}): Promise<void>
```

- Stores in-app notification (see §3)
- If level is `warning` or `critical` AND Telegram is enabled: sends Telegram message
- If `critical`: includes action buttons in Telegram
- Emits `notification:new` Socket.IO event to `hq:activity` room

### Callback Handler

When Commander replies via Telegram:
```typescript
async function handleTelegramCallback(action: string, entityType: string, entityId: string): Promise<void>
```

Maps actions to operations:
- `approve` → Continue with Captain's decision (no-op, just acknowledge)
- `retry` → Redeploy the mission
- `abort` → Abandon the mission/campaign
- `override` → (Future) Commander provides custom instructions

---

## 3. In-App Notification Panel

**New table: `notifications`**

```
- id              TEXT PRIMARY KEY
- level           TEXT NOT NULL — 'info' | 'warning' | 'critical'
- title           TEXT NOT NULL
- detail          TEXT NOT NULL
- entityType      TEXT — 'mission' | 'campaign' | 'phase'
- entityId        TEXT
- battlefieldId   TEXT
- read            INTEGER DEFAULT 0
- telegramSent    INTEGER DEFAULT 0
- telegramMsgId   INTEGER — for editing the message later
- createdAt       INTEGER NOT NULL
```

### Notification Bell

**Modify:** `src/components/layout/intel-bar.tsx`

Add a notification indicator next to the LOGISTICS indicator:

```
INTEL // "Quote..."              🔔 3    LOGISTICS: ● OK
```

The bell shows unread notification count. Click opens a dropdown panel with recent notifications. Each notification: level icon (ℹ️/⚠️/🚨), title, detail preview, timestamp, link to entity. Mark as read on click.

### Notification Hook

**Create:** `src/hooks/use-notifications.ts`

Subscribes to `notification:new` Socket.IO events. Maintains unread count. Provides:
- `notifications: Notification[]`
- `unreadCount: number`
- `markAsRead(id): void`

### Server Actions

**Create:** `src/actions/notification.ts`

- `getNotifications(limit?, unreadOnly?)` — Query notifications
- `markNotificationRead(id)` — Set read = 1
- `markAllRead()` — Set all read = 1
- `getUnreadCount()` — Count where read = 0

---

## 4. Integration Points

### Captain Decision Engine

**Modify:** `src/lib/captain/captain.ts`

After the Captain makes a decision, if `escalate === true`:
```typescript
await escalate({
  level: decision.confidence === 'low' ? 'warning' : 'info',
  title: `Captain Escalation: ${mission.title}`,
  detail: `Q: ${question}\nA: ${decision.answer}\nReasoning: ${decision.reasoning}`,
  entityType: 'mission',
  entityId: mission.id,
  battlefieldId: mission.battlefieldId,
  actions: [
    { label: 'APPROVE', handler: 'approve' },
    { label: 'RETRY', handler: 'retry' },
    { label: 'ABORT', handler: 'abort' },
  ],
});
```

### Campaign Executor

**Modify:** `src/lib/orchestrator/campaign-executor.ts`

When campaign pauses (phase compromised):
```typescript
await escalate({
  level: 'critical',
  title: `Campaign Paused: ${campaign.name}`,
  detail: `Phase ${phase.name} compromised. ${compromisedCount} mission(s) failed.`,
  entityType: 'campaign',
  entityId: campaign.id,
  battlefieldId: campaign.battlefieldId,
  actions: [
    { label: 'RESUME', handler: 'resume' },
    { label: 'SKIP & CONTINUE', handler: 'skip' },
    { label: 'ABANDON', handler: 'abort' },
  ],
});
```

### Mission Executor

When mission compromised (after all retries):
```typescript
await escalate({
  level: 'warning',
  title: `Mission Compromised: ${mission.title}`,
  detail: mission.debrief?.slice(0, 200) || 'No debrief available.',
  entityType: 'mission',
  entityId: mission.id,
  battlefieldId: mission.battlefieldId,
});
```

---

## 5. Server.ts Changes

- Start Telegram polling after scheduler: `if (config.telegramEnabled) startTelegramPolling()`
- Stop polling in shutdown handler
- Seed default notifications table

---

## 6. Socket.IO Events

| Event | Payload | Room |
|-------|---------|------|
| `notification:new` | `{ id, level, title, detail, timestamp }` | `hq:activity` |

---

## 7. End State

After F2:
1. Captain escalations sent to Commander via Telegram with action buttons
2. Commander taps APPROVE/RETRY/ABORT in Telegram → DEVROOM acts on it
3. In-app notification bell shows unread count
4. Notification panel lists all escalations with severity levels
5. Campaign pauses and mission failures trigger Telegram alerts
6. Telegram is opt-in (disabled by default, enabled via env vars)
