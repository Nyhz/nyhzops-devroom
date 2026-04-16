import { describe, it, expect } from 'vitest';
import { decideNextAction, nextInfraBackoffMs, RetryState } from '@/control/retry-policy';

describe('decideNextAction', () => {
  it('attempt 1 gate pass → COMPLETE', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'gate-pass', lastDiffHash: 'x', priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('COMPLETE');
  });
  it('attempt 1 gate fail → DETERMINISTIC_RETRY', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'gate-fail', lastDiffHash: 'x', priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('DETERMINISTIC_RETRY');
  });
  it('attempt 2 gate fail with same diff → OVERSEER_CONSULT (skip attempt 3)', () => {
    const r = decideNextAction({ sortieAttempt: 2, lastOutcome: 'gate-fail', lastDiffHash: 'x', priorDiffHash: 'x', overseerConsulted: false });
    expect(r.action).toBe('OVERSEER_CONSULT');
  });
  it('attempt 2 gate fail with different diff → DETERMINISTIC_RETRY (attempt 3)', () => {
    const r = decideNextAction({ sortieAttempt: 2, lastOutcome: 'gate-fail', lastDiffHash: 'y', priorDiffHash: 'x', overseerConsulted: false });
    expect(r.action).toBe('DETERMINISTIC_RETRY');
  });
  it('attempt 3 gate fail (haven\'t consulted) → OVERSEER_CONSULT', () => {
    const r = decideNextAction({ sortieAttempt: 3, lastOutcome: 'gate-fail', lastDiffHash: 'z', priorDiffHash: 'y', overseerConsulted: false });
    expect(r.action).toBe('OVERSEER_CONSULT');
  });
  it('attempt 4 gate fail after consult → COMPROMISED', () => {
    const r = decideNextAction({ sortieAttempt: 4, lastOutcome: 'gate-fail', lastDiffHash: 'w', priorDiffHash: 'z', overseerConsulted: true });
    expect(r.action).toBe('COMPROMISED');
  });
  it('infrastructure outcome at any attempt → INFRA_BACKOFF', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'infrastructure', lastDiffHash: null, priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('INFRA_BACKOFF');
  });
  it('rate-limit outcome → RATE_LIMIT_BACKOFF', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'rate-limit', lastDiffHash: null, priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('RATE_LIMIT_BACKOFF');
  });
  it('auth outcome → AUTH_PAUSE', () => {
    const r = decideNextAction({ sortieAttempt: 1, lastOutcome: 'auth', lastDiffHash: null, priorDiffHash: null, overseerConsulted: false });
    expect(r.action).toBe('AUTH_PAUSE');
  });
});

describe('infra backoff', () => {
  it('returns next backoff delay from schedule', () => {
    expect(nextInfraBackoffMs(0, [30_000, 120_000])).toBe(30_000);
    expect(nextInfraBackoffMs(1, [30_000, 120_000])).toBe(120_000);
    expect(nextInfraBackoffMs(2, [30_000, 120_000])).toBeNull();
  });
});
