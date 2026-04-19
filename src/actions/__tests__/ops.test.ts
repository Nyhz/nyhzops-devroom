import { describe, it, expect, vi } from 'vitest';
import { _makeOpsActions } from '@/lib/ops/actions-factory';
import type { ManagedApp } from '@/lib/ops/types';

const devroom: ManagedApp = {
  slug: 'devroom', displayName: 'DEVROOM', battlefieldId: null,
  launchdLabel: 'com.devroom.app', ctlScriptPath: '/bin/true',
  logPath: '/tmp/d.log', healthUrl: null, orderIdx: 0,
  isSelfControlled: true, createdAt: 0, updatedAt: 0,
};
const finances: ManagedApp = { ...devroom, slug: 'finances', displayName: 'FIN', launchdLabel: 'com.finances.app', isSelfControlled: false };

describe('ops server actions', () => {
  it('rejects any action on a self-controlled app', async () => {
    const actions = _makeOpsActions({
      getApp: (slug) => slug === 'devroom' ? devroom : null,
      runner: { run: vi.fn() },
      revalidate: () => {},
    });
    const r = await actions.restartApp('devroom');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/self-control locked/i);
  });

  it('404s on unknown slug', async () => {
    const actions = _makeOpsActions({ getApp: () => null, runner: { run: vi.fn() }, revalidate: () => {} });
    const r = await actions.startApp('ghost');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown/i);
  });

  it('invokes ctl script with the right subcommand for restart', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const actions = _makeOpsActions({ getApp: () => finances, runner: { run }, revalidate: () => {} });
    const r = await actions.restartApp('finances');
    expect(r.ok).toBe(true);
    expect(run).toHaveBeenCalledWith('/bin/true', ['restart'], 30_000);
  });

  it('setMode("dev") passes "dev" subcommand', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const actions = _makeOpsActions({ getApp: () => finances, runner: { run }, revalidate: () => {} });
    await actions.setMode('finances', 'dev');
    expect(run).toHaveBeenCalledWith('/bin/true', ['dev'], 30_000);
  });

  it('returns non-ok with stderr tail on non-zero exit', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'boom' });
    const actions = _makeOpsActions({ getApp: () => finances, runner: { run }, revalidate: () => {} });
    const r = await actions.stopApp('finances');
    expect(r.ok).toBe(false);
    expect(r.stderrTail).toBe('boom');
  });
});
