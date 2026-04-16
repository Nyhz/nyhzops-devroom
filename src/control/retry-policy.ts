export type AttemptOutcome =
  | 'gate-pass'
  | 'gate-fail'
  | 'infrastructure'
  | 'rate-limit'
  | 'auth'
  | 'timeout'
  | 'turn-limit';

export type NextAction =
  | 'COMPLETE'
  | 'DETERMINISTIC_RETRY'
  | 'OVERSEER_CONSULT'
  | 'COMPROMISED'
  | 'INFRA_BACKOFF'
  | 'RATE_LIMIT_BACKOFF'
  | 'AUTH_PAUSE';

export interface RetryState {
  sortieAttempt: number;
  lastOutcome: AttemptOutcome;
  lastDiffHash: string | null;
  priorDiffHash: string | null;
  overseerConsulted: boolean;
}

export function decideNextAction(state: RetryState): { action: NextAction; reason: string } {
  if (state.lastOutcome === 'auth') return { action: 'AUTH_PAUSE', reason: 'auth failure' };
  if (state.lastOutcome === 'infrastructure') return { action: 'INFRA_BACKOFF', reason: 'infra exit' };
  if (state.lastOutcome === 'rate-limit') return { action: 'RATE_LIMIT_BACKOFF', reason: 'rate limit' };

  if (state.lastOutcome === 'gate-pass') return { action: 'COMPLETE', reason: 'gates green' };

  // gate-fail, timeout, turn-limit all treated as "attempt failed, retry-budget applies"
  if (state.sortieAttempt >= 4 && state.overseerConsulted) {
    return { action: 'COMPROMISED', reason: 'overseer-redirect attempt failed' };
  }
  if (state.sortieAttempt >= 3 && !state.overseerConsulted) {
    return { action: 'OVERSEER_CONSULT', reason: 'deterministic budget exhausted' };
  }
  if (state.sortieAttempt === 2 && state.lastDiffHash === state.priorDiffHash) {
    return { action: 'OVERSEER_CONSULT', reason: 'no-progress signal — identical diff to prior attempt' };
  }
  return { action: 'DETERMINISTIC_RETRY', reason: 'retry with gate output' };
}

export function nextInfraBackoffMs(attemptIdx: number, schedule: number[]): number | null {
  if (attemptIdx < 0 || attemptIdx >= schedule.length) return null;
  return schedule[attemptIdx];
}
