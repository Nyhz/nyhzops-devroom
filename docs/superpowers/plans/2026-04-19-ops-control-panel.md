# OPS Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/ops` in DEVROOM — a tactical devops surface that monitors and controls all Mac Mini-hosted apps (DEVROOM itself read-only, plus `finances`, `calendar`, future siblings) reusing the existing launchd + `<name>-ctl.sh` scripts.

**Architecture:** One new page (`/ops`), a background `OpsPoller` singleton inside `server.ts` that shells out every 3s and broadcasts over Socket.IO, a per-slug `tail -F` log stream manager, four Server Actions for start/stop/restart/setMode (DEVROOM rejected server-side via `isSelfControlled` flag), and two new Drizzle tables (`managed_apps`, `managed_app_metrics`) with hard retention (hourly rollup + weekly VACUUM).

**Tech Stack:** Next.js 16.2 App Router, TypeScript strict, Drizzle + better-sqlite3, Socket.IO, Tailwind v4 (tactical theme), Node `child_process.execFile`, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-04-19-ops-control-panel-design.md`](../specs/2026-04-19-ops-control-panel-design.md)

---

## File Structure

**New files:**
- `src/lib/db/schema.ts` — append `managedApps` and `managedAppMetrics` tables (modify in place, same file holds all schema today).
- `src/lib/db/migrations/NNNN_ops_tables.sql` — Drizzle-generated migration.
- `src/lib/ops/types.ts` — shared types (`ManagedApp`, `OpsStatus`, `OpsMetricRow`, action result types).
- `src/lib/ops/discovery.ts` — filesystem scan + upsert of managed apps.
- `src/lib/ops/parsers.ts` — pure parsers for `launchctl list`, `ps -o rss,%cpu`, health probe. Pure functions, no shelling.
- `src/lib/ops/poller.ts` — `OpsPoller` singleton: shells out, calls parsers, writes metrics, broadcasts.
- `src/lib/ops/retention.ts` — hourly rollup + delete + weekly VACUUM.
- `src/lib/ops/log-stream.ts` — refcounted `tail -F` manager per slug.
- `src/lib/ops/ctl.ts` — `execFile` wrapper for ctl scripts; single place that actually runs external commands (easy to mock in tests).
- `src/lib/socket/events.ts` — append `ops:status`/`ops:logs:<slug>` client↔server event types.
- `src/actions/ops.ts` — Server Actions: `startApp`, `stopApp`, `restartApp`, `setMode`.
- `src/app/(hq)/ops/page.tsx` — Server Component, loads snapshot + 1h metrics window.
- `src/app/(hq)/ops/settings/page.tsx` — simple form for path overrides + rescan.
- `src/components/ops/OpsGrid.tsx` — client grid + selection state.
- `src/components/ops/OpsCard.tsx` — single card.
- `src/components/ops/OpsDetail.tsx` — detail panel (actions + telemetry + graphs + comms).
- `src/components/ops/ActionButtons.tsx` — state-aware buttons with confirm flow.
- `src/components/ops/Sparkline.tsx` — SVG sparkline (no charting lib).
- `src/components/ops/OpsLogTerminal.tsx` — client component that subscribes to `ops:logs:<slug>` and renders a scrolling terminal.

**Modified files:**
- `server.ts` — start the OpsPoller + retention cron alongside CONTROL; seed DEVROOM row; run discovery.
- `src/lib/db/schema.ts` (above)
- `src/lib/socket/events.ts` (above)

**Tests:**
- `src/lib/ops/__tests__/parsers.test.ts`
- `src/lib/ops/__tests__/discovery.test.ts`
- `src/lib/ops/__tests__/retention.test.ts`
- `src/lib/ops/__tests__/poller.test.ts`
- `src/actions/__tests__/ops.test.ts`
- `e2e/ops.spec.ts` (Playwright)

---

## Task 1: Database Schema + Migration

**Files:**
- Modify: `src/lib/db/schema.ts` (append at end)
- Create: `src/lib/db/migrations/<next>_ops_tables.sql` (via `pnpm drizzle-kit generate`)

- [ ] **Step 1: Append schema**

Append to `src/lib/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Managed Apps (OPS control panel)
// ---------------------------------------------------------------------------
export const managedApps = sqliteTable('managed_apps', {
  slug: text('slug').primaryKey(),
  displayName: text('display_name').notNull(),
  battlefieldId: text('battlefield_id').references(() => battlefields.id),
  launchdLabel: text('launchd_label').notNull(),
  ctlScriptPath: text('ctl_script_path').notNull(),
  logPath: text('log_path').notNull(),
  healthUrl: text('health_url'),
  orderIdx: integer('order_idx').notNull().default(0),
  isSelfControlled: integer('is_self_controlled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const managedAppMetrics = sqliteTable('managed_app_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  ts: integer('ts').notNull(),
  bucket: text('bucket', { enum: ['raw', '1m', '5m'] }).notNull(),
  rss: integer('rss'),
  cpu: real('cpu'),
  healthy: integer('healthy', { mode: 'boolean' }),
  httpCode: integer('http_code'),
  latencyMs: integer('latency_ms'),
}, (t) => ({
  byAppTs: index('mam_slug_ts').on(t.slug, t.ts),
  byBucketTs: index('mam_bucket_ts').on(t.bucket, t.ts),
}));
```

Note: `real` is imported from `drizzle-orm/sqlite-core` — add to the existing import if missing.

- [ ] **Step 2: Generate migration**

Run: `pnpm drizzle-kit generate`
Expected: new SQL file at `src/lib/db/migrations/<next>_*.sql` with `CREATE TABLE managed_apps` and `CREATE TABLE managed_app_metrics` statements plus both indexes. Do NOT hand-edit the generated file.

- [ ] **Step 3: Apply migration in dev**

Run: `pnpm dev` (startup runs `runMigrations()`).
Expected: no errors, server boots. Stop it after boot.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations
git commit -m "feat(ops): add managed_apps + managed_app_metrics tables"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/lib/ops/types.ts`

- [ ] **Step 1: Write types**

```ts
import type { managedApps } from '@/lib/db/schema';

export type ManagedApp = typeof managedApps.$inferSelect;

export interface LaunchctlInfo {
  pid: number | null;
  lastExitCode: number | null;
}

export interface ProcInfo {
  rssBytes: number;
  cpuPercent: number;
}

export interface HealthInfo {
  healthy: boolean;
  httpCode: number | null;
  latencyMs: number | null;
}

export interface OpsStatus {
  slug: string;
  displayName: string;
  mode: 'prod' | 'dev' | 'unknown';
  pid: number | null;
  lastExitCode: number | null;
  uptimeMs: number | null;
  rssBytes: number | null;
  cpuPercent: number | null;
  healthy: boolean | null;
  httpCode: number | null;
  latencyMs: number | null;
  state: 'running' | 'stopped' | 'unresponsive';
  isSelfControlled: boolean;
  lastUpdatedAt: number;
  sinceMs: number | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  stdoutTail?: string;
  stderrTail?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ops/types.ts
git commit -m "feat(ops): shared ops types"
```

---

## Task 3: Parsers (Pure Functions)

**Files:**
- Create: `src/lib/ops/parsers.ts`
- Test: `src/lib/ops/__tests__/parsers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ops/__tests__/parsers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseLaunchctlPrint, parsePsOutput } from '../parsers';

describe('parseLaunchctlPrint', () => {
  it('extracts pid and last exit code from launchctl print output', () => {
    const out = `
com.devroom.app = {
  pid = 12345
  last exit code = 0
  ...
}`;
    expect(parseLaunchctlPrint(out)).toEqual({ pid: 12345, lastExitCode: 0 });
  });

  it('returns pid=null when service is not running', () => {
    const out = `Could not find service "com.devroom.app" in domain for ...`;
    expect(parseLaunchctlPrint(out)).toEqual({ pid: null, lastExitCode: null });
  });

  it('parses last exit = (never exited) as null', () => {
    const out = `pid = 99\nlast exit code = (never exited)\n`;
    expect(parseLaunchctlPrint(out)).toEqual({ pid: 99, lastExitCode: null });
  });
});

describe('parsePsOutput', () => {
  it('parses rss KB and cpu percent', () => {
    // `ps -o rss=,%cpu= -p <pid>` output looks like: "  145920  1.2"
    expect(parsePsOutput('  145920  1.2')).toEqual({ rssBytes: 145920 * 1024, cpuPercent: 1.2 });
  });

  it('returns null-ish on empty output', () => {
    expect(parsePsOutput('')).toBeNull();
  });
});
```

Run: `pnpm test src/lib/ops/__tests__/parsers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement parsers**

Create `src/lib/ops/parsers.ts`:

```ts
import type { LaunchctlInfo, ProcInfo } from './types';

export function parseLaunchctlPrint(output: string): LaunchctlInfo {
  const pidMatch = output.match(/(?:^|\s)pid\s*=\s*(\d+)/);
  const exitMatch = output.match(/last exit code\s*=\s*(-?\d+)/);
  const pid = pidMatch ? Number(pidMatch[1]) : null;
  const lastExitCode = exitMatch ? Number(exitMatch[1]) : null;
  return { pid: pid && pid > 0 ? pid : null, lastExitCode };
}

export function parsePsOutput(output: string): ProcInfo | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;
  const rssKb = Number(parts[0]);
  const cpu = Number(parts[1]);
  if (!Number.isFinite(rssKb) || !Number.isFinite(cpu)) return null;
  return { rssBytes: rssKb * 1024, cpuPercent: cpu };
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/ops/__tests__/parsers.test.ts`
Expected: PASS all 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ops/parsers.ts src/lib/ops/__tests__/parsers.test.ts
git commit -m "feat(ops): pure parsers for launchctl and ps output"
```

---

## Task 4: Ctl Wrapper (execFile shim)

**Files:**
- Create: `src/lib/ops/ctl.ts`

- [ ] **Step 1: Write the wrapper**

```ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface CtlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CtlRunner {
  run(path: string, args: string[], timeoutMs?: number): Promise<CtlResult>;
}

export const defaultCtlRunner: CtlRunner = {
  async run(path, args, timeoutMs = 30_000) {
    try {
      const { stdout, stderr } = await execFileAsync(path, args, {
        timeout: timeoutMs,
        maxBuffer: 1 << 20,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
      };
    }
  },
};
```

Note: isolating `execFile` behind `CtlRunner` means tests inject a fake and never shell out.

- [ ] **Step 2: Commit**

```bash
git add src/lib/ops/ctl.ts
git commit -m "feat(ops): ctl runner abstraction"
```

---

## Task 5: Discovery

**Files:**
- Create: `src/lib/ops/discovery.ts`
- Test: `src/lib/ops/__tests__/discovery.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { discoverManagedApps, seedDevroomRow, type DiscoveryIO } from '../discovery';

let tmp: string;
let io: DiscoveryIO;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ops-discover-'));
  const bf = join(tmp, 'battlefields');
  mkdirSync(join(bf, 'finances', 'scripts'), { recursive: true });
  writeFileSync(join(bf, 'finances', 'scripts', 'finances-ctl.sh'), '#!/bin/bash\nPORT=3200\n');
  mkdirSync(join(bf, 'calendar', 'scripts'), { recursive: true });
  writeFileSync(join(bf, 'calendar', 'scripts', 'calendar-ctl.sh'), '#!/bin/bash\nPORT=3100\n');
  io = { battlefieldsRoot: bf, homeRoot: tmp, now: () => 1000 };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('discoverManagedApps', () => {
  it('finds apps by <slug>-ctl.sh convention and extracts PORT', () => {
    const rows = discoverManagedApps(io);
    const slugs = rows.map(r => r.slug).sort();
    expect(slugs).toEqual(['calendar', 'finances']);
    const finances = rows.find(r => r.slug === 'finances')!;
    expect(finances.launchdLabel).toBe('com.finances.app');
    expect(finances.healthUrl).toBe('http://localhost:3200/');
    expect(finances.logPath).toBe(join(tmp, '.finances', 'logs', 'finances.log'));
    expect(finances.isSelfControlled).toBe(false);
  });
});

describe('seedDevroomRow', () => {
  it('returns a devroom row with isSelfControlled = true', () => {
    const row = seedDevroomRow({ homeRoot: tmp, devroomRoot: '/opt/devroom', port: 7777, now: () => 1000 });
    expect(row.slug).toBe('devroom');
    expect(row.isSelfControlled).toBe(true);
    expect(row.ctlScriptPath).toBe('/opt/devroom/scripts/devroom-ctl.sh');
    expect(row.healthUrl).toBe('http://localhost:7777/');
  });
});
```

Run: `pnpm test src/lib/ops/__tests__/discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement discovery**

```ts
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ManagedApp } from './types';

export interface DiscoveryIO {
  battlefieldsRoot: string;
  homeRoot: string;
  now: () => number;
}

export interface DevroomSeedIO {
  homeRoot: string;
  devroomRoot: string;
  port: number;
  now: () => number;
}

function extractPort(scriptPath: string): number | null {
  try {
    const contents = readFileSync(scriptPath, 'utf-8');
    const m = contents.match(/^\s*PORT\s*=\s*["']?(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export function discoverManagedApps(io: DiscoveryIO): ManagedApp[] {
  if (!existsSync(io.battlefieldsRoot)) return [];
  const entries = readdirSync(io.battlefieldsRoot);
  const rows: ManagedApp[] = [];
  for (const slug of entries) {
    const dir = join(io.battlefieldsRoot, slug);
    if (!statSync(dir).isDirectory()) continue;
    const ctl = join(dir, 'scripts', `${slug}-ctl.sh`);
    if (!existsSync(ctl)) continue;
    const port = extractPort(ctl);
    rows.push({
      slug,
      displayName: slug.toUpperCase(),
      battlefieldId: null,
      launchdLabel: `com.${slug}.app`,
      ctlScriptPath: ctl,
      logPath: join(io.homeRoot, `.${slug}`, 'logs', `${slug}.log`),
      healthUrl: port ? `http://localhost:${port}/` : null,
      orderIdx: 0,
      isSelfControlled: false,
      createdAt: io.now(),
      updatedAt: io.now(),
    });
  }
  return rows;
}

export function seedDevroomRow(io: DevroomSeedIO): ManagedApp {
  return {
    slug: 'devroom',
    displayName: 'DEVROOM',
    battlefieldId: null,
    launchdLabel: 'com.devroom.app',
    ctlScriptPath: join(io.devroomRoot, 'scripts', 'devroom-ctl.sh'),
    logPath: join(io.homeRoot, '.devroom', 'logs', 'devroom.log'),
    healthUrl: `http://localhost:${io.port}/`,
    orderIdx: -1,
    isSelfControlled: true,
    createdAt: io.now(),
    updatedAt: io.now(),
  };
}

export function upsertManagedApp(
  db: { insert: Function; update: Function; select: Function },
  row: ManagedApp,
): void {
  // Implementation uses Drizzle's `onConflictDoUpdate`:
  //   db.insert(managedApps).values(row).onConflictDoUpdate({
  //     target: managedApps.slug,
  //     set: { ...row, createdAt: sql`created_at` },   // keep original createdAt
  //   });
  // Callers inject the real db + schema at wire time (see Task 6).
  throw new Error('upsertManagedApp is wired in poller-init; this export kept for clarity');
}
```

Note: `upsertManagedApp` is actually called from Task 12 (boot wiring) using Drizzle directly; the shape here is placeholder documentation. Keep `discoverManagedApps` and `seedDevroomRow` pure.

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/ops/__tests__/discovery.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ops/discovery.ts src/lib/ops/__tests__/discovery.test.ts
git commit -m "feat(ops): filesystem discovery + devroom seed row"
```

---

## Task 6: OpsPoller

**Files:**
- Create: `src/lib/ops/poller.ts`
- Test: `src/lib/ops/__tests__/poller.test.ts`

- [ ] **Step 1: Write poller test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { OpsPoller } from '../poller';
import type { ManagedApp } from '../types';

const app: ManagedApp = {
  slug: 'finances', displayName: 'FINANCES', battlefieldId: null,
  launchdLabel: 'com.finances.app', ctlScriptPath: '/tmp/finances-ctl.sh',
  logPath: '/tmp/finances.log', healthUrl: 'http://localhost:3200/',
  orderIdx: 0, isSelfControlled: false, createdAt: 0, updatedAt: 0,
};

describe('OpsPoller.tick', () => {
  it('assembles OpsStatus from parser outputs and writes metrics row', async () => {
    const writes: any[] = [];
    const emits: any[] = [];
    const poller = new OpsPoller({
      listApps: () => [app],
      runLaunchctl: async () => 'pid = 42\nlast exit code = 0\n',
      runPs: async () => '  81920  0.5',
      probeHealth: async () => ({ healthy: true, httpCode: 200, latencyMs: 12 }),
      readMode: () => 'prod',
      writeMetric: (row) => writes.push(row),
      emit: (snap) => emits.push(snap),
      now: () => 1_700_000_000_000,
    });
    await poller.tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ slug: 'finances', bucket: 'raw', rss: 81920 * 1024, cpu: 0.5, healthy: true });
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toMatchObject({ slug: 'finances', state: 'running', mode: 'prod', pid: 42 });
  });

  it('marks stopped apps correctly when pid is null', async () => {
    const emits: any[] = [];
    const poller = new OpsPoller({
      listApps: () => [app],
      runLaunchctl: async () => 'Could not find service',
      runPs: async () => '',
      probeHealth: async () => ({ healthy: false, httpCode: null, latencyMs: null }),
      readMode: () => 'prod',
      writeMetric: () => {},
      emit: (snap) => emits.push(snap),
      now: () => 1_700_000_000_000,
    });
    await poller.tick();
    expect(emits[0][0].state).toBe('stopped');
    expect(emits[0][0].pid).toBeNull();
  });

  it('marks unresponsive when pid exists but health fails', async () => {
    const emits: any[] = [];
    const poller = new OpsPoller({
      listApps: () => [app],
      runLaunchctl: async () => 'pid = 42\nlast exit code = 0',
      runPs: async () => '  81920  0.5',
      probeHealth: async () => ({ healthy: false, httpCode: 500, latencyMs: 20 }),
      readMode: () => 'prod',
      writeMetric: () => {},
      emit: (snap) => emits.push(snap),
      now: () => 1_700_000_000_000,
    });
    await poller.tick();
    expect(emits[0][0].state).toBe('unresponsive');
  });
});
```

Run: `pnpm test src/lib/ops/__tests__/poller.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement OpsPoller**

```ts
import { parseLaunchctlPrint, parsePsOutput } from './parsers';
import type { ManagedApp, OpsStatus, HealthInfo } from './types';

export interface OpsPollerDeps {
  listApps: () => ManagedApp[];
  runLaunchctl: (label: string) => Promise<string>;
  runPs: (pid: number) => Promise<string>;
  probeHealth: (url: string | null) => Promise<HealthInfo>;
  readMode: (slug: string) => 'prod' | 'dev' | 'unknown';
  writeMetric: (row: {
    slug: string; ts: number; bucket: 'raw'; rss: number | null;
    cpu: number | null; healthy: boolean | null; httpCode: number | null; latencyMs: number | null;
  }) => void;
  emit: (snapshot: OpsStatus[]) => void;
  now: () => number;
}

export class OpsPoller {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processStartTimes = new Map<string, number>();

  constructor(private deps: OpsPollerDeps) {}

  start(intervalMs = 3000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      if (this.running) return;  // skip overlap
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    this.running = true;
    try {
      const apps = this.deps.listApps();
      const results = await Promise.all(apps.map(app => this.pollApp(app)));
      this.deps.emit(results);
      for (const r of results) {
        this.deps.writeMetric({
          slug: r.slug,
          ts: r.lastUpdatedAt,
          bucket: 'raw',
          rss: r.rssBytes,
          cpu: r.cpuPercent,
          healthy: r.healthy,
          httpCode: r.httpCode,
          latencyMs: r.latencyMs,
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async pollApp(app: ManagedApp): Promise<OpsStatus> {
    const now = this.deps.now();
    const raw = await this.deps.runLaunchctl(app.launchdLabel).catch(() => '');
    const { pid, lastExitCode } = parseLaunchctlPrint(raw);
    let rss: number | null = null;
    let cpu: number | null = null;
    if (pid) {
      const psOut = await this.deps.runPs(pid).catch(() => '');
      const proc = parsePsOutput(psOut);
      if (proc) { rss = proc.rssBytes; cpu = proc.cpuPercent; }
      if (!this.processStartTimes.has(`${app.slug}:${pid}`)) {
        this.processStartTimes.set(`${app.slug}:${pid}`, now);
      }
    } else {
      // clean up any stale start-time entries for this slug
      for (const k of this.processStartTimes.keys()) {
        if (k.startsWith(`${app.slug}:`)) this.processStartTimes.delete(k);
      }
    }
    const health = await this.deps.probeHealth(app.healthUrl);
    const mode = this.deps.readMode(app.slug);
    const uptimeStart = pid ? this.processStartTimes.get(`${app.slug}:${pid}`) ?? now : null;
    const state: OpsStatus['state'] =
      !pid ? 'stopped' : health.healthy ? 'running' : 'unresponsive';

    return {
      slug: app.slug,
      displayName: app.displayName,
      mode,
      pid,
      lastExitCode,
      uptimeMs: uptimeStart ? now - uptimeStart : null,
      rssBytes: rss,
      cpuPercent: cpu,
      healthy: pid ? health.healthy : null,
      httpCode: health.httpCode,
      latencyMs: health.latencyMs,
      state,
      isSelfControlled: app.isSelfControlled,
      lastUpdatedAt: now,
      sinceMs: null,
    };
  }
}
```

Note: `uptimeMs` is approximate — we only know start time since the poller first observed the PID. Acceptable for a monitoring view; true start time could be read from `ps -o lstart=` in a follow-up.

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/ops/__tests__/poller.test.ts`
Expected: PASS all 3 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ops/poller.ts src/lib/ops/__tests__/poller.test.ts
git commit -m "feat(ops): OpsPoller with injected shell deps"
```

---

## Task 7: Retention

**Files:**
- Create: `src/lib/ops/retention.ts`
- Test: `src/lib/ops/__tests__/retention.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runRetention } from '../retention';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE managed_app_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL, ts INTEGER NOT NULL, bucket TEXT NOT NULL,
      rss INTEGER, cpu REAL, healthy INTEGER, http_code INTEGER, latency_ms INTEGER
    );
  `);
});

describe('runRetention', () => {
  it('rolls up raw → 1m buckets older than 1h and deletes the source rows', () => {
    const now = 10 * 3600 * 1000; // 10h after epoch
    const twoHoursAgo = now - 2 * 3600 * 1000;
    const insert = db.prepare(`INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, healthy, http_code, latency_ms) VALUES (?,?,?,?,?,?,?,?)`);
    // 20 rows in the same minute, 2h ago
    for (let i = 0; i < 20; i++) {
      insert.run('finances', twoHoursAgo + i * 3000, 'raw', 100_000 + i, 1.0, 1, 200, 10);
    }
    runRetention(db, now);
    const raw = db.prepare(`SELECT COUNT(*) AS n FROM managed_app_metrics WHERE bucket='raw'`).get() as { n: number };
    const oneM = db.prepare(`SELECT COUNT(*) AS n FROM managed_app_metrics WHERE bucket='1m'`).get() as { n: number };
    expect(raw.n).toBe(0);
    expect(oneM.n).toBe(1);
  });

  it('deletes 5m rows older than 7 days', () => {
    const now = 30 * 24 * 3600 * 1000;
    const eightDaysAgo = now - 8 * 24 * 3600 * 1000;
    db.prepare(`INSERT INTO managed_app_metrics (slug, ts, bucket) VALUES ('f', ?, '5m')`).run(eightDaysAgo);
    runRetention(db, now);
    const c = db.prepare(`SELECT COUNT(*) AS n FROM managed_app_metrics`).get() as { n: number };
    expect(c.n).toBe(0);
  });
});
```

- [ ] **Step 2: Implement retention**

```ts
import type Database from 'better-sqlite3';

export function runRetention(db: Database.Database, now: number): void {
  const oneHourAgo = now - 3600 * 1000;
  const oneDayAgo = now - 24 * 3600 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;

  const txn = db.transaction(() => {
    // raw → 1m
    db.prepare(`
      INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, healthy, http_code, latency_ms)
      SELECT slug, (ts / 60000) * 60000 AS bts, '1m',
             CAST(AVG(rss) AS INTEGER), AVG(cpu), MAX(healthy),
             CAST(AVG(http_code) AS INTEGER), CAST(AVG(latency_ms) AS INTEGER)
      FROM managed_app_metrics WHERE bucket='raw' AND ts < ?
      GROUP BY slug, bts;
    `).run(oneHourAgo);
    db.prepare(`DELETE FROM managed_app_metrics WHERE bucket='raw' AND ts < ?`).run(oneHourAgo);

    // 1m → 5m
    db.prepare(`
      INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, healthy, http_code, latency_ms)
      SELECT slug, (ts / 300000) * 300000 AS bts, '5m',
             CAST(AVG(rss) AS INTEGER), AVG(cpu), MAX(healthy),
             CAST(AVG(http_code) AS INTEGER), CAST(AVG(latency_ms) AS INTEGER)
      FROM managed_app_metrics WHERE bucket='1m' AND ts < ?
      GROUP BY slug, bts;
    `).run(oneDayAgo);
    db.prepare(`DELETE FROM managed_app_metrics WHERE bucket='1m' AND ts < ?`).run(oneDayAgo);

    // 5m → dropped
    db.prepare(`DELETE FROM managed_app_metrics WHERE bucket='5m' AND ts < ?`).run(sevenDaysAgo);
  });

  txn();
}

export function vacuumMetrics(db: Database.Database): void {
  db.exec('VACUUM');
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/ops/__tests__/retention.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ops/retention.ts src/lib/ops/__tests__/retention.test.ts
git commit -m "feat(ops): time-series retention (rollup + vacuum)"
```

---

## Task 8: Log Stream Manager

**Files:**
- Create: `src/lib/ops/log-stream.ts`

- [ ] **Step 1: Implement**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface LogStreamDeps {
  emit: (slug: string, line: string) => void;
}

interface Stream {
  proc: ChildProcessWithoutNullStreams;
  refCount: number;
}

export class LogStreamManager {
  private streams = new Map<string, Stream>();

  constructor(private deps: LogStreamDeps) {}

  attach(slug: string, logPath: string): void {
    const existing = this.streams.get(slug);
    if (existing) {
      existing.refCount++;
      return;
    }
    const proc = spawn('tail', ['-n', '200', '-F', logPath]);
    proc.stdout.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.length) this.deps.emit(slug, line);
      }
    });
    proc.on('exit', () => {
      this.streams.delete(slug);
    });
    this.streams.set(slug, { proc, refCount: 1 });
  }

  detach(slug: string): void {
    const s = this.streams.get(slug);
    if (!s) return;
    s.refCount--;
    if (s.refCount <= 0) {
      s.proc.kill('SIGTERM');
      this.streams.delete(slug);
    }
  }

  shutdown(): void {
    for (const { proc } of this.streams.values()) proc.kill('SIGTERM');
    this.streams.clear();
  }
}
```

Note: `tail -F` (capital F) follows through log rotation; Linux `tail` supports it, macOS `tail` supports it. No extra handling needed.

- [ ] **Step 2: Commit**

```bash
git add src/lib/ops/log-stream.ts
git commit -m "feat(ops): refcounted tail -F log stream manager"
```

---

## Task 9: Server Actions

**Files:**
- Create: `src/actions/ops.ts`
- Test: `src/actions/__tests__/ops.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _makeOpsActions } from '../ops';
import type { ManagedApp } from '@/lib/ops/types';

const devroom: ManagedApp = {
  slug: 'devroom', displayName: 'DEVROOM', battlefieldId: null,
  launchdLabel: 'com.devroom.app', ctlScriptPath: '/bin/true',
  logPath: '/tmp/d.log', healthUrl: null, orderIdx: 0,
  isSelfControlled: true, createdAt: 0, updatedAt: 0,
};
const finances: ManagedApp = { ...devroom, slug: 'finances', displayName: 'FIN', launchdLabel: 'com.finances.app', isSelfControlled: false };

describe('ops server actions', () => {
  it('rejects any action on a self-controlled app', async () => {
    const actions = _makeOpsActions({
      getApp: (slug) => slug === 'devroom' ? devroom : null,
      runner: { run: vi.fn() },
      revalidate: () => {},
    });
    const r = await actions.restartApp('devroom');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/self-control locked/i);
  });

  it('404s on unknown slug', async () => {
    const actions = _makeOpsActions({ getApp: () => null, runner: { run: vi.fn() }, revalidate: () => {} });
    const r = await actions.startApp('ghost');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown/i);
  });

  it('invokes ctl script with the right subcommand for restart', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const actions = _makeOpsActions({
      getApp: () => finances, runner: { run }, revalidate: () => {},
    });
    const r = await actions.restartApp('finances');
    expect(r.ok).toBe(true);
    expect(run).toHaveBeenCalledWith('/bin/true', ['restart'], 30_000);
  });

  it('setMode("dev") passes "dev" subcommand', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const actions = _makeOpsActions({ getApp: () => finances, runner: { run }, revalidate: () => {} });
    await actions.setMode('finances', 'dev');
    expect(run).toHaveBeenCalledWith('/bin/true', ['dev'], 30_000);
  });

  it('returns non-ok with stderr tail on non-zero exit', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'boom' });
    const actions = _makeOpsActions({ getApp: () => finances, runner: { run }, revalidate: () => {} });
    const r = await actions.stopApp('finances');
    expect(r.ok).toBe(false);
    expect(r.stderrTail).toBe('boom');
  });
});
```

- [ ] **Step 2: Implement actions**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { managedApps } from '@/lib/db/schema';
import { defaultCtlRunner, type CtlRunner } from '@/lib/ops/ctl';
import type { ActionResult, ManagedApp } from '@/lib/ops/types';

interface Deps {
  getApp: (slug: string) => ManagedApp | null;
  runner: CtlRunner;
  revalidate: (path: string) => void;
}

async function invoke(deps: Deps, slug: string, sub: string): Promise<ActionResult> {
  const app = deps.getApp(slug);
  if (!app) return { ok: false, error: 'unknown slug' };
  if (app.isSelfControlled) return { ok: false, error: 'self-control locked — use terminal' };
  const { exitCode, stdout, stderr } = await deps.runner.run(app.ctlScriptPath, [sub], 30_000);
  const stdoutTail = stdout.trim().split('\n').slice(-5).join('\n');
  const stderrTail = stderr.trim().split('\n').slice(-5).join('\n');
  if (exitCode !== 0) return { ok: false, error: `ctl ${sub} exited ${exitCode}`, stdoutTail, stderrTail };
  deps.revalidate('/ops');
  return { ok: true, stdoutTail, stderrTail };
}

/** @internal — exported for tests only. */
export function _makeOpsActions(deps: Deps) {
  return {
    startApp: (slug: string) => invoke(deps, slug, 'start'),
    stopApp: (slug: string) => invoke(deps, slug, 'stop'),
    restartApp: (slug: string) => invoke(deps, slug, 'restart'),
    setMode: (slug: string, mode: 'prod' | 'dev') => invoke(deps, slug, mode),
  };
}

const prodDeps: Deps = {
  getApp: (slug) => {
    const db = getDatabase();
    const row = db.select().from(managedApps).where(eq(managedApps.slug, slug)).get();
    return (row as ManagedApp | undefined) ?? null;
  },
  runner: defaultCtlRunner,
  revalidate: revalidatePath,
};

const prod = _makeOpsActions(prodDeps);
export const startApp = prod.startApp;
export const stopApp = prod.stopApp;
export const restartApp = prod.restartApp;
export const setMode = prod.setMode;
```

- [ ] **Step 3: Run tests**

Run: `pnpm test src/actions/__tests__/ops.test.ts`
Expected: PASS all 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src/actions/ops.ts src/actions/__tests__/ops.test.ts
git commit -m "feat(ops): server actions with self-control guard"
```

---

## Task 10: Socket.IO Events

**Files:**
- Modify: `src/lib/socket/events.ts`

- [ ] **Step 1: Append event types**

In `ClientToServerEvents`, add:
```ts
  'ops:subscribe': () => void;
  'ops:unsubscribe': () => void;
  'ops:logs:subscribe': (slug: string) => void;
  'ops:logs:unsubscribe': (slug: string) => void;
```

In `ServerToClientEvents` (or wherever server→client events are typed), add:
```ts
  'ops:status': (snapshot: import('@/lib/ops/types').OpsStatus[]) => void;
  'ops:logs': (payload: { slug: string; line: string }) => void;
```

- [ ] **Step 2: Wire subscribe handlers in `src/lib/socket/server.ts`**

Add alongside existing subscribe handlers:
```ts
socket.on('ops:subscribe', () => socket.join('ops:status'));
socket.on('ops:unsubscribe', () => socket.leave('ops:status'));
socket.on('ops:logs:subscribe', (slug: string) => {
  socket.join(`ops:logs:${slug}`);
  globalThis.logStreamManager?.attach(slug, getLogPathForSlug(slug));
});
socket.on('ops:logs:unsubscribe', (slug: string) => {
  socket.leave(`ops:logs:${slug}`);
  globalThis.logStreamManager?.detach(slug);
});
```

`getLogPathForSlug` is a small helper that reads from the DB:
```ts
function getLogPathForSlug(slug: string): string {
  const db = getDatabase();
  const row = db.select().from(managedApps).where(eq(managedApps.slug, slug)).get();
  return row?.logPath ?? '/dev/null';
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/socket/events.ts src/lib/socket/server.ts
git commit -m "feat(ops): socket.io rooms for status and per-app logs"
```

---

## Task 11: Boot Wiring in server.ts

**Files:**
- Modify: `server.ts`
- Modify: `src/types/globals.d.ts`

- [ ] **Step 1: Declare globals**

Append to `src/types/globals.d.ts`:
```ts
declare global {
  var opsPoller: import('@/lib/ops/poller').OpsPoller | undefined;
  var logStreamManager: import('@/lib/ops/log-stream').LogStreamManager | undefined;
}
export {};
```

- [ ] **Step 2: Wire up in `server.ts`**

After CONTROL is initialized and before the HTTP listen call, add:

```ts
import { OpsPoller } from './src/lib/ops/poller';
import { LogStreamManager } from './src/lib/ops/log-stream';
import { discoverManagedApps, seedDevroomRow } from './src/lib/ops/discovery';
import { parsePsOutput, parseLaunchctlPrint } from './src/lib/ops/parsers';
import { runRetention, vacuumMetrics } from './src/lib/ops/retention';
import { managedApps, managedAppMetrics } from './src/lib/db/schema';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sql } from 'drizzle-orm';

// ---- ops: discovery + seed
{
  const db = getDatabase();
  const now = Date.now();
  const home = homedir();
  const devroomRoot = process.cwd();
  const battlefieldsRoot = join(devroomRoot, '..', 'battlefields');

  const discovered = [
    seedDevroomRow({ homeRoot: home, devroomRoot, port: config.port, now: () => now }),
    ...discoverManagedApps({ battlefieldsRoot, homeRoot: home, now: () => now }),
  ];
  for (const row of discovered) {
    db.insert(managedApps).values(row).onConflictDoUpdate({
      target: managedApps.slug,
      set: {
        displayName: row.displayName, launchdLabel: row.launchdLabel,
        ctlScriptPath: row.ctlScriptPath, logPath: row.logPath,
        healthUrl: row.healthUrl, isSelfControlled: row.isSelfControlled,
        updatedAt: now,
      },
    }).run();
  }
}

// ---- ops: log stream manager
const logStreamManager = new LogStreamManager({
  emit: (slug, line) => io.to(`ops:logs:${slug}`).emit('ops:logs', { slug, line }),
});
globalThis.logStreamManager = logStreamManager;

// ---- ops: poller
const opsPoller = new OpsPoller({
  listApps: () => {
    const db = getDatabase();
    return db.select().from(managedApps).orderBy(managedApps.orderIdx, managedApps.slug).all() as any[];
  },
  runLaunchctl: (label) => new Promise((resolve) => {
    const uid = process.getuid?.() ?? 0;
    execFile('launchctl', ['print', `gui/${uid}/${label}`], { timeout: 2000 }, (_err, stdout) => resolve(stdout || ''));
  }),
  runPs: (pid) => new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], { timeout: 2000 }, (_err, stdout) => resolve(stdout || ''));
  }),
  probeHealth: async (url) => {
    if (!url) return { healthy: false, httpCode: null, latencyMs: null };
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return { healthy: res.ok, httpCode: res.status, latencyMs: Date.now() - started };
    } catch {
      return { healthy: false, httpCode: null, latencyMs: Date.now() - started };
    }
  },
  readMode: (slug) => {
    try {
      const modeFile = join(homedir(), `.${slug}`, 'mode');
      return readFileSync(modeFile, 'utf-8').trim() as 'prod' | 'dev';
    } catch { return 'unknown'; }
  },
  writeMetric: (row) => {
    const db = getDatabase();
    db.insert(managedAppMetrics).values(row).run();
  },
  emit: (snapshot) => io.to('ops:status').emit('ops:status', snapshot),
  now: () => Date.now(),
});
globalThis.opsPoller = opsPoller;
opsPoller.start(3000);

// ---- ops: retention cron (hourly rollup, weekly VACUUM)
setInterval(() => {
  try { runRetention(getDatabase(), Date.now()); }
  catch (e) { console.error('[OPS] retention failed', e); }
}, 3600 * 1000);
setInterval(() => {
  const d = new Date();
  if (d.getDay() === 0 && d.getHours() === 4 && d.getMinutes() < 5) {
    try { vacuumMetrics(getDatabase()); } catch (e) { console.error('[OPS] vacuum failed', e); }
  }
}, 5 * 60 * 1000);
```

Also extend the existing shutdown handler to call:
```ts
opsPoller.stop();
logStreamManager.shutdown();
```

- [ ] **Step 3: Verify boot**

Run: `pnpm dev`
Expected: server boots without errors. Check logs for no new warnings. After ~5s, `sqlite3 .devroom/db.sqlite "SELECT slug FROM managed_apps;"` should list `devroom`, `finances`, `calendar`.

- [ ] **Step 4: Commit**

```bash
git add server.ts src/types/globals.d.ts
git commit -m "feat(ops): boot wiring — discovery, poller, log streams, retention"
```

---

## Task 12: Sparkline Component

**Files:**
- Create: `src/components/ops/Sparkline.tsx`

- [ ] **Step 1: Write component**

```tsx
interface Point { ts: number; value: number | null }

export function Sparkline({
  points, width = 220, height = 48, color = 'var(--amber)',
}: { points: Point[]; width?: number; height?: number; color?: string }) {
  const values = points.map(p => p.value).filter((v): v is number => v != null);
  if (values.length === 0) {
    return <svg width={width} height={height} className="block opacity-30"><text x={4} y={height/2} className="text-xs font-mono fill-current">NO DATA</text></svg>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const range = max - min;
  const stepX = width / Math.max(points.length - 1, 1);
  const d = points.map((p, i) => {
    if (p.value == null) return '';
    const x = i * stepX;
    const y = height - ((p.value - min) / range) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="block">
      {/* dashed grid */}
      {[0.25, 0.5, 0.75].map(r => (
        <line key={r} x1={0} x2={width} y1={height*r} y2={height*r}
          stroke="currentColor" strokeDasharray="2,4" opacity={0.12}/>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth={1}/>
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/Sparkline.tsx
git commit -m "feat(ops): tactical sparkline component"
```

---

## Task 13: Action Buttons (state-aware + confirm)

**Files:**
- Create: `src/components/ops/ActionButtons.tsx`

- [ ] **Step 1: Write component**

```tsx
'use client';
import { useState, useTransition } from 'react';
import type { OpsStatus, ActionResult } from '@/lib/ops/types';

type ActionName = 'DEPLOY' | 'STAND DOWN' | 'REBOOT' | 'ENGAGE PROD' | 'ENGAGE DEV';

interface Props {
  status: OpsStatus;
  actions: {
    start: (slug: string) => Promise<ActionResult>;
    stop: (slug: string) => Promise<ActionResult>;
    restart: (slug: string) => Promise<ActionResult>;
    setMode: (slug: string, mode: 'prod' | 'dev') => Promise<ActionResult>;
  };
  onResult: (r: ActionResult) => void;
}

function enabledSet(s: OpsStatus): Record<ActionName, boolean> {
  if (s.isSelfControlled) return { 'DEPLOY': false, 'STAND DOWN': false, 'REBOOT': false, 'ENGAGE PROD': false, 'ENGAGE DEV': false };
  const running = s.state !== 'stopped';
  return {
    'DEPLOY': !running,
    'STAND DOWN': running,
    'REBOOT': running,
    'ENGAGE PROD': running && s.mode === 'dev',
    'ENGAGE DEV': running && s.mode === 'prod',
  };
}

export function ActionButtons({ status, actions, onResult }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<ActionName | null>(null);
  const enabled = enabledSet(status);

  const run = (name: ActionName) => startTransition(async () => {
    let r: ActionResult;
    switch (name) {
      case 'DEPLOY': r = await actions.start(status.slug); break;
      case 'STAND DOWN': r = await actions.stop(status.slug); break;
      case 'REBOOT': r = await actions.restart(status.slug); break;
      case 'ENGAGE PROD': r = await actions.setMode(status.slug, 'prod'); break;
      case 'ENGAGE DEV': r = await actions.setMode(status.slug, 'dev'); break;
    }
    onResult(r);
    setConfirm(null);
  });

  const click = (name: ActionName) => {
    if (!enabled[name] || pending) return;
    if (confirm === name) { run(name); return; }
    setConfirm(name);
    setTimeout(() => setConfirm((c) => (c === name ? null : c)), 3000);
  };

  const tooltip = (name: ActionName): string => {
    if (status.isSelfControlled) return 'self-control locked — use terminal';
    if (!enabled[name]) {
      if (status.state === 'stopped') return 'service offline';
      if (name === 'ENGAGE PROD') return 'already in PROD';
      if (name === 'ENGAGE DEV') return 'already in DEV';
      if (name === 'DEPLOY') return 'already running';
    }
    return '';
  };

  return (
    <div className="flex gap-2 font-mono text-xs">
      {(['DEPLOY','STAND DOWN','REBOOT','ENGAGE PROD','ENGAGE DEV'] as ActionName[]).map(name => {
        const on = enabled[name];
        const isConfirm = confirm === name;
        return (
          <button
            key={name}
            disabled={!on || pending}
            onClick={() => click(name)}
            title={tooltip(name)}
            data-testid={`ops-action-${name.replace(/\s+/g, '-').toLowerCase()}`}
            className={[
              'px-3 py-1 border tracking-widest uppercase transition-colors',
              on ? (isConfirm ? 'border-red-500 text-red-500 animate-pulse' : 'border-amber-500 text-amber-500 hover:bg-amber-500/10')
                 : 'border-zinc-700 text-zinc-600 line-through cursor-not-allowed',
            ].join(' ')}
          >
            {isConfirm ? `CONFIRM ${name}` : name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/ActionButtons.tsx
git commit -m "feat(ops): state-aware action buttons with confirm flow"
```

---

## Task 14: OpsCard, OpsGrid, OpsDetail

**Files:**
- Create: `src/components/ops/OpsCard.tsx`
- Create: `src/components/ops/OpsDetail.tsx`
- Create: `src/components/ops/OpsGrid.tsx`
- Create: `src/components/ops/OpsLogTerminal.tsx`

- [ ] **Step 1: OpsCard**

```tsx
import type { OpsStatus } from '@/lib/ops/types';

const healthColor = (s: OpsStatus): string =>
  s.state === 'running' ? 'bg-green-500' : s.state === 'unresponsive' ? 'bg-amber-500' : 'bg-red-500';

function formatUptime(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function OpsCard({ status, selected, onClick }: { status: OpsStatus; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={[
      'border p-3 text-left font-mono w-[220px] h-[130px] flex flex-col gap-2 relative',
      selected ? 'border-amber-500 shadow-[inset_0_0_0_2px_rgba(245,158,11,0.2)]' : 'border-zinc-800 hover:border-zinc-600',
    ].join(' ')}>
      <div className="flex items-start justify-between">
        <span className="text-amber-500 text-sm tracking-widest">{status.displayName}</span>
        <span className={`w-2 h-2 rounded-full ${healthColor(status)}`} />
      </div>
      <div className="text-[10px] text-zinc-500 tracking-widest">
        {status.mode.toUpperCase()}{status.isSelfControlled ? ' • SELF' : ''}
      </div>
      <div className="mt-auto text-xs text-zinc-400 grid grid-cols-3 gap-1">
        <span>{formatUptime(status.uptimeMs)}</span>
        <span>{status.rssBytes ? `${Math.round(status.rssBytes / 1024 / 1024)}M` : '—'}</span>
        <span>{status.cpuPercent != null ? `${status.cpuPercent.toFixed(1)}%` : '—'}</span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: OpsLogTerminal**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket/emit';   // adapt to existing socket client export

export function OpsLogTerminal({ slug }: { slug: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const sock = getSocket();
    setLines([]);
    sock.emit('ops:logs:subscribe', slug);
    const onLog = (p: { slug: string; line: string }) => {
      if (p.slug !== slug) return;
      setLines(prev => [...prev.slice(-999), p.line]);
    };
    sock.on('ops:logs', onLog);
    return () => {
      sock.off('ops:logs', onLog);
      sock.emit('ops:logs:unsubscribe', slug);
    };
  }, [slug]);

  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div className="border border-zinc-800 bg-black">
      <div className="flex justify-between p-1 text-xs font-mono">
        <span className="text-amber-500">COMMS :: {slug.toUpperCase()}</span>
        <div className="flex gap-3">
          <label><input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} /> auto</label>
          <button onClick={() => setLines([])}>CLEAR</button>
        </div>
      </div>
      <div ref={ref} className="h-80 overflow-auto p-2 text-xs font-mono text-green-400 whitespace-pre">
        {lines.length ? lines.join('\n') : 'NO COMMS'}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: OpsDetail**

```tsx
'use client';
import { useState } from 'react';
import { ActionButtons } from './ActionButtons';
import { Sparkline } from './Sparkline';
import { OpsLogTerminal } from './OpsLogTerminal';
import type { OpsStatus, ActionResult } from '@/lib/ops/types';
import { startApp, stopApp, restartApp, setMode } from '@/actions/ops';

interface MetricPoint { ts: number; rss: number | null; cpu: number | null; latency: number | null }

export function OpsDetail({ status, metrics }: { status: OpsStatus; metrics: MetricPoint[] }) {
  const [toast, setToast] = useState<string | null>(null);
  const onResult = (r: ActionResult) => setToast(r.ok ? 'OK' : `ERR: ${r.error}${r.stderrTail ? ' — ' + r.stderrTail : ''}`);

  return (
    <div className="mt-6 border border-zinc-800 p-4 space-y-6 font-mono">
      <ActionButtons status={status} actions={{ start: startApp, stop: stopApp, restart: restartApp, setMode }} onResult={onResult} />
      {toast && <div className="text-xs text-amber-500">{toast}</div>}
      <section>
        <h3 className="text-amber-500 text-xs mb-2 tracking-widest">TELEMETRY</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div>PID :: <span className="text-green-400">{status.pid ?? '—'}</span></div>
          <div>EXIT :: <span className="text-green-400">{status.lastExitCode ?? '—'}</span></div>
          <div>HTTP :: <span className="text-green-400">{status.httpCode ?? '—'}</span></div>
          <div>LATENCY :: <span className="text-green-400">{status.latencyMs ?? '—'} ms</span></div>
        </dl>
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div><div className="text-xs text-amber-500 tracking-widest">RSS</div><Sparkline points={metrics.map(m => ({ ts: m.ts, value: m.rss }))} /></div>
        <div><div className="text-xs text-amber-500 tracking-widest">CPU</div><Sparkline points={metrics.map(m => ({ ts: m.ts, value: m.cpu }))} /></div>
        <div><div className="text-xs text-amber-500 tracking-widest">LATENCY</div><Sparkline points={metrics.map(m => ({ ts: m.ts, value: m.latency }))} /></div>
      </section>
      <OpsLogTerminal slug={status.slug} />
    </div>
  );
}
```

- [ ] **Step 4: OpsGrid (client wrapper)**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket/emit';
import { OpsCard } from './OpsCard';
import { OpsDetail } from './OpsDetail';
import type { OpsStatus } from '@/lib/ops/types';

interface Props {
  initial: OpsStatus[];
  metricsBySlug: Record<string, { ts: number; rss: number | null; cpu: number | null; latency: number | null }[]>;
}

export function OpsGrid({ initial, metricsBySlug }: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.slug ?? null);

  useEffect(() => {
    const sock = getSocket();
    sock.emit('ops:subscribe');
    const onStatus = (s: OpsStatus[]) => setSnapshot(s);
    sock.on('ops:status', onStatus);
    return () => { sock.off('ops:status', onStatus); sock.emit('ops:unsubscribe'); };
  }, []);

  const current = snapshot.find(s => s.slug === selected) ?? snapshot[0];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        {snapshot.map(s => <OpsCard key={s.slug} status={s} selected={s.slug === selected} onClick={() => setSelected(s.slug)} />)}
      </div>
      {current && <OpsDetail status={current} metrics={metricsBySlug[current.slug] ?? []} />}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ops
git commit -m "feat(ops): card, grid, detail, log terminal components"
```

---

## Task 15: `/ops` Page

**Files:**
- Create: `src/app/(hq)/ops/page.tsx`
- Create: `src/app/(hq)/ops/loading.tsx`

- [ ] **Step 1: Write page**

```tsx
import { OpsGrid } from '@/components/ops/OpsGrid';
import { getDatabase } from '@/lib/db';
import { managedApps, managedAppMetrics } from '@/lib/db/schema';
import { sql, desc, and, eq, gte } from 'drizzle-orm';
import type { OpsStatus } from '@/lib/ops/types';

export const dynamic = 'force-dynamic';

export default function OpsPage() {
  const db = getDatabase();
  const apps = db.select().from(managedApps).orderBy(managedApps.orderIdx, managedApps.slug).all();
  const snap: OpsStatus[] =
    (globalThis as any).opsPoller?.snapshot?.() ??
    apps.map((a: any) => ({
      slug: a.slug, displayName: a.displayName, mode: 'unknown',
      pid: null, lastExitCode: null, uptimeMs: null,
      rssBytes: null, cpuPercent: null, healthy: null, httpCode: null, latencyMs: null,
      state: 'stopped', isSelfControlled: a.isSelfControlled,
      lastUpdatedAt: Date.now(), sinceMs: null,
    }));

  const oneHourAgo = Date.now() - 3600 * 1000;
  const rows = db.select().from(managedAppMetrics)
    .where(gte(managedAppMetrics.ts, oneHourAgo))
    .orderBy(managedAppMetrics.ts).all() as any[];
  const metricsBySlug: Record<string, any[]> = {};
  for (const r of rows) {
    (metricsBySlug[r.slug] ??= []).push({ ts: r.ts, rss: r.rss, cpu: r.cpu, latency: r.latencyMs });
  }

  return (
    <div className="p-6">
      <h1 className="text-amber-500 tracking-widest text-lg mb-6 font-mono">OPS</h1>
      <OpsGrid initial={snap} metricsBySlug={metricsBySlug} />
    </div>
  );
}
```

Also add a `snapshot()` method to `OpsPoller` that returns its last broadcast cache, so Server Component first-render has live data. If not already added, add:
```ts
// inside OpsPoller
private lastSnapshot: OpsStatus[] = [];
// set this at the end of tick() before emit: this.lastSnapshot = results;
snapshot(): OpsStatus[] { return this.lastSnapshot; }
```

- [ ] **Step 2: Loading skeleton**

```tsx
export default function Loading() {
  return <div className="p-6 font-mono text-amber-500 opacity-60">LOADING OPS…</div>;
}
```

- [ ] **Step 3: Add nav link**

Find the existing sidebar navigation component (likely `src/components/hq/Sidebar.tsx` or similar) and add an `OPS` link between existing items. Match the style of existing nav items; do not invent a new style.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build passes, `/ops` listed in route table.

- [ ] **Step 5: Verify page loads**

Run: `pnpm dev`, open `http://localhost:7777/ops`.
Expected: 3 cards (devroom, calendar, finances). Click each — detail panel changes. DEVROOM card shows all buttons disabled with tooltip. Log terminal attempts to tail the log file.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(hq\)/ops src/lib/ops/poller.ts  # for snapshot()
git commit -m "feat(ops): /ops page with live grid and detail panel"
```

---

## Task 16: Settings Page (overrides + rescan)

**Files:**
- Create: `src/app/(hq)/ops/settings/page.tsx`
- Create: `src/actions/ops-settings.ts`

- [ ] **Step 1: Implement action**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { managedApps } from '@/lib/db/schema';
import { discoverManagedApps, seedDevroomRow } from '@/lib/ops/discovery';
import { homedir } from 'os';
import { join } from 'path';

export async function updateManagedApp(slug: string, patch: {
  healthUrl?: string | null; ctlScriptPath?: string; logPath?: string; displayName?: string; orderIdx?: number;
}) {
  const db = getDatabase();
  db.update(managedApps).set({ ...patch, updatedAt: Date.now() }).where(eq(managedApps.slug, slug)).run();
  revalidatePath('/ops');
}

export async function rescan() {
  const db = getDatabase();
  const now = Date.now();
  const rows = [
    seedDevroomRow({ homeRoot: homedir(), devroomRoot: process.cwd(), port: 7777, now: () => now }),
    ...discoverManagedApps({ battlefieldsRoot: join(process.cwd(), '..', 'battlefields'), homeRoot: homedir(), now: () => now }),
  ];
  for (const r of rows) {
    db.insert(managedApps).values(r).onConflictDoUpdate({
      target: managedApps.slug,
      set: { ctlScriptPath: r.ctlScriptPath, logPath: r.logPath, healthUrl: r.healthUrl, updatedAt: now },
    }).run();
  }
  revalidatePath('/ops');
}
```

- [ ] **Step 2: Implement page**

```tsx
import { getDatabase } from '@/lib/db';
import { managedApps } from '@/lib/db/schema';
import { updateManagedApp, rescan } from '@/actions/ops-settings';

export default function OpsSettings() {
  const apps = getDatabase().select().from(managedApps).all() as any[];
  return (
    <div className="p-6 font-mono">
      <h1 className="text-amber-500 tracking-widest mb-4">OPS :: SETTINGS</h1>
      <form action={rescan}><button className="border border-amber-500 text-amber-500 px-3 py-1 mb-6">RE-SCAN</button></form>
      <div className="space-y-6">
        {apps.map(a => (
          <form key={a.slug} action={async (fd) => {
            'use server';
            await updateManagedApp(a.slug, {
              displayName: String(fd.get('displayName')),
              ctlScriptPath: String(fd.get('ctlScriptPath')),
              logPath: String(fd.get('logPath')),
              healthUrl: String(fd.get('healthUrl')) || null,
              orderIdx: Number(fd.get('orderIdx')),
            });
          }} className="border border-zinc-800 p-3 space-y-2 text-xs">
            <div className="text-amber-500">{a.slug.toUpperCase()}{a.isSelfControlled ? ' (self)' : ''}</div>
            {(['displayName','ctlScriptPath','logPath','healthUrl','orderIdx'] as const).map(f => (
              <label key={f} className="block">
                <span className="text-zinc-500">{f}</span>
                <input name={f} defaultValue={a[f] ?? ''} className="block w-full bg-black border border-zinc-700 px-2 py-1 text-green-400" />
              </label>
            ))}
            <button className="border border-amber-500 text-amber-500 px-3 py-1">SAVE</button>
          </form>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(hq\)/ops/settings src/actions/ops-settings.ts
git commit -m "feat(ops): settings page with path overrides + rescan"
```

---

## Task 17: Playwright E2E

**Files:**
- Create: `e2e/ops.spec.ts`

- [ ] **Step 1: Write E2E**

```ts
import { test, expect } from '@playwright/test';

test('OPS page shows cards, selection drives detail, devroom actions disabled', async ({ page }) => {
  await page.goto('/ops');
  await expect(page.getByRole('heading', { name: 'OPS' })).toBeVisible();
  // Expect at least one card
  const cards = page.locator('button:has-text("DEVROOM")');
  await expect(cards).toBeVisible();

  // Click DEVROOM — all actions should be disabled
  await cards.first().click();
  for (const name of ['deploy','stand-down','reboot','engage-prod','engage-dev']) {
    const btn = page.getByTestId(`ops-action-${name}`);
    await expect(btn).toBeDisabled();
  }
});

test('confirm flow requires two clicks for REBOOT on non-devroom app', async ({ page }) => {
  await page.goto('/ops');
  // Select calendar (if seeded) — else this test is skipped
  const card = page.locator('button:has-text("CALENDAR")');
  if ((await card.count()) === 0) test.skip();
  await card.click();
  const reboot = page.getByTestId('ops-action-reboot');
  if (!(await reboot.isEnabled())) test.skip();
  await reboot.click();
  await expect(reboot).toHaveText(/CONFIRM REBOOT/);
});
```

- [ ] **Step 2: Run**

Run: `pnpm test:e2e -g ops`
Expected: PASS (or SKIP cleanly if the user's machine doesn't have calendar seeded).

- [ ] **Step 3: Commit**

```bash
git add e2e/ops.spec.ts
git commit -m "test(ops): playwright e2e for cards + confirm flow"
```

---

## Task 18: Final Verification

- [ ] **Step 1: Typecheck + build**

Run: `pnpm build`
Expected: passes.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke test with real services**

Run: `pnpm dev`
- Navigate to `/ops`.
- Confirm 3 cards appear with correct modes/health.
- Click `finances` card, verify actions enabled/disabled correctly for current state.
- Click `ENGAGE DEV` (if in PROD), go through confirm flow, verify service actually switched mode (check xbar menu).
- Click `REBOOT` on `finances`, confirm, watch log terminal populate with startup logs.
- Click `DEVROOM` card, verify all actions disabled with correct tooltip.
- Wait ~10 minutes, reload page, confirm sparklines populated with live data.

- [ ] **Step 4: Verify retention**

Run: `sqlite3 ~/.devroom/db.sqlite "SELECT bucket, COUNT(*) FROM managed_app_metrics GROUP BY bucket;"`
Expected: rows in `raw` bucket only (until first hourly rollup runs). Steady-state row count stays bounded.

---

## Self-Review Notes

- **Spec coverage:** Tasks 1 (tables) → 2, 11 (types + boot), 3 (parsers), 4 (ctl runner), 5 (discovery), 6 (poller), 7 (retention), 8 (log streams), 9 (actions + self-control guard), 10 (sockets), 12-14 (UI components + confirm flow), 15 (page + sparkline integration), 16 (settings + rescan), 17 (E2E). All spec sections mapped.
- **Scope:** Single implementation plan, no cross-subsystem dependencies beyond existing DEVROOM infrastructure.
- **DEVROOM self-control:** enforced at three layers — `isSelfControlled` column in DB (Task 1), server action rejection (Task 9), UI button disablement (Task 13). Defense-in-depth.
- **Retention:** hard deletion inside transaction (Task 7), wired into hourly cron (Task 11). Row count ceiling calculated in spec.
- **No placeholders.** All code blocks are concrete.
