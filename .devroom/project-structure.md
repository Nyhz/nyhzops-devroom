# Project Structure

```
devroom/
├── CLAUDE.md
├── SPEC.md
├── README.md
├── package.json                       # pnpm as package manager
├── pnpm-workspace.yaml
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                    # shadcn/ui configuration
├── Dockerfile                         # Multi-stage: deps → dev | build → production
├── docker-compose.yml                 # Dev stack: devroom + caddy reverse proxy
├── Caddyfile                          # Caddy config — reverse proxy with WebSocket support
├── .env.example                       # Environment variable template
├── server.ts                          # Custom server (Next.js + Socket.IO)
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout — tactical shell
│   │   ├── loading.tsx                # Root loading skeleton
│   │   ├── error.tsx                  # Global error boundary
│   │   ├── global-error.tsx           # Next.js global error fallback
│   │   ├── not-found.tsx              # 404 page
│   │   ├── warroom/
│   │   │   └── page.tsx               # Boot sequence animation (first-visit gate)
│   │   ├── (hq)/                      # Route group — HQ layout shell
│   │   │   ├── layout.tsx             # HQ layout (sidebar + intel bar + footer)
│   │   │   ├── page.tsx               # HQ Dashboard — global overview
│   │   │   ├── general/
│   │   │   │   └── page.tsx           # GENERAL chat — standalone Claude Code sessions
│   │   │   ├── assets/
│   │   │   │   └── page.tsx           # Asset management (global, not per-battlefield)
│   │   │   ├── captain-log/
│   │   │   │   └── page.tsx           # Captain AI decision log viewer
│   │   │   ├── logistics/
│   │   │   │   └── page.tsx           # Token usage & rate limit dashboard
│   │   │   ├── notifications/
│   │   │   │   └── page.tsx           # Notification center
│   │   │   └── battlefields/
│   │   │       ├── page.tsx           # Battlefield selector
│   │   │       ├── new/
│   │   │       │   └── page.tsx       # Create new battlefield
│   │   │       └── [id]/
│   │   │           ├── layout.tsx     # Battlefield layout (sidebar nav)
│   │   │           ├── loading.tsx    # Battlefield loading skeleton
│   │   │           ├── page.tsx       # Battlefield overview — missions tab
│   │   │           ├── board/
│   │   │           │   ├── page.tsx       # Intel board — planning/tracking cards
│   │   │           │   └── loading.tsx
│   │   │           ├── missions/
│   │   │           │   └── [missionId]/
│   │   │           │       └── page.tsx   # Mission detail + live comms
│   │   │           ├── campaigns/
│   │   │           │   ├── page.tsx       # Campaigns list
│   │   │           │   ├── loading.tsx
│   │   │           │   ├── new/
│   │   │           │   │   ├── page.tsx   # Create new campaign
│   │   │           │   │   └── form.tsx   # Campaign creation form
│   │   │           │   └── [campaignId]/
│   │   │           │       ├── page.tsx   # Campaign detail + phase view
│   │   │           │       └── loading.tsx
│   │   │           ├── assets/
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
│   │   │   ├── schema.ts             # Drizzle schema (16 tables)
│   │   │   └── migrations/
│   │   ├── general/
│   │   │   ├── general-engine.ts     # Spawn Claude Code for standalone GENERAL chat sessions
│   │   │   ├── general-prompt.ts     # System prompt builder with optional battlefield context
│   │   │   └── general-commands.ts   # Command parser (/clear, /compact)
│   │   ├── briefing/
│   │   │   ├── briefing-engine.ts    # Spawn Claude Code (GENERAL) for interactive campaign planning
│   │   │   └── briefing-prompt.ts    # System prompt builder for GENERAL with campaign context
│   │   ├── orchestrator/
│   │   │   ├── orchestrator.ts       # Core engine — queue loop, concurrency
│   │   │   ├── executor.ts           # Claude Code spawn + stream management
│   │   │   ├── campaign-executor.ts  # Multi-phase campaign orchestration
│   │   │   ├── stream-parser.ts      # Parse Claude Code stream-json output
│   │   │   ├── worktree.ts           # Git worktree lifecycle
│   │   │   ├── merger.ts             # Branch merge + conflict resolution
│   │   │   ├── prompt-builder.ts     # Prompt assembly + cache optimization
│   │   │   └── auth-check.ts         # Claude Code auth verification
│   │   ├── captain/
│   │   │   ├── captain.ts            # AI decision layer — autonomous judgment calls
│   │   │   ├── captain-db.ts         # Captain decision persistence
│   │   │   ├── debrief-reviewer.ts   # Mission result review + quality assessment
│   │   │   ├── escalation.ts         # Telegram escalation for critical decisions
│   │   │   ├── phase-failure-handler.ts  # Phase failure recovery logic
│   │   │   └── review-handler.ts     # Captain review runner — post-completion review with retry/escalation
│   │   ├── process/
│   │   │   ├── dev-server.ts         # Dev server lifecycle (start/stop/restart, port tracking)
│   │   │   ├── command-runner.ts     # Quick command execution + streaming output
│   │   │   └── claude-print.ts       # Claude Code output formatting
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
│   │   ├── asset.ts                  # Server Actions for asset CRUD
│   │   ├── battlefield.ts            # Server Actions for battlefield CRUD + scaffold
│   │   ├── briefing.ts               # Server Actions for briefing session queries
│   │   ├── campaign.ts               # Server Actions for campaign CRUD + plan + launch
│   │   ├── captain.ts                # Server Actions for captain log queries
│   │   ├── console.ts                # Server Actions for quick commands + dev server
│   │   ├── dossier.ts                # Server Actions for briefing template CRUD
│   │   ├── general.ts                # Server Actions for GENERAL session CRUD + messaging
│   │   ├── git.ts                    # Server Actions for git operations
│   │   ├── intel.ts                  # Server Actions for intel board note CRUD
│   │   ├── logistics.ts              # Server Actions for token usage + cost tracking
│   │   ├── mission.ts                # Server Actions for mission CRUD + deploy + abort
│   │   ├── notification.ts           # Server Actions for notification CRUD + read status
│   │   └── schedule.ts               # Server Actions for scheduled task CRUD
│   ├── components/
│   │   ├── general/
│   │   │   ├── general-chat.tsx      # Main GENERAL chat UI (tabs, messages, streaming)
│   │   │   ├── new-session-modal.tsx # Create session dialog (optional battlefield link)
│   │   │   ├── close-session-modal.tsx # Close session confirmation
│   │   │   └── command-reference.tsx # Help overlay for /clear, /compact commands
│   │   ├── layout/
│   │   │   ├── app-shell.tsx         # Top intel bar + sidebar + content area
│   │   │   ├── app-shell-client.tsx  # Client-side shell wrapper (Socket.IO, responsive)
│   │   │   ├── sidebar.tsx           # Left nav — branding + battlefield selector
│   │   │   ├── sidebar-content.tsx   # Sidebar inner content (nav sections)
│   │   │   ├── sidebar-nav.tsx       # Section navigation links (missions, campaigns, etc.)
│   │   │   ├── collapsible-sidebar.tsx # Desktop collapsible sidebar
│   │   │   ├── mobile-drawer.tsx     # Mobile sidebar drawer overlay
│   │   │   ├── mobile-top-bar.tsx    # Mobile top navigation bar
│   │   │   ├── global-nav.tsx        # Global nav — top: HQ (◉), GENERAL (◇); bottom: CAPTAIN'S LOG (⚓), ASSETS (◎), LOGISTICS (◈)
│   │   │   ├── battlefield-selector.tsx # Battlefield dropdown selector
│   │   │   ├── intel-bar.tsx         # Top bar — rotating military quotes
│   │   │   ├── page-header.tsx       # Reusable page header (codename + section + title)
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
│   │   ├── board/
│   │   │   ├── intel-board.tsx       # Main intel board with drag-and-drop columns
│   │   │   ├── board-card.tsx        # Individual board card
│   │   │   ├── board-column.tsx      # Board column container
│   │   │   └── note-panel.tsx        # Note creation/editing panel
│   │   ├── mission/
│   │   │   ├── mission-comms.tsx     # Live terminal log stream
│   │   │   ├── mission-actions.tsx   # Continue / Redeploy / Abandon buttons
│   │   │   └── live-status-badge.tsx # Real-time status badge via Socket.IO
│   │   ├── campaign/
│   │   │   ├── briefing-chat.tsx     # Interactive campaign planning chat with GENERAL
│   │   │   ├── campaign-controls.tsx # MISSION ACCOMPLISHED | REDEPLOY | ABANDON
│   │   │   ├── campaign-live-view.tsx # Real-time campaign progress viewer
│   │   │   ├── campaign-results.tsx  # Campaign completion metrics (cost, tokens, duration)
│   │   │   ├── mission-card.tsx      # Campaign-specific mission card
│   │   │   ├── phase-timeline.tsx    # Phase container with nested mission cards
│   │   │   └── plan-editor.tsx       # Editable plan viewer (reorder phases/missions)
│   │   ├── asset/
│   │   │   ├── asset-list.tsx        # Right sidebar asset panel
│   │   │   ├── asset-deployment.tsx  # Asset deployment status/history
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
│   │       ├── tac-tooltip.tsx       # Tactical tooltip
│   │       ├── search-input.tsx      # Search with monospace placeholder
│   │       ├── markdown.tsx          # Markdown renderer (react-markdown + remark-gfm)
│   │       ├── commander-content.tsx # Commander-styled content wrapper
│   │       ├── chat-message.tsx      # Chat message bubble component
│   │       ├── responsive-table.tsx  # Responsive table wrapper
│   │       ├── modal.tsx
│   │       ├── button.tsx            # shadcn button (restyled)
│   │       ├── dialog.tsx            # shadcn dialog
│   │       ├── scroll-area.tsx       # shadcn scroll area
│   │       ├── select.tsx            # shadcn select
│   │       ├── tabs.tsx              # shadcn tabs
│   │       └── tooltip.tsx           # shadcn tooltip
│   ├── hooks/
│   │   ├── use-socket.ts             # Socket.IO connection hook
│   │   ├── use-general.ts            # GENERAL chat session — stream chunks, send messages
│   │   ├── use-mission-comms.ts      # Mission log stream subscription
│   │   ├── use-campaign-comms.ts     # Campaign progress stream subscription
│   │   ├── use-activity-feed.ts      # HQ activity feed subscription
│   │   ├── use-briefing.ts           # Briefing session Socket.IO hook
│   │   ├── use-confirm.tsx           # Confirmation dialog hook (returns promise)
│   │   ├── use-notifications.ts      # Notification stream subscription
│   │   ├── use-dev-server.ts         # Dev server status + log stream
│   │   ├── use-command-output.ts     # Streaming command output
│   │   ├── use-board.ts              # Intel board state + drag-and-drop
│   │   └── use-streaming-chat.ts     # Generic streaming chat hook
│   └── types/
│       └── index.ts
├── scripts/
│   ├── seed.ts                       # Seed default assets
│   ├── rerun-review.ts               # CLI script for re-running Captain debrief review
│   └── sync-claude-credentials.sh    # Sync Claude API credentials
└── .devroom/                          # Extended documentation
    ├── project-structure.md
    ├── database-schema.md
    ├── ui-theme.md
    ├── server-and-sockets.md
    ├── git-and-workflows.md
    ├── spec-battlefields.md
    ├── spec-missions.md
    ├── spec-campaigns.md
    ├── spec-operations.md
    ├── spec-prompts.md
    ├── spec-captain-and-comms.md
    └── accessibility-audit.md
```
