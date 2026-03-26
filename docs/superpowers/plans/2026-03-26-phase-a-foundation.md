# Phase A: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the DEVROOM infrastructure — database, custom server, Socket.IO, tactical theme, layout shell, and initial pages — so Phase B can build on a working foundation.

**Architecture:** Next.js 16.2 App Router with custom `server.ts` (HTTP + Socket.IO). SQLite via better-sqlite3 + Drizzle ORM for persistence. Tailwind CSS with Ghost Ops V2 tactical theme. shadcn/ui for accessible primitives, restyled with custom tokens.

**Tech Stack:** Next.js 16.2, TypeScript strict, Tailwind CSS, shadcn/ui, better-sqlite3, Drizzle ORM, Socket.IO, pnpm

**Spec:** `docs/superpowers/specs/2026-03-26-phase-a-foundation-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Project Scaffold:**
- `package.json` (modified by create-next-app, then customized)
- `next.config.ts` (modified)
- `tsconfig.json` (modified)
- `tailwind.config.ts` (modified)
- `.env.local`
- `.gitignore` (modified — add `.superpowers/`, `devroom.db`)
- `drizzle.config.ts`
- `server.ts`

**Task 2 — Database & Types:**
- `src/lib/db/schema.ts`
- `src/lib/db/index.ts`
- `src/lib/config.ts`
- `src/lib/utils.ts` (extend shadcn-generated file)
- `src/types/index.ts`

**Task 3 — Seed Script:**
- `scripts/seed.ts`

**Task 4 — Custom Server & Socket.IO:**
- `server.ts` (full implementation)
- `src/lib/socket/server.ts`
- `src/components/providers/socket-provider.tsx`
- `src/hooks/use-socket.ts`
- `scripts/seed.ts` (modified — refactored to export `seedIfEmpty`)

**Task 5 — Tailwind Theme & Fonts:**
- `tailwind.config.ts` (full theme)
- `src/app/layout.tsx` (fonts + global styles)
- `src/app/globals.css` (modified)

**Task 6 — Tactical UI Components:**
- `src/components/ui/tac-button.tsx`
- `src/components/ui/tac-input.tsx`
- `src/components/ui/tac-card.tsx`
- `src/components/ui/tac-badge.tsx`
- `src/components/ui/tac-select.tsx`
- `src/components/ui/search-input.tsx`
- `src/components/ui/terminal.tsx`
- `src/components/ui/modal.tsx`

**Task 7 — Layout Shell:**
- `src/components/layout/app-shell.tsx`
- `src/components/layout/intel-bar.tsx`
- `src/components/layout/sidebar.tsx`
- `src/components/layout/status-footer.tsx`

**Task 8 — Pages & Routing:**
- `src/app/page.tsx`
- `src/app/loading.tsx`
- `src/app/error.tsx`
- `src/app/projects/page.tsx`
- `src/app/projects/[id]/layout.tsx`
- `src/app/projects/[id]/page.tsx`
- `src/app/projects/[id]/loading.tsx`
- `src/app/projects/[id]/assets/page.tsx`
- `src/app/projects/[id]/missions/[missionId]/page.tsx`
- `src/app/projects/[id]/campaigns/page.tsx`
- `src/app/projects/[id]/campaigns/[campaignId]/page.tsx`
- `src/app/projects/[id]/git/page.tsx`
- `src/app/projects/[id]/console/page.tsx`
- `src/app/projects/[id]/schedule/page.tsx`
- `src/app/projects/[id]/config/page.tsx`

**Task 9 — Integration Test & Polish:**
- Verification across all routes
- Final commit

---

## Task 1: Project Scaffold

**Files:**
- Create: `.env.local`, `drizzle.config.ts`
- Modify: `package.json`, `next.config.ts`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Scaffold Next.js project**

Run in the project directory (which already has `CLAUDE.md`, `SPEC.md`, `docs/`, `.git`):

```bash
pnpm create next-app@latest . --typescript --tailwind --app --src-dir --turbopack --yes
```

If it errors on non-empty directory, scaffold into a temp dir and copy files:
```bash
cd /tmp && pnpm create next-app@latest devroom-scaffold --typescript --tailwind --app --src-dir --turbopack --yes
cp -r /tmp/devroom-scaffold/* /Users/nyhzdev/dev/nyhzops-devroom/
cp /tmp/devroom-scaffold/.eslintrc* /Users/nyhzdev/dev/nyhzops-devroom/ 2>/dev/null || true
rm -rf /tmp/devroom-scaffold
```

- [ ] **Step 2: Install runtime dependencies**

```bash
pnpm add better-sqlite3 drizzle-orm socket.io socket.io-client simple-git ulid dotenv
```

- [ ] **Step 3: Install dev dependencies**

```bash
pnpm add -D drizzle-kit tsx @types/better-sqlite3 vitest @types/node
```

- [ ] **Step 4: Update package.json scripts**

Replace the `scripts` section:
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

- [ ] **Step 5: Update next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  images: {
    dangerouslyAllowLocalIP: true,
  },
};

export default nextConfig;
```

- [ ] **Step 6: Create .env.local**

```
DEVROOM_PORT=7777
DEVROOM_HOST=0.0.0.0
DEVROOM_DB_PATH=./devroom.db
DEVROOM_DEV_BASE_PATH=/dev
DEVROOM_LOG_LEVEL=info
DEVROOM_MAX_AGENTS=5
DEVROOM_CLAUDE_PATH=claude
DEVROOM_LOG_RETENTION_DAYS=30
```

- [ ] **Step 7: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dbCredentials: {
    url: process.env.DEVROOM_DB_PATH || './devroom.db',
  },
});
```

- [ ] **Step 8: Update .gitignore**

Append to existing `.gitignore`:
```
# DEVROOM
devroom.db
devroom.db-wal
devroom.db-shm
.superpowers/
```

- [ ] **Step 9: Initialize shadcn**

```bash
pnpm dlx shadcn@latest init
```

Select: New York style, Slate base color, CSS variables enabled. Then override the generated config to use `dr-*` tokens and no border-radius.

- [ ] **Step 10: Install shadcn components**

```bash
pnpm dlx shadcn@latest add dialog dropdown-menu select tooltip tabs scroll-area popover
```

- [ ] **Step 11: Verify scaffold builds**

```bash
pnpm build
```

Expected: Build succeeds.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 16.2 project with dependencies"
```

---

## Task 2: Database Schema, Config & Types

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/config.ts`, `src/types/index.ts`
- Modify: `src/lib/utils.ts`

- [ ] **Step 1: Create config module**

Create `src/lib/config.ts`:

```typescript
export interface DevRoomConfig {
  port: number;
  host: string;
  dbPath: string;
  devBasePath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxAgents: number;
  claudePath: string;
  logRetentionDays: number;
}

function loadConfig(): DevRoomConfig {
  return {
    port: parseInt(process.env.DEVROOM_PORT || '7777', 10),
    host: process.env.DEVROOM_HOST || '0.0.0.0',
    dbPath: process.env.DEVROOM_DB_PATH || './devroom.db',
    devBasePath: process.env.DEVROOM_DEV_BASE_PATH || '/dev',
    logLevel: (process.env.DEVROOM_LOG_LEVEL as DevRoomConfig['logLevel']) || 'info',
    maxAgents: parseInt(process.env.DEVROOM_MAX_AGENTS || '5', 10),
    claudePath: process.env.DEVROOM_CLAUDE_PATH || 'claude',
    logRetentionDays: parseInt(process.env.DEVROOM_LOG_RETENTION_DAYS || '30', 10),
  };
}

export const config = loadConfig();
```

- [ ] **Step 2: Create Drizzle schema**

Create `src/lib/db/schema.ts` with all 7 tables:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const battlefields = sqliteTable('battlefields', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  codename: text('codename').notNull(),
  description: text('description'),
  initialBriefing: text('initial_briefing'),
  repoPath: text('repo_path').notNull(),
  defaultBranch: text('default_branch').default('main'),
  claudeMdPath: text('claude_md_path'),
  specMdPath: text('spec_md_path'),
  scaffoldCommand: text('scaffold_command'),
  devServerCommand: text('dev_server_command').default('npm run dev'),
  autoStartDevServer: integer('auto_start_dev_server').default(0),
  status: text('status').default('initializing'),
  bootstrapMissionId: text('bootstrap_mission_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const missions = sqliteTable('missions', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  phaseId: text('phase_id').references(() => phases.id),
  type: text('type').default('standard'),
  title: text('title').notNull(),
  briefing: text('briefing').notNull(),
  status: text('status').default('standby'),
  priority: text('priority').default('normal'),
  assetId: text('asset_id').references(() => assets.id),
  useWorktree: integer('use_worktree').default(0),
  worktreeBranch: text('worktree_branch'),
  sessionId: text('session_id'),
  debrief: text('debrief'),
  iterations: integer('iterations').default(0),
  costInput: integer('cost_input').default(0),
  costOutput: integer('cost_output').default(0),
  costCacheHit: integer('cost_cache_hit').default(0),
  durationMs: integer('duration_ms').default(0),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  status: text('status').default('draft'),
  worktreeMode: text('worktree_mode').default('phase'),
  currentPhase: integer('current_phase').default(0),
  isTemplate: integer('is_template').default(0),
  templateId: text('template_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const phases = sqliteTable('phases', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  phaseNumber: integer('phase_number').notNull(),
  name: text('name').notNull(),
  objective: text('objective'),
  status: text('status').default('standby'),
  debrief: text('debrief'),
  totalTokens: integer('total_tokens').default(0),
  durationMs: integer('duration_ms').default(0),
  createdAt: integer('created_at').notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  codename: text('codename').notNull().unique(),
  specialty: text('specialty').notNull(),
  systemPrompt: text('system_prompt'),
  model: text('model').default('claude-sonnet-4-6'),
  status: text('status').default('active'),
  missionsCompleted: integer('missions_completed').default(0),
  createdAt: integer('created_at').notNull(),
});

export const missionLogs = sqliteTable('mission_logs', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  timestamp: integer('timestamp').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
});

export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  cron: text('cron').notNull(),
  enabled: integer('enabled').default(1),
  missionTemplate: text('mission_template'),
  campaignId: text('campaign_id').references(() => campaigns.id),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at'),
  runCount: integer('run_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const commandLogs = sqliteTable('command_logs', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  command: text('command').notNull(),
  exitCode: integer('exit_code'),
  durationMs: integer('duration_ms').default(0),
  output: text('output'),
  createdAt: integer('created_at').notNull(),
});
```

- [ ] **Step 3: Create DB connection singleton**

Create `src/lib/db/index.ts`:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '@/lib/config';
import * as schema from './schema';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabase() {
  if (!_db) {
    sqlite = new Database(config.dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export function runMigrations() {
  const db = getDatabase();
  migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
}

export function closeDatabase() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    _db = null;
  }
}

export type DB = ReturnType<typeof getDatabase>;
```

- [ ] **Step 4: Create types file**

Create `src/types/index.ts`:

```typescript
import type { InferSelectModel } from 'drizzle-orm';
import type {
  battlefields, missions, campaigns, phases,
  assets, missionLogs, scheduledTasks, commandLogs,
} from '@/lib/db/schema';

// Status union types
export type BattlefieldStatus = 'initializing' | 'active' | 'archived';
export type MissionStatus = 'standby' | 'queued' | 'deploying' | 'in_combat' | 'accomplished' | 'compromised' | 'abandoned';
export type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'accomplished' | 'compromised';
export type PhaseStatus = 'standby' | 'active' | 'secured' | 'compromised';
export type AssetStatus = 'active' | 'offline';
export type MissionType = 'standard' | 'bootstrap' | 'conflict_resolution' | 'phase_debrief';
export type MissionPriority = 'low' | 'normal' | 'high' | 'critical';
export type WorktreeMode = 'none' | 'phase' | 'mission';
export type LogType = 'log' | 'status' | 'error';
export type ScheduleType = 'mission' | 'campaign';

// Row types inferred from Drizzle schema
export type Battlefield = InferSelectModel<typeof battlefields>;
export type Mission = InferSelectModel<typeof missions>;
export type Campaign = InferSelectModel<typeof campaigns>;
export type Phase = InferSelectModel<typeof phases>;
export type Asset = InferSelectModel<typeof assets>;
export type MissionLog = InferSelectModel<typeof missionLogs>;
export type ScheduledTask = InferSelectModel<typeof scheduledTasks>;
export type CommandLog = InferSelectModel<typeof commandLogs>;
```

- [ ] **Step 5: Extend utils.ts**

The shadcn init created `src/lib/utils.ts` with `cn()`. Add the DEVROOM utilities:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ulid } from 'ulid';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return ulid();
}

export function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  const remainingSecs = seconds % 60;

  if (hours > 0) return `${hours}h ${remainingMins}m`;
  if (minutes > 0) return `${minutes}m ${remainingSecs}s`;
  return `${seconds}s`;
}

export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

- [ ] **Step 6: Generate initial migration**

```bash
pnpm db:generate
```

Expected: Migration files created in `src/lib/db/migrations/`.

- [ ] **Step 7: Verify migration applies**

Write a quick smoke test — create a temporary script or use the DB module directly to confirm the migration runs and tables exist.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/ src/lib/config.ts src/lib/utils.ts src/types/ drizzle.config.ts
git commit -m "feat: add database schema, config, types, and utilities"
```

---

## Task 3: Seed Script

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 1: Create seed script**

Create `scripts/seed.ts`:

```typescript
import { ulid } from 'ulid';
import { assets, battlefields } from '../src/lib/db/schema';
import { count } from 'drizzle-orm';
import { getDatabase, closeDatabase } from '../src/lib/db/index';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ASSETS = [
  {
    codename: 'ARCHITECT',
    specialty: 'general',
    systemPrompt: 'You are ARCHITECT, a full-stack generalist agent. You follow project conventions strictly, write clean and maintainable code, and ensure all changes are well-tested. You handle any task that doesn\'t require a specialist.',
  },
  {
    codename: 'ASSERT',
    specialty: 'testing',
    systemPrompt: 'You are ASSERT, a QA and testing specialist. You write comprehensive tests, identify edge cases, improve test coverage, and ensure code reliability. You advocate for testability in all code you review.',
  },
  {
    codename: 'CANVAS',
    specialty: 'frontend',
    systemPrompt: 'You are CANVAS, a frontend specialist. You build responsive, accessible UI components with meticulous attention to styling, layout, and user experience. You follow the project\'s design system precisely.',
  },
  {
    codename: 'CRITIC',
    specialty: 'review',
    systemPrompt: 'You are CRITIC, a code review specialist. You identify bugs, anti-patterns, security issues, and improvement opportunities. You provide actionable, specific feedback with code examples.',
  },
  {
    codename: 'DISTILL',
    specialty: 'docs',
    systemPrompt: 'You are DISTILL, a documentation specialist. You write clear, comprehensive documentation including API docs, guides, architecture decisions, and inline comments where code isn\'t self-evident.',
  },
  {
    codename: 'GOPHER',
    specialty: 'backend',
    systemPrompt: 'You are GOPHER, a backend specialist. You design and implement APIs, database operations, business logic, and server-side infrastructure. You prioritize correctness, performance, and error handling.',
  },
  {
    codename: 'REBASE',
    specialty: 'devops',
    systemPrompt: 'You are REBASE, a DevOps and infrastructure specialist. You handle CI/CD pipelines, database migrations, deployment configurations, and build tooling. You ensure smooth, repeatable deployments.',
  },
  {
    codename: 'SCANNER',
    specialty: 'security',
    systemPrompt: 'You are SCANNER, a security specialist. You audit code for vulnerabilities, implement security best practices, review authentication and authorization flows, and harden system defenses.',
  },
];

export function seedIfEmpty() {
  const db = getDatabase();
  const now = Date.now();

  // Seed assets if table is empty
  const [assetCount] = db.select({ value: count() }).from(assets).all();
  if (assetCount.value === 0) {
    console.log('[DEVROOM] Seeding default assets...');
    for (const asset of DEFAULT_ASSETS) {
      db.insert(assets).values({
        id: ulid(),
        codename: asset.codename,
        specialty: asset.specialty,
        systemPrompt: asset.systemPrompt,
        model: 'claude-sonnet-4-6',
        status: 'active',
        missionsCompleted: 0,
        createdAt: now,
      }).run();
    }
    console.log(`[DEVROOM]   Seeded ${DEFAULT_ASSETS.length} assets.`);
  }

  // Seed sample battlefield if table is empty
  const [bfCount] = db.select({ value: count() }).from(battlefields).all();
  if (bfCount.value === 0) {
    console.log('[DEVROOM] Seeding sample battlefield...');
    const projectDir = path.resolve(__dirname, '..');
    db.insert(battlefields).values({
      id: ulid(),
      name: 'DEVROOM Self',
      codename: 'OPERATION BOOTSTRAP',
      description: 'The DEVROOM project itself',
      repoPath: projectDir,
      defaultBranch: 'main',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();
    console.log('[DEVROOM]   Seeded sample battlefield.');
  }
}

// When run directly as a script (not imported by server.ts)
const isDirectRun = process.argv[1]?.includes('seed');
if (isDirectRun) {
  seedIfEmpty();
  closeDatabase();
  console.log('Seed complete.');
}
```

- [ ] **Step 2: Run seed to verify**

First run the migration, then the seed:
```bash
pnpm db:migrate && pnpm seed
```

Expected output:
```
Seeding default assets...
  Seeded 8 assets.
Seeding sample battlefield...
  Seeded sample battlefield.
Seed complete.
```

- [ ] **Step 3: Run seed again to verify idempotency**

```bash
pnpm seed
```

Expected: "Assets table already has 8 rows, skipping." + "Battlefields table already has 1 rows, skipping."

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat: add seed script with default assets and sample battlefield"
```

---

## Task 4: Custom Server & Socket.IO

**Files:**
- Create: `server.ts`, `src/lib/socket/server.ts`, `src/components/providers/socket-provider.tsx`, `src/hooks/use-socket.ts`

- [ ] **Step 1: Create Socket.IO server setup**

Create `src/lib/socket/server.ts`:

```typescript
import { Server as SocketIOServer } from 'socket.io';

export function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('mission:subscribe', (id: string) => {
      socket.join(`mission:${id}`);
    });

    socket.on('mission:unsubscribe', (id: string) => {
      socket.leave(`mission:${id}`);
    });

    socket.on('hq:subscribe', () => {
      socket.join('hq:activity');
    });

    socket.on('devserver:subscribe', (battlefieldId: string) => {
      socket.join(`devserver:${battlefieldId}`);
    });

    socket.on('console:subscribe', (battlefieldId: string) => {
      socket.join(`console:${battlefieldId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
```

- [ ] **Step 2: Create server.ts**

Create `server.ts` in project root:

```typescript
import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import os from 'os';
import { getDatabase, runMigrations, closeDatabase } from './src/lib/db/index';
import { setupSocketIO } from './src/lib/socket/server';
import { config } from './src/lib/config';

// Typed globalThis for Socket.IO access
declare global {
  var io: SocketIOServer | undefined;
}

const dev = process.env.NODE_ENV !== 'production';

async function start() {
  // 1. Database setup
  console.log('[DEVROOM] Initializing database...');
  getDatabase();
  runMigrations();

  // 2. Seed if needed (dynamic import to avoid bundling issues)
  const { seedIfEmpty } = await import('./scripts/seed');
  seedIfEmpty();

  // 3. Prepare Next.js
  const app = next({ dev, turbopack: true });
  const handle = app.getRequestHandler();
  await app.prepare();

  // 4. Create HTTP server
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  // 5. Attach Socket.IO
  const io = new SocketIOServer(httpServer, { path: '/socket.io' });
  globalThis.io = io;
  setupSocketIO(io);

  // 6. Detect local IP
  const localIP = getLocalIP();

  // 7. Start listening
  httpServer.listen(config.port, config.host, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  NYHZ OPS — DEVROOM');
    console.log('  Status:  OPERATIONAL');
    console.log(`  Local:   http://localhost:${config.port}`);
    console.log(`  Network: http://${localIP}:${config.port}`);
    console.log(`  Agents:  0/${config.maxAgents} deployed`);
    console.log('═══════════════════════════════════════════');
    console.log('');
  });

  // 8. Graceful shutdown
  const shutdown = () => {
    console.log('\n[DEVROOM] STANDING DOWN...');
    httpServer.close(() => {
      io.close(() => {
        closeDatabase();
        console.log('[DEVROOM] All systems offline. Goodbye, Commander.');
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

start().catch((err) => {
  console.error('[DEVROOM] Fatal startup error:', err);
  process.exit(1);
});
```

**Note:** The server dynamically imports `seedIfEmpty` from `scripts/seed.ts`, which exports it as a named function. The module-level code at the bottom guards itself with `process.argv[1]?.includes('seed')` — so `seedIfEmpty()` and `closeDatabase()` only run when the script is executed directly via `pnpm seed`, not when imported by `server.ts`.

- [ ] **Step 3: Create Socket.IO client provider**

Create `src/components/providers/socket-provider.tsx`:

```typescript
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io as ioClient, type Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const sock = ioClient({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
    });

    sock.on('connect', () => {
      console.log('[Socket.IO] Connected:', sock.id);
    });

    sock.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected');
    });

    setSocket(sock);

    return () => {
      sock.disconnect();
    };
  }, []);

  return (
    <SocketContext value={socket}>
      {children}
    </SocketContext>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
```

- [ ] **Step 4: Create useSocket hook**

Create `src/hooks/use-socket.ts`:

```typescript
'use client';

import { useSocketContext } from '@/components/providers/socket-provider';

export function useSocket() {
  return useSocketContext();
}
```

- [ ] **Step 5: Test server starts**

```bash
pnpm dev
```

Expected: Startup banner appears, server runs on port 7777, no errors.

- [ ] **Step 6: Commit**

```bash
git add server.ts scripts/seed.ts src/lib/socket/ src/components/providers/ src/hooks/
git commit -m "feat: add custom server with Socket.IO and client provider"
```

---

## Task 5: Tailwind Theme & Fonts

**Files:**
- Modify: `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`

- [ ] **Step 1: Update tailwind.config.ts with Ghost Ops V2 theme**

Replace the theme extension with the full tactical theme from the spec:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
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
        },
      },
      fontFamily: {
        tactical: ['var(--font-tactical)', 'monospace'],
        mono:     ['var(--font-mono)', 'monospace'],
        data:     ['var(--font-data)', 'monospace'],
      },
      boxShadow: {
        'glow-green': '0 0 10px rgba(0, 255, 65, 0.3)',
        'glow-amber': '0 0 10px rgba(255, 191, 0, 0.3)',
        'glow-red':   '0 0 10px rgba(255, 51, 51, 0.3)',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Update globals.css**

Replace the default Tailwind globals with minimal tactical base:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    border-radius: 0 !important;
  }

  body {
    @apply bg-dr-bg text-dr-text font-tactical antialiased;
  }

  ::selection {
    @apply bg-dr-green/20 text-dr-green;
  }

  /* Scrollbar styling */
  ::-webkit-scrollbar {
    @apply w-2;
  }
  ::-webkit-scrollbar-track {
    @apply bg-dr-bg;
  }
  ::-webkit-scrollbar-thumb {
    @apply bg-dr-border hover:bg-dr-dim;
  }
}
```

- [ ] **Step 3: Update root layout.tsx with fonts**

```typescript
import type { Metadata } from 'next';
import { Share_Tech_Mono, IBM_Plex_Mono, Courier_Prime } from 'next/font/google';
import { SocketProvider } from '@/components/providers/socket-provider';
import './globals.css';

const shareTechMono = Share_Tech_Mono({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-tactical',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-mono',
});

const courierPrime = Courier_Prime({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-data',
});

export const metadata: Metadata = {
  title: 'NYHZ OPS — DEVROOM',
  description: 'Agent Orchestrator — Tactical Operations Center',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${shareTechMono.variable} ${ibmPlexMono.variable} ${courierPrime.variable}`}>
      <body>
        <SocketProvider>
          {children}
        </SocketProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify theme renders**

```bash
pnpm dev
```

Open http://localhost:7777. Expected: Dark background (`#0a0a0c`), monospace text, no default Next.js styling.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts src/app/globals.css src/app/layout.tsx
git commit -m "feat: add Ghost Ops V2 tactical theme with custom fonts"
```

---

## Task 6: Tactical UI Components

**Files:**
- Create: `src/components/ui/tac-button.tsx`, `tac-input.tsx`, `tac-card.tsx`, `tac-badge.tsx`, `tac-select.tsx`, `search-input.tsx`, `terminal.tsx`, `modal.tsx`

- [ ] **Step 1: Create tac-button**

Create `src/components/ui/tac-button.tsx`:

```typescript
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface TacButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles = {
  primary: 'border-dr-amber text-dr-amber hover:bg-dr-amber/10 hover:shadow-glow-amber',
  success: 'border-dr-green text-dr-green hover:bg-dr-green/10 hover:shadow-glow-green',
  danger: 'border-dr-red text-dr-red hover:bg-dr-red/10 hover:shadow-glow-red',
  ghost: 'border-dr-border text-dr-muted hover:text-dr-text hover:border-dr-dim',
};

const sizeStyles = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-sm',
};

export const TacButton = forwardRef<HTMLButtonElement, TacButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'border font-tactical uppercase tracking-wider transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  ),
);
TacButton.displayName = 'TacButton';
```

- [ ] **Step 2: Create tac-input**

Create `src/components/ui/tac-input.tsx` with `TacInput` and `TacTextarea` components. Dark bg, dr-border, amber focus ring, monospace.

- [ ] **Step 3: Create tac-card**

Create `src/components/ui/tac-card.tsx` with optional `status` prop for left border color (green/amber/red/blue). `dr-surface` bg, `dr-border` border.

- [ ] **Step 4: Create tac-badge**

Create `src/components/ui/tac-badge.tsx` with status-to-color mapping. Renders `● STATUS_TEXT` with appropriate color and optional glow.

- [ ] **Step 5: Create tac-select**

Create `src/components/ui/tac-select.tsx` wrapping shadcn Select with tactical styling. Dark bg, dr-border, amber focus.

- [ ] **Step 6: Create search-input**

Create `src/components/ui/search-input.tsx`. Input with search icon, monospace placeholder, dim border.

- [ ] **Step 7: Create terminal**

Create `src/components/ui/terminal.tsx`. Client Component. Monospace log viewer with auto-scroll, timestamps, color-coded log types (log=dim, status=green, error=red). Uses shadcn ScrollArea.

- [ ] **Step 8: Create modal**

Create `src/components/ui/modal.tsx` wrapping shadcn Dialog. `dr-surface` bg, `dr-border`, amber title.

- [ ] **Step 9: Verify all components import cleanly**

Create a temporary test page that renders each component. Verify no import errors, styles apply.

- [ ] **Step 10: Commit**

```bash
git add src/components/ui/
git commit -m "feat: add tactical UI component library"
```

---

## Task 7: Layout Shell

**Files:**
- Create: `src/components/layout/app-shell.tsx`, `intel-bar.tsx`, `sidebar.tsx`, `status-footer.tsx`

- [ ] **Step 1: Create status-footer**

Create `src/components/layout/status-footer.tsx` (Server Component):

```typescript
export function StatusFooter() {
  return (
    <footer className="bg-dr-surface border-t border-dr-border px-4 py-1.5 flex items-center gap-2">
      <span className="text-dr-green text-[8px]">●</span>
      <span className="text-dr-dim text-xs tracking-wide">
        LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK
      </span>
    </footer>
  );
}
```

- [ ] **Step 2: Create intel-bar**

Create `src/components/layout/intel-bar.tsx` (Client Component). Rotating quotes array, 60s interval with fade transition via CSS opacity + transition.

- [ ] **Step 3: Create sidebar**

Create `src/components/layout/sidebar.tsx`. This is a **Server Component** that:
- Reads battlefields from DB for the selector dropdown
- Reads asset counts, mission counts from DB for badges
- Renders brand block, passes data to client sub-components for interactivity

Extract two Client Components:
1. `<BattlefieldSelector />` — receives battlefield list as props, uses `useRouter().push()` on change
2. `<SidebarNav />` — receives the nav items + counts as props, uses `usePathname()` to determine active link and highlight it with `bg-dr-elevated` + amber text

The sidebar Server Component queries the DB and passes data as props to these client children. Intel briefing section is static in Phase A.

- [ ] **Step 4: Create app-shell**

Create `src/components/layout/app-shell.tsx` that assembles Intel Bar + Sidebar + content slot + Status Footer in the grid layout from the spec.

- [ ] **Step 5: Wire into root layout**

Update `src/app/layout.tsx` to wrap `{children}` in `<AppShell>`.

- [ ] **Step 6: Verify layout renders**

```bash
pnpm dev
```

Open http://localhost:7777. Expected: Full tactical shell — intel bar rotating quotes, sidebar with brand + battlefield selector showing "OPERATION BOOTSTRAP" + nav links, status footer.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/ src/app/layout.tsx
git commit -m "feat: add tactical layout shell with intel bar, sidebar, and status footer"
```

---

## Task 8: Pages & Routing

**Files:**
- Create/Modify: All page files listed in the file map above

- [ ] **Step 1: Create root page (redirect)**

Create `src/app/page.tsx`:

```typescript
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/projects');
}
```

- [ ] **Step 2: Create root loading.tsx**

Create `src/app/loading.tsx` with pulsing skeleton bars.

- [ ] **Step 3: Create root error.tsx**

Create `src/app/error.tsx` (Client Component) with military-style error display, retry button, collapsible trace.

- [ ] **Step 4: Create projects list page**

Create `src/app/projects/page.tsx`. Server Component that reads battlefields from DB. Renders a grid of cards or an empty state message. Each card links to `/projects/[id]`.

- [ ] **Step 5: Create battlefield layout**

Create `src/app/projects/[id]/layout.tsx`. Wraps children with the right sidebar (asset list + breakdown). Reads assets from DB. Reads battlefield by `id`.

**IMPORTANT — Next.js 16.2 async params pattern.** All pages/layouts with route params must use this pattern:

```typescript
export default async function BattlefieldLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Now use `id` to query the database
}
```

The same pattern applies to all `[id]` and `[missionId]` pages.

- [ ] **Step 6: Create battlefield overview page**

Create `src/app/projects/[id]/page.tsx`. Server Component (with `await params`). Displays:
- Header with breadcrumb, codename, description
- Deploy mission card (static form, no submit wired)
- Stats bar (all zeros — reads real counts from DB)
- Mission list section (empty state: "No missions deployed yet.")

- [ ] **Step 7: Create battlefield loading.tsx**

Create `src/app/projects/[id]/loading.tsx` with skeleton matching the overview layout.

- [ ] **Step 8: Create assets page**

Create `src/app/projects/[id]/assets/page.tsx`. Server Component. Reads all assets from DB. Renders a grid of cards: codename, specialty, model, status dot, missions completed count.

- [ ] **Step 9: Create stub pages**

Create stub pages for all Phase B-D routes. Each renders a tactical-styled placeholder:

```typescript
export default function StubPage() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-dr-amber text-sm font-tactical tracking-wider mb-2">
          CLASSIFIED
        </div>
        <div className="text-dr-dim text-xs">
          This section is under development — Phase [X]
        </div>
      </div>
    </div>
  );
}
```

Create stubs for:
- `src/app/projects/[id]/missions/[missionId]/page.tsx`
- `src/app/projects/[id]/campaigns/page.tsx`
- `src/app/projects/[id]/campaigns/[campaignId]/page.tsx`
- `src/app/projects/[id]/git/page.tsx`
- `src/app/projects/[id]/console/page.tsx`
- `src/app/projects/[id]/schedule/page.tsx`
- `src/app/projects/[id]/config/page.tsx`

- [ ] **Step 10: Verify all routes**

```bash
pnpm dev
```

Navigate through all routes. Verify:
- `/` redirects to `/projects`
- `/projects` shows the seeded battlefield
- `/projects/[id]` shows the overview with tactical styling
- `/projects/[id]/assets` shows all 8 seeded assets
- Sidebar nav links all work
- Stub pages render placeholder text
- Loading states work (check by adding artificial delay)
- Error boundary works (check by throwing in a component)

- [ ] **Step 11: Commit**

```bash
git add src/app/
git commit -m "feat: add all Phase A pages, routing, loading and error boundaries"
```

---

## Task 9: Integration Verification & Polish

**Files:**
- Modify: Various (bug fixes, polish)
- Modify: `CLAUDE.md` (update theme and Next.js version references)

- [ ] **Step 1: Full navigation test**

Start the server and verify every route works end-to-end:
1. Server starts with banner ✓
2. `/` → redirects to `/projects` ✓
3. `/projects` → shows seeded battlefield card ✓
4. Click battlefield → `/projects/[id]` → overview page ✓
5. Sidebar nav → all 7 sections navigate correctly ✓
6. Assets page → 8 seeded assets displayed ✓
7. Battlefield selector → shows "OPERATION BOOTSTRAP" ✓
8. Intel bar → quotes rotating ✓
9. Status footer → LAN warning visible ✓
10. Socket.IO → client connects (check browser console) ✓

- [ ] **Step 2: Fix any issues found**

Address any bugs or styling issues discovered during testing.

- [ ] **Step 3: Update CLAUDE.md**

Update the theme section in `CLAUDE.md` to reflect:
- Ghost Ops V2 color palette (replacing green-tinted palette)
- Next.js 16.2 (replacing 14+)
- pnpm as package manager
- shadcn/ui addition

- [ ] **Step 4: Build test**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase A foundation — DEVROOM operational"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `pnpm dev` starts with no errors
- [ ] Startup banner shows with local + network URLs
- [ ] SQLite database created with all 7 tables
- [ ] 8 default assets seeded
- [ ] 1 sample battlefield seeded
- [ ] Full tactical shell renders (intel bar, sidebar, footer)
- [ ] Ghost Ops V2 theme applied (gray base, amber headers, neon green status)
- [ ] All 3 fonts loading (Share Tech Mono, IBM Plex Mono, Courier Prime)
- [ ] Sidebar navigation works for all 7 sections
- [ ] Battlefield selector shows seeded battlefield
- [ ] Assets page shows all 8 assets
- [ ] Socket.IO client connects (browser console)
- [ ] Loading skeletons display
- [ ] Error boundary catches and displays errors
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
- [ ] CLAUDE.md updated with theme + version changes
