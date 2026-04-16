# CONTROL Reliability Refactor — Design Spec

**Date:** 2026-04-16
**Status:** Draft, awaiting Commander review
**Scope:** Complete replacement of the current orchestrator, overseer, and quartermaster subsystems with a new reliability-first execution model.

---

## 1. Mission Brief

DEVROOM's current execution pipeline (mission → overseer review → quartermaster merge) is an accumulation of iterative patches. It conflates several distinct failure modes into a single "compromise reason" string, relies heavily on LLM judgment for deterministic decisions, and leaves missions able to silently hang in transient states. This spec specifies its complete replacement.

**Design principles, in priority order:**

1. **Deterministic gates are the source of truth.** A mission's success is measured by objective signals (commits present, build exits 0, tests exit 0) — not by an LLM's reading of a debrief.
2. **LLM involvement is bounded and exception-only.** Agents run combat missions. An LLM judgment call (OVERSEER consult, QUARTERMASTER conflict resolution) only fires when deterministic mechanics hit their limit. Never on the happy path.
3. **The system never autonomously gives up on a mission.** CONTROL can pause progress by marking a mission `COMPROMISED`, but only the Commander transitions missions to `ABANDONED` or accepts failed work as `ACCOMPLISHED`. Subordinates advise; the Commander decides.
4. **Instructions are advisory; CONTROL enforces.** Any reliability-critical behavior the agent is told to do (commit, emit debrief, run tests) has a CONTROL-side enforcement mechanism. The prompt is what we hope for; the system is what we guarantee.
5. **Every state is bounded in time.** No mission can remain in a transient state indefinitely. Every transition has a deterministic path to terminal or Commander-awaiting.

---

## 2. Terminology

### Roles

| Codename | Kind | Purpose |
|---|---|---|
| **COMMANDER** | Human | The user. Only entity that can transition a mission to `ABANDONED` or override gates. |
| **CONTROL** | Node.js supervisor | The non-LLM orchestrator. Dispatches assets, runs gates, commits, merges, classifies exits, enforces timeouts. Posts to comms under its own name. |
| **OPERATIVE** | Combat asset | General backend/fullstack/refactor/test-writing combat missions. |
| **VANGUARD** | Combat asset | Frontend specialist (UI, styling, UX). |
| **INTEL** | Combat asset | Docs, analysis, specs, bootstrap. Writing-heavy work. |
| **STRATEGIST** | System asset | Campaign planning via interactive briefing. Can propose combat *and* recon missions. |
| **OVERSEER** | System asset | Two narrow jobs: (a) classify ambiguous subprocess exits, (b) advise on repeated gate failures with `redirect` or `escalate`. |
| **QUARTERMASTER** | System asset | One narrow job: resolve merge conflicts during the rebase-then-merge path. |

### Concepts

| Term | Meaning |
|---|---|
| **Battlefield** | A git repository under DEVROOM's control. |
| **Gate manifest** | Per-battlefield `{ build, test, lint, typecheck }` command set, established at bootstrap, verified green on `HEAD` before activation. |
| **Combat mission** | Mission that modifies code. Always uses a worktree, always commits, always goes through gates and merge. |
| **Recon mission** | Mission that produces a prose report, no worktree, no commits, no gates. |
| **Attempt** | One invocation of the combat asset for a mission. Missions can have multiple attempts (retries). Each attempt logged to `mission_attempts`. |
| **Gate** | One of: `build`, `test`, `lint`, `typecheck`. Shell commands executed after the combat asset exits cleanly. |
| **Debrief** | Short, Commander-facing prose + structured metadata (commits, files touched, open questions). Not evidence for review. |

---

## 3. State Model

### Mission States

```
STANDBY → QUEUED → DEPLOYING → IN_COMBAT → (MERGING →) ACCOMPLISHED
                                          ↘
                                            COMPROMISED ↔ (Commander actions)
                                                        ↘ ABANDONED
```

| State | Set by | Meaning | Recoverable by Commander? |
|---|---|---|---|
| `STANDBY` | Commander (create) or campaign executor | Exists but not yet dispatched (e.g. campaign mission waiting on `dependsOn`) | Yes (trivially) |
| `QUEUED` | CONTROL (dispatcher) | Waiting for an execution slot | Yes |
| `DEPLOYING` | CONTROL | Setting up worktree / spawning subprocess | Yes (via watchdog healing) |
| `IN_COMBAT` | CONTROL | Combat asset subprocess running | Yes (via watchdog healing) |
| `MERGING` | CONTROL | Rebase and merge in progress (optionally with QUARTERMASTER) | Yes (via watchdog healing) |
| `ACCOMPLISHED` | Gates+merge OR Commander Accept & Merge override | Success | Terminal |
| `COMPROMISED` | **CONTROL** | Retry budget exhausted, or OVERSEER escalated, or merge cannot complete | **Yes — Commander decides next** |
| `ABANDONED` | **Commander** | Commander walked away | Terminal |

**Critical distinction:** `COMPROMISED` is set by CONTROL automatically when the system hits its limits. `ABANDONED` is only ever set by explicit Commander action. CONTROL never marks a mission `ABANDONED`.

### Mission states for recon missions

Recon missions skip `MERGING`. Lifecycle: `QUEUED → DEPLOYING → IN_COMBAT → ACCOMPLISHED` (or `COMPROMISED`). No worktree path, no gate path, no merge path.

### Campaign States

| State | Meaning |
|---|---|
| `DRAFT` | Created, no plan yet |
| `PLANNING` | STRATEGIST briefing session in progress |
| `ACTIVE` | Phases executing; at least one mission still in flight OR queued |
| `COMPROMISED` | No running/queued missions, but one or more missions are `COMPROMISED` awaiting Commander |
| `ACCOMPLISHED` | All phases `SECURED` (all missions `ACCOMPLISHED`) |
| `ABANDONED` | Commander cancelled the campaign |

### Phase States

| State | Meaning |
|---|---|
| `STANDBY` | Phase not started (previous phase not yet `SECURED`) |
| `ACTIVE` | Missions running in this phase |
| `SECURED` | Every mission in phase is `ACCOMPLISHED` |
| `COMPROMISED` | Phase settled; at least one mission is `COMPROMISED`/`ABANDONED` but others `ACCOMPLISHED` (mixed outcome — campaign still advances) |

A phase transitions out of `ACTIVE` only when every mission in it is in a terminal state (`ACCOMPLISHED`, `COMPROMISED`, `ABANDONED`). If any mission is `COMPROMISED` awaiting Commander, the phase stays `ACTIVE` (other missions keep running), and when they settle, the campaign transitions to `COMPROMISED`.

### Commander actions on `COMPROMISED` missions

| Action | Effect | Dependency cascade |
|---|---|---|
| **Tactical Override** | Rewrite briefing, reset retry-budget counter (new sortie), mission → `QUEUED`, fresh session. Prior `mission_attempts` rows remain for audit; `attemptNumber` continues incrementing. | Re-activates campaign on this mission |
| **Accept & Merge** | Force-merge worktree's current state into target; mission → `ACCOMPLISHED` | Unblocks dependents |
| **Abandon** | Mission → `ABANDONED`; confirmation modal offers opt-in branch preservation | Dependents cascade to `ABANDONED` with reason `dependency-cascade` |

Commander can resolve multiple `COMPROMISED` missions one at a time; campaign auto-resumes as soon as any resolution creates forward progress.

---

## 4. Architecture

### Module structure (new `src/control/`)

```
src/control/
  index.ts                     Public API — createControl(), startControl()
  control.ts                   Main supervisor. Dispatch loop, slot accounting, startup recovery.
  mission-runner.ts            Per-mission lifecycle (deploy → run → classify → gate → merge).
  liveness.ts                  Supervision layers (L1 exit / L3 silence / L5 wall-clock). One LivenessMonitor per running mission.
  exit-classifier.ts           Fast-path regex + OVERSEER classification fallback.
  retry-policy.ts              Deterministic retries, OVERSEER consult invocation, infra backoff.
  gates.ts                     Sequential fail-fast runner, per-gate timeouts, output capture.
  merge.ts                     Rebase-then-merge, merge lock, QUARTERMASTER conflict path.
  recon.ts                     Recon-specific lifecycle.
  worktree.ts                  Create/remove/rebase helpers with git timeouts.
  watchdog.ts                  L6 periodic sweep + startup rehydration.
  comms.ts                     Structured comms event emission under CONTROL identity.

src/control/debrief/
  schema.ts                    JSON schema for <DEBRIEF> block.
  parse.ts                     Extract block from final assistant message.
  synthesize.ts                Deterministic fallback from git state.

src/control/assets/
  registry.ts                  6-asset roster definitions (OPERATIVE/VANGUARD/INTEL + STRATEGIST/OVERSEER/QUARTERMASTER).
  combat/                      System prompts for combat assets.
  system/                      System prompts for system assets.
  cli-builder.ts               Translate asset config → claude CLI flags.

src/control/bootstrap/
  detect.ts                    Probe for existing test/build/lint infra.
  scaffold.ts                  Install missing infra via INTEL asset.
  verify.ts                    Run gates on HEAD; confirm green; seal manifest.

src/control/campaign/
  executor.ts                  Phase-by-phase execution, dependency checks, cascading.
  debrief.ts                   Deterministic phase debrief composition.
  dependency-graph.ts          Validation + cascade utilities.

tests/
  unit/                        Per-module unit tests (vitest).
  integration/                 Real-git + mocked-claude full-lifecycle tests.
  e2e/                         Scripted-claude end-to-end scenarios.
  fixtures/
    scripted-claude/           Mock claude binary that reads scenario files.
    repos/                     Disposable test repositories.
```

**Deletion at cutover:** `src/lib/orchestrator/`, `src/lib/overseer/`, `src/lib/quartermaster/` — replaced entirely, not refactored. No logic is lifted forward. The new module structure is written fresh from this spec.

### CONTROL responsibilities

CONTROL is the Node.js process that:

- Owns a slot-limited dispatch loop (`DEVROOM_MAX_AGENTS` concurrent missions).
- Picks up `QUEUED` missions, transitions them through `DEPLOYING → IN_COMBAT → (MERGING →) ACCOMPLISHED/COMPROMISED`.
- Spawns assets as `child_process.spawn('claude', ...)` subprocesses with isolated `HOME` per subprocess (prevents concurrent config corruption).
- Streams stdout from each subprocess, parses JSON events, emits to Socket.IO rooms, writes to the `comms` table.
- Runs the supervision layers (L1/L3/L5 per mission, L6 global watchdog) concurrently per live mission.
- On subprocess exit, runs the exit classifier, auto-commit sweep (combat missions), gate suite (combat), merge (combat).
- Maintains a merge lock per battlefield.
- Runs the periodic watchdog sweep and performs startup recovery.
- Never delegates authority to an LLM for anything on the happy path.

CONTROL identifies itself in comms as `CONTROL`. All system-emitted events on comms include this identity.

---

## 5. Combat Mission Lifecycle

### 5.1 Deployment

1. CONTROL picks a mission from `QUEUED` when a slot is free.
2. Status → `DEPLOYING`. Emit status change to comms.
3. Check CLI auth via keychain. On failure → orchestrator pause + AUTH escalation (see §6).
4. Create worktree at `{battlefield.repoPath}/.worktrees/{sanitized-branch}` (branch sanitized to `[a-zA-Z0-9._-]`).
5. Target branch is `battlefield.defaultBranch` (typically `main`).
6. Rebase the new worktree branch onto latest target to ensure the agent starts from current state.
7. Build prompt via `prompt-builder.ts`; see §11.
8. Build CLI args: `--model`, `--max-turns`, `--effort`, `--append-system-prompt`, `--plugin-dir` (skills), `--mcp-config`.
9. Spawn `claude` with `AbortController` tied to the mission. Isolated `HOME` at `/tmp/claude-config/{missionId}`.
10. Status → `IN_COMBAT`. Launch LivenessMonitor (L1/L3/L5/L6).

### 5.2 Execution supervision

Four supervision layers run concurrently per mission:

| Layer | Detects | Mechanism | Threshold |
|---|---|---|---|
| **L1** — Subprocess exit | Any process termination | Node `close` event on child process | Immediate |
| **L3** — Stdout silence | Network hang, blocked on API, stuck read | Timer reset on each JSON line | **5 minutes** |
| **L5** — Hard wall clock | Runaway attempts | Per-attempt timer at spawn | **30 minutes per attempt** |
| **L6** — Watchdog sweep | CONTROL itself crashed; stale transient states | Periodic scan: missions in `DEPLOYING`/`IN_COMBAT`/`MERGING` older than their max expected duration with no live pid in CONTROL's in-memory map | Every 60s + on CONTROL startup |

When L3/L5 fire, CONTROL sends SIGTERM to the subprocess, then SIGKILL after 5s grace. The attempt is recorded with `endReason: silence-kill / timeout`.

L6's startup recovery: on CONTROL boot, scan all missions in `DEPLOYING`/`IN_COMBAT`/`MERGING`. For each, check if there's a live process with a matching pid. If not, mark the last attempt as `infrastructure` (process unreachable) and apply the INFRASTRUCTURE policy (§5.4).

L6's post-resolution sweep: on each watchdog tick, scan missions in terminal states where artifacts should have been cleaned (`ACCOMPLISHED` / `ABANDONED`) but `.worktrees/` or `.git/worktrees/` still contains their entries. This happens when Commander resolved a mission via UI while CONTROL was down (Server Actions write DB directly). Heal by running the eager-cleanup path (§13) for each stale artifact.

### 5.3 Exit classification

On subprocess exit (L1), CONTROL classifies the exit before deciding what to do.

**Fast-path categories** (regex and event inspection, no LLM):

| Category | Signals |
|---|---|
| `CLEAN` | exit 0, final `result` event subtype `success` or `error_max_turns` |
| `TURN_LIMIT` | `result.subtype === 'error_max_turns'` |
| `TIMEOUT` | CONTROL's kill flag set (L3/L5 triggered) |
| `INFRASTRUCTURE` | stderr matches `/5\d\d|overload|server.?busy|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|stream aborted/i`, OR non-zero exit with no recognizable pattern, OR exit in <30s with no tool use and no diff |
| `RATE_LIMIT` | stderr matches `/429\|rate.?limit\|too many requests/i`, or response headers include `retry-after` |
| `AUTH` | stderr matches `/401\|403\|unauthori[sz]ed\|invalid.?credential\|keychain/i` |

**Fallback: OVERSEER classification pass.** If nothing matches, CONTROL spawns OVERSEER with `--print --output-format json` and a classification-only prompt (§11). Inputs: raw stderr, stdout tail, exit code. Output schema:

```ts
{
  category: "INFRASTRUCTURE" | "AGENT_FAILURE" | "NEEDS_COMMANDER",
  reasoning: string
}
```

- `AGENT_FAILURE` → treated as a failed attempt, counts against retry budget.
- `INFRASTRUCTURE` → infra retry with backoff, does not count against retry budget.
- `NEEDS_COMMANDER` → mission → `COMPROMISED` with raw output available to Commander.

If OVERSEER classification itself fails (process error, invalid JSON, timeout) → mission → `COMPROMISED` immediately with full raw output available to Commander. One shot; no retry.

Regex uses broad patterns (e.g., `5\d\d` catches 500–599) to avoid literal-code brittleness.

### 5.4 Exit policy per category

| Category | Auto-commit? | Run gates? | Counts against retry budget? | Worktree state for next attempt |
|---|---|---|---|---|
| `CLEAN` | Yes | Yes | Yes, if gates fail | Preserve (auto-committed), `--resume` session |
| `TURN_LIMIT` | Yes | Yes | Yes, if gates fail | Preserve, `--resume` |
| `TIMEOUT` | No | No | Yes | **Reset**: `git reset --hard HEAD && git clean -fdx`, fresh session |
| `INFRASTRUCTURE` | No | No | No | Reset, fresh session. Backoff scheduled. |
| `RATE_LIMIT` | No | No | No | Reset, fresh session. Delayed by `retry-after` or 60s. |
| `AUTH` | No | No | N/A | Orchestrator-wide pause (see §6.1). |

"Preserve" = keep uncommitted work (auto-committed first), keep session (`--resume`).
"Reset" = `git reset --hard HEAD`, `git clean -fdx`, fresh session (no `--resume`), prompt includes note "a previous attempt was terminated; proceed from the briefing."

Committed work from prior attempts on the worktree branch is *always* preserved across resets. Reset clears the dirty working tree and the agent's conversation context, not branch history.

### 5.5 Auto-commit sweep

Fires on `CLEAN` or `TURN_LIMIT` exit for combat missions.

1. `git status --porcelain` in the worktree.
2. If clean → skip.
3. If dirty:
   - `git add -A`
   - `git -c user.email="devroom@local" -c user.name="DEVROOM" commit --no-verify -m "chore(mission): sweep uncommitted work [{mission-id}]"`
   - Post to comms: `CONTROL │ Auto-commit: {n} files swept (agent did not commit).`
   - Set `mission.attempts.autoCommitted = true` on the current attempt record.

Rationale for `--no-verify`: pre-commit hooks can block the sweep (e.g., linting). The sweep preserves work; gates run afterward and will catch real quality issues.

### 5.6 Gate execution

Triggered on `CLEAN` or `TURN_LIMIT` after auto-commit sweep.

**Order (sequential, fail-fast):** `lint` → `typecheck` → `build` → `test`. Skip any gate whose command is `null` in the manifest.

- Each gate runs as a shell subprocess in the worktree directory.
- Per-gate timeout: 5 minutes. Total gate-suite timeout: 15 minutes.
- Stdout/stderr streamed live to comms; full captured output stored on the `mission_attempts` row.
- First failure stops the suite; remaining gates not run.

**Outcomes:**

- All gates pass → mission → `MERGING`.
- Any gate fails → record gate failure with stderr snapshot, trigger retry policy (§5.7).
- Gate command not found (ENOENT) → `gate-command-missing` failure reason; retry prompt surfaces this distinctly.
- Gate times out → `gate-timeout`; treated as gate failure.

### 5.7 Retry policy

Per mission, attempt budget:

1. **Attempt 1** — initial run with original briefing.
2. **Attempt 2 (deterministic)** — same session (`--resume`), prompt = "Gates failed. Here is the output. Fix it." plus full gate stderr.
3. **Attempt 3 (deterministic)** — same as attempt 2, but **only runs if attempt 2 produced a different diff than attempt 1.** If diff is identical → skip to step 4 (no-progress signal, don't burn tokens).
4. **OVERSEER consult** — one-shot `claude --print` with structured JSON output. Inputs: briefing, attempt history summaries, final diff, last gate stderr, CLAUDE.md excerpt. Output schema:

   ```ts
   {
     verdict: "redirect" | "escalate",
     reasoning: string,
     redirect?: { newPrompt: string, focusHint: string },
     escalate?: { question: string, options?: string[] }
   }
   ```
5. **If OVERSEER `redirect`**: attempt 4 runs combat asset with `newPrompt` replacing the retry template. Same worktree, same session.
6. **If OVERSEER `escalate`**: mission → `COMPROMISED` with the question attached. Commander answers via UI or Telegram (§9).
7. **If attempt 4 still fails gates** → mission → `COMPROMISED`. No second OVERSEER consult.

Hard caps: max **4 combat-asset spawns per mission**, exactly **1 OVERSEER consult per mission**.

Infrastructure-category exits (§5.3) do not count against this budget. They are retried with exponential backoff: **30s → 2m → 10m → 30m → COMPROMISED**. Backoff state persisted to `mission.nextAttemptAt` and `mission.infrastructureRetryCount` so CONTROL restart rehydrates pending infra retries.

---

## 6. Special execution paths

### 6.1 AUTH failure

If any subprocess exits with AUTH classification OR the initial auth check in `DEPLOYING` fails:

1. **All** queued missions are paused (not just the current one).
2. Orchestrator posts to comms: `CONTROL │ AUTH failure — claude CLI cannot authenticate. Orchestrator paused.`
3. Loud Telegram alert to Commander with re-auth instructions.
4. No new missions are dispatched until Commander explicitly resumes after re-authenticating.
5. The failed mission is re-queued (free retry) — when the orchestrator resumes, it tries again.

### 6.2 Merge (§5.6 gates passed)

1. CONTROL acquires per-battlefield merge lock.
2. Compare `target.HEAD` at mission start (recorded on attempt row) vs current `target.HEAD`.
3. If **target did not advance** during mission execution → rebase is a no-op; fast-forward merge → release lock → mission → `ACCOMPLISHED`.
4. If **target advanced**: rebase worktree branch onto latest target.
   - **Rebase clean (no conflicts):** re-run full gate suite on the rebased state. If gates pass → fast-forward merge → release lock → `ACCOMPLISHED`. If gates fail → mission → `COMPROMISED` with reason `post-rebase-gate-failure`; Commander resolves.
   - **Rebase produces conflicts:** enter QUARTERMASTER path (§6.3).

### 6.3 QUARTERMASTER conflict resolution

1. Mission status → `MERGING` with `hasConflict: true`.
2. Spawn QUARTERMASTER as one-shot `claude --print` in worktree, max 15 turns, 10-minute hard timeout.
3. Inputs: mission briefing, mission debrief, conflict diff with markers, `git log --oneline target..source`, `git log --oneline source..target`, CLAUDE.md excerpt.
4. QUARTERMASTER's authority: edit conflicted files, `git add`, single commit. Cannot touch anything outside the worktree, run tests, or make new changes.
5. On QUARTERMASTER exit:
   - If index is clean and a conflict-resolution commit exists → **re-run the full gate suite** on the resolved state.
   - Gates green → merge → `ACCOMPLISHED`.
   - Gates red, OR QUARTERMASTER failed to produce a clean index, OR QUARTERMASTER timed out → mission → `COMPROMISED` with reason `merge-conflict`. Release merge lock. Commander resolves.
6. No QUARTERMASTER retries. One shot or `COMPROMISED`.

---

## 7. Recon Mission Lifecycle

Recon missions produce a prose report; no worktree, no commits, no gates, no merge.

1. Commander creates recon mission (or STRATEGIST proposes one in campaign plan). `type: "recon"`.
2. CONTROL picks it up, status → `DEPLOYING` → `IN_COMBAT`.
3. Spawn combat asset (OPERATIVE or INTEL — assigned by Commander/STRATEGIST) in **repo root** (not a worktree).
4. Rules of Engagement for recon includes: *"You may not write files. You are producing a report only."*
5. L1/L3/L5/L6 supervision applies. L3 (stdout silence) threshold raised to 10 minutes for recon (recon involves long reads/thinking without necessarily writing output).
6. On process exit:
   - CONTROL runs `git status --porcelain` on repo root.
   - **If any changes present** → revert them (`git reset --hard HEAD && git clean -fdx`), set `mission.reconViolatedReadonly = true`, flag visible on mission page.
   - Look for `<DEBRIEF>` block.
   - If `summary` field is non-empty → mission → `ACCOMPLISHED`. Report rendered on mission page.
   - If `summary` empty or block missing → treat as gate-failure-equivalent, apply retry policy (same 4-attempt budget, OVERSEER redirect still applies).

For the OVERSEER consult on recon missions: the `LAST GATE OUTPUT` and `FINAL DIFF` sections are omitted from the prompt (there are no gates and no diff). Inputs are briefing, attempt-history summaries, prior debrief attempts' raw final-message text, CLAUDE.md excerpt. OVERSEER still returns the same schema (`redirect` / `escalate`).

Recon missions cannot have `dependsOn` dependencies from other recon missions (recon is cheap scouting; no chaining). STRATEGIST plan validator rejects plans that violate this.

---

## 8. Campaign Lifecycle

### 8.1 Planning

Unchanged from current system: Commander opens BriefingChat with STRATEGIST, iterates, taps GENERATE PLAN. STRATEGIST emits JSON plan per current schema with one extension: each mission has `type: "combat" | "recon"`.

### 8.2 Execution

1. Campaign → `ACTIVE`. Phase 1 → `ACTIVE`.
2. Missions within a phase with no `dependsOn` → `QUEUED`. Others → `STANDBY`.
3. CONTROL dispatches up to `DEVROOM_MAX_AGENTS` concurrent missions.
4. As each mission reaches `ACCOMPLISHED`, `checkDependencies()` unblocks any `STANDBY` missions whose dependencies are all `ACCOMPLISHED` → those → `QUEUED`.
5. Phase settles when every mission in it is terminal (`ACCOMPLISHED`/`COMPROMISED`/`ABANDONED`).
6. Phase `SECURED` if all missions `ACCOMPLISHED`. Otherwise phase `COMPROMISED` but campaign still advances to next phase.
7. Phase debrief composed **deterministically** (§11) — no LLM call. Passed as context to next phase's missions.
8. All phases settled → campaign → `ACCOMPLISHED` or `COMPROMISED` (if any mission stuck in COMPROMISED).
9. If any mission transitions to `COMPROMISED`, other missions in the same phase continue running.
10. **Campaign transitions to `COMPROMISED`** when none of its missions can make forward progress without Commander input. Concretely: no missions in `QUEUED`, `DEPLOYING`, `IN_COMBAT`, or `MERGING`; at least one mission in `COMPROMISED`; any `STANDBY` missions still exist only because their dependencies are `COMPROMISED`/`ABANDONED` (i.e., they are blocked-not-waiting). Pure dependency-waiting (dependencies still running) keeps the campaign `ACTIVE`.

### 8.3 Mission cascade on `ABANDONED`

When Commander sets a mission to `ABANDONED`:

1. Walk dependency graph (within-phase `dependsOn` pointers) **transitively** — if M is abandoned and N depends on M, N cascades; if O depends on N, O also cascades; and so on until the walk finds no more affected `STANDBY` missions.
2. Each cascaded mission → `ABANDONED` with reason `dependency-cascade`, recording the originating mission ID.
3. Running/queued/already-compromised downstream missions are not cascaded (past the dependency gate); Commander handles them independently.

### 8.4 Commander controls

| Control | Scope | Effect |
|---|---|---|
| `[ABANDON CAMPAIGN]` | Campaign | All non-terminal missions → `ABANDONED`; campaign → `ABANDONED`. |
| `[ACCEPT CAMPAIGN]` | Campaign | Only valid if all missions terminal; forces campaign → `ACCOMPLISHED` regardless of mixed outcomes. |
| Mission resolution actions | Per `COMPROMISED` mission | Tactical Override / Accept & Merge / Abandon (§3). |

---

## 9. Notifications (Telegram + Comms)

### Comms (all events)

Every state transition, gate result, subprocess spawn/exit, classification decision, auto-commit, merge event, Commander action is posted to comms under a named actor (`CONTROL`, `OPERATIVE`, `OVERSEER`, `COMMANDER`, etc.). Mission detail page and campaign detail page subscribe to per-mission and per-campaign Socket.IO rooms respectively.

### Telegram (tier B, minus phase events)

| Event | Telegram? |
|---|---|
| Mission → `COMPROMISED` | **Quiet ping** — "come look when you can" |
| Campaign → `COMPROMISED` | **Loud ping** — work halted |
| Campaign → `ACCOMPLISHED` | Quiet ping |
| Orchestrator AUTH pause | **Loud ping** — re-auth required |
| Mission/Phase → `ACCOMPLISHED` | No notification |
| Phase → `SECURED` | No notification |

### Answerable escalations

When mission → `COMPROMISED` is caused by OVERSEER `escalate` with a specific question, the Telegram message includes the question inline with a Telegram inline keyboard:

```
🟠 MISSION COMPROMISED — Commander input required
Mission: "Add Redis-backed rate limiter"
Question: Should the rate limiter use sliding-window or token-bucket?
[ A) sliding-window ] [ B) token-bucket ]
```

Commander taps → `callback_query` received by DEVROOM's Telegram bot → answer injected into mission prompt → mission re-queued. Implementation: the existing `plugin_telegram_telegram` MCP doesn't support inline keyboards or `callback_query`; DEVROOM owns its own Telegram bot handler for these updates (the MCP remains for free-text notifications).

### Telegram transport

**Long-polling** (not webhooks). DEVROOM's Telegram bot handler maintains a single persistent HTTP connection to `api.telegram.org/bot{token}/getUpdates?timeout=30`. Telegram holds the connection until an update arrives or 30s elapses; DEVROOM reopens immediately. Cost: one idle socket, negligible CPU, effectively zero bandwidth when quiet. No public URL, no TLS termination, no ngrok — works on LAN-only deployments by design.

---

## 10. Debrief Format

### Structure

Combat assets are instructed (via Rules of Engagement) to emit a JSON block as their final action:

```
<DEBRIEF>
{
  "summary": "Implemented JWT refresh-token rotation. Added tests covering replay, concurrency, and expiry.",
  "commits": ["abc1234", "def5678"],
  "files_touched": ["src/auth/refresh.ts", "src/auth/__tests__/refresh.test.ts"],
  "confidence": "high",
  "open_questions": [
    {
      "title": "Rate limiting on /api/auth/refresh",
      "description": "Refresh endpoint has no rate limit. A brute-force attacker could hammer it.",
      "severity": "medium"
    }
  ]
}
</DEBRIEF>
```

Schema:

| Field | Type | Required |
|---|---|---|
| `summary` | string | yes |
| `commits` | string[] (12-char short SHAs) | yes |
| `files_touched` | string[] | yes |
| `confidence` | `"high" \| "medium" \| "low" \| "unknown"` | yes |
| `open_questions` | `{title, description, severity: "low"\|"medium"\|"high"}[]` | optional (empty array OK) |

### Parse → synthesize fallback

On mission exit, CONTROL extracts the `<DEBRIEF>...</DEBRIEF>` block from the last assistant message and parses as JSON.

**If parse succeeds and schema validates** → use as-is, stored on `mission.debriefStructured`.

**If parse fails, block missing, or schema invalid:**
- `summary` ← last assistant message text, truncated to 2000 chars, or `"No structured debrief provided by agent."`
- `commits` ← `git log --format="%h" --abbrev=12 target..worktree-branch`.
- `files_touched` ← `git diff --name-only target..worktree-branch`.
- `confidence` ← `"unknown"`.
- `open_questions` ← `[]`.
- `mission.debriefSynthesized = true` — banner on mission detail page: *"Agent did not provide a structured debrief. Fields reconstructed from git state."*

### Phase debrief composition (deterministic, no LLM)

```
# Phase {n}: {name}
Status: SECURED | COMPROMISED
Duration: {formatted} | Tokens: {total}

## Mission: {title} ({status})
{mission.debriefStructured.summary}

Files touched: {count}
Commits: {count}
{if open_questions} Open questions: {count} {/if}

---

## Mission: {title} ({status})
...
```

Stored on `phase.debrief`. Passed to next phase's missions as `### Previous Phase Results` context section.

---

## 11. Prompt Architecture

### Rules of Engagement (shared prompt prefix for combat assets)

Stored in `settings.rules_of_engagement`. Composed onto every mission asset's system prompt at CLI-build time (not for system assets).

Must include:

- **Final-step checklist at both top and bottom** — concrete closure ritual.
- `FINAL STEP CHECKLIST (do these in order before exiting):
  1. git add + git commit your changes
  2. emit the <DEBRIEF>...</DEBRIEF> block as your final assistant message
  3. stop`
- Instructions on gate commands for this battlefield (injected per-mission from the manifest).
- Instructions on worktree boundary (do not edit outside `{worktreePath}`).

### Mission prompts

Built by `src/control/prompt-builder.ts` with three variants:

1. **Standard combat** — `{CLAUDE.md}` + `## Mission Briefing` + `## Workspace`.
2. **Campaign combat** — adds `## Campaign Context` (operation name, phase, previous phase debriefs).
3. **Recon** — `{CLAUDE.md}` + `## Recon Briefing` + warning about read-only boundary. No workspace worktree path (runs in repo root).

### Retry prompts

**Deterministic retry** (attempt 2, 3):
```
OVERSEER REVIEW FEEDBACK (Retry {n})
========================================
Gates failed. Output:
{gate-stderr}

Please fix the gate failures. Your previous session context is preserved.
```

**OVERSEER-redirected retry** (attempt 4):
```
OVERSEER REDIRECT (Retry {n})
========================================
The Overseer has reviewed your attempts and reframed the approach.

{overseer.redirect.newPrompt}

Your previous session context is preserved.
```

### OVERSEER classification prompt (ambiguous exit)

```
You are the OVERSEER. Classify this subprocess exit. Do NOT judge the work.

EXIT CODE: {code}
STDERR:
{raw-stderr}

STDOUT TAIL:
{last-2000-chars}

Respond with JSON:
{
  "category": "INFRASTRUCTURE" | "AGENT_FAILURE" | "NEEDS_COMMANDER",
  "reasoning": "<one sentence>"
}
```

### OVERSEER consult prompt (gate failure after retries)

```
You are the OVERSEER. The combat asset has exhausted deterministic retries.
Decide: redirect (write a new prompt reframing the approach, agent gets 1 more attempt)
or escalate (this needs the Commander — write a specific question).

DO NOT decide whether the mission should continue — that is the Commander's call.

MISSION BRIEFING:
{briefing}

ATTEMPT HISTORY:
{attempt-summaries}
  # one line per prior attempt, format:
  # "Attempt N (duration): exit={category}, gates failed on [{gate-names}], diff: +X -Y across Z files"
  # e.g.:
  # "Attempt 1 (7m 12s): exit=clean, gates failed on [test], diff: +41 -12 across 3 files"
  # "Attempt 2 (4m 03s): exit=clean, gates failed on [test], diff: +41 -12 across 3 files (identical to attempt 1)"

LAST GATE OUTPUT:
{gate-stderr}

FINAL DIFF:
{git-diff-stat + truncated diff}

PROJECT CONVENTIONS:
{claude-md-excerpt}

Respond with JSON matching the schema.
```

### QUARTERMASTER conflict prompt

Unchanged from current system's structure: mission briefing + debrief + conflict diff + log summaries + orders.

---

## 12. Bootstrap

### Triggered when

- A new battlefield is created (Commander provides `repoPath` + `initialBriefing`).
- An existing battlefield has `needsGateManifest: true` and Commander triggers `[ESTABLISH GATES]`.

### Flow

1. Spawn INTEL in repo root (not a worktree). Status on battlefield → `INITIALIZING`.
2. **Detect phase** (programmatic, not LLM):
   - Read `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.
   - Look for existing test/build/lint commands.
   - Probe each candidate command by running it against `HEAD`.
   - Record which gates exist and whether they currently pass.
3. **Adopt phase:** for each detected command that exits 0 → adopted into `battlefield.gateManifest`.
4. **Fill gaps:** if any of `test`/`build` is missing, INTEL is instructed to:
   - Propose a framework from the curated list (Vitest for TS/JS, pytest for Python, Go test for Go, etc.).
   - Install it via the appropriate package manager.
   - Write a minimal smoke test.
   - Wire up scripts in `package.json` / equivalent.
   - Verify the new command exits 0 on `HEAD`.
   - Commit the changes.
5. **Generate docs:** INTEL writes CLAUDE.md and SPEC.md per current behavior.
6. **Verify phase:** CONTROL runs every gate command in the manifest against `HEAD` one last time. Record which gates pass.
7. Battlefield status → `ACTIVE`. `needsGateManifest` cleared.
8. **If any gate is red on `HEAD`** (e.g., imported repo with broken main):
   - Battlefield enters `ACTIVE` but with flag `mainIsRed: true` recorded on the battlefield row.
   - Battlefield overview shows a prominent banner: *"Main is red on {gates}. Launch a combat mission to green the build before other missions can deploy."*
   - **No combat missions can be deployed** on this battlefield until Commander resolves the red state by launching + accomplishing a combat mission that leaves all gates green on HEAD. Recon missions are permitted (they don't merge to main).
   - When a combat mission accomplishes and leaves all manifest gates passing on target HEAD, CONTROL clears `mainIsRed` and the banner disappears.
   - Commander can override the guard per-battlefield via a `[OVERRIDE MAIN-RED GUARD]` toggle in battlefield settings (§17) if they want to deploy regardless.

### Curated testing frameworks

| Language | Default framework |
|---|---|
| TypeScript / JavaScript | Vitest |
| Python | pytest |
| Go | `go test` (stdlib) |
| Rust | `cargo test` (stdlib) |
| Ruby | RSpec |
| Java / Kotlin | JUnit 5 |
| C# | xUnit |

For languages not on the list, bootstrap proposes the ecosystem default with Commander confirmation.

### Curated build commands

Battlefield bootstrap attempts in order: existing `build` script → `tsc --noEmit` (TS projects) → `go build ./...` → `cargo build` → language-specific default. If none applies and none is configured, `build` gate is `null` (docs-only battlefield).

---

## 13. Worktree Lifecycle

### Location

`{battlefield.repoPath}/.worktrees/{sanitized-branch-name}` — in-repo, same as current. Sanitization: restrict branch-to-path transform to `[a-zA-Z0-9._-]`.

### Cleanup policy

| Terminal state | Worktree directory | Branch |
|---|---|---|
| `ACCOMPLISHED` | Removed | Deleted |
| `COMPROMISED` | **Kept** | **Kept** |
| `ABANDONED` | Removed | Deleted (with opt-in preserve checkbox at Commander decision time) |

**Eager cleanup** on status transition (primary path):
- `git worktree remove {path}` + `git branch -D {branch}` as appropriate.

**Sweep job** (orphan-catcher): `WORKTREE SWEEP` scheduled task runs on cron + on CONTROL startup. Cross-references `.worktrees/` and `.git/worktrees/` against DB missions; removes directories/refs whose mission is terminal in a state where artifacts shouldn't exist.

**Forensic branch pruning:** Commander action `[PRUNE FORENSIC BRANCHES OLDER THAN N DAYS]` on battlefield overview — manual, never automatic.

---

## 14. Database Schema Changes

### New tables

**`mission_attempts`** — one row per attempt per mission.

| Column | Type | Notes |
|---|---|---|
| `id` | text (ULID) | primary key |
| `missionId` | text | FK to missions |
| `attemptNumber` | integer | 1-based |
| `startedAt` | integer (ms) | — |
| `endedAt` | integer (ms) | — |
| `endReason` | text | `clean` / `timeout` / `silence-kill` / `infrastructure` / `rate-limit` / `auth` / `turn-limit` / `gate-failure` |
| `classification` | text (JSON) | Full exit classifier output including raw stderr snapshot |
| `gateResults` | text (JSON) | Per-gate pass/fail + stderr snapshots |
| `debriefSynthesized` | integer | 0/1 |
| `autoCommitted` | integer | 0/1 |
| `tokensInput` | integer | — |
| `tokensOutput` | integer | — |
| `tokensCache` | integer | — |
| `durationMs` | integer | — |
| `sessionId` | text | Claude Code session ID for this attempt |
| `targetHeadAtStart` | text | Full SHA of target branch HEAD when attempt began — used by merge §6.2 to detect target advance |

### New columns on existing tables

- `battlefields.gateManifest` — text (JSON) — `{ build, test, lint, typecheck }` each string | null.
- `battlefields.needsGateManifest` — integer (0/1) — set on existing battlefields at cutover; cleared after Commander establishes gates.
- `battlefields.mainIsRed` — integer (0/1) — true when `HEAD` has failing gates; blocks combat mission deployment unless overridden. Specific failing gate names are recomputed on demand by re-running the manifest.
- `battlefields.overrideMainRedGuard` — integer (0/1) — Commander override allowing combat missions despite red main.
- `missions.debriefStructured` — text (JSON) — parsed `<DEBRIEF>` block.
- `missions.nextAttemptAt` — integer (ms) — for infra backoff persistence.
- `missions.infrastructureRetryCount` — integer — bounded by policy (§5.7).
- `missions.type` — text — `combat` | `recon`.
- `missions.reconViolatedReadonly` — integer (0/1) — recon violation flag.
- `missions.currentSortieAttempts` — integer — attempts since the most recent Tactical Override (or mission creation). Retry-policy (§5.7) checks against this, not the global `mission_attempts` count. Reset to 0 on Tactical Override.

### Columns dropped at cutover

These columns are dropped in the same migration that creates the new schema — no carry-forward period:

- `missions.reviewAttempts` — replaced by `mission_attempts` count.
- `missions.compromiseReason` — replaced by `mission_attempts.endReason` on last attempt.
- `missions.mergeRetryAt` — merge is deterministic + QUARTERMASTER one-shot; no retry scheduler.

### Clean-slate migration at cutover

**Preserved:**
- `battlefields` (flagged `needsGateManifest: 1` for all existing rows)
- `assets` — truncated, reseeded with new 6-asset roster
- `dossiers`
- `settings` (including `rules_of_engagement` — updated to new text)
- `scheduledTasks`

**Wiped:**
- `missions`, `campaigns`, `phases`, `comms`, `overseerLogs`, `followUpSuggestions`, `missionLogs`, `intelNotes` (mission-linked ones)

**Kept on disk, not touched:**
- `CLAUDE.md`, `SPEC.md` inside each battlefield's repo.
- Any existing git state on battlefield repos.

---

## 15. Testing Strategy

Every new flow ships with at least one integration or E2E test before cutover. No untested paths in the critical execution loop.

### 15.1 Unit tests (Vitest)

One test file per module under `src/control/`. Each module tested in isolation with mocks:

- `exit-classifier` — fed synthetic stderr/exit-code combinations, assert category returned.
- `retry-policy` — state machine tests for attempt progression, budget enforcement, backoff calculations.
- `gates` — mock shell commands with scripted outcomes, assert fail-fast ordering.
- `liveness` — fake subprocess that emits/withholds output, assert L3 and L5 fire at thresholds.
- `merge` — mocked git operations, assert rebase-clean vs rebase-conflict paths.
- `debrief/parse` — valid/invalid/malformed `<DEBRIEF>` blocks, schema validation.
- `debrief/synthesize` — mocked git state, assert correct fallback fields.

### 15.2 Integration tests (Vitest, real git + mock claude)

Disposable fixture repos under `tests/fixtures/repos/` (checked into VCS, materialized per test). Mock Claude Code subprocess replaced with scripted binary (see 15.3).

Scenarios:

- Combat mission happy path: spawn, agent commits, gates pass, merge clean, `ACCOMPLISHED`.
- Combat mission, agent forgets commit: auto-commit sweep fires, gates run on swept commit.
- Combat mission, gate fails attempt 1, passes attempt 2: deterministic retry works.
- Combat mission, gates fail all deterministic retries, OVERSEER redirect, passes attempt 4.
- Combat mission, gates fail including OVERSEER redirect → `COMPROMISED`.
- Combat mission with merge conflict: QUARTERMASTER resolves cleanly.
- Combat mission with merge conflict: QUARTERMASTER fails → `COMPROMISED`.
- Recon mission happy path.
- Recon mission violates read-only: changes reverted, flag set.

### 15.3 E2E tests (Vitest, scripted-claude fixture)

**Scripted-claude** (`tests/fixtures/scripted-claude/`): a small Node.js binary that masquerades as the `claude` CLI. Accepts the same flags. Reads a scenario file specified via env var. Emits pre-canned JSON stream events with scripted delays, exit codes, and final messages.

Scenarios cover full flows end-to-end from the Server Action trigger to final mission status:

- Happy path combat (OPERATIVE + gates + merge + ACCOMPLISHED)
- Agent hangs mid-execution (L3 silence kill + fresh-session retry)
- Infrastructure error (free retry, no budget burn)
- Rate limit with `retry-after` (delayed retry)
- Watchdog recovery (kill CONTROL mid-mission, restart, assert heal)
- Full campaign: 3 phases, one mission pauses mid-phase, rest continue, Commander resolves via test harness
- STRATEGIST proposes recon phase, then combat phase builds on recon findings

### 15.3.1 Opt-in real-LLM E2E mode

A small subset of the scripted-claude scenarios has a `--real` variant that substitutes the scripted binary for the actual `claude` CLI with a small, cheap model (default `claude-haiku-4-5`). Purpose: catch real-API drift (prompt-format changes, JSON schema behaviour, new error envelopes) that scripted tests miss by design.

- Triggered via `pnpm test:e2e:real`. Never runs in the default `pnpm test` / `pnpm test:all` flow.
- Covered scenarios: happy path combat, happy path recon, simple OVERSEER consult, simple QUARTERMASTER resolution. ~5 minutes of real-LLM time per run.
- Token budget is bounded per run (e.g., max 50k tokens total). Hard-stops if budget exceeded.
- Expected to be run manually before cutover and periodically as a smoke test — not on every PR.

### 15.4 UI E2E tests (Playwright)

Kept from current test stack. Flows:

- Create battlefield with bootstrap → gate establishment → first mission launch
- Launch combat mission from battlefield overview → observe comms → `ACCOMPLISHED` state
- Resolve `COMPROMISED` mission via Tactical Override
- Answer OVERSEER escalation question from mission page
- Create campaign via BriefingChat → Launch → observe phase progression

### 15.5 Test run commands

| Command | Scope |
|---|---|
| `pnpm test` | Unit + integration (fast) |
| `pnpm test:e2e` | Scripted-claude E2E |
| `pnpm test:e2e:real` | Opt-in real-LLM E2E (small model, bounded tokens) |
| `pnpm test:ui` | Playwright UI E2E |
| `pnpm test:all` | Unit + integration + scripted-claude E2E + UI E2E (does NOT include `:real`) |

CI runs `pnpm test:all` before any cutover or follow-up merge.

---

## 16. Implementation Plan

### Phase 0 — Preparation (no code changes)

- Review and approve this spec.
- Decompose spec into implementation plan via `writing-plans` skill.
- Create tracking issues / tasks from the plan.

### Phase 1 — Schema migration + scripted-claude fixture

- Author Drizzle migration for new columns, new `mission_attempts` table, deprecation markers.
- Build scripted-claude fixture with scenario file format.
- Build disposable-repo fixture materializer.
- Write all unit test skeletons (failing, red).
- No production code yet.

### Phase 2 — `src/control/` skeleton

- Implement `control.ts`, `mission-runner.ts`, `liveness.ts`, `exit-classifier.ts`, `retry-policy.ts`, `gates.ts`, `worktree.ts`, `watchdog.ts`, `comms.ts`.
- Each module ships with its unit tests passing.
- No integration yet with the rest of DEVROOM (Server Actions, UI).

### Phase 3 — Asset roster + prompts

- Reseed asset registry with 6-asset roster.
- Update Rules of Engagement text per §11.
- Author system prompts for OVERSEER (classification + consult), QUARTERMASTER (conflict), INTEL (bootstrap + recon), OPERATIVE, VANGUARD.
- Unit tests for CLI-builder assembling correct args.

### Phase 4 — Bootstrap + gates

- Implement `src/control/bootstrap/` (detect/scaffold/verify).
- Implement `src/control/gates.ts` with sequential fail-fast runner.
- Integration tests on fixture repos for bootstrap flow on: JS/TS project with existing tests, JS/TS project without tests, Python project without tests, repo with broken main.

### Phase 5 — Mission lifecycle integration tests

- Wire `mission-runner` to scripted-claude.
- Full integration coverage of §5 happy path, all retry paths, all classification outcomes.
- Recon lifecycle tests.

### Phase 6 — Merge + QUARTERMASTER

- Implement `merge.ts` with merge lock + rebase + QUARTERMASTER spawn.
- Integration tests: clean merge, rebase-conflict with QUARTERMASTER success, rebase-conflict with QUARTERMASTER failure.

### Phase 7 — Campaign executor

- Implement `src/control/campaign/`.
- Cascade logic, dependency graph validation.
- E2E campaign test with scripted-claude: multi-phase, pause-and-resume, mixed outcomes.

### Phase 8 — Server Actions + UI wiring

- Rewrite Server Actions (`src/actions/mission.ts`, `campaign.ts`, `battlefield.ts`) against the new CONTROL API.
- Update UI components for new state names, new Commander actions, new debrief format.
- Remove UI dependencies on deleted subsystems.

### Phase 9 — Telegram bot + inline escalations

- Add Telegram bot update-handler for `callback_query`.
- Answerable escalation flow end-to-end.
- Notification policy per §9.

### Phase 10 — Cutover

- Delete `src/lib/orchestrator/`, `src/lib/overseer/`, `src/lib/quartermaster/`.
- Run clean-slate migration.
- Flag all existing battlefields `needsGateManifest: 1`.
- Restart production DEVROOM on new code.
- Commander establishes gates on each battlefield before resuming combat missions.

### Phase 11 — Follow-ups (post-cutover, weeks)

- Iterate on scripted-claude scenarios as new failure modes are observed in production.
- Promote recurring "unknown exit" patterns to fast-path regex entries.

---

## 17. Settings

Commander-editable configuration surfaces. All settings live in the existing `settings` table (key/value JSON) or on `battlefields` columns as noted.

### 17.1 Global settings — `/assets` page (kept from current)

- **Rules of Engagement** — shared prompt prefix for all combat assets. Editable via existing RoE tab. Must reference the gate manifest (combat assets see per-battlefield gate commands at prompt-build time).
- **Asset roster management** — `/assets` page kept. Updated to show new 6-asset lineup (OPERATIVE, VANGUARD, INTEL, STRATEGIST, OVERSEER, QUARTERMASTER). System assets (STRATEGIST, OVERSEER, QUARTERMASTER) are read-only for codename + deletion but have editable prompts, models, skills, MCP servers.

### 17.2 Global settings — `settings` table

| Key | Value | Default |
|---|---|---|
| `rules_of_engagement` | string | Seeded from `default-rules-of-engagement.ts` |
| `devroom_max_agents` | integer | 3 |
| `attempt_hard_timeout_ms` | integer | 1_800_000 (30 min, L5) |
| `stdout_silence_ms` | integer | 300_000 (5 min, L3) |
| `telegram_bot_token` | string | (from env) |

Other timings (infra backoff intervals, gate suite timeout, gate per-command timeout, recon L3 threshold) are hardcoded constants in the new code. Promoted to settings only if operational evidence shows a need.

### 17.3 Battlefield settings — `/battlefields/[id]/settings` (new page section)

Per-battlefield configuration:

- **Gate manifest editor** — form with 4 fields (`build`, `test`, `lint`, `typecheck`), each accepting a shell command or blank (disables that gate). `[VERIFY AGAINST HEAD]` button runs the new commands in repo root and reports pass/fail before saving. Save is only allowed if verify was run and passed (or Commander explicitly overrides with a `[SAVE WITHOUT VERIFYING]` confirm).
- **Main-red guard override** — toggle for `overrideMainRedGuard`. Default off. Only meaningful when `mainIsRed: true`.
- **Forensic branch cleanup** — `[PRUNE FORENSIC BRANCHES OLDER THAN N DAYS]` action with configurable N.
- **Re-establish gates** — button that re-runs bootstrap detection against the current repo state. Useful if the repo has changed test frameworks since bootstrap.

### 17.4 Asset settings — kept at `/assets/[id]`

No structural change. Existing tabs (Profile, Prompt, Skills) continue to work against the new roster.

---

## 18. Non-goals

- **Multi-Commander / auth / RBAC** — DEVROOM remains single-Commander LAN-only.
- **Cross-battlefield coordination** — each battlefield's execution is isolated.
- **Real-time LLM-driven merge reasoning beyond conflict-only** — QUARTERMASTER does not propose follow-up work, does not re-run tests beyond gate re-verification.
- **Agent-to-agent in-flight messaging** (stall-break via stdin injection) — explicitly removed.
- **Automatic "give up" by the system** — CONTROL never marks `ABANDONED`.

---

## 19. Resolved decisions from brainstorming

Recorded here for traceability:

1. **L5 per-attempt budget:** single global value (30 min). Tunable via `attempt_hard_timeout_ms` setting if false timeouts appear in practice.
2. **Infra retry ceiling:** single global value (4 escalating waits; ~45min total). Tunable via `infra_retry_backoff_ms` setting.
3. **E2E test modes:** both. Scripted-claude is the default deterministic path (`pnpm test:e2e`); opt-in real-LLM smoke path (`pnpm test:e2e:real`) exists for manual pre-cutover verification against real API behavior.
4. **Telegram transport:** long-polling (§9). DEVROOM owns the bot update handler, separate from the MCP plugin.
5. **Deprecated columns:** dropped at cutover (same migration), no carry-forward.
6. **Broken-main handling:** battlefield enters `ACTIVE` with `mainIsRed: true`; combat missions blocked until Commander greens the build via a normal combat mission (or explicitly overrides the guard). Bootstrap no longer auto-creates its own follow-on mission.
7. **Watchdog liveness:** L6 watchdog sweeps stale transient states via pid-map + DB scan. Process-level liveness delegated to launchd (no redundant DB heartbeat).
