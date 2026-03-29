# DEVROOM — Agent Orchestrator

**NYHZ OPS — DEVROOM**

## Mission Brief

DEVROOM is an agent orchestrator that spawns and coordinates Claude Code processes to execute tasks autonomously. It runs on a Mac Mini as a local-network service, accessible from any device on the LAN.

The interface follows a tactical operations center aesthetic. Dark backgrounds, monospace typography, green and amber accent lighting, sharp angular components. Every screen should feel like a military command console — functional, information-dense, and zero-decoration. The user is addressed as **Commander** in all system reports, debriefs, and notifications.

---

## Tech Stack

| Layer        | Technology                                                       |
|--------------|------------------------------------------------------------------|
| Runtime      | Node.js 20+                                                     |
| Framework    | Next.js 16.2 (App Router)                                       |
| Language     | TypeScript (strict mode)                                         |
| Styling      | Tailwind CSS 4.x + custom tactical theme                        |
| Primitives   | shadcn/ui (cherry-picked, restyled with tactical theme)          |
| Database     | SQLite via better-sqlite3 (synchronous, zero config)             |
| ORM          | Drizzle ORM (type-safe, SQLite-native)                           |
| Real-time    | Socket.IO (auto-reconnection, room-based channels)               |
| Agent Runtime| Claude Code CLI (`claude`) via `child_process.spawn`             |
| Git          | simple-git (worktree management, merging)                        |
| IDs          | ULID (lexicographically sortable, timestamp-embedded)            |
| Auth         | None (LAN-only, trusted network)                                 |

### Why This Stack

- **Next.js App Router**: Server Components for fast initial loads, Server Actions for mutations, Route Handlers for orchestrator internals. Single project, single deploy.
- **better-sqlite3**: Synchronous API, WAL mode for concurrent reads. A single file — backup means copying one file.
- **Drizzle ORM**: Type-safe queries with zero overhead. Schema in TypeScript, migrations auto-generated.
- **Socket.IO**: Graceful reconnection when switching between LAN devices. Room-based channels map to per-mission log streams.
- **simple-git**: Promise-based git wrapper with built-in worktree support and proper error handling.

---

## Domain Model

### Terminology

| Concept       | Codename          | Description                                                    |
|---------------|-------------------|----------------------------------------------------------------|
| Project       | **Battlefield**   | A git repository. All operations happen within a battlefield.  |
| Setup         | **Bootstrap**     | Initial recon: generates CLAUDE.md + SPEC.md for a new battlefield. |
| Task          | **Mission**       | A single unit of work. One Claude Code process.                |
| Task Group    | **Campaign**      | Multi-phase operation. Phases execute sequentially.            |
| Phase         | **Phase**         | A step in a campaign. Its missions run in parallel.            |
| Sub-agent     | **Asset**         | A Claude Code agent profile with a specialty and system prompt.|
| Result        | **Debrief**       | Post-mission summary report, addressed to the Commander.       |
| Logs          | **Comms**         | Real-time output stream from a running mission.                |
| Dashboard     | **HQ**            | The main overview screen.                                      |
| Template      | **Dossier**       | Reusable mission briefing template with variable placeholders. |
| AI Layer      | **Captain**       | Autonomous decision engine — judges, escalates, reviews.       |
| Alert         | **Notification**  | In-app + Telegram alert for events and escalations.            |
| Startup       | **War Room**      | Boot sequence animation shown on first visit.                  |
| Planning Chat | **Briefing**      | Interactive campaign planning chat with GENERAL asset.         |
| Cost Tracking | **Logistics**     | Token usage, rate limits, and cost tracking dashboard.         |

### Status Terms

| Status         | Color   | Meaning                                      |
|----------------|---------|----------------------------------------------|
| `INITIALIZING` | blue    | Battlefield bootstrapping — generating docs. |
| `STANDBY`      | dim     | Created, not yet queued.                     |
| `QUEUED`       | muted   | Waiting for an available agent slot.         |
| `DEPLOYING`    | amber   | Setting up worktree / preparing process.     |
| `IN COMBAT`    | amber   | Claude Code process actively running.        |
| `REVIEWING`    | blue    | Captain AI reviewing debrief quality.        |
| `ACCOMPLISHED` | green   | Completed successfully.                      |
| `COMPROMISED`  | red     | Failed or errored.                           |
| `ABANDONED`    | dim     | Cancelled by Commander or interrupted.       |
| `SECURED`      | green   | Phase completed (all missions accomplished). |

---

## Coding Rules

### Non-Negotiable

1. **TypeScript strict mode.** No `any` unless unavoidable (with comment).
2. **App Router only.** Server Components by default. `"use client"` only for interactivity.
3. **Server Actions for mutations.** Route Handlers only for orchestrator-internal endpoints.
4. **Tailwind only.** No inline styles, no CSS modules. All tokens in `globals.css` via `@theme` blocks (Tailwind v4).
5. **Drizzle for DB.** No raw SQL. Never modify existing migrations.
6. **Synchronous DB.** better-sqlite3 is sync — use it directly.
7. **AbortController on all long ops.** Claude Code processes, git operations — everything cancellable.

### TypeScript

- `interface` for object shapes, `type` for unions/utilities.
- Types exported from `@/types`. Path alias `@/*` → `./src/*`.
- `const` assertions for enum-like values.
- Errors wrapped: `throw new Error(\`Deploy mission ${id}: ${err.message}\`)`.
- Named exports preferred (except page/layout components).

### Next.js Patterns

- **Server Components**: data display — lists, details, stats. Query Drizzle directly.
- **Client Components**: Socket.IO subscriptions, forms, real-time terminals.
- **Server Actions** (in `src/actions/`): all CRUD mutations. Call `revalidatePath()` after writes.
- **Route Handlers** (`app/api/`): scaffold process streaming and rate-limit checks only. Mission execute/abort and campaign launch are Server Actions.
- **`loading.tsx`**: skeleton screens — pulsing dark green bars.
- **`error.tsx`**: styled error with military quote, retry button, collapsible details.

### Component Rules

- Functional components with hooks.
- Socket.IO subscribers are Client Components wrapped by Server Component parents that pass initial data.
- All UI components accept `className` prop.
- Use `cn()` (clsx + tailwind-merge) for conditional classes.

---

## Extended Documentation

Detailed docs are split into topic files under `.devroom/`. Reference these when working on related areas:

| File | Contents |
|------|----------|
| `.devroom/project-structure.md` | Full project file tree and directory layout |
| `.devroom/database-schema.md` | All Drizzle table definitions (Battlefield, Mission, Campaign, Phase, Asset, IntelNote, etc.) |
| `.devroom/ui-theme.md` | Branding, Tailwind theme tokens, layout structure, UI patterns, Commander reporting tone |
| `.devroom/server-and-sockets.md` | Custom server boot, Socket.IO rooms/events, Claude Code invocation, prompt cache optimization |
| `.devroom/git-and-workflows.md` | Git/worktree rules, Definition of Done, scripts, environment variables |
| `.devroom/spec-battlefields.md` | Battlefield creation, bootstrap, review flow, overview page, configuration |
| `.devroom/spec-missions.md` | Mission lifecycle, execution, session reuse, assets, dossiers |
| `.devroom/spec-campaigns.md` | Campaign creation, phase execution, templates, detail page |
| `.devroom/spec-operations.md` | Git dashboard, console & dev server, scheduled tasks |
| `.devroom/spec-prompts.md` | All prompt templates (standard, campaign, conflict, debrief, bootstrap) |
| `.devroom/spec-captain-and-comms.md` | Captain AI, notifications, Telegram, logistics, War Room |
| `.devroom/accessibility-audit.md` | Contrast and size violation audit — theme tokens, per-file violations, recommended fixes |

---

## Quick Reference

```
Battlefield  = Project / git repo
Bootstrap    = Initial setup — generates CLAUDE.md + SPEC.md for a new battlefield
Campaign     = Multi-phase operation
Phase        = Campaign step (parallel missions)
Mission      = Single task (one Claude Code process)
Asset        = Agent profile (specialty + system prompt)
Dossier      = Reusable mission briefing template
Briefing     = Interactive campaign planning chat with GENERAL
Captain      = AI decision layer (autonomous judgment + escalation)
Debrief      = Post-mission report to Commander
Comms        = Real-time log stream
HQ           = Main dashboard
War Room     = Boot sequence animation
Logistics    = Token usage + cost tracking
Notification = In-app + Telegram alert
```

**Battlefields:** `INITIALIZING → ACTIVE → ARCHIVED`

**Missions:** `STANDBY → QUEUED → DEPLOYING → IN COMBAT → REVIEWING → ACCOMPLISHED / COMPROMISED / ABANDONED`

**Phases:** `STANDBY → ACTIVE → SECURED / COMPROMISED`

**Campaigns:** `DRAFT → PLANNING → ACTIVE → ACCOMPLISHED / COMPROMISED / ABANDONED`
