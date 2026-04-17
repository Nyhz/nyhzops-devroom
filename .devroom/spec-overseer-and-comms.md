# Overseer, Quartermaster, Notifications, Logistics & War Room

## Overseer — AI Exception Layer

### Concept

The Overseer is a narrow AI exception handler invoked by CONTROL as a last resort in two specific situations: ambiguous subprocess exits and exhausted-retry gate failures. It is not a reviewer, not a mission supervisor, and not involved in normal execution flow. CONTROL's deterministic fast paths handle everything else.

Implementation: embedded in `src/control/exit-classifier.ts` (classification fallback) and `src/control/retry-policy.ts` (gate-failure consult). There is no `src/lib/overseer/` directory.

---

### Job 1 — Exit Classification

**When:** A subprocess exits and CONTROL's fast-path regex cannot classify the exit as success or failure.

**How:** CONTROL spawns OVERSEER as a one-shot `claude --print` process. The prompt contains the subprocess exit code, last N lines of stdout/stderr, and the mission briefing. The OVERSEER returns a single JSON object — no conversation.

**Response schema:**

```json
{
  "classification": "INFRASTRUCTURE" | "AGENT_FAILURE" | "NEEDS_COMMANDER",
  "reasoning": "one sentence"
}
```

| Classification     | Effect                                                                 |
|--------------------|------------------------------------------------------------------------|
| `INFRASTRUCTURE`   | Free retry — does not count against the attempt budget (transient env issue) |
| `AGENT_FAILURE`    | Counts against the attempt budget — the agent made a mistake           |
| `NEEDS_COMMANDER`  | Mission → `COMPROMISED` immediately — situation requires human judgment |

---

### Job 2 — Gate-Failure Consult

**When:** A mission has failed gates 2–3 times and deterministic retries are not making progress.

**How:** CONTROL spawns OVERSEER as a one-shot `claude --print` process. The prompt contains the mission briefing, the gate commands that are failing, gate output from recent attempts, and CLAUDE.md context. The OVERSEER returns a single JSON object.

**Response schema:**

```json
{
  "decision": "redirect" | "escalate",
  "newPrompt": "reframed mission briefing (redirect only)",
  "question": "specific answerable question for Commander (escalate only)",
  "reasoning": "one sentence"
}
```

| Decision    | Effect                                                                                          |
|-------------|-------------------------------------------------------------------------------------------------|
| `redirect`  | CONTROL requeues the mission with `newPrompt` as the briefing. The agent gets one more attempt. |
| `escalate`  | Mission → `COMPROMISED`. The `question` field is surfaced to the Commander via Telegram inline keyboard. |

One consult per mission, period. If the redirect attempt also fails gates, CONTROL marks the mission `COMPROMISED` without a second consult.

---

### What the Overseer Does NOT Do

- Review mission debriefs or completed work
- Issue approve / retry / escalate verdicts on finished missions
- Make runtime tactical decisions for running agents via stdin injection
- Handle phase failure triage
- Participate in normal (non-exception) mission flow

---

### Overseer Log Page — `/(hq)/overseer-log`

Displays all Overseer decisions across battlefields. Each entry shows the trigger type (exit classification or gate-failure consult), the decision returned, reasoning, and outcome. Stats include total invocations and decision distribution.

Server Actions: `src/actions/overseer.ts` — `getOverseerLogs()`, `getOverseerStats()`.

---

## Quartermaster — Conflict Resolution

### Concept

The Quartermaster is a narrow AI process invoked by CONTROL when a rebase-then-merge path encounters conflicts that cannot be resolved automatically. Its only job is to resolve conflict markers, stage the files, and commit. CONTROL owns the full merge flow — the Quartermaster is a single step within it.

Implementation: `src/control/merge.ts` handles the merge flow. `src/control/merge/quartermaster.ts` spawns the QM process. There is no `src/lib/quartermaster/` directory.

---

### Conflict Resolution Flow

**When:** CONTROL's rebase-then-merge path detects conflict markers after a rebase.

**How:** CONTROL spawns QUARTERMASTER as a one-shot `claude --print` process inside the worktree with `--dangerously-skip-permissions`, max 15 turns, 10-minute hard timeout.

The prompt contains:
- CLAUDE.md (project conventions)
- Mission briefing
- Mission debrief
- Upstream commit log and branch commit log
- The conflict diff

Resolution orders:
1. Analyze both sides of each conflict.
2. Preserve both intents where possible.
3. Prefer source (new work) if the intents are incompatible.
4. Resolve all conflict markers, stage the resolved files, and commit.

**After QM exits:** CONTROL re-runs the gate manifest against the resolved state. If gates pass, the merge is complete. If gates fail, the mission goes to `COMPROMISED` with `compromiseReason: 'merge-failed'` — the branch is preserved for manual review and a critical notification is sent to the Commander.

### What the Quartermaster Does NOT Do

- Orchestrate the full merge flow (CONTROL does this)
- Extract follow-up suggestions from debriefs
- Retry merges on a schedule

---

## Notifications & Escalations

### Concept

Notifications track important events and optionally deliver them via Telegram. Escalation logic lives in `src/lib/notifications/escalate.ts`.

### `escalate()` Function

The central entry point for all notifications:

1. **Store in DB**: Inserts into the `notifications` table with level, title, detail, entity references, and read status.
2. **Emit Socket.IO**: Broadcasts `notification:new` to the `hq:activity` room with full notification payload.
3. **Send Telegram**: For `warning` and `critical` levels only (when Telegram is enabled). Supports both plain text messages and interactive escalations with inline keyboard buttons.

### Notification Levels

| Level      | Color  | Telegram | Description                                              |
|------------|--------|----------|----------------------------------------------------------|
| `info`     | blue   | No       | Mission accomplished, phase secured                      |
| `warning`  | amber  | Yes      | Review failures, non-critical escalations                |
| `critical` | red    | Yes      | Mission compromised, merge failures, orchestrator paused |

### Trigger Events

| Event                              | Level      | Telegram style               |
|------------------------------------|------------|------------------------------|
| Mission → `COMPROMISED`            | `critical` | Quiet ping                   |
| Campaign → `COMPROMISED`           | `critical` | Loud ping                    |
| Campaign → `ACCOMPLISHED`          | `info`     | Quiet ping                   |
| Orchestrator AUTH pause            | `critical` | Loud ping                    |
| OVERSEER escalate with question    | `critical` | Inline keyboard (answerable) |

### Answerable Escalation Flow

When the Overseer issues an `escalate` decision with a `question` field:

1. CONTROL sends a Telegram message containing the OVERSEER's question and the mission context.
2. The message includes an inline keyboard with answer options (e.g., approach choices, or a free-text prompt).
3. The Commander taps a response in Telegram.
4. The callback is routed through `handleTelegramCallback()` in `escalate.ts`, which injects the answer into the mission's prompt and requeues the mission.

### In-App

Notifications are accessible via a bell icon or notification panel. Unread count shown in nav. Mark as read via Server Action.

### Telegram Integration

When `DEVROOM_TELEGRAM_BOT_TOKEN`, `DEVROOM_TELEGRAM_CHAT_ID`, and `DEVROOM_TELEGRAM_ENABLED=true` are set:

- Bot uses long-polling (no webhooks — LAN-only). `src/lib/telegram/bot.ts` handles `callback_query` routing. `src/lib/telegram/telegram.ts` handles basic polling. `src/lib/notifications/notifier.ts` handles dispatch policy.
- Warning and critical notifications are sent to the configured chat.
- Escalations with action buttons use Telegram inline keyboards.
- `telegramSent` and `telegramMsgId` fields track delivery status.

#### Telegram Callback Actions

When the Commander presses an inline button in Telegram, the callback is routed through `handleTelegramCallback()` in `escalate.ts`:

| Action    | Entity Type   | Effect                                                                     |
|-----------|---------------|----------------------------------------------------------------------------|
| `abort`   | mission       | Abandons the mission                                                       |
| `abort`   | campaign      | Abandons the campaign                                                      |
| `resume`  | campaign      | Resumes a halted campaign                                                  |
| answer    | mission       | Answerable escalation — injects OVERSEER question response, requeues mission |

---

## Logistics — Token & Cost Tracking

### Page — `/(hq)/logistics`

Dashboard showing token usage and cost data across all battlefields.

### Features

- **Token usage breakdown**: input tokens, output tokens, cache hit tokens — aggregated from `costInput`, `costOutput`, `costCacheHit` fields on missions.
- **Per-attempt tracking**: Token usage is also available at the attempt level via the `mission_attempts` table.
- **Cost estimation**: Approximate USD cost per mission using Claude Sonnet pricing (input $3/1M, output $15/1M, cache read $0.30/1M).
- **Breakdown by battlefield**: Token usage and cost grouped by battlefield.
- **Breakdown by asset**: Token usage and cost grouped by asset codename.
- **Daily usage trends**: Token consumption per day over the last 30 days.
- **Rate limit status**: Live rate limit info from the orchestrator (`orchestrator.latestRateLimit`).
- **Cache hit rate**: Overall percentage of cache tokens vs total input context.

Server Actions: `src/actions/logistics.ts` — `getGlobalStats()`, `getCostByBattlefield()`, `getCostByAsset()`, `getDailyUsage()`, `getRateLimitStatus()`.

---

## War Room — Boot Sequence

A cinematic boot animation shown on first visit to DEVROOM. Creates an immersive tactical startup experience.

### Flow

1. First visit to HQ shows the `<BootGate>` overlay on top of the dashboard content.
2. `<BootGate>` renders a solid covering overlay from initial paint (server + client agree on `'pending'` state) to prevent any flash of underlying content.
3. `useEffect` checks `sessionStorage('devroom-booted')`:
   - First visit → transitions to `'booting'` (shows `<BootSequence>` animation).
   - Returning visit → transitions to `'done'` (overlay removed immediately).
4. Boot sequence plays four staggered progress bars with status messages:
   - "Establishing secure connection..."
   - "Loading battlefield intelligence..."
   - "Recovering active campaigns..."
   - "Contacting deployed assets..."
5. On completion, the overlay fades out to reveal the HQ dashboard underneath.
6. The `devroom-booted` sessionStorage flag prevents re-showing on subsequent visits within the session.

The `<BootSequence>` component receives `battlefieldCount` and `inCombatCount` props for displaying live system stats during the boot animation.

Components: `src/components/warroom/boot-gate.tsx`, `src/components/warroom/boot-sequence.tsx`

The HQ page wraps its content with `<BootGate>`, which renders the animation as an overlay. No redirect occurs — the HQ dashboard renders underneath and becomes visible when the animation completes. The `/warroom` route exists only as a redirect to `/` (legacy endpoint).
