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

## Project Structure

```
devroom/
├── CLAUDE.md
├── SPEC.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                    # shadcn/ui configuration
├── .env.local
├── server.ts                          # Custom server (Next.js + Socket.IO)
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout — tactical shell
│   │   ├── loading.tsx                # Root loading skeleton
│   │   ├── error.tsx                  # Global error boundary
│   │   ├── warroom/
│   │   │   └── page.tsx               # Boot sequence animation (first-visit gate)
│   │   ├── overwatch/
│   │   │   └── page.tsx               # System metrics dashboard (agents, tokens, uptime)
│   │   ├── (hq)/                      # Route group — HQ layout shell
│   │   │   ├── layout.tsx             # HQ layout (sidebar + intel bar + footer)
│   │   │   ├── page.tsx               # HQ Dashboard — global overview
│   │   │   ├── captain-log/
│   │   │   │   └── page.tsx           # Captain AI decision log viewer
│   │   │   ├── logistics/
│   │   │   │   └── page.tsx           # Token usage & rate limit dashboard
│   │   │   └── battlefields/
│   │   │       ├── page.tsx           # Battlefield selector
│   │   │       ├── new/
│   │   │       │   └── page.tsx       # Create new battlefield
│   │   │       └── [id]/
│   │   │           ├── layout.tsx     # Battlefield layout (sidebar nav)
│   │   │           ├── loading.tsx    # Battlefield loading skeleton
│   │   │           ├── page.tsx       # Battlefield overview — missions tab
│   │   │           ├── missions/
│   │   │           │   └── [missionId]/
│   │   │           │       └── page.tsx   # Mission detail + live comms
│   │   │           ├── campaigns/
│   │   │           │   ├── page.tsx       # Campaigns list
│   │   │           │   ├── loading.tsx
│   │   │           │   ├── new/
│   │   │           │   │   └── page.tsx   # Create new campaign
│   │   │           │   └── [campaignId]/
│   │   │           │       ├── page.tsx   # Campaign detail + phase view
│   │   │           │       └── loading.tsx
│   │   │           ├── assets/
│   │   │           │   ├── page.tsx       # Asset management
│   │   │           │   └── loading.tsx
│   │   │           ├── git/
│   │   │           │   ├── page.tsx       # Git dashboard
│   │   │           │   └── loading.tsx
│   │   │           ├── console/
│   │   │           │   ├── page.tsx       # Quick commands + dev server
│   │   │           │   └── loading.tsx
│   │   │           ├── schedule/
│   │   │           │   ├── page.tsx       # Scheduled tasks
│   │   │           │   └── loading.tsx
│   │   │           └── config/
│   │   │               ├── page.tsx       # Battlefield configuration
│   │   │               └── loading.tsx
│   │   └── api/
│   │       ├── battlefields/
│   │       │   └── [id]/
│   │       │       └── scaffold/
│   │       │           ├── route.ts       # Start battlefield scaffold process
│   │       │           └── logs/
│   │       │               └── route.ts   # Stream scaffold logs (SSE)
│   │       └── logistics/
│   │           └── rate-limit/
│   │               └── route.ts           # Check Claude API rate limit status
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts              # DB connection singleton
│   │   │   ├── schema.ts             # Drizzle schema (13 tables)
│   │   │   └── migrations/
│   │   ├── orchestrator/
│   │   │   ├── orchestrator.ts       # Core engine — queue loop, concurrency
│   │   │   ├── executor.ts           # Claude Code spawn + stream management
│   │   │   ├── campaign-executor.ts  # Multi-phase campaign orchestration
│   │   │   ├── plan-generator.ts     # AI battle plan generation from objective
│   │   │   ├── stream-parser.ts      # Parse Claude Code stream-json output
│   │   │   ├── worktree.ts           # Git worktree lifecycle
│   │   │   ├── merger.ts             # Branch merge + conflict resolution
│   │   │   └── prompt-builder.ts     # Prompt assembly + cache optimization
│   │   ├── captain/
│   │   │   ├── captain.ts            # AI decision layer — autonomous judgment calls
│   │   │   ├── captain-db.ts         # Captain decision persistence
│   │   │   ├── debrief-reviewer.ts   # Mission result review + quality assessment
│   │   │   ├── escalation.ts         # Telegram escalation for critical decisions
│   │   │   └── phase-failure-handler.ts  # Phase failure recovery logic
│   │   ├── process/
│   │   │   ├── dev-server.ts         # Dev server lifecycle (start/stop/restart, port tracking)
│   │   │   └── command-runner.ts     # Quick command execution + streaming output
│   │   ├── scheduler/
│   │   │   ├── scheduler.ts          # Cron engine — evaluate schedules, trigger missions/campaigns
│   │   │   └── cron.ts               # Cron expression parsing + next-run calculation
│   │   ├── socket/
│   │   │   └── server.ts             # Socket.IO setup + room management
│   │   ├── telegram/
│   │   │   └── telegram.ts           # Telegram bot polling + notification delivery
│   │   ├── config.ts
│   │   └── utils.ts                  # ULID generation, time formatting, etc.
│   ├── actions/
│   │   ├── battlefield.ts            # Server Actions for battlefield CRUD + scaffold
│   │   ├── mission.ts                # Server Actions for mission CRUD + deploy + abort
│   │   ├── campaign.ts               # Server Actions for campaign CRUD + plan + launch
│   │   ├── asset.ts                  # Server Actions for asset CRUD
│   │   ├── captain.ts                # Server Actions for captain log queries
│   │   ├── console.ts                # Server Actions for quick commands + dev server
│   │   ├── dossier.ts                # Server Actions for briefing template CRUD
│   │   ├── git.ts                    # Server Actions for git operations
│   │   ├── logistics.ts              # Server Actions for token usage + cost tracking
│   │   ├── notification.ts           # Server Actions for notification CRUD + read status
│   │   └── schedule.ts               # Server Actions for scheduled task CRUD
│   ├── components/
│   │   ├── layout/
│   │   │   ├── app-shell.tsx         # Top intel bar + sidebar + content area
│   │   │   ├── sidebar.tsx           # Left nav — branding + battlefield selector
│   │   │   ├── sidebar-nav.tsx       # Section navigation links (missions, campaigns, etc.)
│   │   │   ├── global-nav.tsx        # Top-level nav (HQ, Captain Log, Logistics, Overwatch)
│   │   │   ├── battlefield-selector.tsx # Battlefield dropdown selector
│   │   │   ├── intel-bar.tsx         # Top bar — rotating military quotes
│   │   │   ├── page-wrapper.tsx      # Consistent page padding + title wrapper
│   │   │   └── status-footer.tsx     # Bottom bar — system status + LAN warning
│   │   ├── dashboard/
│   │   │   ├── deploy-mission.tsx    # Quick deploy form (textarea + asset picker)
│   │   │   ├── dossier-selector.tsx  # Dossier template picker for deploy form
│   │   │   ├── stats-bar.tsx         # IN COMBAT | ACCOMPLISHED | COMPROMISED | STANDBY
│   │   │   ├── mission-list.tsx      # Searchable mission table
│   │   │   └── activity-feed.tsx     # Real-time ops log
│   │   ├── battlefield/
│   │   │   ├── create-battlefield.tsx # Create form with initial briefing textarea
│   │   │   ├── bootstrap-review.tsx  # Review generated CLAUDE.md + SPEC.md before commit
│   │   │   ├── bootstrap-comms.tsx   # Live log stream during bootstrap generation
│   │   │   ├── bootstrap-error.tsx   # Bootstrap failure display + retry
│   │   │   ├── scaffold-output.tsx   # Scaffold command output viewer
│   │   │   └── scaffold-retry.tsx    # Scaffold failure retry UI
│   │   ├── mission/
│   │   │   ├── mission-comms.tsx     # Live terminal log stream
│   │   │   └── mission-actions.tsx   # Continue / Redeploy / Abandon buttons
│   │   ├── campaign/
│   │   │   ├── campaign-controls.tsx # MISSION ACCOMPLISHED | REDEPLOY | ABANDON
│   │   │   ├── campaign-live-view.tsx # Real-time campaign progress viewer
│   │   │   ├── generate-plan-button.tsx # AI battle plan generation trigger
│   │   │   ├── mission-card.tsx      # Campaign-specific mission card
│   │   │   ├── phase-timeline.tsx    # Phase container with nested mission cards
│   │   │   └── plan-editor.tsx       # Editable plan viewer (reorder phases/missions)
│   │   ├── asset/
│   │   │   ├── asset-list.tsx        # Right sidebar asset panel
│   │   │   └── asset-form.tsx        # Create/edit asset form
│   │   ├── git/
│   │   │   ├── git-status.tsx        # Working tree status (modified, staged, untracked)
│   │   │   ├── git-log.tsx           # Commit history with branch graph
│   │   │   ├── git-branches.tsx      # Branch list + checkout
│   │   │   └── git-diff.tsx          # File diff viewer
│   │   ├── console/
│   │   │   ├── dev-server-panel.tsx  # Start/stop/restart + port + log stream
│   │   │   ├── quick-commands.tsx    # Predefined command buttons + custom input
│   │   │   └── command-output.tsx    # Streaming command output terminal
│   │   ├── config/
│   │   │   └── config-form.tsx       # Battlefield configuration form
│   │   ├── schedule/
│   │   │   ├── schedule-list.tsx     # List of scheduled tasks
│   │   │   └── schedule-form.tsx     # Create/edit scheduled task
│   │   ├── overwatch/
│   │   │   └── overwatch.tsx         # System metrics display component
│   │   ├── warroom/
│   │   │   ├── boot-gate.tsx         # First-visit boot animation gate
│   │   │   └── boot-sequence.tsx     # Tactical boot animation sequence
│   │   ├── providers/
│   │   │   ├── socket-provider.tsx   # Socket.IO context provider
│   │   │   └── toast-provider.tsx    # Toast notification provider (sonner)
│   │   └── ui/
│   │       ├── terminal.tsx          # Reusable monospace log viewer
│   │       ├── tac-button.tsx        # Tactical button variants
│   │       ├── tac-input.tsx         # Tactical input
│   │       ├── tac-textarea-with-images.tsx  # Textarea with image paste (Cmd+V, base64)
│   │       ├── tac-card.tsx          # Dark card with optional status border
│   │       ├── tac-badge.tsx         # Status badge (● ACCOMPLISHED, etc.)
│   │       ├── tac-select.tsx        # Styled dropdown
│   │       ├── search-input.tsx      # Search with monospace placeholder
│   │       ├── markdown.tsx          # Markdown renderer (react-markdown + remark-gfm)
│   │       ├── modal.tsx
│   │       ├── button.tsx            # shadcn button (restyled)
│   │       ├── dialog.tsx            # shadcn dialog
│   │       ├── dropdown-menu.tsx     # shadcn dropdown menu
│   │       ├── popover.tsx           # shadcn popover
│   │       ├── scroll-area.tsx       # shadcn scroll area
│   │       ├── select.tsx            # shadcn select
│   │       ├── tabs.tsx              # shadcn tabs
│   │       └── tooltip.tsx           # shadcn tooltip
│   ├── hooks/
│   │   ├── use-socket.ts             # Socket.IO connection hook
│   │   ├── use-mission-comms.ts      # Mission log stream subscription
│   │   ├── use-campaign-comms.ts     # Campaign progress stream subscription
│   │   ├── use-activity-feed.ts      # HQ activity feed subscription
│   │   ├── use-notifications.ts      # Notification stream subscription
│   │   ├── use-dev-server.ts         # Dev server status + log stream
│   │   └── use-command-output.ts     # Streaming command output
│   └── types/
│       └── index.ts
├── public/
│   ├── sounds/
│   └── img/
└── scripts/
    └── seed.ts                       # Seed default assets
```

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
| Monitoring    | **OVERWATCH**     | System metrics dashboard (agents, tokens, uptime).             |
| Startup       | **War Room**      | Boot sequence animation shown on first visit.                  |
| Cost Tracking | **Logistics**     | Token usage, rate limits, and cost tracking dashboard.         |

### Status Terms

| Status         | Color   | Meaning                                      |
|----------------|---------|----------------------------------------------|
| `INITIALIZING` | blue    | Battlefield bootstrapping — generating docs. |
| `STANDBY`      | dim     | Created, not yet queued.                     |
| `QUEUED`       | muted   | Waiting for an available agent slot.         |
| `DEPLOYING`    | amber   | Setting up worktree / preparing process.     |
| `IN COMBAT`    | amber   | Claude Code process actively running.        |
| `ACCOMPLISHED` | green   | Completed successfully.                      |
| `COMPROMISED`  | red     | Failed or errored.                           |
| `ABANDONED`    | dim     | Cancelled by Commander or interrupted.       |
| `SECURED`      | green   | Phase completed (all missions accomplished). |

### Battlefield

```
- id                TEXT PRIMARY KEY (ULID)
- name              TEXT NOT NULL
- codename          TEXT NOT NULL            -- e.g. "OPERATION THUNDER"
- description       TEXT
- initialBriefing   TEXT                     -- Commander's project briefing for bootstrap
- repoPath          TEXT NOT NULL            -- absolute path to git repo (auto-generated or linked)
- defaultBranch     TEXT DEFAULT 'main'
- claudeMdPath      TEXT                     -- path to project CLAUDE.md (auto-set after bootstrap)
- specMdPath        TEXT                     -- path to project SPEC.md (auto-set after bootstrap)
- scaffoldCommand   TEXT                     -- command used to scaffold (for reference)
- scaffoldStatus    TEXT                     -- null | 'running' | 'complete' | 'failed'
- devServerCommand  TEXT DEFAULT 'npm run dev' -- command to start dev server
- autoStartDevServer INTEGER DEFAULT 0       -- boolean
- status            TEXT DEFAULT 'initializing' -- initializing | active | archived
- bootstrapMissionId TEXT                    -- references the bootstrap mission
- createdAt         INTEGER NOT NULL         -- unix ms
- updatedAt         INTEGER NOT NULL
```

### Mission

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- campaignId      TEXT REFERENCES campaigns(id)
- phaseId         TEXT REFERENCES phases(id)
- type            TEXT DEFAULT 'standard'  -- standard | bootstrap | conflict_resolution | phase_debrief
- title           TEXT NOT NULL
- briefing        TEXT NOT NULL            -- markdown, may contain base64 images
- status          TEXT DEFAULT 'standby'   -- standby|queued|deploying|in_combat|accomplished|compromised|abandoned
- priority        TEXT DEFAULT 'normal'    -- low|normal|high|critical
- assetId         TEXT REFERENCES assets(id)
- useWorktree     INTEGER DEFAULT 0
- worktreeBranch  TEXT
- dependsOn       TEXT                     -- mission ID this depends on (intra-phase ordering)
- sessionId       TEXT                     -- Claude Code session for reuse
- debrief         TEXT
- iterations      INTEGER DEFAULT 0
- costInput       INTEGER DEFAULT 0
- costOutput      INTEGER DEFAULT 0
- costCacheHit    INTEGER DEFAULT 0
- durationMs      INTEGER DEFAULT 0
- startedAt       INTEGER
- completedAt     INTEGER
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### Campaign

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- name            TEXT NOT NULL            -- e.g. "Operation Clean Sweep"
- objective       TEXT NOT NULL
- status          TEXT DEFAULT 'draft'     -- draft|planning|active|paused|accomplished|compromised
- worktreeMode    TEXT DEFAULT 'phase'     -- none|phase|mission
- currentPhase    INTEGER DEFAULT 0
- isTemplate      INTEGER DEFAULT 0
- templateId      TEXT
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### Phase

```
- id              TEXT PRIMARY KEY (ULID)
- campaignId      TEXT NOT NULL REFERENCES campaigns(id)
- phaseNumber     INTEGER NOT NULL
- name            TEXT NOT NULL            -- e.g. "Recon", "Strike", "Extraction"
- objective       TEXT
- status          TEXT DEFAULT 'standby'   -- standby|active|secured|compromised
- debrief         TEXT
- totalTokens     INTEGER DEFAULT 0
- durationMs      INTEGER DEFAULT 0
- createdAt       INTEGER NOT NULL
```

### Asset

```
- id              TEXT PRIMARY KEY (ULID)
- codename        TEXT NOT NULL UNIQUE     -- e.g. "ARCHITECT", "ASSERT"
- specialty       TEXT NOT NULL
- systemPrompt    TEXT
- model           TEXT DEFAULT 'claude-sonnet-4-6'
- status          TEXT DEFAULT 'active'    -- active | offline
- missionsCompleted INTEGER DEFAULT 0
- createdAt       INTEGER NOT NULL
```

### MissionLog

```
- id              TEXT PRIMARY KEY (ULID)
- missionId       TEXT NOT NULL REFERENCES missions(id)
- timestamp       INTEGER NOT NULL
- type            TEXT NOT NULL             -- log | status | error
- content         TEXT NOT NULL
```

### ScheduledTask

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- name            TEXT NOT NULL             -- e.g. "Nightly test suite"
- type            TEXT NOT NULL             -- mission | campaign
- cron            TEXT NOT NULL             -- cron expression (e.g. "0 3 * * *")
- enabled         INTEGER DEFAULT 1        -- boolean
- missionTemplate TEXT                     -- JSON: { title, briefing, assetId, priority, useWorktree }
- campaignId      TEXT                     -- if type=campaign, which template to re-run
- lastRunAt       INTEGER                  -- unix ms
- nextRunAt       INTEGER                  -- unix ms (precomputed)
- runCount        INTEGER DEFAULT 0
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### CommandLog

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- command         TEXT NOT NULL             -- the command that was executed
- exitCode        INTEGER
- durationMs      INTEGER DEFAULT 0
- output          TEXT                     -- captured stdout+stderr (truncated if large)
- createdAt       INTEGER NOT NULL
```

### Dossier

Reusable mission briefing templates with variable interpolation.

```
- id              TEXT PRIMARY KEY (ULID)
- codename        TEXT NOT NULL UNIQUE     -- e.g. "CODE_REVIEW", "SECURITY_AUDIT"
- name            TEXT NOT NULL
- description     TEXT
- briefingTemplate TEXT NOT NULL           -- markdown with {{variable}} placeholders
- variables       TEXT                     -- JSON array of DossierVariable objects
- assetCodename   TEXT                     -- recommended asset for this dossier
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

`DossierVariable` shape: `{ key, label, description, placeholder }`.

### CaptainLog

Records AI-made autonomous decisions during mission/campaign execution.

```
- id              TEXT PRIMARY KEY (ULID)
- missionId       TEXT NOT NULL REFERENCES missions(id)
- campaignId      TEXT REFERENCES campaigns(id)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- question        TEXT NOT NULL             -- the decision the Captain faced
- answer          TEXT NOT NULL             -- the decision made
- reasoning       TEXT NOT NULL             -- why this decision was chosen
- confidence      TEXT NOT NULL             -- 'high' | 'medium' | 'low'
- escalated       INTEGER DEFAULT 0        -- whether it was escalated to Commander
- timestamp       INTEGER NOT NULL
```

### Notification

In-app and Telegram alerts for mission events, failures, and escalations.

```
- id              TEXT PRIMARY KEY (ULID)
- level           TEXT NOT NULL             -- 'info' | 'warning' | 'critical'
- title           TEXT NOT NULL
- detail          TEXT NOT NULL
- entityType      TEXT                     -- 'mission' | 'campaign' | 'phase'
- entityId        TEXT
- battlefieldId   TEXT
- read            INTEGER DEFAULT 0
- telegramSent    INTEGER DEFAULT 0
- telegramMsgId   INTEGER
- createdAt       INTEGER NOT NULL
```

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

### Git / Worktree

- Branch naming: `devroom/{codename-lower}/{mission-id-short}`.
- Phase branches: `devroom/{codename-lower}/phase-{number}-{slug}`.
- Post-completion: merge → cleanup worktree dir → delete branch.
- Conflicts: spawn dedicated Claude Code process with resolution prompt.
- Never force-push. Merge failure → `compromised` with details.

### Claude Code Invocation

```typescript
const proc = spawn(config.claudePath, [
  '--dangerously-skip-permissions',
  '--output-format', 'stream-json',
  '--max-turns', '50',
  ...(sessionId ? ['--session-id', sessionId] : []),
  '--prompt', fullPrompt,
], {
  cwd: workingDirectory,
  signal: abortController.signal,
});
```

Stream `proc.stdout` line by line. Parse JSON, emit via Socket.IO, store in `missionLogs`.

### Prompt Cache Optimization

Prompt structure — static at top, dynamic at bottom:

1. **TOP (static, cached)**: Battlefield CLAUDE.md content.
2. **MIDDLE (semi-static)**: Asset system prompt.
3. **MIDDLE (semi-dynamic)**: Previous phase debrief (campaign missions only).
4. **BOTTOM (dynamic)**: Mission briefing.

Target 90%+ cache hit rate.

### Socket.IO

- Attached to custom `server.ts`.
- Rooms: `mission:{id}` per mission, `campaign:{id}` per campaign, `hq:activity` for global, `devserver:{battlefieldId}` for dev server logs, `console:{battlefieldId}` for command output.
- Server → Client: `mission:log`, `mission:status`, `mission:debrief`, `mission:tokens`, `campaign:status`, `campaign:phase`, `activity:event`, `devserver:log`, `devserver:status`, `console:output`, `notification`.
- Client → Server: `mission:subscribe`, `mission:unsubscribe`, `campaign:subscribe`, `campaign:unsubscribe`, `hq:subscribe`, `devserver:subscribe`, `console:subscribe`.

---

## Custom Server

The `server.ts` entry point boots the full system. Startup sequence:

1. Initialize database (SQLite + WAL mode + Drizzle migrations).
2. Seed default assets if table is empty.
3. Prepare Next.js app.
4. Create HTTP server, attach Socket.IO at `/socket.io`.
5. Start Orchestrator (queue poll loop).
6. Start DevServerManager (per-battlefield dev server lifecycle).
7. Pause any campaigns left `active` from previous run.
8. Auto-start dev servers for flagged battlefields.
9. Start Scheduler (cron engine + seed WORKTREE SWEEP daily task).
10. Start Telegram bot polling (if configured).
11. Detect local IP, log startup banner.
12. Register graceful shutdown handler (SIGINT/SIGTERM → abort missions → close DB → exit).

```typescript
// Simplified server.ts structure
const app = next({ dev: process.env.NODE_ENV !== 'production' });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new SocketIOServer(httpServer, { path: '/socket.io' });
  global.io = io;

  const orchestrator = new Orchestrator(io);
  const devServerManager = new DevServerManager(io);
  orchestrator.start();
  // ... scheduler, telegram, auto-start, etc.

  const port = parseInt(process.env.DEVROOM_PORT || '7777');
  httpServer.listen(port, '0.0.0.0');
});
```

---

## UI / Aesthetic Direction

### Branding

The app identity is **NYHZ OPS** with **DEVROOM** as the operation codename. In the UI sidebar:

```
N   NYHZ OPS  ●
    DEVROOM
```

The `N` sits inside a colored circle (brand initial). The green dot indicates operational status.

### Reference

The UI follows the tactical operations center aesthetic from the reference screenshots. Key principles:

- **Dark background** with cool gray/slate tint (Ghost Ops V2 theme) (`#0a0a0c`).
- **Green accents** for success states and primary highlights.
- **Amber/orange accents** for labels, section headers, in-progress states.
- **Monospace everywhere** — all text.
- **Dense information layout** — stats bars, sidebars with asset lists, mission tables.
- **Sharp corners** — no border-radius on cards. Angular, military feel.
- **Top intel bar** with rotating military quotes.
- **Bottom status bar** with system status and LAN access warning.
- **Left sidebar** with battlefield selector dropdown, section navigation (MISSIONS, CAMPAIGNS, ASSETS, GIT, CONSOLE, SCHEDULE, CONFIG), counts.
- **Right sidebar** (battlefield view) with asset list and asset breakdown stats.

### Tailwind Theme

Tailwind v4 uses CSS-based configuration. There is **no `tailwind.config.ts`**. All theme tokens are defined in `src/app/globals.css` using `@theme inline` blocks:

```css
/* src/app/globals.css */
@theme inline {
  --color-dr-bg:        #0a0a0c;
  --color-dr-surface:   #111114;
  --color-dr-elevated:  #1a1a22;
  --color-dr-border:    #2a2a32;
  --color-dr-text:      #b8b8c8;
  --color-dr-muted:     #6a6a7a;
  --color-dr-dim:       #4a4a5a;
  --color-dr-green:     #00ff41;
  --color-dr-amber:     #ffbf00;
  --color-dr-red:       #ff3333;
  --color-dr-blue:      #00aaff;

  --font-tactical: 'Share Tech Mono', monospace;
  --font-mono:     'IBM Plex Mono', monospace;
  --font-data:     'Courier Prime', monospace;

  --shadow-glow-green: 0 0 10px rgba(0, 255, 65, 0.3);
  --shadow-glow-amber: 0 0 10px rgba(255, 191, 0, 0.3);
  --shadow-glow-red:   0 0 10px rgba(255, 51, 51, 0.3);

  --radius-*: 0rem;  /* No border-radius — sharp angular military feel */
}
```

Usage in components: `bg-dr-bg`, `text-dr-green`, `font-tactical`, `shadow-glow-green`, etc.

### Intel Bar

Full-width top bar: `INTEL //` prefix + rotating military quote every 60s. Monospace, dim text.

```typescript
const INTEL_QUOTES = [
  "The supreme art of war is to subdue the enemy without fighting. — Sun Tzu",
  "No plan survives first contact with the enemy. — Helmuth von Moltke",
  "In preparing for battle I have always found that plans are useless, but planning is indispensable. — Eisenhower",
  "The more you sweat in training, the less you bleed in combat. — Richard Marcinko",
  "Speed is the essence of war. — Sun Tzu",
  "Who dares wins. — SAS motto",
  "The only easy day was yesterday. — Navy SEALs",
  "Brave men rejoice in adversity, just as brave soldiers triumph in war. — Seneca",
  "Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat. — Sun Tzu",
  "Fortune favors the bold. — Virgil",
  "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt. — Sun Tzu",
  "Amateurs talk strategy. Professionals talk logistics. — Gen. Omar Bradley",
  "A good plan violently executed now is better than a perfect plan executed next week. — Patton",
  "Victory belongs to the most persevering. — Napoleon",
  "We sleep safely at night because rough men stand ready to visit violence on those who would harm us. — attributed to Orwell",
];
```

### Status Footer

Bottom bar: `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`. Green dot, dim monospace.

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  INTEL //  "The supreme art of war is to subdue the enemy..."   │
├────────┬────────────────────────────────────────┬───────────────┤
│        │                                        │               │
│  N     │  Battlefields // Project Name          │  ASSETS       │
│  NYHZ  │  PROJECT CODENAME                      │  ● ARCHITECT  │
│  OPS ● │  Description text                      │  ● ASSERT     │
│  DEV-  │                                        │  ● CANVAS     │
│  ROOM  │  ┌─ DEPLOY MISSION ──────────────┐     │  ...          │
│        │  │ [textarea] [asset] [deploy]   │     │               │
│ ─────  │  └───────────────────────────────┘     │  BREAKDOWN    │
│ PROJ ▾ │                                        │  CANVAS  83   │
│        │  0 IN COMBAT │ 251 ACCOMPLISHED │ ...  │  ARCHITECT 77 │
│ ■ MISS │                                        │  ...          │
│ ✕ CAMP │  MISSIONS          [Search...]         │               │
│ ◎ ASST │  ┌─────────────────────────────┐       │               │
│ ◆ GIT  │  │ mission title    ● ACCOMP.  │       │               │
│ ▶ CONS │  │ ASSET · 9 mins ago    VIEW  │       │               │
│ ⏱ SCHD │  ├─────────────────────────────┤       │               │
│ ⚙ CONF │  │ ...                         │       │               │
│        │  │ ASSET · 9 mins ago    VIEW  │       │               │
│ ─────  │  └─────────────────────────────┘       │               │
│ INTEL  │                                        │               │
│ BRIEF  │                                        │               │
│ ● OK   │                                        │               │
├────────┴────────────────────────────────────────┴───────────────┤
│  ● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK          │
└─────────────────────────────────────────────────────────────────┘
```

### Key UI Patterns

- **Deploy Mission**: inline on battlefield page. Textarea + asset dropdown + SAVE / SAVE & DEPLOY + Load dossier.
- **Stats bar**: `IN COMBAT | ACCOMPLISHED | COMPROMISED | STANDBY | cache hit %`.
- **Mission list**: table rows — title (+ iteration badge), asset + time, status badge, VIEW.
- **Asset panel**: right sidebar with green dots + codenames + models. ASSET BREAKDOWN below.
- **Campaign phases**: stacked containers with left border (green=secured, amber=active). Mission cards laid horizontally inside each phase.
- **Campaign controls**: `[MISSION ACCOMPLISHED]` (green) `[REDEPLOY]` `[ABANDON]` (red).

---

## Commander Reporting Tone

All system-generated text addresses the user as **Commander**:

**Mission debrief:**
```
DEBRIEF — Mission: Fix authentication bug
Status: ACCOMPLISHED | Asset: ARCHITECT
Duration: 2m 14s | Tokens: 45.2K (91% cache hit)

Commander, the authentication module has been updated. The JWT refresh
endpoint was returning 401 due to an expired signing key reference.
Changes applied:
- Replaced hardcoded key with dynamic lookup from config
- Added token rotation logic on refresh
- All 14 existing auth tests pass, 3 new tests added

No further action required. Awaiting next orders.
```

**Phase debrief:**
```
PHASE DEBRIEF — Phase 1: Recon
Status: SECURED | Duration: 1m 48s | Tokens: 683.0K

Commander, Phase 1 is complete. All reconnaissance missions accomplished.
- Code audit identified 12 areas requiring attention
- Test coverage stands at 67%, with 14 critical paths uncovered

Recommend proceeding to Phase 2: Strike. Standing by for orders.
```

**Error report:**
```
SITUATION REPORT — Mission COMPROMISED
Asset GHOST encountered resistance during deployment.
Error: git merge conflict in src/auth/handler.ts

Recommend manual review or redeployment with conflict resolution
asset. Awaiting Commander's orders.
```

---

## Definition of Done

- [ ] **Types safe** — no `any`. New interfaces exported from `@/types`.
- [ ] **Components correct** — Server/Client boundary right. `"use client"` only where needed.
- [ ] **Migration created** — `npx drizzle-kit generate`. Never edit existing migrations.
- [ ] **Server Actions** — mutations via actions, `revalidatePath()` after writes.
- [ ] **Socket events** — real-time changes emit correct events. Hooks updated.
- [ ] **Error handling** — caught, wrapped, styled military error UI.
- [ ] **Loading states** — `loading.tsx` or Suspense with skeleton UI.
- [ ] **AbortController** — long ops honor signals.
- [ ] **Worktree cleanup** — branches merged, dirs removed.
- [ ] **Tests pass** — `npm test` green. New logic covered.
- [ ] **Tailwind only** — no inline styles.
- [ ] **Domain model synced** — schema changes reflected here.

---

## Scripts

```json
{
  "dev": "tsx server.ts",
  "build": "next build",
  "start": "NODE_ENV=production tsx server.ts",
  "test": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "seed": "tsx scripts/seed.ts"
}
```

---

## Environment Variables

`.env.local` — all optional with sane defaults:

| Variable                    | Default      | Description                              |
|-----------------------------|--------------|------------------------------------------|
| `DEVROOM_PORT`              | `7777`       | HTTP server port                         |
| `DEVROOM_HOST`              | `0.0.0.0`    | Bind address                             |
| `DEVROOM_DB_PATH`           | `./devroom.db`| SQLite file path                        |
| `DEVROOM_DEV_BASE_PATH`    | `/dev`        | Base directory for new battlefields      |
| `DEVROOM_LOG_LEVEL`         | `info`       | debug, info, warn, error                 |
| `DEVROOM_MAX_AGENTS`        | `5`          | Max concurrent Claude Code processes     |
| `DEVROOM_CLAUDE_PATH`       | `claude`     | Path to Claude Code binary               |
| `DEVROOM_LOG_RETENTION_DAYS`| `30`         | Days to keep mission logs                |

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
Captain      = AI decision layer (autonomous judgment + escalation)
Debrief      = Post-mission report to Commander
Comms        = Real-time log stream
HQ           = Main dashboard
OVERWATCH    = System metrics dashboard
War Room     = Boot sequence animation
Logistics    = Token usage + cost tracking
Notification = In-app + Telegram alert
```

**Battlefields:** `INITIALIZING → ACTIVE → ARCHIVED`

**Missions:** `STANDBY → QUEUED → DEPLOYING → IN COMBAT → ACCOMPLISHED / COMPROMISED / ABANDONED`

**Phases:** `STANDBY → ACTIVE → SECURED / COMPROMISED`

**Campaigns:** `DRAFT → PLANNING → ACTIVE → ACCOMPLISHED / COMPROMISED` (can pause/resume)
