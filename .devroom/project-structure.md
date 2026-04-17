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
│   │   │   │       └── page.tsx       # Asset detail — tabbed view (Profile, Prompt, Skills, Memory)
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
│   │   │           ├── deps/
│   │   │           │   └── page.tsx       # Dependency management (audit, install, outdated)
│   │   │           ├── env/
│   │   │           │   └── page.tsx       # Environment file editor (.env, .env.example)
│   │   │           ├── field-check/
│   │   │           │   ├── page.tsx       # Field check — repo vitals, branch hygiene, worktree board
│   │   │           │   └── loading.tsx
│   │   │           ├── schedule/
│   │   │           │   ├── page.tsx       # Scheduled tasks
│   │   │           │   └── loading.tsx
│   │   │           ├── telemetry/
│   │   │           │   ├── page.tsx       # Service health, resource usage, active processes
│   │   │           │   └── loading.tsx
│   │   │           ├── tests/
│   │   │           │   └── page.tsx       # Test runner — run suite, view history, inspect failures
│   │   │           └── config/
│   │   │               ├── page.tsx       # Battlefield configuration (tabbed)
│   │   │               └── loading.tsx
│   │   └── api/
│   │       ├── __tests__/
│   │       │   └── test-seed-guard.test.ts  # Guard test: seed routes must be no-ops outside test env
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
│   ├── control/                           # CONTROL supervisor module — mission execution engine
│   │   ├── control.ts                     # Core queue loop — picks up queued missions, dispatches runners
│   │   ├── mission-runner.ts              # Single mission lifecycle: worktree → spawn → gate → merge
│   │   ├── liveness.ts                    # Process liveness monitor (silence kills, timeouts)
│   │   ├── exit-classifier.ts             # Classify process exit codes into outcome categories
│   │   ├── retry-policy.ts                # Retry logic — attempt outcomes, backoff decisions
│   │   ├── gates.ts                       # Gate manifest runner (build, test, lint commands)
│   │   ├── merge.ts                       # Merge orchestration — rebase onto target, gate verification
│   │   ├── recon.ts                       # INTEL recon mission spawner (bootstrap-phase analysis)
│   │   ├── worktree.ts                    # Git worktree lifecycle — create, sanitize branch names, remove
│   │   ├── watchdog.ts                    # Sweep stale/orphaned missions and clean their worktrees
│   │   ├── comms.ts                       # Persist and emit comm events to the DB + Socket.IO
│   │   ├── config.ts                      # Load CONTROL runtime config (maxAgents, timeouts, etc.)
│   │   ├── prompt-builder.ts              # Pure prompt assemblers — no I/O, substitutes spec templates
│   │   ├── spawn-asset.ts                 # Real subprocess launcher wrapping the `claude` CLI
│   │   ├── production-deps.ts             # Wire concrete MissionRunnerDeps for the production server
│   │   ├── debrief/
│   │   │   ├── schema.ts                  # Debrief structured JSON schema + hand-rolled validation
│   │   │   ├── parse.ts                   # Extract and parse debrief block from raw mission output
│   │   │   └── synthesize.ts              # Compose a synthetic debrief from git diff when no block found
│   │   ├── assets/
│   │   │   ├── cli-builder.ts             # Build `claude` CLI args from asset profile (model, effort, skills)
│   │   │   └── prompts/
│   │   │       ├── combat/
│   │   │       │   ├── intel.md           # INTEL asset system prompt (recon / analysis specialist)
│   │   │       │   ├── operative.md       # OPERATIVE asset system prompt (backend / fullstack specialist)
│   │   │       │   └── vanguard.md        # VANGUARD asset system prompt (frontend specialist)
│   │   │       └── system/
│   │   │           ├── overseer.md        # OVERSEER system prompt (debrief review + verdict)
│   │   │           ├── quartermaster.md   # QUARTERMASTER system prompt (merge conflict resolution)
│   │   │           └── strategist.md      # STRATEGIST system prompt (campaign planning chat)
│   │   ├── bootstrap/
│   │   │   ├── bootstrap.ts               # Full bootstrap orchestration — detect → scaffold → verify → commit
│   │   │   ├── detect.ts                  # Auto-detect existing gate commands from repo files
│   │   │   ├── scaffold.ts                # Scaffold missing test infra via INTEL asset
│   │   │   ├── verify.ts                  # Verify detected/scaffolded gates pass on HEAD
│   │   │   └── frameworks.ts              # Curated framework table for bootstrap when no test gate found
│   │   ├── campaign/
│   │   │   ├── executor.ts                # Phase-by-phase campaign progression + dependency unblocking
│   │   │   ├── debrief.ts                 # Deterministic phase debrief composer (pure, no LLM)
│   │   │   └── dependency-graph.ts        # Mission dependency graph utilities (pure, no DB)
│   │   └── merge/
│   │       └── quartermaster.ts           # QUARTERMASTER conflict resolution subprocess spawn
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts              # DB connection singleton
│   │   │   ├── schema.ts             # Drizzle schema (17+ tables)
│   │   │   └── migrations/           # Auto-generated SQL migrations (0000–0028)
│   │   ├── general/
│   │   │   ├── general-engine.ts     # Spawn Claude Code for standalone GENERAL chat sessions
│   │   │   ├── general-prompt.ts     # System prompt builder with optional battlefield context
│   │   │   ├── general-commands.ts   # Command parser (/clear, /compact)
│   │   │   ├── asset-cli.ts          # Build CLI args per asset (skills, MCP servers, effort, max turns)
│   │   │   └── stream-parser.ts      # Parse Claude Code stream-json output for GENERAL sessions
│   │   ├── briefing/
│   │   │   ├── briefing-engine.ts    # Spawn Claude Code (STRATEGIST) for interactive campaign planning
│   │   │   ├── briefing-prompt.ts    # System prompt builder for STRATEGIST with campaign context
│   │   │   ├── asset-roster.ts       # Build asset roster summary for STRATEGIST context
│   │   │   └── briefing-contract.ts  # Single source of truth for STRATEGIST's planning JSON contract
│   │   ├── discovery/
│   │   │   ├── skill-scanner.ts      # Scan for Claude Code plugin skills
│   │   │   └── __tests__/
│   │   │       └── skill-scanner.test.ts
│   │   ├── notifications/
│   │   │   └── escalate.ts           # Central notification entry point — DB + Socket.IO + Telegram
│   │   ├── process/
│   │   │   ├── dev-server.ts         # Dev server lifecycle (start/stop/restart, port tracking)
│   │   │   ├── command-runner.ts     # Quick command execution + streaming output
│   │   │   └── claude-print.ts       # Claude Code output formatting
│   │   ├── scheduler/
│   │   │   ├── scheduler.ts          # Cron engine — evaluate schedules, trigger missions/campaigns
│   │   │   ├── cron.ts               # Cron expression parsing + next-run calculation
│   │   │   └── dossiers.ts           # Schedule task type constants and dossier helpers
│   │   ├── settings/
│   │   │   ├── rules-of-engagement.ts          # Load current ROE from DB settings
│   │   │   └── default-rules-of-engagement.ts  # Canonical v1 ROE text — seed + migration reference
│   │   ├── socket/
│   │   │   ├── server.ts             # Socket.IO setup + room management
│   │   │   ├── emit.ts               # Centralized status emitter — topology-aware room resolution
│   │   │   └── __tests__/
│   │   │       └── emit.test.ts
│   │   ├── telegram/
│   │   │   ├── telegram.ts           # Telegram bot polling + notification delivery
│   │   │   ├── bot.ts                # Bot instance and connection management
│   │   │   └── notifier.ts           # Notification formatter and send helpers
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
│   │       ├── cli.ts                # CLI arg utilities (filterFlag helper)
│   │       └── __tests__/
│   │           ├── debrief-parser.test.ts
│   │           └── dependency-graph.test.ts
│   ├── actions/
│   │   ├── _helpers.ts               # Shared Server Action helpers (auth checks, DB shortcuts)
│   │   ├── asset.ts                  # Server Actions for asset CRUD
│   │   ├── battlefield.ts            # Server Actions for battlefield CRUD + scaffold
│   │   ├── briefing.ts               # Server Actions for briefing session queries
│   │   ├── campaign.ts               # Server Actions for campaign CRUD + launch
│   │   ├── campaign-helpers.ts       # Internal helpers for campaign mutation actions
│   │   ├── campaign-overrides.ts     # Server Actions for per-mission campaign overrides
│   │   ├── campaign-plan.ts          # Server Actions for STRATEGIST plan generation + editing
│   │   ├── console.ts                # Server Actions for quick commands + dev server
│   │   ├── deps.ts                   # Server Actions for dependency management (detect, audit, install)
│   │   ├── discovery.ts              # Server Actions for skill discovery
│   │   ├── dossier.ts                # Server Actions for briefing template CRUD
│   │   ├── env.ts                    # Server Actions for .env file read/write
│   │   ├── field-check.ts            # Server Actions for repo vitals, branch hygiene, worktrees
│   │   ├── follow-up.ts              # Server Actions for follow-up suggestion CRUD
│   │   ├── general.ts                # Server Actions for GENERAL session CRUD + messaging
│   │   ├── git.ts                    # Server Actions for git operations
│   │   ├── intel.ts                  # Server Actions for intel board note CRUD
│   │   ├── logistics.ts              # Server Actions for token usage + cost tracking
│   │   ├── mission.ts                # Server Actions for mission CRUD + deploy + abort
│   │   ├── notification.ts           # Server Actions for notification CRUD + read status
│   │   ├── overseer.ts               # Server Actions for Overseer log queries
│   │   ├── schedule.ts               # Server Actions for scheduled task CRUD
│   │   ├── settings.ts               # Server Actions for settings CRUD (ROE, config)
│   │   ├── telemetry.ts              # Server Actions for service health + resource metrics
│   │   ├── tests.ts                  # Server Actions for test runner (detect, run, history)
│   │   └── __tests__/
│   │       ├── asset-memory.test.ts
│   │       ├── asset.test.ts
│   │       ├── battlefield.test.ts
│   │       ├── briefing.test.ts
│   │       ├── campaign.test.ts
│   │       ├── console.test.ts
│   │       ├── dossier.test.ts
│   │       ├── field-check.test.ts
│   │       ├── follow-up.test.ts
│   │       ├── general.test.ts
│   │       ├── intel.test.ts
│   │       ├── logistics.test.ts
│   │       ├── mission.test.ts
│   │       ├── notification.test.ts
│   │       ├── overseer.test.ts
│   │       ├── schedule.test.ts
│   │       ├── settings.test.ts
│   │       ├── telemetry.test.ts
│   │       └── tests.test.ts
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
│   │   │   ├── global-nav.tsx        # Global nav — HQ, GENERAL, OVERSEER LOG, ASSETS, LOGISTICS
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
│   │   │   ├── debrief-panel.tsx     # Structured debrief viewer (summary, changes, risks)
│   │   │   ├── mission-type-badge.tsx # Badge for mission type (standard, recon, campaign)
│   │   │   └── __tests__/
│   │   │       ├── live-status-badge.test.tsx
│   │   │       ├── mission-actions.test.tsx
│   │   │       └── mission-comms.test.tsx
│   │   ├── campaign/
│   │   │   ├── briefing-chat.tsx     # Interactive campaign planning chat with STRATEGIST
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
│   │   │   ├── asset-detail-tabs.tsx # Tabbed asset detail view (Profile, Prompt, Skills, Memory)
│   │   │   ├── asset-profile-tab.tsx # Asset profile information tab
│   │   │   ├── asset-prompt-tab.tsx  # Asset system prompt editor tab
│   │   │   ├── asset-skills-tab.tsx  # Asset skills configuration tab
│   │   │   ├── asset-memory-tab.tsx  # Asset memory viewer/editor tab
│   │   │   ├── asset-status-toggle.tsx # Online/offline status toggle
│   │   │   └── skill-toggle-list.tsx # Toggleable skill list for asset config
│   │   ├── config/
│   │   │   ├── config-form.tsx       # Battlefield configuration form
│   │   │   ├── config-tabs.tsx       # Tabbed config layout (profile, gates, main branch, forensics)
│   │   │   ├── ForensicPruneForm.tsx # Forensic log pruning form
│   │   │   ├── GateManifestEditor.tsx # Gate manifest (build/test/lint) editor
│   │   │   ├── MainRedOverrideToggle.tsx # Toggle to override main branch merge protection
│   │   │   └── __tests__/
│   │   │       ├── ForensicPruneForm.test.tsx
│   │   │       ├── GateManifestEditor.test.tsx
│   │   │       └── MainRedOverrideToggle.test.tsx
│   │   ├── deps/
│   │   │   ├── deps-audit.tsx        # Dependency audit results display
│   │   │   ├── deps-install-form.tsx # Install/upgrade dependency form
│   │   │   ├── deps-output.tsx       # Streaming install command output
│   │   │   └── deps-table.tsx        # Installed dependencies table with outdated indicators
│   │   ├── env/
│   │   │   ├── env-editor.tsx        # Main environment file editor
│   │   │   ├── env-variable-row.tsx  # Single env var row (key + value + actions)
│   │   │   ├── create-env-file.tsx   # Create new .env file form
│   │   │   └── create-from-example.tsx # Bootstrap .env from .env.example
│   │   ├── field-check/
│   │   │   ├── repo-vitals.tsx       # Repo health vitals (uncommitted files, HEAD status)
│   │   │   ├── branch-hygiene.tsx    # Branch hygiene report (stale branches, merge status)
│   │   │   ├── worktree-board.tsx    # Active worktree board (per-mission worktree status)
│   │   │   └── quartermaster-log.tsx # Recent Quartermaster merge/conflict log
│   │   ├── follow-up/
│   │   │   ├── follow-up-cards.tsx       # Follow-up suggestion cards (server)
│   │   │   └── follow-up-cards-live.tsx  # Follow-up cards with live updates (client)
│   │   ├── settings/
│   │   │   └── rules-of-engagement-editor.tsx # Live editor for the shared Rules of Engagement
│   │   ├── telemetry/
│   │   │   ├── active-processes.tsx  # Live active Claude Code process list with abort controls
│   │   │   ├── resource-usage.tsx    # CPU, memory, disk usage display
│   │   │   └── service-health.tsx    # DEVROOM service health status panel
│   │   ├── tests/
│   │   │   ├── test-runner.tsx       # Test suite runner UI (trigger runs, stream output)
│   │   │   ├── test-results.tsx      # Test results overview (pass/fail counts)
│   │   │   ├── test-suite-card.tsx   # Individual test suite card
│   │   │   ├── test-summary.tsx      # Aggregate test run summary
│   │   │   ├── test-output.tsx       # Raw test output terminal viewer
│   │   │   ├── test-history.tsx      # Historical test run list
│   │   │   └── test-failure-detail.tsx # Detailed failure breakdown for a test run
│   │   ├── git/
│   │   │   ├── git-status.tsx        # Working tree status (modified, staged, untracked)
│   │   │   ├── git-log.tsx           # Commit history with branch graph
│   │   │   ├── git-branches.tsx      # Branch list + checkout
│   │   │   └── git-diff.tsx          # File diff viewer
│   │   ├── console/
│   │   │   ├── dev-server-panel.tsx  # Start/stop/restart + port + log stream
│   │   │   ├── quick-commands.tsx    # Predefined command buttons + custom input
│   │   │   └── command-output.tsx    # Streaming command output terminal
│   │   ├── schedule/
│   │   │   ├── schedule-list.tsx     # List of scheduled tasks
│   │   │   └── schedule-form.tsx     # Create/edit scheduled task
│   │   ├── warroom/
│   │   │   ├── boot-gate.tsx         # First-visit boot animation gate
│   │   │   └── boot-sequence.tsx     # Tactical boot animation sequence
│   │   ├── providers/
│   │   │   ├── socket-provider.tsx   # Socket.IO context provider
│   │   │   ├── toast-provider.tsx    # Toast notification provider (sonner)
│   │   │   └── activity-toasts.tsx   # Real-time activity toast subscriber
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
│   │           ├── tac-textarea-with-images.test.tsx
│   │           └── terminal.test.tsx
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
│   │   ├── use-deps-output.ts        # Streaming dependency install output via Socket.IO
│   │   ├── use-test-output.ts        # Streaming test runner output via Socket.IO
│   │   └── __tests__/
│   │       ├── use-board.test.ts
│   │       ├── use-notifications.test.ts
│   │       └── use-socket.test.ts
│   └── types/
│       ├── index.ts                  # Re-exports all types
│       ├── models.ts                 # Core DB model types (Battlefield, Mission, Campaign, etc.)
│       ├── actions.ts                # Server Action return types
│       ├── asset.ts                  # Asset and skill types
│       ├── campaign.ts               # Campaign, phase, and plan types
│       ├── command.ts                # Quick command types
│       ├── deps.ts                   # Dependency management types
│       ├── env.ts                    # Environment file types
│       ├── field-check.ts            # Field check / repo vitals types
│       ├── orchestrator.ts           # Mission runner and orchestration types
│       ├── status.ts                 # Status enum types (mission, campaign, battlefield)
│       ├── system.ts                 # System metrics and service health types
│       ├── telemetry.ts              # Telemetry and resource usage types
│       ├── test-runner.ts            # Test runner result types
│       └── ui.ts                     # Shared UI component types
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
│   ├── devroom-ctl.sh                # CLI control script (status, dev, prod, restart, logs)
│   ├── devroom-service.sh            # Service runner for launchd
│   ├── devroom-status.5s.sh          # xbar plugin — menu bar status indicator
│   ├── devroom-xbar-run.sh           # xbar run helper for menu bar plugin
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
