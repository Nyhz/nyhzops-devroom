import { describe, it, expect, beforeEach } from 'vitest';
import { getControlConfig, clearConfigCache } from '@/control/config';
import { getDatabase } from '@/lib/db';
import { settings } from '@/lib/db/schema';

const db = getDatabase();

describe('getControlConfig', () => {
  beforeEach(() => {
    clearConfigCache();
    db.delete(settings).run();
  });

  it('returns hardcoded defaults when no settings exist', () => {
    const cfg = getControlConfig();
    expect(cfg.maxAgents).toBe(3);
    expect(cfg.attemptHardTimeoutMs).toBe(1_800_000);
    expect(cfg.stdoutSilenceMs).toBe(300_000);
    expect(cfg.infraRetryBackoffMs).toEqual([30_000, 120_000, 600_000, 1_800_000]);
    expect(cfg.gateSuiteTimeoutMs).toBe(900_000);
    expect(cfg.gatePerCommandTimeoutMs).toBe(300_000);
    expect(cfg.reconStdoutSilenceMs).toBe(600_000);
    expect(cfg.quartermasterTimeoutMs).toBe(600_000);
  });

  it('reads overrides from settings table for tunable keys', () => {
    db.insert(settings).values({ key: 'devroom_max_agents', value: '5', updatedAt: Date.now() }).run();
    clearConfigCache();
    expect(getControlConfig().maxAgents).toBe(5);
  });
});
