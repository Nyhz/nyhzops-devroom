```
 ██████╗ ███████╗██╗   ██╗██████╗  ██████╗  ██████╗ ███╗   ███╗
 ██╔══██╗██╔════╝██║   ██║██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║
 ██║  ██║█████╗  ██║   ██║██████╔╝██║   ██║██║   ██║██╔████╔██║
 ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██╗██║   ██║██║   ██║██║╚██╔╝██║
 ██████╔╝███████╗ ╚████╔╝ ██║  ██║╚██████╔╝╚██████╔╝██║ ╚═╝ ██║
 ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝
                    N Y H Z   O P S
```

**Autonomous Agent Orchestrator — Tactical Operations Center**

> *"War is ninety percent information."* — Napoleon Bonaparte

DEVROOM is a self-hosted command center for spawning, coordinating, and monitoring autonomous [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents. It runs on your local network — deploy missions from any device, watch them execute in real-time, and let the **Captain** handle the rest.

Built for one operator. Designed like a war room.

---

## The Concept

You are the **Commander**. Your codebase is a **Battlefield**. Every task is a **Mission** — a Claude Code process deployed into an isolated git worktree with a briefing, an objective, and an asset (agent) assigned to carry it out.

Need to coordinate multiple missions across sequential phases? That's a **Campaign**. Plan it interactively with the **GENERAL** (a planning-specialized agent), review the operation, then hit **GREEN LIGHT** and watch your phases execute in sequence — missions within each phase running in parallel.

When things go sideways, the **Captain** — an autonomous AI decision layer — reviews debriefs, makes tactical calls, and escalates to you via Telegram when confidence is low.

Every mission. Every decision. Every token. Logged, tracked, and reported back to Command.

---

## Features

### Mission Deployment & Execution

- **One-click deploy** — Write a briefing, pick an asset, set priority, deploy
- **Isolated worktrees** — Every mission gets its own git branch and worktree. No conflicts. Clean merges on success
- **Live comms** — Real-time streaming output from running agents via Socket.IO
- **Concurrency control** — Configurable parallel agent slots with automatic queue management
- **Rate limit handling** — Exponential backoff with retry (60s × 2^attempt, max 5 retries)
- **Mission templates (Dossiers)** — Reusable briefing templates with variable placeholders for repeat operations

### Campaign Operations

- **Multi-phase campaigns** — Sequential phases, parallel missions within each phase
- **Interactive briefing** — Plan campaigns conversationally with the GENERAL asset
- **Plan generation** — GENERAL produces structured phase/mission plans from your briefing
- **Visual plan editor** — Drag-and-drop reordering of phases and missions before launch
- **Live timeline** — Track campaign progress across phases in real-time
- **Auto phase transitions** — Next phase begins automatically when current phase is secured

### Captain AI — Autonomous Decision Layer

- **Debrief review** — Evaluates every completed mission: satisfactory? concerns? accept / retry / escalate?
- **Stall detection** — When an agent asks a question mid-mission, Captain answers autonomously
- **Confidence-based escalation** — HIGH confidence proceeds silently, LOW confidence pings the Commander
- **Full audit trail** — Every Captain decision logged with reasoning, confidence level, and outcome
- **Telegram escalation** — Critical decisions forwarded with inline action buttons (APPROVE / RETRY / ESCALATE)

### Asset Management

- **Agent profiles** — Each asset has a codename, specialty, system prompt, and model assignment
- **Model selection** — Per-asset model choice (Opus, Sonnet, Haiku)
- **Live deployment status** — See which assets are in combat, queued, or idle
- **Mission tracking** — Completed mission count per asset

### Monitoring & Intelligence

- **HQ Dashboard** — Global operations status, battlefield grid, activity feed, recent missions
- **Captain's Log** — Searchable audit trail of all autonomous decisions
- **Logistics** — Token usage, cost breakdown by battlefield and asset, 30-day usage chart, rate limit status
- **Notifications** — In-app alerts for status changes, escalations, and system events (INFO / WARNING / CRITICAL)
- **Telegram integration** — Real-time escalation alerts with inline action buttons

### Git Operations

- **Automatic worktree lifecycle** — Create on deploy, merge on success, cleanup on completion
- **Branch management** — Status, commit log, and branch listing per battlefield
- **Orphan cleanup** — Scheduled sweep for abandoned worktrees and branches

### War Room

First visit triggers a theatrical boot sequence — progress bars filling, systems coming online, status checks reporting in. Because every command center needs a proper power-on sequence.

```
NYHZ OPS
D E V R O O M

[████████████████████████████████] Establishing secure connection...
[████████████████████████████████] Loading battlefield intelligence...
[████████████████████████████████] Recovering active campaigns...
[████████████████████████████████] Contacting deployed assets...

> BATTLEFIELDS ONLINE .............. 3 active
> ASSETS DEPLOYED ................. 2 in combat
> CAPTAIN ON STATION .............. standing by
> ALL SYSTEMS NOMINAL

          [ ENTER COMMAND CENTER ]
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    COMMANDER (You)                       │
│              Browser on any LAN device                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Next.js App Router                                    │
│   ├── Server Components (data display, DB queries)      │
│   ├── Client Components (Socket.IO, forms, terminals)   │
│   ├── Server Actions (all mutations)                    │
│   └── Route Handlers (stream endpoints)                 │
│                                                         │
├──────────────┬──────────────┬───────────────────────────┤
│  SQLite DB   │  Socket.IO   │   Orchestrator            │
│  (Drizzle)   │  (real-time) │   ├── Queue Loop          │
│              │              │   ├── Executor (spawn)     │
│              │              │   ├── Campaign Executor    │
│              │              │   ├── Captain AI           │
│              │              │   ├── Worktree Manager     │
│              │              │   └── Stream Parser        │
├──────────────┴──────────────┴───────────────────────────┤
│                                                         │
│   Claude Code CLI Processes                             │
│   ├── Mission agents (isolated worktrees)               │
│   ├── Briefing agent (GENERAL)                          │
│   ├── Captain review agents                             │
│   └── Bootstrap agents (CLAUDE.md + SPEC.md gen)        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│         Git Repositories (Battlefields)                 │
│         └── Worktrees per mission/phase                 │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 4 — custom tactical theme |
| Primitives | shadcn/ui (restyled) |
| Database | SQLite via better-sqlite3 (synchronous, WAL mode) |
| ORM | Drizzle ORM |
| Real-time | Socket.IO |
| Agent Runtime | Claude Code CLI via `child_process.spawn` |
| Git | simple-git (worktrees, merges) |
| IDs | ULID |

---

## Terminology

Everything has a codename. This isn't a project management tool — it's an operations center.

| You Know It As | We Call It | What It Does |
|---|---|---|
| Project | **Battlefield** | A git repository under DEVROOM control |
| Task | **Mission** | A single Claude Code agent execution |
| Task Group | **Campaign** | Multi-phase operation with sequential phases |
| Phase | **Phase** | A campaign step — its missions run in parallel |
| Agent Profile | **Asset** | Specialty + system prompt + model assignment |
| Result | **Debrief** | Post-mission summary report |
| Logs | **Comms** | Real-time output stream from a running mission |
| Template | **Dossier** | Reusable mission briefing with variable slots |
| AI Layer | **Captain** | Autonomous decision engine |
| Dashboard | **HQ** | Main overview screen |
| Alert | **Notification** | In-app + Telegram alert |
| Planning Chat | **Briefing** | Interactive campaign planning with GENERAL |
| Cost Tracking | **Logistics** | Token usage, rate limits, cost dashboard |
| Startup | **War Room** | Boot sequence animation |

### Status Colors

| Status | Color | Meaning |
|---|---|---|
| `STANDBY` | dim | Created, not yet queued |
| `QUEUED` | muted | Waiting for an agent slot |
| `DEPLOYING` | amber | Setting up worktree |
| `IN COMBAT` | amber | Agent actively running |
| `REVIEWING` | blue | Captain reviewing debrief |
| `ACCOMPLISHED` | green | Mission complete |
| `COMPROMISED` | red | Failed |
| `ABANDONED` | dim | Cancelled by Commander |

---

## Getting Started

### Prerequisites

- **Node.js 20+** and **pnpm**
- **Claude Code CLI** installed and authenticated ([docs](https://docs.anthropic.com/en/docs/claude-code))
- A git repository to use as your first battlefield

### Installation

```bash
git clone https://github.com/Nyhz/nyhzops-devroom.git
cd nyhzops-devroom
pnpm install
```

### Configuration

Create a `.env` file:

```bash
# Required
DEVROOM_PORT=7777
DEVROOM_CLAUDE_PATH=/usr/local/bin/claude   # Path to your Claude Code binary

# Optional
DEVROOM_MAX_AGENTS=4                         # Max parallel missions (default: 4)
DEVROOM_TELEGRAM_BOT_TOKEN=your-bot-token    # Telegram escalation alerts
DEVROOM_TELEGRAM_CHAT_ID=your-chat-id        # Telegram destination
DEVROOM_TELEGRAM_ENABLED=true                # Enable Telegram integration
```

### Database Setup

```bash
pnpm db:migrate    # Apply migrations
pnpm seed          # Seed default assets (GENERAL, ARCHITECT, ENGINEER, etc.)
```

### Launch

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start
```

Open `http://<your-machine-ip>:7777` from any device on your network.

---

## Usage

### Deploy Your First Mission

1. **Create a Battlefield** — Click `+ NEW BATTLEFIELD` on HQ, point it to a git repo
2. **Bootstrap** — DEVROOM auto-generates a `CLAUDE.md` and `SPEC.md` for the repo
3. **Deploy** — Write a mission briefing, select an asset, hit `DEPLOY`
4. **Monitor** — Watch live comms stream as your agent works
5. **Review** — Captain auto-reviews the debrief. Check the result.

### Run a Campaign

1. **New Campaign** — Navigate to Campaigns, create one with an objective
2. **Brief the GENERAL** — Chat about what you need. Discuss phases, priorities, constraints.
3. **Generate Plan** — Hit `GENERATE PLAN`. GENERAL structures your conversation into phases and missions.
4. **Review** — Reorder phases, reassign assets, adjust priorities in the plan editor.
5. **GREEN LIGHT** — Launch the campaign. Phases execute in sequence, missions in parallel.
6. **Debrief** — Review results per mission and per phase when complete.

---

## Project Structure

```
devroom/
├── server.ts                    # Custom server (Next.js + Socket.IO + Orchestrator)
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── (hq)/               # Main layout group
│   │   │   ├── page.tsx         # HQ Dashboard
│   │   │   ├── battlefields/   # Battlefield pages
│   │   │   ├── assets/         # Asset management
│   │   │   ├── captain-log/    # Captain's Log
│   │   │   └── logistics/      # Cost & usage dashboard
│   │   ├── api/                # Route handlers
│   │   └── warroom/            # Boot sequence redirect
│   ├── actions/                # Server Actions (all mutations)
│   ├── components/             # React components
│   │   ├── campaign/           # Campaign UI (briefing, controls, timeline)
│   │   ├── mission/            # Mission UI (comms, debrief, deploy)
│   │   ├── layout/             # Nav, sidebar, footer, intel bar
│   │   ├── warroom/            # Boot sequence animation
│   │   └── ui/                 # Tactical UI primitives
│   ├── hooks/                  # Client-side hooks (Socket.IO, etc.)
│   ├── lib/
│   │   ├── orchestrator/       # Core engine (queue, executor, worktrees)
│   │   ├── captain/            # AI decision layer
│   │   ├── briefing/           # Campaign planning engine
│   │   ├── db/                 # Drizzle schema + migrations
│   │   ├── socket/             # Socket.IO server setup
│   │   ├── telegram/           # Telegram integration
│   │   └── scheduler/          # Cron-based task scheduling
│   └── types/                  # TypeScript type definitions
├── drizzle/                    # Generated migrations
└── scripts/                    # Seed data, utilities
```

---

## Design Philosophy

DEVROOM is built around a few convictions:

**Single operator, maximum leverage.** This isn't a team tool. It's a force multiplier for one person running multiple AI agents against real codebases. No auth, no permissions, no collaboration features. Just you and your agents.

**Information density over aesthetics.** Every pixel earns its place. Stats bars, status badges, live comms, token counts — all visible at a glance. The tactical theme isn't decoration; it's a design language optimized for scanning dense, real-time information.

**Autonomous but accountable.** The Captain makes decisions so you don't have to babysit every mission. But every decision is logged, every debrief is reviewed, and escalation paths exist for when confidence is low. Trust but verify.

**Git-native isolation.** Every mission gets its own worktree and branch. Agents can't step on each other. Success means a clean merge. Failure means a branch you can inspect or discard. The git history tells the full story.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm test` | Run tests (Vitest) |
| `pnpm lint` | Lint with ESLint |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm seed` | Seed default assets |

---

## License

Private project. Not licensed for redistribution.

---

<p align="center">
  <sub>NYHZ OPS — DEVROOM v0.1.0</sub><br>
  <sub>All systems nominal. Standing by for orders, Commander.</sub>
</p>
