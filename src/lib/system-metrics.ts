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
    // macOS: /System/Volumes/Data is where user data lives (/ is a read-only snapshot)
    // Linux/Docker: / is the real root filesystem
    const diskPath = os.platform() === 'darwin' ? '/System/Volumes/Data' : '/';
    const output = execSync(`df -k ${diskPath}`, { encoding: 'utf-8', timeout: 3000 });
    const lines = output.trim().split('\n');
    const parts = lines[1].split(/\s+/);
    const total = parseInt(parts[1], 10) * 1024; // bytes
    const used = parseInt(parts[2], 10) * 1024;
    const percent = Math.round((used / total) * 100);
    return { used, total, percent };
  } catch {
    return { used: 0, total: 0, percent: 0 };
  }
}

function getMemoryUsed(): number {
  if (os.platform() === 'darwin') {
    // Parse vm_stat to match Activity Monitor's "Memory Used" (active + wired pages)
    // os.freemem() counts file cache as "used" which inflates the number
    try {
      const output = execSync('vm_stat', { encoding: 'utf-8', timeout: 3000 });
      const pageSize = parseInt(output.match(/page size of (\d+)/)?.[1] ?? '16384', 10);
      const active = parseInt(output.match(/Pages active:\s+(\d+)/)?.[1] ?? '0', 10);
      const wired = parseInt(output.match(/Pages wired down:\s+(\d+)/)?.[1] ?? '0', 10);
      const compressor = parseInt(output.match(/Pages occupied by compressor:\s+(\d+)/)?.[1] ?? '0', 10);
      return (active + wired + compressor) * pageSize;
    } catch {
      return os.totalmem() - os.freemem();
    }
  }
  // Linux: os.freemem() already excludes buffers/cache, so this is accurate
  return os.totalmem() - os.freemem();
}

function collectMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const usedMem = getMemoryUsed();

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
      active: orchestrator?.getWorkingCount() ?? 0,
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

