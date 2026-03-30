# System Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Intel Bar's rotating quotes with a real-time system monitor showing per-core CPU, RAM, disk, uptime, and active assets.

**Architecture:** A new server-side module (`system-metrics.ts`) collects OS metrics every 10 seconds and emits them via Socket.IO to subscribed clients. A new client component (`SystemMonitor`) renders the data with color-coded thresholds. The Intel Bar is refactored to use this component instead of the quote rotation.

**Tech Stack:** Node.js `os` module (CPU/RAM), `child_process.execSync` (disk via `df`), Socket.IO (real-time transport), React + Tailwind (rendering).

---

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | Add `SystemMetrics` interface |
| `src/lib/system-metrics.ts` | Create | Collect CPU/RAM/disk/uptime/assets, emit on interval |
| `src/lib/socket/server.ts` | Modify | Add `system:subscribe`/`system:unsubscribe` handlers |
| `server.ts` | Modify | Capture boot timestamp, start metrics emitter |
| `src/hooks/use-system-metrics.ts` | Create | Socket.IO subscription hook for system metrics |
| `src/components/layout/system-monitor.tsx` | Create | Client component rendering the metric strip |
| `src/components/layout/intel-bar.tsx` | Modify | Remove quotes, integrate SystemMonitor |

---

### Task 1: Add SystemMetrics type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the SystemMetrics interface**

Add at the end of `src/types/index.ts`:

```typescript
// ---------------------------------------------------------------------------
// System monitoring
// ---------------------------------------------------------------------------
export interface SystemMetrics {
  cores: number[];
  ram: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  uptime: number;
  assets: { active: number; max: number };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(system-monitor): add SystemMetrics type"
```

---

### Task 2: Create system metrics collector

**Files:**
- Create: `src/lib/system-metrics.ts`

- [ ] **Step 1: Create the metrics collection module**

Create `src/lib/system-metrics.ts`:

```typescript
import os from 'os';
import { execSync } from 'child_process';
import { Server as SocketIOServer } from 'socket.io';
import { config } from '@/lib/config';
import type { SystemMetrics } from '@/types';

const INTERVAL_MS = 10_000;
const ROOM = 'system:status';

let timer: ReturnType<typeof setInterval> | null = null;
let prevCpuTicks: { idle: number; total: number }[] | null = null;
let bootTimestamp: number = Date.now();

export function setBootTimestamp(ts: number): void {
  bootTimestamp = ts;
}

function computeCoreUsage(): number[] {
  const cpus = os.cpus();
  const current = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return { idle: cpu.times.idle, total };
  });

  if (!prevCpuTicks) {
    prevCpuTicks = current;
    // First sample — return zeros (no delta yet)
    return cpus.map(() => 0);
  }

  const usage = current.map((cur, i) => {
    const prev = prevCpuTicks![i];
    const totalDelta = cur.total - prev.total;
    const idleDelta = cur.idle - prev.idle;
    if (totalDelta === 0) return 0;
    return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  });

  prevCpuTicks = current;
  return usage;
}

function getDiskUsage(): { used: number; total: number; percent: number } {
  try {
    const output = execSync('df -k /', { encoding: 'utf-8', timeout: 3000 });
    const lines = output.trim().split('\n');
    // Second line has the data; columns: Filesystem 1K-blocks Used Available Use% Mounted
    const parts = lines[1].split(/\s+/);
    const total = parseInt(parts[1], 10) * 1024; // bytes
    const used = parseInt(parts[2], 10) * 1024;
    const percent = Math.round((used / total) * 100);
    return { used, total, percent };
  } catch {
    return { used: 0, total: 0, percent: 0 };
  }
}

function collectMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const orchestrator = globalThis.orchestrator;

  return {
    cores: computeCoreUsage(),
    ram: {
      used: usedMem,
      total: totalMem,
      percent: Math.round((usedMem / totalMem) * 100),
    },
    disk: getDiskUsage(),
    uptime: Date.now() - bootTimestamp,
    assets: {
      active: orchestrator?.getActiveCount() ?? 0,
      max: config.maxAgents,
    },
  };
}

export function startMetricsEmitter(io: SocketIOServer): void {
  if (timer) return; // Already running

  // Take an initial CPU snapshot so the first real emit has a delta
  computeCoreUsage();

  timer = setInterval(() => {
    const room = io.sockets.adapter.rooms.get(ROOM);
    if (!room || room.size === 0) {
      // No subscribers — stop emitting, clear previous ticks
      stopMetricsEmitter();
      return;
    }
    const metrics = collectMetrics();
    io.to(ROOM).emit('system:metrics', metrics);
  }, INTERVAL_MS);
}

export function stopMetricsEmitter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  prevCpuTicks = null;
}

export function isEmitterRunning(): boolean {
  return timer !== null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/system-metrics.ts
git commit -m "feat(system-monitor): add system metrics collector module"
```

---

### Task 3: Wire Socket.IO subscriptions and server startup

**Files:**
- Modify: `src/lib/socket/server.ts`
- Modify: `server.ts`

- [ ] **Step 1: Add system subscribe/unsubscribe handlers to socket server**

In `src/lib/socket/server.ts`, add these two imports at the top:

```typescript
import { startMetricsEmitter, isEmitterRunning } from '@/lib/system-metrics';
```

Then inside the `io.on('connection', (socket) => { ... })` block, before the `disconnect` handler, add:

```typescript
    socket.on('system:subscribe', () => {
      socket.join('system:status');
      if (!isEmitterRunning()) {
        startMetricsEmitter(io);
      }
    });

    socket.on('system:unsubscribe', () => {
      socket.leave('system:status');
    });
```

- [ ] **Step 2: Capture boot timestamp and initialize metrics in server.ts**

In `server.ts`, add this import alongside the existing ones:

```typescript
import { setBootTimestamp } from './src/lib/system-metrics';
```

Then right after the `const dev = ...` line (line 27), add:

```typescript
const SERVER_BOOT_TIME = Date.now();
```

Then after `setupSocketIO(io);` (after line 52), add:

```typescript
  setBootTimestamp(SERVER_BOOT_TIME);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/socket/server.ts server.ts
git commit -m "feat(system-monitor): wire Socket.IO subscriptions and boot timestamp"
```

---

### Task 4: Create useSystemMetrics hook

**Files:**
- Create: `src/hooks/use-system-metrics.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/use-system-metrics.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import type { SystemMetrics } from '@/types';

export function useSystemMetrics() {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit('system:subscribe');

    const handleMetrics = (data: SystemMetrics) => {
      setMetrics(data);
    };

    socket.on('system:metrics', handleMetrics);

    return () => {
      socket.off('system:metrics', handleMetrics);
      socket.emit('system:unsubscribe');
    };
  }, [socket, reconnectKey]);

  return metrics;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-system-metrics.ts
git commit -m "feat(system-monitor): add useSystemMetrics hook"
```

---

### Task 5: Create SystemMonitor component

**Files:**
- Create: `src/components/layout/system-monitor.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/layout/system-monitor.tsx`:

```typescript
'use client';

import { useSystemMetrics } from '@/hooks/use-system-metrics';
import { cn } from '@/lib/utils';

function thresholdColor(percent: number): string {
  if (percent >= 85) return 'bg-dr-red';
  if (percent >= 60) return 'bg-dr-amber';
  return 'bg-dr-green';
}

function thresholdText(percent: number): string {
  if (percent >= 85) return 'text-dr-red';
  if (percent >= 60) return 'text-dr-amber';
  return 'text-dr-green';
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)}M`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SystemMonitor() {
  const metrics = useSystemMetrics();

  if (!metrics) {
    return (
      <div className="flex items-center gap-2 text-dr-dim text-xs flex-1">
        <span className="text-dr-amber font-bold text-sm">SYS //</span>
        <span className="text-xs">CONNECTING...</span>
      </div>
    );
  }

  const criticalCores = metrics.cores.filter((c) => c >= 85).length;

  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <span className="text-dr-amber font-bold text-sm whitespace-nowrap">
        SYS //
      </span>

      {/* CPU — per-core vertical bars */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">CPU</span>
        <div className="flex items-end gap-[2px] h-3.5">
          {metrics.cores.map((usage, i) => (
            <div
              key={i}
              className="w-[4px] bg-dr-elevated relative"
              style={{ height: '100%' }}
              title={`Core ${i}: ${usage}%`}
            >
              <div
                className={cn('absolute bottom-0 left-0 right-0', thresholdColor(usage))}
                style={{ height: `${Math.max(usage, 2)}%` }}
              />
            </div>
          ))}
        </div>
        {criticalCores > 0 && (
          <span className="text-dr-red text-xs font-bold animate-pulse">
            !{criticalCores}
          </span>
        )}
      </div>

      {/* RAM */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">RAM</span>
        <div className="w-12 h-[5px] bg-dr-elevated overflow-hidden">
          <div
            className={thresholdColor(metrics.ram.percent)}
            style={{ width: `${metrics.ram.percent}%`, height: '100%' }}
          />
        </div>
        <span className={cn('text-xs', thresholdText(metrics.ram.percent))}>
          {formatBytes(metrics.ram.used)}
        </span>
      </div>

      {/* Disk */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">DSK</span>
        <div className="w-12 h-[5px] bg-dr-elevated overflow-hidden">
          <div
            className={thresholdColor(metrics.disk.percent)}
            style={{ width: `${metrics.disk.percent}%`, height: '100%' }}
          />
        </div>
        <span className={cn('text-xs', thresholdText(metrics.disk.percent))}>
          {metrics.disk.percent}%
        </span>
      </div>

      {/* Separator */}
      <span className="text-dr-border">|</span>

      {/* Uptime */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">UP</span>
        <span className="text-dr-text text-xs">{formatUptime(metrics.uptime)}</span>
      </div>

      {/* Separator */}
      <span className="text-dr-border">|</span>

      {/* Assets */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">ASSETS</span>
        <span className={cn('text-xs', metrics.assets.active >= metrics.assets.max ? 'text-dr-amber' : 'text-dr-green')}>
          {metrics.assets.active}
        </span>
        <span className="text-dr-dim text-xs">/</span>
        <span className="text-dr-text text-xs">{metrics.assets.max}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/system-monitor.tsx
git commit -m "feat(system-monitor): add SystemMonitor component with per-core CPU bars"
```

---

### Task 6: Integrate into Intel Bar and remove quotes

**Files:**
- Modify: `src/components/layout/intel-bar.tsx`

- [ ] **Step 1: Remove quotes and integrate SystemMonitor**

Replace the entire content of `src/components/layout/intel-bar.tsx` with:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/hooks/use-notifications";
import { cn, formatRelativeTime } from "@/lib/utils";
import { SystemMonitor } from "@/components/layout/system-monitor";
import type { Notification } from "@/types";

function levelIcon(level: string): string {
  switch (level) {
    case 'critical': return '\u{1F6A8}';
    case 'warning': return '\u26A0\uFE0F';
    default: return '\u2139\uFE0F';
  }
}

function levelColor(level: string): string {
  switch (level) {
    case 'critical': return 'text-dr-red';
    case 'warning': return 'text-dr-amber';
    default: return 'text-dr-dim';
  }
}

function entityLink(n: Notification): string | null {
  if (!n.entityType || !n.entityId) return null;
  if (!n.battlefieldId) return null;

  switch (n.entityType) {
    case 'mission':
      return `/battlefields/${n.battlefieldId}/missions/${n.entityId}`;
    case 'campaign':
      return `/battlefields/${n.battlefieldId}/campaigns/${n.entityId}`;
    case 'phase':
      return null;
    default:
      return null;
  }
}

export function IntelBar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read) {
      await markAsRead(n.id);
    }
    const link = entityLink(n);
    if (link) {
      router.push(link);
      setDropdownOpen(false);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
  };

  return (
    <header className="bg-dr-surface border-b border-dr-border px-6 py-2.5 flex items-center gap-4 min-h-[44px]">
      <SystemMonitor />

      {/* Notification Bell */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-1 text-xs hover:opacity-80 transition-opacity px-1"
          title="Notifications"
        >
          <span className={unreadCount > 0 ? 'text-dr-amber' : 'text-dr-dim'}>
            {'\u{1F514}'}
          </span>
          {unreadCount > 0 && (
            <span className="text-dr-red font-bold text-xs min-w-[14px] text-center bg-dr-red/20 px-1 rounded-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown Panel */}
        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-[380px] bg-dr-surface border border-dr-border shadow-lg z-50 max-h-[420px] flex flex-col">
            <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
              <span className="text-dr-amber text-xs font-bold">NOTIFICATIONS</span>
              {unreadCount > 0 && (
                <span className="text-dr-muted text-sm">{unreadCount} UNREAD</span>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-dr-muted text-sm">
                  No notifications
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-3 py-2 border-b border-dr-border/50 hover:bg-dr-elevated transition-colors ${
                      !n.read ? 'bg-dr-elevated/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm flex-shrink-0 mt-0.5">
                        {levelIcon(n.level)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold truncate ${levelColor(n.level)}`}>
                            {n.title}
                          </span>
                          {!n.read && (
                            <span className="w-2 h-2 bg-dr-amber rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-dr-muted truncate mt-0.5">
                          {n.detail}
                        </p>
                        <span className="text-xs text-dr-dim mt-0.5 block" suppressHydrationWarning>
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="px-3 py-2 border-t border-dr-border flex items-center justify-between gap-2">
              {notifications.length > 0 ? (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-dr-amber hover:text-dr-green transition-colors font-bold"
                >
                  [ MARK ALL READ ]
                </button>
              ) : (
                <span />
              )}
              <Link
                href="/notifications"
                onClick={() => setDropdownOpen(false)}
                className="text-xs text-dr-muted hover:text-dr-amber transition-colors font-bold"
              >
                [ ALL NOTIFICATIONS ]
              </Link>
            </div>
          </div>
        )}
      </div>

      <Link
        href="/logistics"
        className="flex items-center gap-1.5 text-xs whitespace-nowrap hover:opacity-80 transition-opacity"
      >
        <span className="text-dr-muted">LOGISTICS</span>
        <span className="text-sm text-dr-green">{'\u25CF'}</span>
      </Link>
    </header>
  );
}
```

**What was removed:**
- `INTEL_QUOTES` array (lines 10-26)
- `index` state and `visible` state (quote rotation)
- `useEffect` with quote rotation interval + fade logic (lines 70-85)
- The `INTEL //` label and quote `<span>` (lines 123-133)

**What was added:**
- Import `SystemMonitor` component
- `<SystemMonitor />` placed as first child in the header, takes `flex-1` to fill available space

- [ ] **Step 2: Verify the app compiles**

Run: `cd /Users/nyhzdev/devroom/nyhzops-devroom && npx next build 2>&1 | tail -20`

Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/intel-bar.tsx
git commit -m "feat(system-monitor): integrate into Intel Bar, remove rotating quotes"
```

---

### Task 7: Smoke test

- [ ] **Step 1: Start the dev server and verify metrics flow**

Run: `cd /Users/nyhzdev/devroom/nyhzops-devroom && npm run dev`

Open `http://localhost:3000` in a browser. Verify:
1. The Intel Bar shows `SYS // CONNECTING...` briefly, then populates with metrics
2. CPU shows 10 vertical mini-bars (one per core on Mac Mini)
3. RAM shows a horizontal bar with used memory in GB
4. DSK shows a horizontal bar with usage percentage
5. Uptime counts up from server start
6. Assets shows active/max count
7. No rotating quotes remain

- [ ] **Step 2: Verify per-core detection works**

Run a CPU stress test in another terminal to peg one core:

```bash
yes > /dev/null &
```

After ~10 seconds, one CPU bar should turn red and the `!1` indicator should appear. Kill it with `kill %1`.

- [ ] **Step 3: Verify cleanup — no stale quote code**

Run: `grep -r "INTEL_QUOTES\|INTEL //" src/`

Expected: No matches. The quotes system is fully removed.
