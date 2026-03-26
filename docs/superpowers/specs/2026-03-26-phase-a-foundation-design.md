# Phase A: Foundation — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** A (Foundation)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Phase A establishes the infrastructure layer for DEVROOM: project scaffold, database, custom server with Socket.IO, tactical UI theme, layout shell, and initial pages. The goal is a running application with the full visual shell, seeded data, and all plumbing ready for Phase B (Battlefields + Missions).

---

## 1. Project Scaffold

### Package Manager & Runtime
- **Runtime:** Node.js 25.8.2
- **Package manager:** pnpm
- **Framework:** Next.js 16.2 (App Router, Turbopack default)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 3.x + custom tactical theme
- **Component primitives:** shadcn/ui (cherry-picked, fully restyled)

### Scaffold Command
```bash
pnpm create next-app@latest . --typescript --tailwind --app --src-dir --turbopack
```

### Dependencies
**Runtime:**
- `better-sqlite3` — synchronous SQLite driver
- `drizzle-orm` — type-safe ORM
- `socket.io` — server-side real-time
- `socket.io-client` — client-side real-time
- `simple-git` — git operations (used in later phases, installed now)
- `ulid` — sortable unique IDs
- `dotenv` — env loading (if not covered by Next.js built-in)

**Dev:**
- `drizzle-kit` — migration generation
- `tsx` — TypeScript execution for server.ts and scripts
- `@types/better-sqlite3` — type definitions
- `vitest` — testing

### shadcn Components (cherry-picked)
Install with custom config: no border-radius, monospace font, dark theme.
- `dialog`
- `dropdown-menu`
- `select`
- `tooltip`
- `tabs`
- `scroll-area`
- `popover`

### Next.js Config (`next.config.ts`)
- `serverExternalPackages: ['better-sqlite3']` — native module exclusion
- `images.dangerouslyAllowLocalIP: true` — LAN image optimization

### TypeScript Config
- Strict mode enabled
- Path alias: `@/*` → `./src/*`

### Scripts (`package.json`)
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

## 2. Database Schema

### Connection (`src/lib/db/index.ts`)
- Singleton `Database` instance via better-sqlite3
- Path: `DEVROOM_DB_PATH` env var (default: `./devroom.db`)
- Pragmas on open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`

### Schema (`src/lib/db/schema.ts`)
All tables use ULID primary keys (TEXT). Timestamps are Unix milliseconds (INTEGER).

#### battlefields
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| name | TEXT NOT NULL | Human-readable name |
| codename | TEXT NOT NULL | e.g. "OPERATION THUNDER" |
| description | TEXT | Short one-liner |
| initialBriefing | TEXT | Commander's project briefing |
| repoPath | TEXT NOT NULL | Absolute path to git repo |
| defaultBranch | TEXT DEFAULT 'main' | |
| claudeMdPath | TEXT | Path to CLAUDE.md |
| specMdPath | TEXT | Path to SPEC.md |
| scaffoldCommand | TEXT | Command used to scaffold |
| devServerCommand | TEXT DEFAULT 'npm run dev' | |
| autoStartDevServer | INTEGER DEFAULT 0 | Boolean |
| status | TEXT DEFAULT 'initializing' | initializing, active, archived |
| bootstrapMissionId | TEXT | FK to missions |
| createdAt | INTEGER NOT NULL | Unix ms |
| updatedAt | INTEGER NOT NULL | Unix ms |

#### missions
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| battlefieldId | TEXT NOT NULL | FK to battlefields |
| campaignId | TEXT | FK to campaigns |
| phaseId | TEXT | FK to phases |
| type | TEXT DEFAULT 'standard' | standard, bootstrap, conflict_resolution, phase_debrief |
| title | TEXT NOT NULL | |
| briefing | TEXT NOT NULL | Markdown, may contain base64 images |
| status | TEXT DEFAULT 'standby' | standby, queued, deploying, in_combat, accomplished, compromised, abandoned |
| priority | TEXT DEFAULT 'normal' | low, normal, high, critical |
| assetId | TEXT | FK to assets |
| useWorktree | INTEGER DEFAULT 0 | Boolean |
| worktreeBranch | TEXT | |
| sessionId | TEXT | Claude Code session for reuse |
| debrief | TEXT | |
| iterations | INTEGER DEFAULT 0 | |
| costInput | INTEGER DEFAULT 0 | |
| costOutput | INTEGER DEFAULT 0 | |
| costCacheHit | INTEGER DEFAULT 0 | |
| durationMs | INTEGER DEFAULT 0 | |
| startedAt | INTEGER | Unix ms |
| completedAt | INTEGER | Unix ms |
| createdAt | INTEGER NOT NULL | Unix ms |
| updatedAt | INTEGER NOT NULL | Unix ms |

#### campaigns
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| battlefieldId | TEXT NOT NULL | FK to battlefields |
| name | TEXT NOT NULL | |
| objective | TEXT NOT NULL | |
| status | TEXT DEFAULT 'draft' | draft, planning, active, paused, accomplished, compromised |
| worktreeMode | TEXT DEFAULT 'phase' | none, phase, mission |
| currentPhase | INTEGER DEFAULT 0 | |
| isTemplate | INTEGER DEFAULT 0 | Boolean |
| templateId | TEXT | Source template ID |
| createdAt | INTEGER NOT NULL | Unix ms |
| updatedAt | INTEGER NOT NULL | Unix ms |

#### phases
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| campaignId | TEXT NOT NULL | FK to campaigns |
| phaseNumber | INTEGER NOT NULL | |
| name | TEXT NOT NULL | |
| objective | TEXT | |
| status | TEXT DEFAULT 'standby' | standby, active, secured, compromised |
| debrief | TEXT | |
| totalTokens | INTEGER DEFAULT 0 | |
| durationMs | INTEGER DEFAULT 0 | |
| createdAt | INTEGER NOT NULL | Unix ms |

#### assets
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| codename | TEXT NOT NULL UNIQUE | e.g. "ARCHITECT" |
| specialty | TEXT NOT NULL | |
| systemPrompt | TEXT | |
| model | TEXT DEFAULT 'claude-sonnet-4-6' | |
| status | TEXT DEFAULT 'active' | active, offline |
| missionsCompleted | INTEGER DEFAULT 0 | |
| createdAt | INTEGER NOT NULL | Unix ms |

#### missionLogs
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| missionId | TEXT NOT NULL | FK to missions |
| timestamp | INTEGER NOT NULL | Unix ms |
| type | TEXT NOT NULL | log, status, error |
| content | TEXT NOT NULL | |

#### scheduledTasks
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| battlefieldId | TEXT NOT NULL | FK to battlefields |
| name | TEXT NOT NULL | |
| type | TEXT NOT NULL | mission, campaign |
| cron | TEXT NOT NULL | Cron expression |
| enabled | INTEGER DEFAULT 1 | Boolean |
| missionTemplate | TEXT | JSON template |
| campaignId | TEXT | FK to campaigns |
| lastRunAt | INTEGER | Unix ms |
| nextRunAt | INTEGER | Unix ms |
| runCount | INTEGER DEFAULT 0 | |
| createdAt | INTEGER NOT NULL | Unix ms |
| updatedAt | INTEGER NOT NULL | Unix ms |

#### commandLogs
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| battlefieldId | TEXT NOT NULL | FK to battlefields |
| command | TEXT NOT NULL | |
| exitCode | INTEGER | |
| durationMs | INTEGER DEFAULT 0 | |
| output | TEXT | Truncated stdout+stderr |
| createdAt | INTEGER NOT NULL | Unix ms |

### Migrations
- Generated via `pnpm db:generate` (drizzle-kit)
- Applied automatically on server startup
- Existing migrations are never modified

### Drizzle Config (`drizzle.config.ts`)
- Dialect: SQLite
- Schema: `./src/lib/db/schema.ts`
- Out: `./src/lib/db/migrations`

---

## 3. Seed Script

**Location:** `scripts/seed.ts`
**Run:** `pnpm seed` or automatically on server startup if assets table is empty.

### Default Assets

| Codename | Specialty | Model |
|----------|-----------|-------|
| ARCHITECT | general | claude-sonnet-4-6 |
| ASSERT | testing | claude-sonnet-4-6 |
| CANVAS | frontend | claude-sonnet-4-6 |
| CRITIC | review | claude-sonnet-4-6 |
| DISTILL | docs | claude-sonnet-4-6 |
| GOPHER | backend | claude-sonnet-4-6 |
| REBASE | devops | claude-sonnet-4-6 |
| SCANNER | security | claude-sonnet-4-6 |

Each asset includes a tailored `systemPrompt` describing its specialty and behavioral directives.

---

## 4. Custom Server

### `server.ts` (project root)

**Startup sequence:**
1. Load env vars
2. Open SQLite, set pragmas (WAL, foreign_keys, busy_timeout)
3. Run pending Drizzle migrations
4. Seed default assets if table is empty
5. Prepare Next.js app (`next({ dev, turbopack: true })`)
6. Create HTTP server, attach Next.js request handler
7. Attach Socket.IO (`path: '/socket.io'`)
8. Store `io` on typed `globalThis`
9. Detect local IP via `os.networkInterfaces()`
10. Bind `0.0.0.0:${DEVROOM_PORT}` (default 7777)
11. Log startup banner

**Startup banner:**
```
═══════════════════════════════════════════
  NYHZ OPS — DEVROOM
  Status:  OPERATIONAL
  Local:   http://localhost:7777
  Network: http://192.168.1.42:7777
  Agents:  0/5 deployed
═══════════════════════════════════════════
```

**Graceful shutdown (SIGINT/SIGTERM):**
1. Log `DEVROOM — STANDING DOWN...`
2. Stop accepting connections
3. Close Socket.IO
4. Close database
5. Exit

(Aborting running missions added in Phase B)

### Config (`src/lib/config.ts`)

Typed singleton reading all env vars with defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| DEVROOM_PORT | 7777 | HTTP server port |
| DEVROOM_HOST | 0.0.0.0 | Bind address |
| DEVROOM_DB_PATH | ./devroom.db | SQLite file path |
| DEVROOM_DEV_BASE_PATH | /dev | Base for new battlefields |
| DEVROOM_LOG_LEVEL | info | Log level |
| DEVROOM_MAX_AGENTS | 5 | Max concurrent Claude Code processes |
| DEVROOM_CLAUDE_PATH | claude | Path to Claude Code binary |
| DEVROOM_LOG_RETENTION_DAYS | 30 | Days to keep mission logs |

---

## 5. Socket.IO

### Server Setup (`src/lib/socket/server.ts`)

Room subscription handlers:
- `mission:subscribe` / `mission:unsubscribe`
- `hq:subscribe`
- `devserver:subscribe`
- `console:subscribe`
- Connection/disconnection logging

No events emitted in Phase A — infrastructure only.

### Client Hook (`src/hooks/use-socket.ts`)

- Singleton Socket.IO client connection to same origin
- Path: `/socket.io`
- Auto-reconnect enabled
- React context provider (`SocketProvider`) at root layout
- `useSocket()` hook returns the socket instance

---

## 6. Theme — Ghost Ops V2

### Tailwind Config (`tailwind.config.ts`)

```typescript
{
  theme: {
    extend: {
      colors: {
        dr: {
          bg:        '#0a0a0c',
          surface:   '#111114',
          elevated:  '#1a1a22',
          border:    '#2a2a32',
          text:      '#b8b8c8',
          muted:     '#6a6a7a',
          dim:       '#4a4a5a',
          green:     '#00ff41',
          amber:     '#ffbf00',
          red:       '#ff3333',
          blue:      '#00aaff',
        }
      },
      fontFamily: {
        tactical: ['"Share Tech Mono"', 'monospace'],
        mono:     ['"IBM Plex Mono"', 'monospace'],
        data:     ['"Courier Prime"', 'monospace'],
      },
      boxShadow: {
        'glow-green': '0 0 10px rgba(0, 255, 65, 0.3)',
        'glow-amber': '0 0 10px rgba(255, 191, 0, 0.3)',
        'glow-red':   '0 0 10px rgba(255, 51, 51, 0.3)',
      }
    }
  }
}
```

### Fonts
Loaded via `next/font/google` with automatic self-hosting:
- **Share Tech Mono** — primary UI font (tactical)
- **IBM Plex Mono** — secondary, code/data
- **Courier Prime** — tertiary, terminal output

### Design Principles
- No border-radius anywhere (sharp angular military feel)
- Monospace typography throughout
- Green for success/operational states
- Amber for active/in-progress states and section headers
- Red for errors/failures
- Blue for informational/initializing states
- Glow shadows for emphasis on interactive elements

---

## 7. UI Components

### shadcn Primitives (restyled)
Installed via shadcn CLI, fully restyled with `dr-*` tokens:
- `dialog` — modals, confirmations
- `dropdown-menu` — context/action menus
- `select` — battlefield selector, asset picker
- `tooltip` — hover info
- `tabs` — tabbed views
- `scroll-area` — scrollable containers
- `popover` — inline panels

### Custom Tactical Components (`src/components/ui/`)

| Component | Description |
|-----------|-------------|
| `tac-button.tsx` | Variants: primary (amber), success (green), danger (red), ghost. Monospace, uppercase, no border-radius. |
| `tac-input.tsx` | Input + textarea. Dark bg (`dr-bg`), `dr-border` default, `dr-amber` on focus. Monospace placeholder. |
| `tac-card.tsx` | `dr-surface` bg, optional left status border (green/amber/red), no border-radius. |
| `tac-badge.tsx` | Status badges with colored dot + label. Optional glow shadow. |
| `tac-select.tsx` | Wraps shadcn Select with tactical styling. |
| `search-input.tsx` | Search with monospace placeholder, dim border. |
| `terminal.tsx` | Monospace log viewer with timestamps, auto-scroll, scrollback buffer. |
| `modal.tsx` | Wraps shadcn Dialog with tactical styling. |

### Utility
- `cn()` — clsx + tailwind-merge (ships with shadcn)

---

## 8. Layout Shell

### Root Layout (`src/app/layout.tsx`)
- Google fonts loaded via `next/font/google`
- `SocketProvider` wrapping children
- `AppShell` component wrapping all pages
- Global body: `bg-dr-bg text-dr-text font-tactical`

### App Shell (`src/components/layout/app-shell.tsx`)
Assembles the full layout:
```
┌─────────────────────────────────────────────┐
│  Intel Bar                                   │
├─────────┬───────────────────────────────────┤
│         │                                    │
│ Sidebar │  {children}                        │
│         │                                    │
├─────────┴───────────────────────────────────┤
│  Status Footer                               │
└─────────────────────────────────────────────┘
```

### Intel Bar (`src/components/layout/intel-bar.tsx`)
- Client Component (`"use client"`)
- Full-width top bar
- `INTEL //` prefix in amber + rotating military quote in dim text
- 60-second rotation interval with fade transition
- 15 preset quotes from CLAUDE.md

### Sidebar (`src/components/layout/sidebar.tsx`)
- **Brand block:** `N` in amber circle + `NYHZ OPS` + green operational dot + `DEVROOM` subtitle
- **Battlefield selector:** shadcn Select dropdown, reads battlefields from DB, navigates on change
- **Section nav:** 7 links with icons and count badges. Active state: `bg-dr-elevated` + amber text.
  - MISSIONS (■), CAMPAIGNS (✕), ASSETS (◎), GIT (◆), CONSOLE (▶), SCHEDULE (⏱), CONFIG (⚙)
- **Intel Briefing:** Bottom section. System status dot + text. Active agent count.

### Status Footer (`src/components/layout/status-footer.tsx`)
- Server Component
- Full-width bottom bar
- `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`
- Green dot, dim monospace text

---

## 9. Pages & Routing

### Live Pages

| Route | Type | Content |
|-------|------|---------|
| `/` | Server | Redirect to `/projects` |
| `/projects` | Server | Battlefield list from DB. Empty state with create prompt. |
| `/projects/[id]` | Server | Battlefield overview: header (breadcrumb, codename, description), deploy mission form (static), stats bar (zeros), empty mission list. |
| `/projects/[id]/layout.tsx` | Layout | Right sidebar with asset list from DB + asset breakdown (empty). |
| `/projects/[id]/assets` | Server | Asset grid: seeded assets as cards with codename, specialty, model, status dot. Read-only. |

### Stub Pages
All render a tactical-styled placeholder message indicating which phase will implement them:
- `/projects/[id]/missions/[missionId]` — Phase B
- `/projects/[id]/campaigns` — Phase C
- `/projects/[id]/campaigns/[campaignId]` — Phase C
- `/projects/[id]/git` — Phase D
- `/projects/[id]/console` — Phase D
- `/projects/[id]/schedule` — Phase D
- `/projects/[id]/config` — Phase D

### What Is NOT Built in Phase A
- No battlefield creation form
- No mission deployment or execution
- No Server Actions for mutations
- No real-time event emission
- No campaign, git, console, or schedule functionality

---

## 10. End State

After Phase A is complete, running `pnpm dev` will:
1. Start the custom server on port 7777
2. Display the startup banner with local and network URLs
3. Serve the full tactical shell with Ghost Ops V2 theme
4. Show the battlefield list (empty state)
5. Have a SQLite database with all tables created and 8 default assets seeded
6. Have Socket.IO connected and room handlers registered
7. All navigation links wired to real routes (live or stub)

Phase B will add: battlefield creation, mission CRUD, mission execution (Claude Code spawn), real-time comms, and debriefs.

---

## Next.js 16.2 Considerations

The following breaking changes from Next.js 14→16.2 are accounted for:
- All page `params` are `Promise<{...}>` and must be `await`ed
- `revalidatePath()` works as-is for Server Actions (Phase B+)
- `images.dangerouslyAllowLocalIP: true` set for LAN access
- Turbopack is default (no flag needed)
- React 19.2 ships with it (View Transitions, React Compiler available)
- TypeScript 5+ required
