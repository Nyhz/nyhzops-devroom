import { describe, it, expect, vi } from 'vitest';
import { runGates } from '@/control/gates';

describe('runGates', () => {
  const manifest = {
    lint: 'pnpm lint',
    typecheck: 'tsc --noEmit',
    build: 'pnpm build',
    test: 'pnpm test',
  };

  it('runs in order lint → typecheck → build → test and stops on first fail', async () => {
    const calls: string[] = [];
    const spawn = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      return {
        code: cmd.includes('build') ? 1 : 0,
        stdout: '',
        stderr: cmd.includes('build') ? 'broken' : '',
        durationMs: 10,
        timedOut: false,
        commandMissing: false,
      };
    });
    const r = await runGates({
      manifest,
      workingDir: '/tmp',
      perCommandTimeoutMs: 1000,
      suiteTimeoutMs: 10000,
      spawnShell: spawn,
    });
    expect(calls).toEqual(['pnpm lint', 'tsc --noEmit', 'pnpm build']);
    expect(r.overallStatus).toBe('fail');
    expect(r.results[2].status).toBe('fail');
    expect(r.results.find((x) => x.gate === 'test')).toBeUndefined();
  });

  it('skips gates whose command is null', async () => {
    const manifestNoLint = { ...manifest, lint: null };
    const spawn = vi.fn(async () => ({
      code: 0,
      stdout: '',
      stderr: '',
      durationMs: 10,
      timedOut: false,
      commandMissing: false,
    }));
    const r = await runGates({
      manifest: manifestNoLint,
      workingDir: '/tmp',
      perCommandTimeoutMs: 1000,
      suiteTimeoutMs: 10000,
      spawnShell: spawn,
    });
    expect(r.results.find((x) => x.gate === 'lint')?.status).toBe('skipped');
  });

  it('all pass → overallStatus pass', async () => {
    const spawn = vi.fn(async () => ({
      code: 0,
      stdout: '',
      stderr: '',
      durationMs: 10,
      timedOut: false,
      commandMissing: false,
    }));
    const r = await runGates({
      manifest,
      workingDir: '/tmp',
      perCommandTimeoutMs: 1000,
      suiteTimeoutMs: 10000,
      spawnShell: spawn,
    });
    expect(r.overallStatus).toBe('pass');
  });

  it('reports command-missing when spawnShell reports commandMissing', async () => {
    const spawn = vi.fn(async () => ({
      code: 127,
      stdout: '',
      stderr: 'command not found',
      durationMs: 5,
      timedOut: false,
      commandMissing: true,
    }));
    const r = await runGates({
      manifest,
      workingDir: '/tmp',
      perCommandTimeoutMs: 1000,
      suiteTimeoutMs: 10000,
      spawnShell: spawn,
    });
    expect(r.results[0].status).toBe('command-missing');
  });

  it('reports timeout when spawnShell reports timedOut', async () => {
    const spawn = vi.fn(async () => ({
      code: null,
      stdout: '',
      stderr: 'killed',
      durationMs: 1000,
      timedOut: true,
      commandMissing: false,
    }));
    const r = await runGates({
      manifest,
      workingDir: '/tmp',
      perCommandTimeoutMs: 500,
      suiteTimeoutMs: 10000,
      spawnShell: spawn,
    });
    expect(r.results[0].status).toBe('timeout');
    expect(r.overallStatus).toBe('fail');
  });
});
