# System Monitor — Intel Bar

**Date:** 2026-03-31
**Status:** Draft

## Summary

Replace the rotating military quotes in the Intel Bar with a real-time Mac Mini system monitor. Displays per-core CPU load, RAM usage, disk usage, app uptime, and active asset count. Refreshes every 10 seconds via Socket.IO.

## Motivation

The DEVROOM server runs on a Mac Mini. Runaway processes can peg individual CPU cores at 100% for hours without being noticed — averaging across 10 cores masks the problem (100% on one core = ~10% average). A per-core visual in the topbar makes hot cores immediately visible.

## What Changes

### Removed

- **Rotating quotes system** — the `INTEL_QUOTES` array, rotation interval (60s), fade transition state, and all associated logic in `intel-bar.tsx`. Full removal, no dead code left behind.
- The `INTEL //` prefix label is replaced by `SYS //`.

### Added

**Server: System metrics emitter**

A new module that collects system metrics and emits them over Socket.IO every 10 seconds.

Data sources (all built-in, no new dependencies):

| Metric | Source | Notes |
|--------|--------|-------|
| CPU per-core | `os.cpus()` | Compute delta between ticks snapshots to get per-core utilization % |
| RAM | `os.totalmem()`, `os.freemem()` | Report used amount (total - free) and percentage |
| Disk | `child_process.execSync('df -k /')` | Parse output for root volume usage %. Single sync call every 10s is fine. |
| Uptime | `Date.now() - serverBootTimestamp` | Server boot time captured once at startup |
| Active assets | `globalThis.orchestrator.getActiveCount()` and max slots | Already available on the orchestrator |

Socket.IO pattern:
- New room: `system:status`
- New events: `system:subscribe`, `system:unsubscribe`, `system:metrics`
- The metrics emitter starts on first subscriber, stops when the room is empty (no wasted work when nobody is watching).

Payload shape:

```typescript
interface SystemMetrics {
  cores: number[]           // per-core utilization 0-100, length = core count
  ram: { used: number; total: number; percent: number }
  disk: { used: number; total: number; percent: number }
  uptime: number            // milliseconds since server boot
  assets: { active: number; max: number }
}
```

**Client: SystemMonitor component**

A `"use client"` component that replaces the quote rotation in the Intel Bar.

Display layout (left to right):
1. `SYS //` label (amber, matches existing prefix style)
2. `CPU` label + 10 vertical mini-bars (one per core, color-coded) + critical count indicator (`!N` in red when any core >85%)
3. `RAM` label + horizontal bar + used amount (e.g., `4.2G`)
4. `DSK` label + horizontal bar + percentage
5. `|` separator
6. `UP` label + formatted duration (e.g., `2d 14h 32m`)
7. `|` separator
8. `ASSETS` label + active/max count (e.g., `3/5`)

The existing right side (notifications bell, logistics link) is unchanged.

Color thresholds (applied per-metric):

| Range | Color | Token |
|-------|-------|-------|
| 0–60% | Green | `dr-green` (#00ff41) |
| 60–85% | Amber | `dr-amber` (#ffbf00) |
| 85–100% | Red | `dr-red` (#ff3333) |

CPU cores are colored individually. The `!N` indicator appears only when at least one core exceeds 85%, showing how many cores are in critical state.

RAM and Disk bars follow the same thresholds based on their usage percentage.

Assets count: green when below max, amber when at max capacity.

Uptime is always displayed in `dr-text` (#b8b8c8) — it has no threshold behavior.

**Socket.IO subscription pattern:**

Follows the existing room-based pattern used throughout the app:
- On mount: emit `system:subscribe`, listen for `system:metrics`
- On unmount: emit `system:unsubscribe`, remove listener
- On reconnect (via `reconnectKey`): re-subscribe

## Files Affected

| File | Change |
|------|--------|
| `src/components/layout/intel-bar.tsx` | Remove quotes, integrate `SystemMonitor` component |
| `src/components/layout/system-monitor.tsx` | New client component — metric display with Socket.IO subscription |
| `src/lib/socket/server.ts` | Add `system:subscribe`/`system:unsubscribe` handlers and `system:metrics` emitter |
| `src/lib/system-metrics.ts` | New module — collects CPU/RAM/disk/uptime/assets data |
| `server.ts` | Capture boot timestamp, pass to metrics module |

## Out of Scope

- Historical graphs or sparklines — this is a live status display only.
- Notifications or alerts triggered by thresholds — the visual indicator is the alert. Telegram/notification integration can be added later if needed.
- Per-process breakdown — we show core load, not which process is causing it.
- Network metrics — not needed for this use case.
