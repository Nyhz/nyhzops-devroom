# SPEC.md — DEVROOM Operational Specifications

**NYHZ OPS — DEVROOM**

This document specifies every feature, screen, and workflow. Use alongside `CLAUDE.md` for tech stack, structure, coding rules, and domain model.

Detailed specifications are split into topic files under `.devroom/`. Reference these when working on related areas:

| File | Contents |
|------|----------|
| `.devroom/spec-battlefields.md` | Battlefield creation, bootstrap process, review flow, overview page, configuration, screenshots |
| `.devroom/spec-missions.md` | Mission lifecycle, execution flow, session reuse, debriefs, assets, dossiers |
| `.devroom/spec-campaigns.md` | Campaign creation, phase execution, templates, campaign detail page |
| `.devroom/spec-operations.md` | Git dashboard, console & dev server, scheduled tasks |
| `.devroom/spec-prompts.md` | All prompt templates: standard, campaign, conflict resolution, phase debrief, bootstrap |
| `.devroom/spec-captain-and-comms.md` | Captain AI decision layer, notifications & Telegram, logistics, War Room boot sequence |

---

## 1. System Boot & Server

See `.devroom/server-and-sockets.md` for full startup sequence, graceful shutdown, and custom server details.

**Summary**: Load config → open SQLite (WAL mode) → run Drizzle migrations → seed default assets → prepare Next.js → attach Socket.IO → create Orchestrator + DevServerManager → pause stale campaigns → auto-start dev servers → start Scheduler → start Telegram bot → detect LAN IP → register shutdown handler.

LAN access: binds `0.0.0.0`. Footer: `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`. No auth.

---

## 2. Layout Shell

Every page shares the same shell.

### Intel Bar (top)

Full-width bar: `INTEL //` prefix + rotating military quote (60s interval, fade transition). Client Component.

### Sidebar (left)

Fixed-width left sidebar:

**Identity block** (top): Brand initial `N` in colored circle. `NYHZ OPS` label + green operational dot. `DEVROOM` subtitle.

**Battlefield selector**: Dropdown showing current battlefield name. Selecting navigates to `/battlefields/[id]`.

**Global navigation** (top, above battlefield selector):
- `◉ HQ` — Main dashboard overview.
- `◇ GENERAL` — Standalone Claude Code chat sessions.

**Global navigation** (bottom):
- `⚓ CAPTAIN'S LOG` — AI decision log viewer.
- `◎ ASSETS` — Agent profiles and specialties.
- `◈ LOGISTICS` — Token usage & rate limits.

**Battlefield section navigation** (when a battlefield is selected):
- `■ MISSIONS` — with count badge.
- `✕ CAMPAIGNS`
- `⊞ INTEL BOARD`
- `◆ GIT`
- `▶ CONSOLE`
- `⏱ SCHEDULE`
- `⚙ CONFIG`

Active section: `bg-dr-elevated`, amber text.

**Intel Briefing** (bottom): Collapsible. System status: `● All systems operational`. Active agent count: `3/5 assets deployed`.

### Status Footer (bottom)

Full-width: `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`. Green dot, dim monospace.

---

## 3. Battlefields

See `.devroom/spec-battlefields.md` for full details on creation, bootstrap process, review flow, overview page, configuration, and screenshot support.

**Lifecycle**: `INITIALIZING → ACTIVE → ARCHIVED`

---

## 4. Missions, Assets & Dossiers

See `.devroom/spec-missions.md` for full details on mission lifecycle, execution flow, session reuse, debriefs, asset management, and dossier templates.

**Mission lifecycle**: `STANDBY → QUEUED → DEPLOYING → IN COMBAT → REVIEWING → ACCOMPLISHED / COMPROMISED / ABANDONED`

---

## 5. Campaigns

See `.devroom/spec-campaigns.md` for full details on campaign creation, phase execution, templates, and the campaign detail page.

**Campaign lifecycle**: `DRAFT → PLANNING → ACTIVE → ACCOMPLISHED / COMPROMISED / ABANDONED`

**Phase lifecycle**: `STANDBY → ACTIVE → SECURED / COMPROMISED`

---

## 6. Intel Board

Kanban-style planning board per battlefield at `/battlefields/[id]/board`. Intel notes flow through columns that mirror the mission lifecycle: `backlog → planned → deploying → in_combat → reviewing → accomplished → compromised`.

- **Create** standalone notes with title and description.
- **Drag** notes between `backlog` and `planned` columns for manual triage.
- **Promote** a single note to a mission, or multi-select notes to create a campaign.
- **Link** notes to existing missions/campaigns — status columns update in real-time.
- **Data**: `intelNotes` table — see `.devroom/database-schema.md`.

---

## 7. Operations — Git, Console & Scheduler

See `.devroom/spec-operations.md` for full details on the Git dashboard, console & dev server, and scheduled tasks.

---

## 8. Git Worktree Management

See `.devroom/git-and-workflows.md` for branch naming, merge flow, worktree modes, and cleanup rules.

**Worktree modes**: `none` (repo root), `phase` (one per phase), `mission` (one per mission).

**Lifecycle**: `Create branch → Create worktree → Execute → Merge → Delete worktree → Delete branch`

---

## 9. Real-Time (Socket.IO)

See `.devroom/server-and-sockets.md` for full Socket.IO room/event reference and client hook patterns.

Auto-reconnect via Socket.IO. On reconnect: re-join rooms, backfill missed logs via Server Action.

---

## 10. Queue & Concurrency

### Orchestrator Loop

Polls every 2s. If `activeJobs.size < config.maxAgents`, dequeues missions by priority (critical → high → normal → low), then by `createdAt`.

### Rate Limit Handling

Rate-limit exit → `queued` (not compromised) → exponential backoff (1m, 2m, 4m, 8m, 16m) → after 5 retries → `compromised`.

---

## 11. Prompt Architecture

See `.devroom/spec-prompts.md` for all prompt templates: standard mission, campaign mission, conflict resolution, phase debrief generation, and bootstrap.

---

## 12. Persistence

See `.devroom/database-schema.md` for all table definitions.

SQLite with WAL mode, foreign keys, 5s busy timeout. Single file. Schema in `lib/db/schema.ts`. Migrations via `npx drizzle-kit generate`, applied on startup.

`DEVROOM_LOG_RETENTION_DAYS` (default 30) is configured but log cleanup is not yet implemented.

---

## 13. Error Handling

- **Process crashes**: capture partial output → `compromised` → error in debrief. Campaign mission → pause campaign.
- **Git errors**: simple-git throw → log → `compromised` → git error in debrief → `[RETRY MERGE]` in UI.
- **Error UI**: `error.tsx` boundaries — red alert banner, military quote, `[RETRY]`, collapsible `<details>` with trace.

---

## 14. Captain, Notifications, Logistics & War Room

See `.devroom/spec-captain-and-comms.md` for full details on the Captain AI decision layer, notification levels & Telegram integration, logistics dashboard, and War Room boot sequence.

---

## 15. Future Ops (Backlog)

- [ ] Auto-import skills from curated registry.
- [ ] Cost dashboard with token graphs over time (basic cost tracking exists in Logistics).
- [ ] Mobile-optimized UI pass.
- [x] Push notifications on completion (implemented via Telegram integration).
- [ ] Mission dependencies (DAG within phases — `dependsOn` field exists but no UI).
- [ ] Multi-repo campaigns.
- [ ] Audit log.
- [ ] Log retention cleanup (config exists, logic not yet wired).
- [ ] Export/import state.
- [ ] Voice debriefs (TTS).
- [x] Dossier library (saved briefing templates — fully implemented).
- [x] Captain AI decision layer (autonomous judgment, escalation, debrief review).
- [x] War Room boot sequence animation.
- [x] Logistics / token usage dashboard.
- [x] Intel Board (kanban planning board per battlefield — fully implemented).
- [ ] Image paste in briefing textarea (Cmd+V, base64 — component exists but not fully wired).
