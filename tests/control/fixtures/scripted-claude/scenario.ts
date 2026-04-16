import { readFileSync } from 'node:fs';

export interface Scenario {
  /** Events emitted as JSON lines to stdout, in order. */
  events: ScenarioEvent[];
  /** Final exit code. Defaults to 0. */
  exitCode?: number;
  /** Optional stderr to emit before exit. */
  stderr?: string;
  /** Optional hang: if set, process sleeps this many ms before emitting events. */
  hangMs?: number;
  /** Optional files to write into the cwd before emitting events. Used by
   *  integration tests that need to exercise the auto-commit-sweep path —
   *  scripted-claude writes files the "agent" would have edited. Paths are
   *  resolved relative to the subprocess cwd. */
  writeFiles?: Array<{ path: string; contents: string }>;
}

export type ScenarioEvent =
  | { type: 'assistant'; text: string; delayMs?: number }
  | { type: 'tool_use'; name: string; delayMs?: number }
  | {
      type: 'result';
      subtype: 'success' | 'error_max_turns' | 'error_during_execution';
      delayMs?: number;
      duration_ms?: number;
      num_turns?: number;
      total_cost_usd?: number;
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens: number;
      };
    };

/**
 * Load a scenario JSON file from disk.
 *
 * Sync read is intentional: the fixture runs this exactly once at startup
 * before producing any output, so async overhead buys nothing here.
 */
export function loadScenario(path: string): Scenario {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Scenario;
  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error(
      `Invalid scenario at ${path}: missing or non-array "events" field`,
    );
  }
  return parsed;
}
