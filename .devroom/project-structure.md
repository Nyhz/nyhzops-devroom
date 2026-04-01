# Project Structure

```
devroom/
├── CLAUDE.md
├── SPEC.md
├── README.md
├── package.json                       # pnpm as package manager
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                    # shadcn/ui configuration
├── Caddyfile                          # Caddy config — reverse proxy with WebSocket support
├── .env.example                       # Environment variable template
├── server.ts                          # Custom server (Next.js + Socket.IO)
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout — tactical shell
│   │   ├── globals.css                # Tailwind v4 theme tokens
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
│   │   │   │   ├── page.tsx           # Asset management (global, not per-battlefield)
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx       # Asset detail — tabbed view (Profile, Prompt, Skills)
│   │   │   ├── overseer-log/
│   │   │   │   └── page.tsx           # Overseer AI decision log viewer
│   │   │   ├── logistics/
│   │   │   │   └── page.tsx           # Token usage & rate limit dashboard
│   │   │   ├── notifications/
│   │   │   │   └── page.tsx           # Notification center
│   │   │   ├── test-harness/
│   │   │   │   └── page.tsx           # E2E test harness page
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
│   │       ├── logistics/
│   │       │   └── rate-limit/
│   │       │       └── route.ts           # Check Claude API rate limit status
│   │       ├── test-fixtures/
│   │       │   └── route.ts               # Test fixture seeding endpoint
│   │       └── test/
│   │           ├── seed-campaign/
│   │           │   └── route.ts           # Seed test campaign data
│   │           └── seed-active-campaign/
│   │               └── route.ts           # Seed active campaign for E2E tests
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts              # DB connection singleton
│   │   │   ├── schema.ts             # Drizzle schema (17 tables)
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
│   │   │   ├── prompt-builder.ts     # Prompt assembly + cache optimization
│   │   │   ├── auth-check.ts         # Claude Code auth verification
│   │   │   ├── asset-cli.ts          # Build CLI args per asset (skills, MCP servers, effort, max turns)
│   │   │   ├── safe-queue.ts         # Safe queue processing with error boundaries
│   │   │   ├── system-asset.ts       # Cached lookups for system assets (OVERSEER, GENERAL, QUARTERMASTER)
│   │   │   └── __tests__/
│   │   │       ├── asset-cli.test.ts
│   │   │       ├── phase-guard.test.ts
│   │   │       └── safe-queue.test.ts
│   │   ├── overseer/
│   │   │   ├── overseer.ts           # AI review layer — calls OVERSEER asset for verdict
│   │   │   ├── overseer-db.ts        # Overseer decision persistence
│   │   │   ├── debrief-reviewer.ts   # Mission result review + quality assessment
│   │   │   ├── escalation.ts         # Telegram escalation for critical decisions
│   │   │   ├── phase-failure-handler.ts  # Phase failure recovery logic
│   │   │   ├── review-handler.ts     # Post-completion review runner with retry/escalation
│   │   │   ├── review-parser.ts      # Parse OVERSEER verdict output
│   │   │   └── __tests__/
│   │   │       └── review-parser.test.ts
│   │   ├── quartermaster/
│   │   │   ├── quartermaster.ts      # Merge orchestration — triggerQuartermaster()
│   │   │   ├── merge-executor.ts     # Execute git merge via QUARTERMASTER asset
│   │   │   ├── conflict-resolver.ts  # Automated merge conflict resolution
│   │   │   └── __tests__/
│   │   │       └── quartermaster.test.ts
│   │   ├── discovery/
│   │   │   ├── skill-scanner.ts      # Scan for Claude Code plugin skills
│   │   │   └── __tests__/
│   │   │       └── skill-scanner.test.ts
│   │   ├── process/
│   │   │   ├── dev-server.ts         # Dev server lifecycle (start/stop/restart, port tracking)
│   │   │   ├── command-runner.ts     # Quick command execution + streaming output
│   │   │   └── claude-print.ts       # Claude Code output formatting
│   │   ├── scheduler/
│   │   │   ├── scheduler.ts          # Cron engine — evaluate schedules, trigger missions/campaigns
│   │   │   └── cron.ts               # Cron expression parsing + next-run calculation
│   │   ├── socket/
│   │   │   ├── server.ts             # Socket.IO setup + room management
│   │   │   ├── emit.ts              # Centralized status emitter — topology-aware room resolution
│   │   │   └── __tests__/
│   │   │       └── emit.test.ts
│   │   ├── telegram/
│   │   │   └── telegram.ts           # Telegram bot polling + notification delivery
│   │   ├── test/
│   │   │   ├── action-setup.ts       # Test setup for server action tests
│   │   │   ├── component-setup.ts    # Test setup for component tests
│   │   │   ├── db.ts                 # Test database utilities
│   │   │   ├── fixtures.ts           # Shared test fixture factories
│   │   │   ├── mock-db.ts            # Mock database for unit tests
│   │   │   ├── render.tsx            # Custom render with providers
│   │   │   └── setup.ts              # Global test setup
│   │   ├── config.ts
│   │   ├── system-metrics.ts         # System health metrics emitter (→ system:status room)
│   │   ├── utils.ts                  # ULID generation, time formatting, cn() helper
│   │   └── utils/
│   │       ├── debrief-parser.ts     # Parse debrief sections from mission output
│   │       ├── dependency-graph.ts   # Mission dependency graph utilities
│   │       └── __tests__/
│   │           ├── debrief-parser.test.ts
│   │           └── dependency-graph.test.ts
│   ├── actions/
│   │   ├── asset.ts                  # Server Actions for asset CRUD
│   │   ├── battlefield.ts            # Server Actions for battlefield CRUD + scaffold
│   │   ├── briefing.ts               # Server Actions for briefing session queries
│   │   ├── campaign.ts               # Server Actions for campaign CRUD + plan + launch
│   │   ├── console.ts                # Server Actions for quick commands + dev server
│   │   ├── discovery.ts              # Server Actions for skill discovery
│   │   ├── dossier.ts                # Server Actions for briefing template CRUD
│   │   ├── follow-up.ts             # Server Actions for follow-up suggestion CRUD
│   │   ├── general.ts                # Server Actions for GENERAL session CRUD + messaging
│   │   ├── git.ts                    # Server Actions for git operations
│   │   ├── intel.ts                  # Server Actions for intel board note CRUD
│   │   ├── logistics.ts              # Server Actions for token usage + cost tracking
│   │   ├── mission.ts                # Server Actions for mission CRUD + deploy + abort
│   │   ├── notification.ts           # Server Actions for notification CRUD + read status
│   │   ├── overseer.ts               # Server Actions for Overseer log queries
│   │   ├── schedule.ts               # Server Actions for scheduled task CRUD
│   │   └── __tests__/
│   │       ├── asset.test.ts
│   │       ├── battlefield.test.ts
│   │       ├── briefing.test.ts
│   │       ├── campaign.test.ts
│   │       ├── console.test.ts
│   │       ├── dossier.test.ts
│   │       ├── follow-up.test.ts
│   │       ├── general.test.ts
│   │       ├── git.test.ts
│   │       ├── intel.test.ts
│   │       ├── logistics.test.ts
│   │       ├── mission.test.ts
│   │       ├── notification.test.ts
│   │       ├── overseer.test.ts
│   │       └── schedule.test.ts
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
│   │   │   ├── global-nav.tsx        # Global nav — top: HQ (◉), GENERAL (◇); bottom: OVERSEER LOG (⚓), ASSETS (◎), LOGISTICS (◈)
│   │   │   ├── battlefield-selector.tsx # Battlefield dropdown selector
│   │   │   ├── intel-bar.tsx         # Top bar — rotating military quotes
│   │   │   ├── page-header.tsx       # Reusable page header (codename + section + title)
│   │   │   ├── page-wrapper.tsx      # Consistent page padding + title wrapper
│   │   │   ├── status-footer.tsx     # Bottom bar — system status + LAN warning
│   │   │   └── system-monitor.tsx    # System health metrics display
│   │   ├── dashboard/
│   │   │   ├── deploy-mission.tsx    # Quick deploy form (textarea + asset picker)
│   │   │   ├── dossier-selector.tsx  # Dossier template picker for deploy form
│   │   │   ├── stats-bar.tsx         # IN COMBAT | ACCOMPLISHED | COMPROMISED | STANDBY
│   │   │   ├── mission-list.tsx      # Searchable mission table
│   │   │   ├── activity-feed.tsx     # Real-time ops log
│   │   │   └── __tests__/
│   │   │       ├── activity-feed.test.tsx
│   │   │       ├── deploy-mission.test.tsx
│   │   │       ├── mission-list.test.tsx
│   │   │       └── stats-bar.test.tsx
│   │   ├── battlefield/
│   │   │   ├── create-battlefield.tsx # Create form with initial briefing textarea
│   │   │   ├── bootstrap-review.tsx  # Review generated CLAUDE.md + SPEC.md before commit
│   │   │   ├── bootstrap-comms.tsx   # Live log stream during bootstrap generation
│   │   │   ├── bootstrap-error.tsx   # Bootstrap failure display + retry
│   │   │   ├── scaffold-output.tsx   # Scaffold command output viewer
│   │   │   ├── scaffold-retry.tsx    # Scaffold failure retry UI
│   │   │   └── __tests__/
│   │   │       ├── bootstrap-comms.test.tsx
│   │   │       ├── bootstrap-error.test.tsx
│   │   │       ├── bootstrap-review.test.tsx
│   │   │       ├── create-battlefield.test.tsx
│   │   │       ├── scaffold-output.test.tsx
│   │   │       └── scaffold-retry.test.tsx
│   │   ├── board/
│   │   │   ├── intel-board.tsx       # Main intel board with drag-and-drop columns
│   │   │   ├── board-card.tsx        # Individual board card
│   │   │   ├── board-column.tsx      # Board column container
│   │   │   └── note-panel.tsx        # Note creation/editing panel
│   │   ├── mission/
│   │   │   ├── mission-comms.tsx     # Live terminal log stream
│   │   │   ├── mission-actions.tsx   # Continue / Redeploy / Abandon buttons
│   │   │   ├── live-status-badge.tsx # Real-time status badge via Socket.IO
│   │   │   ├── merge-countdown.tsx   # Merge retry countdown display
│   │   │   └── __tests__/
│   │   │       ├── live-status-badge.test.tsx
│   │   │       ├── mission-actions.test.tsx
│   │   │       └── mission-comms.test.tsx
│   │   ├── campaign/
│   │   │   ├── briefing-chat.tsx     # Interactive campaign planning chat with GENERAL
│   │   │   ├── campaign-controls.tsx # MISSION ACCOMPLISHED | REDEPLOY | ABANDON
│   │   │   ├── campaign-live-view.tsx # Real-time campaign progress viewer
│   │   │   ├── campaign-results.tsx  # Campaign completion metrics (cost, tokens, duration)
│   │   │   ├── mission-card.tsx      # Campaign-specific mission card
│   │   │   ├── mission-skill-panel.tsx # Per-mission skill override panel
│   │   │   ├── phase-timeline.tsx    # Phase container with nested mission cards
│   │   │   ├── plan-editor.tsx       # Editable plan viewer (reorder phases/missions)
│   │   │   ├── plan-editor/
│   │   │   │   ├── inline-edit.tsx         # Inline text editing component
│   │   │   │   ├── plan-editor-utils.ts    # Plan editor utility functions
│   │   │   │   ├── sortable-mission-item.tsx # Drag-sortable mission item
│   │   │   │   └── sortable-phase-item.tsx   # Drag-sortable phase item
│   │   │   └── __tests__/
│   │   │       ├── campaign-controls.test.tsx
│   │   │       ├── mission-card.test.tsx
│   │   │       ├── phase-timeline.test.tsx
│   │   │       ├── plan-editor-utils.test.ts
│   │   │       └── plan-editor.test.tsx
│   │   ├── asset/
│   │   │   ├── asset-list.tsx        # Right sidebar asset panel
│   │   │   ├── asset-deployment.tsx  # Asset deployment status/history
│   │   │   ├── asset-form.tsx        # Create/edit asset form
│   │   │   ├── asset-detail-tabs.tsx # Tabbed asset detail view (Profile, Prompt, Skills)
│   │   │   ├── asset-profile-tab.tsx # Asset profile information tab
│   │   │   ├── asset-prompt-tab.tsx  # Asset system prompt editor tab
│   │   │   ├── asset-skills-tab.tsx  # Asset skills configuration tab
│   │   │   ├── asset-status-toggle.tsx # Online/offline status toggle
│   │   │   └── skill-toggle-list.tsx # Toggleable skill list for asset config
│   │   ├── follow-up/
│   │   │   ├── follow-up-cards.tsx       # Follow-up suggestion cards (server)
│   │   │   └── follow-up-cards-live.tsx  # Follow-up cards with live updates (client)
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
│   │   ├── __tests__/
│   │   │   ├── activity-feed.test.tsx
│   │   │   └── battlefield-selector.test.tsx
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
│   │       ├── inline-error-panel.tsx # Inline error display panel
│   │       ├── responsive-table.tsx  # Responsive table wrapper
│   │       ├── modal.tsx
│   │       ├── button.tsx            # shadcn button (restyled)
│   │       ├── dialog.tsx            # shadcn dialog
│   │       ├── scroll-area.tsx       # shadcn scroll area
│   │       ├── select.tsx            # shadcn select
│   │       ├── tabs.tsx              # shadcn tabs
│   │       ├── tooltip.tsx           # shadcn tooltip
│   │       └── __tests__/
│   │           ├── inline-error-panel.test.tsx
│   │           ├── modal.test.tsx
│   │           ├── search-input.test.tsx
│   │           ├── tac-badge.test.tsx
│   │           ├── tac-button.test.tsx
│   │           ├── tac-card.test.tsx
│   │           ├── tac-input.test.tsx
│   │           ├── tac-select.test.tsx
│   │           └── tac-textarea-with-images.test.tsx
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
│   │   ├── use-streaming-chat.ts     # Generic streaming chat hook
│   │   ├── use-system-metrics.ts     # System health metrics subscription
│   │   └── __tests__/
│   │       ├── use-board.test.ts
│   │       ├── use-notifications.test.ts
│   │       └── use-socket.test.ts
│   └── types/
│       └── index.ts
├── e2e/
│   ├── smoke.spec.ts                 # Basic smoke tests
│   ├── battlefield.spec.ts           # Battlefield E2E tests
│   ├── mission.spec.ts               # Mission E2E tests
│   ├── campaign.spec.ts              # Campaign creation E2E tests
│   ├── campaign-execution.spec.ts    # Campaign execution E2E tests
│   ├── campaign-interactions.spec.ts # Campaign interaction E2E tests
│   ├── ui-components.spec.ts         # UI component E2E tests
│   ├── fixtures.ts                   # E2E test fixtures
│   └── helpers.ts                    # E2E test helpers
├── scripts/
│   ├── seed.ts                       # Seed default assets
│   ├── rerun-review.ts               # CLI script for re-running Overseer debrief review
│   ├── devroom-ctl.sh                # CLI control script (status, dev, prod, restart, logs)
│   ├── devroom-service.sh            # Service runner for launchd
│   ├── devroom-status.5s.sh          # xbar plugin — menu bar status indicator
│   └── com.devroom.app.plist         # launchd service definition
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
    ├── spec-overseer-and-comms.md
    ├── testing.md
    └── accessibility-audit.md
```
