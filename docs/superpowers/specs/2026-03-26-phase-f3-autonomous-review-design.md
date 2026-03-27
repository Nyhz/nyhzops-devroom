# Phase F3: Autonomous Review — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** F3 (Autonomous Review)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase F2 (Telegram Escalation) — complete

---

## Overview

Phase F3 makes the Captain fully autonomous: auto-reviewing mission debriefs after completion, handling campaign phase failures without Commander input, and making retry/skip/escalate decisions. The Captain becomes a true operations manager — the Commander reviews results, not process.

---

## 1. Debrief Auto-Review

**Modify:** `src/lib/orchestrator/executor.ts`

After a mission reaches `accomplished`, the Captain automatically reviews the debrief to check quality and flag concerns.

### Flow

1. Mission completes → debrief generated (existing)
2. Captain reviews the debrief via a quick Claude call
3. Review checks:
   - Did the agent complete what was asked? (compare briefing vs debrief)
   - Are there warnings or risks mentioned?
   - Did tests pass? (look for test failure indicators)
   - Are there TODO/FIXME items left?
   - Did the agent make unexpected architectural decisions?
4. Captain produces a `DebriefReview`:

```typescript
interface DebriefReview {
  satisfactory: boolean;      // Overall assessment
  concerns: string[];         // List of specific concerns
  recommendation: 'accept' | 'retry' | 'escalate';
  reasoning: string;
}
```

5. If `satisfactory` and `accept`: log review, no further action
6. If concerns but `accept`: log review with concerns, notify via in-app notification (info level)
7. If `retry`: automatically redeploy with modified briefing that includes the concerns
8. If `escalate`: send escalation to Commander (warning level)

### Captain Review Prompt

```
You are reviewing a mission debrief for quality and completeness.

MISSION BRIEFING (what was requested):
{mission.briefing}

MISSION DEBRIEF (what was done):
{mission.debrief}

PROJECT CONVENTIONS:
{CLAUDE.md excerpt — key rules only}

Review the debrief and assess:
1. Did the agent complete what was requested in the briefing?
2. Are there any warnings, risks, or concerns mentioned?
3. Are there indicators of test failures or incomplete work?
4. Did the agent make unexpected decisions that deviate from conventions?

Respond with JSON:
{
  "satisfactory": true/false,
  "concerns": ["specific concern 1", "..."],
  "recommendation": "accept" | "retry" | "escalate",
  "reasoning": "Brief explanation"
}

Rules:
- Most debriefs are satisfactory. Only flag genuine issues.
- Minor style differences are not concerns.
- "retry" only if the agent clearly failed to complete the task.
- "escalate" only if there's a significant risk the Commander should know about.
```

---

## 2. Campaign Failure Handling

**Modify:** `src/lib/orchestrator/campaign-executor.ts`

Currently when a phase has compromised missions, the campaign pauses and waits for Commander input. The Captain should handle most of these autonomously.

### Flow

When `onPhaseComplete` detects compromised missions:

1. Captain analyzes the failures: read all mission debriefs from the phase
2. Captain decides:
   - **Retry specific missions** — If the failure looks transient (timeout, rate limit, minor error), redeploy those missions with adjusted briefings
   - **Skip and continue** — If the failures are in non-critical missions and the phase objective is mostly met
   - **Escalate** — If multiple critical missions failed or the Captain can't determine the right course

3. Implementation:
   - Before pausing the campaign, call `captainHandlePhaseFailure()`
   - If Captain decides to retry: redeploy failed missions, DON'T pause
   - If Captain decides to skip: call `skipAndContinue()`, DON'T pause
   - If Captain decides to escalate: pause the campaign + send escalation (existing behavior)

### Captain Phase Failure Prompt

```
You are assessing a campaign phase failure.

CAMPAIGN: {campaign.name}
OBJECTIVE: {campaign.objective}
PHASE: {phase.name} ({n} of {total})
PHASE OBJECTIVE: {phase.objective}

COMPROMISED MISSIONS:
{for each failed mission: title, briefing, debrief, error}

ACCOMPLISHED MISSIONS:
{for each successful mission: title, brief debrief summary}

Decide the best course of action:
- "retry": Redeploy the failed missions (good for transient failures)
- "skip": Skip failed missions and advance to next phase (good for non-critical failures)
- "escalate": Pause and alert the Commander (for critical failures or uncertainty)

If "retry", provide modified briefings that address the failure reasons.

Respond with JSON:
{
  "decision": "retry" | "skip" | "escalate",
  "reasoning": "Why this decision",
  "retryBriefings": { "missionId": "modified briefing..." }  // only if retry
}
```

### Auto-Retry Limit

The Captain can retry a mission up to 2 times. After 2 Captain-initiated retries, escalate to Commander. Track retry count in the Captain's log.

---

## 3. Captain's Decision Log Enhancement

**Modify:** `src/lib/captain/captain-db.ts`

Add new log types to distinguish Captain activities:

```typescript
// Existing: 'question_answer' (from F1)
// New:
type CaptainLogType = 'question_answer' | 'debrief_review' | 'phase_failure_decision';
```

Add a `type` column to `captainLogs` table (or use the existing fields creatively — store the type in the `question` field prefix like `[DEBRIEF_REVIEW]` or add a column).

Simpler approach: use the existing schema. The `question` field stores what triggered the Captain, and the `answer` stores the decision. The type is implicit from the content:
- Question starts with "Agent asked:" → question_answer
- Question starts with "Debrief review:" → debrief_review
- Question starts with "Phase failure:" → phase_failure_decision

---

## 4. Modified Executor Flow

The complete mission lifecycle with Captain:

```
QUEUED → DEPLOYING → IN COMBAT → [agent asks question] → Captain answers → continues
                                → ACCOMPLISHED → Captain reviews debrief
                                                 → satisfactory: done
                                                 → concerns: notify
                                                 → retry: auto-redeploy
                                                 → escalate: notify Commander
                                → COMPROMISED → (if campaign) Captain decides
                                                → retry/skip/escalate
```

---

## 5. What Is NOT Built in F3

- Commander custom override via Telegram reply (Commander can only approve/retry/abort, not provide custom instructions)
- Captain learning from Commander overrides (no feedback loop yet)
- Captain adjusting its own system prompt based on past decisions

---

## 6. End State

After F3:
1. Every accomplished mission is auto-reviewed by the Captain
2. Quality concerns logged and notified (info/warning level)
3. Clearly failed missions auto-redeployed with improved briefings (up to 2 retries)
4. Campaign phase failures handled autonomously (retry/skip/escalate)
5. Commander only sees escalations for genuinely uncertain situations
6. Full Captain decision trail: question answers, debrief reviews, phase failure decisions
7. DEVROOM operates as a fully autonomous agent orchestrator — Commander gives orders, Captain manages execution
