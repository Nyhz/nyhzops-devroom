# Overseer, Quartermaster, Notifications, Logistics & War Room

## Overseer — AI Review Layer

### Concept

The Overseer is a system asset that reviews mission debriefs and makes tactical decisions during campaign execution. It issues verdicts (`approve` / `retry` / `escalate`) on completed missions and handles phase failure triage. It does not make architectural decisions — it judges whether work was completed satisfactorily against the mission briefing and project conventions.

Implementation: `src/lib/overseer/`

### Modules

| Module                     | Purpose                                                          |
|----------------------------|------------------------------------------------------------------|
| `overseer.ts`              | Core decision engine — `askOverseer()` for runtime tactical questions via Claude Code CLI |
| `overseer-db.ts`           | Persists decisions to `overseerLogs` table                       |
| `debrief-reviewer.ts`      | Reviews mission debriefs — spawns OVERSEER asset, returns structured verdict |
| `review-handler.ts`        | Post-completion review orchestrator — routes verdicts to retry/approve/escalate flows |
| `review-parser.ts`         | Parses OVERSEER output into structured `OverseerReview` (handles envelopes, prose, JSON) |
| `escalation.ts`            | Central escalation — stores notifications, emits Socket.IO events, sends Telegram |
| `phase-failure-handler.ts` | Phase failure triage — decides retry/skip/escalate for compromised phases |

### Debrief Review Flow

When a mission completes execution, the review handler takes over:

1. **`runOverseerReview(missionId)`** is called asynchronously after the executor releases its slot.
2. The handler loads the mission, its battlefield, and reads CLAUDE.md for project context.
3. It fetches git diffs (`--stat` and full diff) between the target branch and the mission's worktree branch.
4. **`reviewDebrief()`** builds a prompt containing the mission briefing, debrief text, CLAUDE.md (trimmed to 3000 chars), and code changes. It spawns the OVERSEER system asset via `runClaudePrint()` with `--max-turns 2` and `--output-format json` with a JSON schema enforcing the verdict structure.
5. **`parseReviewOutput()`** extracts the verdict from the OVERSEER's response. It handles multiple formats: direct JSON, envelope objects (with `subtype` and `structured_output` fields), markdown code blocks, and bare JSON embedded in prose. Invalid output escalates to the Commander.
6. The verdict is stored in `overseerLogs` and routed:

| Verdict    | Action                                                                                           |
|------------|--------------------------------------------------------------------------------------------------|
| `approve`  | Status → `approved`. Log info notification if concerns exist. Trigger Quartermaster for merge.   |
| `retry`    | Re-queue mission with feedback (up to 2 retries for reviewed missions, 1 for triaged). Overseer feedback stored as a log entry for the retry prompt builder. |
| `escalate` | Status → `compromised` (with `compromiseReason: 'escalated'`). Send warning notification to Commander via Telegram. Notify campaign executor if applicable. |

If retries are exhausted, the mission is marked `compromised` with `compromiseReason: 'review-failed'` and the Overseer's concerns are appended to the debrief.

### Runtime Tactical Decisions — `askOverseer()`

Beyond debrief review, the Overseer answers tactical questions from running agents. `askOverseer()` builds a prompt containing:

- The `OVERSEER_SYSTEM_PROMPT` (rules for decisive, convention-aligned responses)
- CLAUDE.md content (project conventions)
- Mission briefing
- Campaign context (if applicable)
- Recent agent output (last ~2000 chars)
- The agent's question
- Recent Overseer decision history (for consistency)

The OVERSEER asset is spawned with `--max-turns 1`. The response is parsed as JSON with fields: `answer`, `reasoning`, `escalate` (boolean), `confidence` (`high` / `medium` / `low`).

### Decision Confidence

Each decision is logged with a confidence level:
- **high**: Overseer acts autonomously.
- **medium**: Overseer acts but logs prominently for review.
- **low**: Overseer escalates to Commander (via Telegram if configured).

On process failure, `askOverseer()` returns a safe fallback: proceed with best judgment, low confidence, escalation flagged.

### Phase Failure Handling

When a campaign phase has compromised missions, `handlePhaseFailure()` consults the Overseer:

1. Checks if the phase has already been retried >= 2 times (auto-escalates if so).
2. Builds a prompt with the campaign objective, phase details, compromised and accomplished missions, and CLAUDE.md context.
3. The Overseer decides: `retry` (with modified briefings), `skip` (advance to next phase), or `escalate` (pause for Commander).
4. Retry decisions include a `retryBriefings` map of `missionId → modified briefing` to address the specific failure reasons.

### Overseer Log Page — `/(hq)/overseer-log`

Displays all Overseer decisions across battlefields. Each entry shows the question faced, the decision made, reasoning, confidence level, and whether it was escalated. Stats include total decisions, escalation rate, and confidence distribution.

Server Actions: `src/actions/overseer.ts` — `getOverseerLogs()`, `getOverseerStats()`.

---

## Quartermaster — Merge & Integration

### Concept

The Quartermaster is a system asset responsible for post-approval merge operations. After the Overseer approves a mission, the Quartermaster handles merging the worktree branch into the target branch, resolving conflicts if necessary, cleaning up worktrees, and extracting follow-up suggestions from debriefs.

Implementation: `src/lib/quartermaster/`

### Modules

| Module                | Purpose                                                              |
|-----------------------|----------------------------------------------------------------------|
| `quartermaster.ts`    | Main entry point — `triggerQuartermaster()` orchestrates the full merge-to-completion flow |
| `merge-executor.ts`   | Executes git merge with conflict detection and retry logic           |
| `conflict-resolver.ts`| Spawns QUARTERMASTER Claude Code process to resolve merge conflicts  |

### Merge Flow

**`triggerQuartermaster(missionId)`** is called by the Overseer review handler after an `approve` verdict:

1. **Guard**: Verifies mission exists and is in `approved` status. Loads battlefield.
2. **Non-worktree missions**: Skip merge entirely — status goes directly to `accomplished`. Extract follow-up suggestions and notify campaign executor.
3. **Worktree missions**: Full merge flow begins.

#### Worktree Merge Sequence

1. **Status → `merging`**. Emit status change.
2. **`executeMerge()`** attempts the merge:
   a. Stash any uncommitted changes in the target repo.
   b. Checkout target branch (e.g., `main`).
   c. Merge source branch with `--no-ff`.
   d. Pop stash if needed.
3. **On success**: Clean up worktree via `removeWorktree()`, clean up mission home (`/tmp/claude-config/{missionId}`), status → `accomplished`, extract follow-up suggestions, notify campaign.
4. **On conflict**: Trigger conflict resolution (see below).
5. **On merge failure** (non-conflict git error or exhausted retries): Status → `compromised` with `compromiseReason: 'merge-failed'`. Branch is preserved for manual review. Critical escalation sent to Commander.

### Conflict Resolution

When a merge conflict is detected:

1. **`resolveConflicts()`** spawns the QUARTERMASTER system asset via `child_process.spawn` with `--dangerously-skip-permissions` and `--max-turns 20`.
2. The prompt includes: CLAUDE.md, mission briefing, mission debrief, upstream commit log, branch commit log, and the conflict diff.
3. Resolution orders: analyze both sides, preserve both intents, prefer source (new work) if incompatible, run tests if available, commit the resolution.
4. **10-minute timeout** — process is killed if it exceeds this.
5. If resolution succeeds (exit code 0): merge is complete.
6. If resolution fails: abort merge, schedule retry in 60 seconds (`mergeRetryAt` stored on mission), fetch latest, attempt merge again.
7. If second attempt also conflicts and resolution fails: return failure — mission goes to `compromised`.

### Follow-Up Extraction

After a mission reaches `accomplished`, the Quartermaster calls `extractAndSaveSuggestions()` from `src/actions/follow-up.ts`. This parses the debrief's "Recommended Next Actions" section and saves each item to the `followUpSuggestions` table. These appear as actionable cards on the battlefield overview page.

---

## Notifications & Escalations

### Concept

Notifications track important events (mission completions, failures, Overseer escalations) and optionally deliver them via Telegram. The escalation system is centralized in `src/lib/overseer/escalation.ts`.

### `escalate()` Function

The central entry point for all notifications:

1. **Store in DB**: Inserts into the `notifications` table with level, title, detail, entity references, and read status.
2. **Emit Socket.IO**: Broadcasts `notification:new` to the `hq:activity` room with full notification payload.
3. **Send Telegram**: For `warning` and `critical` levels only (when Telegram is enabled). Supports both plain text messages and interactive escalations with inline keyboard buttons.

### Notification Levels

| Level      | Color  | Telegram | Description                            |
|------------|--------|----------|----------------------------------------|
| `info`     | blue   | No       | Mission completed, phase secured       |
| `warning`  | amber  | Yes      | Overseer medium-confidence decision, review failures |
| `critical` | red    | Yes      | Mission compromised, merge failures, no-debrief situations |

### In-App

Notifications are accessible via a bell icon or notification panel. Unread count shown in nav. Mark as read via Server Action.

### Telegram Integration

When `DEVROOM_TELEGRAM_BOT_TOKEN`, `DEVROOM_TELEGRAM_CHAT_ID`, and `DEVROOM_TELEGRAM_ENABLED=true` are set:

- Bot polls for incoming callback queries (5-second interval, no webhooks — LAN-only).
- Warning and critical notifications are sent to the configured Telegram chat.
- Escalations with action buttons use Telegram inline keyboards.
- `telegramSent` and `telegramMsgId` fields track delivery status.

Implementation: `src/lib/telegram/telegram.ts`

#### Telegram Callback Actions

When the Commander presses an inline button in Telegram, the callback is routed through `handleTelegramCallback()` in `escalation.ts`:

| Action    | Entity Type | Effect                                              |
|-----------|-------------|-----------------------------------------------------|
| `approve` | any         | Acknowledge — edits message to confirm              |
| `retry`   | mission     | Triggers tactical override — re-queues the mission  |
| `abort`   | mission     | Abandons the mission                                |
| `abort`   | campaign    | Abandons the campaign                               |
| `resume`  | campaign    | Resumes a paused campaign                           |
| `skip`    | campaign    | Skips failed phase and advances to next              |
| `unpause` | orchestrator| Unpauses the mission queue                          |

---

## Logistics — Token & Cost Tracking

### Page — `/(hq)/logistics`

Dashboard showing token usage and cost data across all battlefields.

### Features

- **Token usage breakdown**: input tokens, output tokens, cache hit tokens — aggregated from `costInput`, `costOutput`, `costCacheHit` fields on missions.
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
