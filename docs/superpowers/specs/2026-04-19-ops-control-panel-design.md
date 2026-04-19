# OPS Control Panel — Managed App DevOps

**Date:** 2026-04-19
**Status:** Draft

## Summary

A new `/ops` page in DEVROOM that controls and monitors all Mac Mini-hosted apps (DEVROOM itself, `finances`, `calendar`, and future siblings). One global grid, one detail panel. Reuses the existing launchd + `<name>-ctl.sh` + `<name>-service.sh` + `~/.<name>/logs/` convention that xbar already drives. DEVROOM is rendered read-only for self-control safety.

## Motivation

Today, controlling a managed app (switch prod/dev, tail logs, restart, check health) requires either the xbar menu (limited actions) or dropping to a terminal. There is no single place to see the state of every app at once, no history of RAM/CPU behavior, and no ability to tail logs from another device on the LAN. The scripts and data already exist — they just need a tactical browser surface.

## Scope Decisions

**In scope (v1):**
- Global `/ops` page with per-app status cards and a shared detail panel (tabs within one page, no sub-routes).
- Auto-discovery of managed apps by filesystem convention, with optional per-app override rows.
- Live metrics poll (mode, uptime, health, RSS, CPU) via server-side background poller + Socket.IO broadcast.
- Live log tail via Socket.IO room per selected app.
- Actions: `DEPLOY`, `STAND DOWN`, `REBOOT`, `ENGAGE PROD`, `ENGAGE DEV` — state-aware enable/disable, two-step confirm click.
- Time-series metrics with hard retention (hourly rollup cron + weekly `VACUUM`). Sparklines for RSS / CPU / latency.
- DEVROOM row is read-only (all action endpoints reject `slug === "devroom"` server-side).

**Out of scope (v1):**
- Per-battlefield `/devops` tab (merged into the single `/ops` page).
- Per-app `/health` JSON contract (health is an HTTP probe to the app's root URL — reachable + 2xx = healthy).
- Remote apps / non-launchd apps.
- Alerts beyond what the existing notification system already gives us (adding per-app alert rules is a follow-up).
- Metric history dashboards beyond 7 days.

## Architecture

**Additions, no restructuring:**

- **`src/app/ops/page.tsx`** — Server Component. Reads current poller cache snapshot + a 1-hour metrics window from SQLite, hands both to a client component.
- **`src/components/ops/OpsGrid.tsx`** — Client Component. Subscribes to `ops:status`, renders status cards, manages selected-app state, renders the detail panel inline.
- **`src/components/ops/OpsDetail.tsx`** — Detail panel: action buttons, metric strip, sparklines, live log terminal. Terminal component is reused from the existing mission comms viewer.
- **`src/server/ops/poller.ts`** — Singleton OpsPoller. Started from `server.ts` alongside CONTROL. Polls all registered apps every 3s. Shells out in parallel via `execFile`. Writes to `managed_app_metrics`, broadcasts to `ops:status` room, maintains in-memory "latest" cache for fresh page loads.
- **`src/server/ops/log-stream.ts`** — Per-slug `tail -F` manager. Refcounted: first subscriber spawns `tail`, last unsubscribe kills it.
- **`src/server/ops/retention.ts`** — Cron-triggered rollup + delete in a single transaction. Runs hourly. Weekly `VACUUM` runs Sunday 04:00.
- **`src/server/ops/discovery.ts`** — Boot-time filesystem scan. Upserts managed app rows for any battlefield whose scripts match convention.
- **`src/actions/ops.ts`** — Server Actions: `startApp`, `stopApp`, `restartApp`, `setMode`. Each validates slug against registry, rejects DEVROOM, shells out via `execFile` to the registered `ctlScriptPath`.
- **`src/app/ops/settings/page.tsx`** — Simple form to edit paths/URLs when a convention doesn't fit.

## Data Model

New tables in `src/db/schema/managed-apps.ts`:

```ts
export const managedApps = sqliteTable("managed_apps", {
  slug: text("slug").primaryKey(),                    // "devroom", "finances"
  displayName: text("display_name").notNull(),
  battlefieldId: text("battlefield_id"),              // FK, null for devroom itself
  launchdLabel: text("launchd_label").notNull(),      // "com.devroom.app"
  ctlScriptPath: text("ctl_script_path").notNull(),
  logPath: text("log_path").notNull(),
  healthUrl: text("health_url").notNull(),            // "http://localhost:3000/"
  orderIdx: integer("order_idx").notNull().default(0),
  isSelfControlled: integer("is_self_controlled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const managedAppMetrics = sqliteTable("managed_app_metrics", {
  slug: text("slug").notNull(),
  ts: integer("ts").notNull(),                        // unix ms
  bucket: text("bucket").notNull(),                   // "raw" | "1m" | "5m"
  rss: integer("rss"),                                // bytes
  cpu: real("cpu"),                                   // percent
  healthy: integer("healthy", { mode: "boolean" }),
  httpCode: integer("http_code"),
  latencyMs: integer("latency_ms"),
}, (t) => ({
  byAppTs: index("mam_slug_ts").on(t.slug, t.ts),
  byBucket: index("mam_bucket_ts").on(t.bucket, t.ts),
}));
```

`isSelfControlled = true` is set only for the DEVROOM row. It drives both UI disablement and the server-side rejection. Using a column instead of hardcoding `slug === "devroom"` keeps the rule data-driven.

## Discovery & Registration

On `server.ts` boot, after DB migrations, before CONTROL starts:

1. Seed the DEVROOM row if absent (hardcoded paths, `isSelfControlled = true`).
2. Scan `/Users/nyhzdev/devroom/battlefields/*/scripts/<slug>-ctl.sh`. For each hit:
   - Derive `slug` from directory name.
   - Derive `launchdLabel = com.<slug>.app`.
   - Derive `logPath = ~/.<slug>/logs/<slug>.log`.
   - Derive `healthUrl` by reading the port from the ctl script (simple regex on `PORT=` or fallback to asking the user to set via overrides page).
   - Upsert the row, matching `battlefieldId` by slug if a battlefield with that slug exists.
3. Rows for apps whose scripts no longer exist are flagged stale (not deleted; commander may be editing).

A manual "Re-scan" button on `/ops/settings` triggers the same function.

## Poller

`OpsPoller.tick()` runs every 3s:

1. For each registered app, in parallel:
   - `execFile("launchctl", ["list", launchdLabel])` → parse PID, last exit status.
   - If PID > 0: `execFile("ps", ["-o", "rss=,%cpu=", "-p", pid])` → RSS KB, CPU %.
   - `fetch(healthUrl, { method: "GET", signal: AbortSignal.timeout(1500) })` → http code, latency.
2. Assemble `OpsStatus` record per app, push to in-memory cache, `io.to("ops:status").emit("ops:status", snapshot)`.
3. Write one row per app to `managed_app_metrics` with `bucket = "raw"`.
4. If a tick takes longer than 3s (e.g. slow shell), skip the next scheduled fire instead of overlapping. Apps whose last success is >10s old render with a dim timestamp on the card.

The poller uses a single `AbortController` per tick so the server can shut down cleanly.

## Retention

Hourly cron (`node-cron` or setInterval — whichever is already used for CONTROL cleanups):

```
BEGIN TRANSACTION
INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, ...)
  SELECT slug, (ts / 60000) * 60000 AS bucket_ts, '1m', AVG(rss), AVG(cpu), ...
  FROM managed_app_metrics
  WHERE bucket = 'raw' AND ts < strftime('%s','now','-1 hour') * 1000
  GROUP BY slug, bucket_ts;
DELETE FROM managed_app_metrics
  WHERE bucket = 'raw' AND ts < strftime('%s','now','-1 hour') * 1000;
-- same pattern for 1m → 5m at 24h boundary
DELETE FROM managed_app_metrics
  WHERE bucket = '5m' AND ts < strftime('%s','now','-7 days') * 1000;
COMMIT
```

Weekly: `VACUUM` on Sunday 04:00 local time to reclaim pages. The retention job is idempotent — re-running produces no double rollups because source rows are deleted inside the same transaction.

Steady-state row count ceiling (5 apps):
- Raw (1h @ 3s): 1,200 × 5 = 6,000 rows
- 1-min (24h): 1,440 × 5 = 7,200 rows
- 5-min (7d): 2,016 × 5 = 10,080 rows
- **Total: ~23,280 rows.** Bounded, never grows.

## UI

**Theme:** existing tactical tokens — black background, amber headers, green health accent, red alerts, monospace (`font-mono`). All text uppercase for labels, title case for body.

**Grid:**
- Cards 220×130px, 16px gap. Responsive to 1–4 columns.
- Card content: display name (amber, top-left), health dot (top-right, 8px, green/amber/red), mode badge (`PROD`/`DEV`, dim green/amber), uptime, RSS, CPU.
- Selected card: amber 1px border, 4px inset glow.

**Detail panel (below grid):**
- Row 1 — **ACTIONS**: state-aware buttons. Layout:

| State (PID, mode)           | Enabled buttons                   |
|-----------------------------|-----------------------------------|
| stopped                     | `DEPLOY`                          |
| running, PROD               | `STAND DOWN`, `REBOOT`, `ENGAGE DEV` |
| running, DEV                | `STAND DOWN`, `REBOOT`, `ENGAGE PROD`|
| running, unresponsive       | `REBOOT`, `STAND DOWN`            |
| DEVROOM (any state)         | all disabled, tooltip "self-control locked — use terminal" |

  Disabled buttons are dim with a single strikethrough underline. Enabled buttons are amber. Confirm-click: first click morphs to red `CONFIRM <ACTION>` for 3s, second fires.
- Row 2 — **TELEMETRY**: PID, launchd label, port, last exit code, log path. Plain `KEY :: VALUE` pairs, green values.
- Row 3 — **GRAPHS**: three hand-drawn SVG sparklines (RSS, CPU, latency) over a 1h window by default, with a toggle for 24h / 7d. Tactical styling: black background, amber 1px path, dashed 10% grid lines, green dot at current value, red tick markers at health-down events, amber tick markers at mode/state transitions.
- Row 4 — **COMMS**: reused mission log terminal showing the live `tail -F`. Last 200 lines pre-loaded on open, streams after. Auto-scroll toggle, "CLEAR" button (clears local view only), copy-to-clipboard.

## Actions (Server Actions)

`src/actions/ops.ts`:

```ts
async function startApp(slug: string): Promise<ActionResult>
async function stopApp(slug: string): Promise<ActionResult>
async function restartApp(slug: string): Promise<ActionResult>
async function setMode(slug: string, mode: "prod" | "dev"): Promise<ActionResult>
```

Each:
1. Looks up the app row by slug; 404 if missing.
2. Rejects with `"self-control locked"` if `isSelfControlled`.
3. `execFile(ctlScriptPath, [subcommand], { timeout: 30_000 })` — never `exec`, never shell interpretation.
4. Returns exit code + stdout/stderr tails for the toast. On failure, the UI surfaces the stderr tail.
5. Calls `revalidatePath("/ops")` on success; the next poller tick also pushes fresh state over Socket.IO.

## Error Handling & Edge Cases

- **Plist exists, no PID in launchctl** → `OFFLINE` red dot, only `DEPLOY` enabled.
- **PID exists, health probe fails** → `UNRESPONSIVE` amber, `REBOOT`/`STAND DOWN` enabled.
- **Action script non-zero exit** → red flash on button, toast with stderr tail. No auto-retry.
- **Log file rotated / truncated** → `tail -F` reconnects transparently.
- **Log file missing** → detail shows `NO COMMS` placeholder instead of terminal.
- **Poller tick exceeds 3s** → skip next tick, mark app stale after 10s without success.
- **Action on DEVROOM** → Server Action rejects; UI should never have allowed it. Defense-in-depth.
- **Unknown slug in any endpoint** → 404. No shelling with arbitrary input.
- **Boot-time discovery crash** → server still boots; `/ops` shows empty state + "discovery failed" banner + retry button.
- **Port extraction fails for a new app** → row created with `healthUrl = null`; card renders `HEALTH UNKNOWN`; settings page prompts commander to fill it in.

## Testing

- **Unit (Vitest):**
  - Poller parsers: `launchctl list` output → PID + exit status; `ps -o rss,%cpu` → numbers; health fetch result → status + latency. Recorded fixture strings.
  - Retention rollup math: seed N raw rows across 2 hours, run rollup, assert 1-min rows produced + raw rows deleted.
  - Self-control guard: all four Server Actions reject DEVROOM with the exact error.
  - Discovery: pointed at a tmpdir mock of `battlefields/`, produces expected rows.
- **Integration:**
  - Fake ctl script writes to a known file; assert each Server Action calls it with the right subcommand and cwd.
  - Poller end-to-end: write a fake `launchctl`/`ps` shim on PATH, tick once, assert DB row + socket emission.
- **E2E (Playwright):**
  - Seed 3 managed apps + stubbed poller cache. Navigate to `/ops`.
  - Cards render with correct mode/uptime/health.
  - Click non-devroom card → detail panel shows correct action set.
  - Click DEVROOM card → all actions disabled with tooltip.
  - Click `REBOOT`, verify two-click confirm flow.
  - Select an app, assert log terminal renders the stubbed tail.

No real-LLM paths; no `test:e2e:real` additions.

## Dependencies

None beyond what DEVROOM already has. Shells out via Node `child_process.execFile`, uses `fetch` for health, uses existing Socket.IO infra, existing Drizzle, existing mission terminal component, existing Tailwind tactical tokens.

## Open Questions

None. All decisions locked during brainstorming.
