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
