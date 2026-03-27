# Campaign Redesign — GENERAL Briefing Flow

## Summary

Redesign the campaign system around a conversational briefing with GENERAL. Instead of a one-shot plan generation prompt, the Commander has a persistent 1-on-1 chat with GENERAL to brainstorm and refine the campaign plan. The Commander says "GENERATE PLAN" when satisfied, GENERAL outputs structured JSON, and the system populates phases/missions for final review before launch.

## Motivation

The current campaign flow is: create → click "generate plan" (one-shot Claude call) → edit → launch. The plan generation has no context about the Commander's intent beyond a short objective. There's no back-and-forth to clarify scope, discuss trade-offs, or iterate on the approach. GENERAL (the campaign leadership asset) isn't involved at all.

## Campaign Status Lifecycle

```
DRAFT → PLANNING → ACTIVE → ACCOMPLISHED
  ↑         ↑
  └─────────┘

ACTIVE → COMPROMISED (mission exhausted captain retries)
ACTIVE → ABANDONED (Commander manually kills it)
```

| Status | Meaning |
|---|---|
| `DRAFT` | Name + objective set. Briefing chat with GENERAL available. |
| `PLANNING` | GENERAL produced a plan. Plan editor visible for tweaks. Can go back to DRAFT. |
| `ACTIVE` | Green light given. Missions executing. Briefing messages deleted. |
| `ACCOMPLISHED` | All missions accomplished. Results view. |
| `COMPROMISED` | A mission exhausted captain retries. Campaign stops. Commander must intervene. |
| `ABANDONED` | Commander manually killed the campaign. |

No PAUSED state. Failure = COMPROMISED, same semantic as missions.

### Status Transitions

- DRAFT → PLANNING: Commander says "GENERATE PLAN", GENERAL outputs plan, system parses it
- PLANNING → DRAFT: Commander clicks "BACK TO BRIEFING" to continue discussing with GENERAL
- PLANNING → ACTIVE: Commander clicks "GREEN LIGHT"
- ACTIVE → ACCOMPLISHED: All missions accomplished
- ACTIVE → COMPROMISED: A mission exhausted captain retries (2 for reviewing, 1 for compromised)
- COMPROMISED → ACTIVE: Commander uses TACTICAL OVERRIDE or SKIP MISSION to resolve the failed mission
- ACTIVE → ABANDONED: Commander abandons
- COMPROMISED → ABANDONED: Commander abandons

## Briefing Session Data Model

Two new tables:

### `briefing_sessions`
```
- id              TEXT PRIMARY KEY (ULID)
- campaignId      TEXT NOT NULL REFERENCES campaigns(id)
- sessionId       TEXT                    -- Claude session ID for resume
- assetId         TEXT REFERENCES assets(id)  -- GENERAL's asset ID
- status          TEXT DEFAULT 'open'     -- open | closed
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### `briefing_messages`
```
- id              TEXT PRIMARY KEY (ULID)
- briefingId      TEXT NOT NULL REFERENCES briefing_sessions(id)
- role            TEXT NOT NULL            -- commander | general
- content         TEXT NOT NULL
- timestamp       INTEGER NOT NULL
```

One briefing session per campaign. On green light: delete all `briefing_messages` and `briefing_sessions` for that campaign.

## Briefing Chat Execution

### Starting a Session

Commander opens the briefing chat on a draft campaign. If no `briefing_session` exists, create one. Look up the GENERAL asset by codename. No Claude process is spawned yet — it waits for the first message.

### Sending a Message

1. Commander types a message, hits send
2. Store as `briefing_message` (role: `commander`)
3. Spawn Claude: `claude --print --resume <sessionId> --model <GENERAL's model> --dangerously-skip-permissions`
4. Pipe the Commander's message via stdin
5. Stream GENERAL's response back via Socket.IO (`briefing:<campaignId>` room)
6. When response completes, store as `briefing_message` (role: `general`)
7. Save the returned session ID for next resume

### First Message

No `--resume` flag (no session yet). The full prompt includes:
- GENERAL's asset system prompt
- Battlefield CLAUDE.md content (if available)
- Battlefield SPEC.md content (if available)
- Campaign name and objective
- Available assets with codenames and specialties
- Instructions: "You are briefing the Commander on campaign planning for [battlefield codename]. Ask questions to understand the objective, discuss approach, propose phases and missions. The Commander will say GENERATE PLAN when ready. When you hear GENERATE PLAN, output the final plan as a JSON object."

### Subsequent Messages

Use `--resume <sessionId>`. Claude has full conversation context from previous turns. Just pipe the new Commander message via stdin.

### GENERATE PLAN Trigger

1. Commander clicks "GENERATE PLAN" button (sends that text as a message)
2. GENERAL responds with structured JSON plan embedded in the response
3. System extracts JSON from the response (same parsing as current plan-generator: try direct parse, markdown fence extraction, brace extraction)
4. Populates phases/missions in DB using existing `insertPlanFromJSON` helper
5. Campaign status → `planning`
6. Emits `briefing:plan-ready` event
7. Plan editor becomes available on the campaign page

### Resuming Across Browser Sessions

Messages are persisted in DB. On page load, render all stored `briefing_messages`. When Commander sends the next message, `--resume` picks up the Claude session where it left off.

### Session Expiry Fallback

Claude sessions have a TTL. If `--resume` fails (session expired), fall back gracefully: start a fresh Claude session with the full system prompt + all previous `briefing_messages` replayed as conversation context. The Commander sees no difference — the conversation continues seamlessly. The new session ID replaces the expired one in the DB.

## Commander Intervention on Compromised Campaign

When a mission within an active campaign exhausts captain retries, the campaign moves to COMPROMISED. The Commander sees a red alert on the campaign page with the failed mission highlighted and three options:

### TACTICAL OVERRIDE
- Opens the failed mission's briefing in an editable textarea
- Pre-filled with original briefing + captain's concerns as context
- Commander modifies the briefing, clicks deploy
- Mission redeploys with same session ID (context preserved)
- Campaign returns to ACTIVE

### SKIP MISSION
- Marks the failed mission as ABANDONED
- Cascade-abandons any missions that depend on it (transitively)
- Campaign returns to ACTIVE, continues with remaining missions

### ABANDON CAMPAIGN
- Aborts all active missions
- Marks all non-terminal missions as ABANDONED
- Marks all non-terminal phases as COMPROMISED
- Campaign status → ABANDONED

## Socket.IO

### New Room: `briefing:<campaignId>`

| Direction | Event | Data |
|---|---|---|
| Client → Server | `briefing:subscribe` | `campaignId` |
| Client → Server | `briefing:unsubscribe` | `campaignId` |
| Client → Server | `briefing:send` | `{ campaignId, message }` |
| Server → Client | `briefing:chunk` | `{ campaignId, content }` |
| Server → Client | `briefing:complete` | `{ campaignId, messageId }` |
| Server → Client | `briefing:error` | `{ campaignId, error }` |
| Server → Client | `briefing:plan-ready` | `{ campaignId }` |

## Campaign Detail Page — State-Based Rendering

### DRAFT
- Campaign header (name, objective, status badge)
- Briefing chat UI — full-height chat with message history, input field, send button
- "GENERATE PLAN" button in chat toolbar
- No plan editor visible

### PLANNING
- Campaign header
- Plan editor (phases, missions, assets, dependencies)
- "GREEN LIGHT" button — launches the campaign
- "BACK TO BRIEFING" button — returns to DRAFT, chat still available
- Can still click "REGENERATE PLAN" which goes back to DRAFT and reopens briefing

### ACTIVE
- Campaign header with live status
- Phase progress view — current phase, mission statuses
- Clicking a mission links to its detail page

### COMPROMISED
- Same as ACTIVE but with red alert banner
- Failed mission(s) highlighted
- TACTICAL OVERRIDE / SKIP MISSION / ABANDON CAMPAIGN actions

### ACCOMPLISHED
- Results-focused view (not process-focused)
- Per-mission stats: asset, duration, cost, tokens, cache hit %, debrief summary
- Campaign totals: total duration, total cost, total tokens
- Phase-by-phase breakdown
- Captain review outcomes per mission

### ABANDONED
- Static view showing what was completed before abandonment

## GENERAL's Briefing System Prompt

```
You are GENERAL, a campaign planning and coordination specialist for NYHZ OPS DEVROOM.

You are in a briefing session with the Commander for campaign: "{campaignName}"
Battlefield: {battlefieldCodename}

CAMPAIGN OBJECTIVE:
{campaignObjective}

PROJECT CONTEXT:
{claudeMdContent — trimmed if needed}

AVAILABLE ASSETS:
{list of assets with codenames and specialties}

YOUR ORDERS:
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
          "briefing": "Detailed mission briefing",
          "assetCodename": "OPERATIVE",
          "priority": "normal",
          "dependsOn": ["Other mission title"]
        }
      ]
    }
  ]
}

Rules:
- Phases execute SEQUENTIALLY (Phase 1 completes before Phase 2 starts)
- Missions within a phase can execute IN PARALLEL if no dependencies
- dependsOn references mission titles within the SAME phase only
- Each mission must have a detailed briefing — the asset executing it has no context beyond what you write
- Assign assets by specialty: OPERATIVE for code work, ASSERT for testing, DISTILL for docs, WATCHDOG for reviews
```

## Files to Create

| File | Purpose |
|---|---|
| `src/lib/briefing/briefing-engine.ts` | Core — spawn/resume GENERAL, stream responses, parse plan on GENERATE PLAN |
| `src/lib/briefing/briefing-prompt.ts` | Build GENERAL's system prompt with project context |
| `src/actions/briefing.ts` | Server actions — create session, get messages, delete on green light |
| `src/components/campaign/briefing-chat.tsx` | Client component — chat UI with message bubbles, input, streaming |
| `src/components/campaign/campaign-results.tsx` | Client component — results view for accomplished campaigns |
| `src/hooks/use-briefing.ts` | Socket.IO hook for briefing room |
| New Drizzle migration | `briefing_sessions` and `briefing_messages` tables |

## Files to Modify

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Add `briefingSessions` and `briefingMessages` tables |
| `src/types/index.ts` | Add BriefingSession, BriefingMessage, CampaignStatus types |
| `src/app/(hq)/battlefields/[id]/campaigns/[campaignId]/page.tsx` | DRAFT renders briefing chat, ACCOMPLISHED renders results |
| `src/actions/campaign.ts` | `launchCampaign` deletes briefing data. Remove `generateBattlePlan`. Add back-to-draft transition. |
| `src/components/campaign/campaign-controls.tsx` | Add GREEN LIGHT, BACK TO BRIEFING, TACTICAL OVERRIDE, SKIP MISSION |
| `src/lib/orchestrator/campaign-executor.ts` | On retry exhaustion → COMPROMISED (not paused). COMPROMISED → ACTIVE on tactical override. |
| `src/lib/socket/server.ts` | Register briefing room handlers |

## Files to Remove

| File | Reason |
|---|---|
| `src/lib/orchestrator/plan-generator.ts` | Replaced by GENERAL briefing flow |
| `src/components/campaign/generate-plan-button.tsx` | No longer needed |

## What Does NOT Change

- Phase/mission data model — phases contain missions, sequential phases, parallel missions within
- Plan editor component — still used in PLANNING status for final tweaks
- Mission execution — individual missions behave the same (executor, captain review, retry)
- Campaign executor phase advancement logic — phases still advance sequentially
- Dependency resolution within phases — unchanged
- Template system — save/run templates still works (templates skip briefing, go straight to planning)
