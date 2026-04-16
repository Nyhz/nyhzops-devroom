import { getDatabase } from '@/lib/db';
import { settings } from '@/lib/db/schema';

export interface ControlConfig {
  maxAgents: number;
  attemptHardTimeoutMs: number;
  stdoutSilenceMs: number;
  reconStdoutSilenceMs: number;
  infraRetryBackoffMs: number[];
  gateSuiteTimeoutMs: number;
  gatePerCommandTimeoutMs: number;
  quartermasterTimeoutMs: number;
}

const DEFAULTS: ControlConfig = {
  maxAgents: 3,
  attemptHardTimeoutMs: 1_800_000,
  stdoutSilenceMs: 300_000,
  reconStdoutSilenceMs: 600_000,
  infraRetryBackoffMs: [30_000, 120_000, 600_000, 1_800_000],
  gateSuiteTimeoutMs: 900_000,
  gatePerCommandTimeoutMs: 300_000,
  quartermasterTimeoutMs: 600_000,
};

let cache: ControlConfig | null = null;

export function clearConfigCache(): void {
  cache = null;
}

export function getControlConfig(): ControlConfig {
  if (cache) return cache;
  const db = getDatabase();
  const rows = db.select().from(settings).all();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const cfg: ControlConfig = {
    ...DEFAULTS,
    maxAgents:
      parseInt(map.get('devroom_max_agents') ?? '', 10) || DEFAULTS.maxAgents,
    attemptHardTimeoutMs:
      parseInt(map.get('attempt_hard_timeout_ms') ?? '', 10) ||
      DEFAULTS.attemptHardTimeoutMs,
    stdoutSilenceMs:
      parseInt(map.get('stdout_silence_ms') ?? '', 10) ||
      DEFAULTS.stdoutSilenceMs,
  };
  cache = cfg;
  return cfg;
}
