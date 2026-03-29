# Captain, Notifications, Logistics & War Room

## Captain — AI Decision Layer

### Concept

The Captain is an autonomous AI decision layer that makes judgment calls during mission and campaign execution without Commander intervention. It reviews debriefs, handles phase failures, and escalates critical decisions.

Implementation: `src/lib/captain/`

### Modules

| Module                    | Purpose                                               |
|---------------------------|-------------------------------------------------------|
| `captain.ts`              | Core decision engine — evaluates situations, makes calls |
| `captain-db.ts`           | Persists decisions to `captainLogs` table             |
| `debrief-reviewer.ts`     | Reviews mission debriefs for quality and completeness |
| `escalation.ts`           | Routes critical decisions to Commander via Telegram   |
| `phase-failure-handler.ts`| Handles phase failures — retry, skip, or escalate    |
| `review-handler.ts`       | Post-completion captain review with retry/escalation  |

### Decision Confidence

Each decision is logged with a confidence level:
- **high**: Captain acts autonomously.
- **medium**: Captain acts but logs prominently for review.
- **low**: Captain escalates to Commander (via Telegram if configured).

### Captain Log Page — `/(hq)/captain-log`

Displays all Captain decisions across battlefields. Each entry shows the question faced, the decision made, reasoning, confidence level, and whether it was escalated.

---

## Notifications & Escalations

### Concept

Notifications track important events (mission completions, failures, Captain escalations) and optionally deliver them via Telegram.

### Levels

| Level      | Color  | Telegram | Description                        |
|------------|--------|----------|------------------------------------|
| `info`     | blue   | No       | Mission completed, phase secured   |
| `warning`  | amber  | Optional | Captain medium-confidence decision |
| `critical` | red    | Yes      | Mission compromised, escalation    |

### In-App

Notifications are accessible via a bell icon or notification panel. Unread count shown in nav. Mark as read via Server Action.

### Telegram Integration

When `DEVROOM_TELEGRAM_BOT_TOKEN` is set:
- Bot polls for incoming messages (no webhooks — LAN-only).
- Critical notifications are sent to the configured Telegram chat.
- Commander can respond to escalations directly in Telegram.
- `telegramSent` and `telegramMsgId` fields track delivery status.

Implementation: `src/lib/telegram/telegram.ts`

---

## Logistics — Token & Cost Tracking

### Page — `/(hq)/logistics`

Dashboard showing token usage and rate limit status across all battlefields.

### Features

- **Token usage breakdown**: input tokens, output tokens, cache hits, cache creation.
- **Rate limit status**: fetched via `GET /api/logistics/rate-limit` (proxied Claude API check).
- **Cost tracking**: per-mission cost data from `costInput`, `costOutput`, `costCacheHit` fields.
- **Cache hit rate**: overall and per-battlefield percentage.

Server Actions in `src/actions/logistics.ts`.

---

## War Room — Boot Sequence

### Page — `/warroom`

A cinematic boot animation shown on first visit to DEVROOM. Creates an immersive tactical startup experience.

### Flow

1. First visit to HQ triggers redirect to `/warroom`.
2. Boot sequence animation plays (typewriter text, system checks, ASCII art).
3. On completion, redirects to HQ dashboard.
4. A session flag prevents re-showing on subsequent visits.

Components: `src/components/warroom/boot-gate.tsx`, `src/components/warroom/boot-sequence.tsx`

The HQ root layout uses `<BootGate>` as an overlay — if the boot animation hasn't been seen, it renders on top of the HQ content and fades out on completion. This avoids a flash of content before redirect.
