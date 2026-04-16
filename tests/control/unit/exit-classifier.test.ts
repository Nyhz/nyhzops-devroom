import { describe, it, expect, vi } from 'vitest';
import { classifyExit } from '@/control/exit-classifier';

describe('classifyExit (fast-path)', () => {
  it('CLEAN on exit 0 with success result event', async () => {
    const r = await classifyExit({
      exitCode: 0,
      stderr: '',
      stdoutResultSubtype: 'success',
      killedByControl: false,
      elapsedMs: 5000,
      toolUseCount: 3,
      hasDiff: true,
    });
    expect(r.category).toBe('CLEAN');
  });

  it('TURN_LIMIT on error_max_turns subtype', async () => {
    const r = await classifyExit({
      exitCode: 0,
      stderr: '',
      stdoutResultSubtype: 'error_max_turns',
      killedByControl: false,
      elapsedMs: 5000,
      toolUseCount: 3,
      hasDiff: true,
    });
    expect(r.category).toBe('TURN_LIMIT');
  });

  it('TIMEOUT when killedByControl flag is set', async () => {
    const r = await classifyExit({
      exitCode: 143,
      stderr: '',
      stdoutResultSubtype: null,
      killedByControl: true,
      elapsedMs: 30_000,
      toolUseCount: 0,
      hasDiff: false,
    });
    expect(r.category).toBe('TIMEOUT');
  });

  it('INFRASTRUCTURE on 5xx stderr pattern', async () => {
    const r = await classifyExit({
      exitCode: 1,
      stderr: 'Error: 503 Service Unavailable',
      stdoutResultSubtype: null,
      killedByControl: false,
      elapsedMs: 2000,
      toolUseCount: 0,
      hasDiff: false,
    });
    expect(r.category).toBe('INFRASTRUCTURE');
  });

  it('INFRASTRUCTURE on ECONNRESET', async () => {
    const r = await classifyExit({
      exitCode: 1,
      stderr: 'ECONNRESET',
      stdoutResultSubtype: null,
      killedByControl: false,
      elapsedMs: 2000,
      toolUseCount: 0,
      hasDiff: false,
    });
    expect(r.category).toBe('INFRASTRUCTURE');
  });

  it('INFRASTRUCTURE on unclassified quick-exit (crash-like)', async () => {
    const r = await classifyExit({
      exitCode: 2,
      stderr: 'weird unknown',
      stdoutResultSubtype: null,
      killedByControl: false,
      elapsedMs: 500,
      toolUseCount: 0,
      hasDiff: false,
    });
    expect(r.category).toBe('INFRASTRUCTURE');
  });

  it('RATE_LIMIT on 429', async () => {
    const r = await classifyExit({
      exitCode: 1,
      stderr: '429 Too Many Requests',
      stdoutResultSubtype: null,
      killedByControl: false,
      elapsedMs: 1000,
      toolUseCount: 0,
      hasDiff: false,
    });
    expect(r.category).toBe('RATE_LIMIT');
  });

  it('AUTH on 401', async () => {
    const r = await classifyExit({
      exitCode: 1,
      stderr: '401 unauthorized',
      stdoutResultSubtype: null,
      killedByControl: false,
      elapsedMs: 1000,
      toolUseCount: 0,
      hasDiff: false,
    });
    expect(r.category).toBe('AUTH');
  });
});

describe('classifyExit (OVERSEER fallback)', () => {
  it('invokes OVERSEER classifier when no fast-path matches', async () => {
    const overseerSpy = vi
      .fn()
      .mockResolvedValue({ category: 'AGENT_FAILURE', reasoning: 'test' });
    const r = await classifyExit(
      {
        exitCode: 1,
        stderr: 'genuinely novel error',
        stdoutResultSubtype: null,
        killedByControl: false,
        elapsedMs: 60_000,
        toolUseCount: 10,
        hasDiff: true,
      },
      { overseerClassify: overseerSpy },
    );
    expect(overseerSpy).toHaveBeenCalledOnce();
    expect(r.category).toBe('AGENT_FAILURE');
  });

  it('returns NEEDS_COMMANDER when OVERSEER classifier itself errors', async () => {
    const overseerSpy = vi.fn().mockRejectedValue(new Error('overseer down'));
    const r = await classifyExit(
      {
        exitCode: 1,
        stderr: 'genuinely novel',
        stdoutResultSubtype: null,
        killedByControl: false,
        elapsedMs: 60_000,
        toolUseCount: 10,
        hasDiff: true,
      },
      { overseerClassify: overseerSpy },
    );
    expect(r.category).toBe('NEEDS_COMMANDER');
    expect(r.reasoning).toContain('overseer');
  });
});
