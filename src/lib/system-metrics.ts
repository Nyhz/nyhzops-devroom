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
    // Use /System/Volumes/Data on macOS — df -k / reports the read-only system snapshot
    const output = execSync('df -k /System/Volumes/Data', { encoding: 'utf-8', timeout: 3000 });
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

