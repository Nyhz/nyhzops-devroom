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
