export type ExitCategory =
  | 'CLEAN'
  | 'TURN_LIMIT'
  | 'TIMEOUT'
  | 'INFRASTRUCTURE'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'AGENT_FAILURE'
  | 'NEEDS_COMMANDER';

export interface ExitContext {
  exitCode: number | null;
  stderr: string;
  stdoutResultSubtype: 'success' | 'error_max_turns' | 'error_during_execution' | null;
  killedByControl: boolean;
  elapsedMs: number;
  toolUseCount: number;
  hasDiff: boolean;
}

export interface Classification {
  category: ExitCategory;
  reasoning: string;
}

export interface ClassifierDeps {
  overseerClassify?: (ctx: ExitContext) => Promise<{
    category: 'INFRASTRUCTURE' | 'AGENT_FAILURE' | 'NEEDS_COMMANDER';
    reasoning: string;
  }>;
}

const INFRA = /\b5\d\d\b|overload|server.?busy|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|stream aborted/i;
const RATE = /\b429\b|rate.?limit|too many requests/i;
const AUTH = /\b40[13]\b|unauthori[sz]ed|invalid.?(api.?key|credential)|authentication_error|oauth.*(expired|invalid|revoked)|keychain/i;

/**
 * Real Claude-CLI auth failures happen before any tool call: the process
 * fails fast with no activity. If stderr matches the AUTH regex but the
 * run produced tool calls or a diff, the match is almost certainly agent
 * output (e.g. an HTTP 401 from a probe the agent ran), not a CLI auth
 * break. Gate AUTH classification on that shape.
 */
function isFastEmpty(ctx: ExitContext): boolean {
  return ctx.elapsedMs < 30_000 && ctx.toolUseCount === 0 && !ctx.hasDiff;
}

/**
 * Fast-path classifier for mission exits.
 *
 * Precedence (per spec §5.3):
 *   1. TIMEOUT       — killedByControl flag (L3 silence / L5 wall clock)
 *   2. CLEAN         — stdoutResultSubtype === 'success'
 *   3. TURN_LIMIT    — stdoutResultSubtype === 'error_max_turns'
 *   4. AUTH          — stderr matches AUTH regex (wins over generic INFRA)
 *   5. RATE_LIMIT    — stderr matches RATE regex
 *   6. INFRASTRUCTURE— stderr matches INFRA regex, OR nonzero-exit fast-crash
 *                      with no tool use and no diff (<30s)
 *   7. OVERSEER fallback (if provided), else NEEDS_COMMANDER.
 */
export async function classifyExit(
  ctx: ExitContext,
  deps: ClassifierDeps = {},
): Promise<Classification> {
  if (ctx.killedByControl) {
    return { category: 'TIMEOUT', reasoning: 'killed by CONTROL supervision' };
  }
  if (ctx.stdoutResultSubtype === 'success') {
    return { category: 'CLEAN', reasoning: 'success result event' };
  }
  if (ctx.stdoutResultSubtype === 'error_max_turns') {
    return { category: 'TURN_LIMIT', reasoning: 'max turns reached' };
  }
  if (AUTH.test(ctx.stderr) && isFastEmpty(ctx)) {
    return { category: 'AUTH', reasoning: 'auth pattern in stderr with fast-exit signature' };
  }
  if (RATE.test(ctx.stderr)) {
    return { category: 'RATE_LIMIT', reasoning: 'rate-limit pattern in stderr' };
  }
  if (INFRA.test(ctx.stderr)) {
    return { category: 'INFRASTRUCTURE', reasoning: 'infra pattern in stderr' };
  }
  if (
    ctx.exitCode !== 0 &&
    ctx.elapsedMs < 30_000 &&
    ctx.toolUseCount === 0 &&
    !ctx.hasDiff
  ) {
    return {
      category: 'INFRASTRUCTURE',
      reasoning: 'fast-exit with no activity (crash-like)',
    };
  }

  // Fallback: OVERSEER classification.
  if (!deps.overseerClassify) {
    return {
      category: 'NEEDS_COMMANDER',
      reasoning: 'no classifier available for unknown exit',
    };
  }
  try {
    const o = await deps.overseerClassify(ctx);
    return { category: o.category, reasoning: `overseer: ${o.reasoning}` };
  } catch (err) {
    return {
      category: 'NEEDS_COMMANDER',
      reasoning: `overseer classification failed: ${(err as Error).message}`,
    };
  }
}
