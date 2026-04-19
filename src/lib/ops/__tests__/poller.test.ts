import { describe, it, expect } from 'vitest';
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
    const writes: Array<Record<string, unknown>> = [];
    const emits: Array<Array<Record<string, unknown>>> = [];
    const poller = new OpsPoller({
      listApps: () => [app],
      runLaunchctl: async () => 'pid = 42\nlast exit code = 0\n',
      runPs: async () => '  81920  0.5',
      probeHealth: async () => ({ healthy: true, httpCode: 200, latencyMs: 12 }),
      readMode: () => 'prod',
      writeMetric: (row) => writes.push(row),
      emit: (snap) => emits.push(snap as unknown as Array<Record<string, unknown>>),
      now: () => 1_700_000_000_000,
    });
    await poller.tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ slug: 'finances', bucket: 'raw', rss: 81920 * 1024, cpu: 0.5, healthy: true });
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toMatchObject({ slug: 'finances', state: 'running', mode: 'prod', pid: 42 });
  });

  it('marks stopped apps correctly when pid is null', async () => {
    const emits: Array<Array<Record<string, unknown>>> = [];
    const poller = new OpsPoller({
      listApps: () => [app],
      runLaunchctl: async () => 'Could not find service',
      runPs: async () => '',
      probeHealth: async () => ({ healthy: false, httpCode: null, latencyMs: null }),
      readMode: () => 'prod',
      writeMetric: () => {},
      emit: (snap) => emits.push(snap as unknown as Array<Record<string, unknown>>),
      now: () => 1_700_000_000_000,
    });
    await poller.tick();
    expect(emits[0][0].state).toBe('stopped');
    expect(emits[0][0].pid).toBeNull();
  });

  it('marks unresponsive when pid exists but health fails', async () => {
    const emits: Array<Array<Record<string, unknown>>> = [];
    const poller = new OpsPoller({
      listApps: () => [app],
      runLaunchctl: async () => 'pid = 42\nlast exit code = 0',
      runPs: async () => '  81920  0.5',
      probeHealth: async () => ({ healthy: false, httpCode: 500, latencyMs: 20 }),
      readMode: () => 'prod',
      writeMetric: () => {},
      emit: (snap) => emits.push(snap as unknown as Array<Record<string, unknown>>),
      now: () => 1_700_000_000_000,
    });
    await poller.tick();
    expect(emits[0][0].state).toBe('unresponsive');
  });
});
