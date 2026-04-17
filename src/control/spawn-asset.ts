/**
 * Real subprocess launcher for Claude Code.
 *
 * This is the glue behind `MissionRunnerDeps.spawnAsset`. It wraps the
 * `claude` CLI (or any caller-overridden binary — e.g. the scripted-claude
 * fixture) with:
 *   - isolated $HOME per mission (so `~/.claude` state, logs, credentials do
 *     not bleed between concurrent subprocesses),
 *   - stream-JSON stdout parsing (L2 per-event accounting),
 *   - `LivenessMonitor` attached (L3 stdout-silence kill + L5 hard-timeout
 *     kill, both SIGTERM → SIGKILL after 5 s),
 *   - `AbortSignal` cancellation (SIGTERM → SIGKILL after 5 s),
 *   - post-exit `git status --porcelain` probe for `hasDiff` (skipped when the
 *     caller passes a non-git worktree, e.g. OVERSEER/QUARTERMASTER one-shots).
 *
 * The one-shot helper `spawnClaudeOneShot` is a thin wrapper used by
 * OVERSEER classification (§5.3) and QUARTERMASTER conflict resolution (§6.3):
 * `--output-format print` with a bounded `--max-turns`, returning the parsed
 * final-message JSON.
 *
 * Spec: docs/superpowers/specs/2026-04-16-control-reliability-refactor-design.md
 *       §5.1 steps 8–10, §5.3, §5.7, §6.3.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildClaudeArgs } from './assets/cli-builder';
import { getControlConfig } from './config';
import { cleanEnv } from './gates';
import { attachLivenessMonitor, type LivenessEvent } from './liveness';
import type { AssetRunResult, SpawnAssetOpts } from './mission-runner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a parsed stream-JSON event (loose — we only care about a few
 *  fields; anything else is forwarded to `onCommsEvent` verbatim). */
export interface StreamJsonEvent {
  type: string;
  subtype?: string;
  text?: string;
  name?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [key: string]: unknown;
}

export interface AssetDefinition {
  codename: string;
  model: string;
  maxTurns: number;
  effort: string;
  isSystem: number;
  systemPrompt: string;
  skills: string[];
  mcpServers: unknown[];
}

export interface SpawnAssetExtendedOpts extends SpawnAssetOpts {
  asset: AssetDefinition;
  rulesOfEngagement: string;
  /**
   * Path inside the worktree where the asset should Write its final debrief
   * JSON. When set, `spawn-asset` intercepts `Write` tool_use events whose
   * `file_path` matches this path and captures `input.content` verbatim.
   * Comms formatter also uses it to suppress the raw JSON payload from the
   * stream (the Write call itself still shows as `⚙ Write debrief.json`).
   */
  debriefDropPath?: string;
  claudeBinary?: string;
  /**
   * Arguments prepended before the asset-derived args. Primarily used by
   * tests that invoke `tsx <script>` as the claude binary — set
   * `claudeBinary: 'tsx'` and `claudeArgsPrefix: [scriptPath]`.
   */
  claudeArgsPrefix?: string[];
  env?: Record<string, string>;
  outputFormat?: 'stream-json' | 'print';
  extraFlags?: string[];
  signal?: AbortSignal;
  onCommsEvent?: (ev: StreamJsonEvent) => void;
  stdoutSilenceMs?: number;
  hardTimeoutMs?: number;
  /** When true, skip the `git status --porcelain` probe. Useful for one-shots
   *  where `worktreePath` is not a git repo. Defaults based on `outputFormat`:
   *  `print` skips, `stream-json` probes. */
  probeGitDiff?: boolean;
}

export interface SpawnOneShotOpts {
  missionId: string;
  cwd: string;
  briefing: string;
  asset: AssetDefinition;
  rulesOfEngagement: string;
  maxTurnsOverride?: number;
  claudeBinary?: string;
  claudeArgsPrefix?: string[];
  env?: Record<string, string>;
  extraFlags?: string[];
  signal?: AbortSignal;
  hardTimeoutMs?: number;
  stdoutSilenceMs?: number;
  onStdoutLine?: (line: string) => void;
}

export interface OneShotResult {
  json: unknown;
  exitCode: number;
  stderr: string;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Implementation helpers
// ---------------------------------------------------------------------------

const STDERR_BUFFER_CAP = 64 * 1024;

function appendStderr(buf: string, chunk: string): string {
  const combined = buf + chunk;
  if (combined.length <= STDERR_BUFFER_CAP) return combined;
  return combined.slice(combined.length - STDERR_BUFFER_CAP);
}

async function ensureIsolatedHome(missionId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), 'claude-config', missionId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function probeHasDiff(worktreePath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code !== 0) return resolve(false);
      resolve(out.trim().length > 0);
    });
  });
}

/**
 * Inspect a stream-json event for a `Write` tool_use whose target path is
 * (or ends with) the injected debrief drop path, and return the raw JSON
 * content string if so. Handles both the real-Claude nested shape
 * (`message.content[]`) and the legacy flat tool_use shape.
 */
function maybeCaptureDebriefWrite(
  ev: StreamJsonEvent,
  dropPath: string,
): string | null {
  const pathEndsDrop = (p: unknown): boolean =>
    typeof p === 'string' && (p === dropPath || p.endsWith(dropPath));

  const readContent = (input: unknown): string | null => {
    if (!input || typeof input !== 'object') return null;
    const rec = input as { file_path?: unknown; content?: unknown };
    if (!pathEndsDrop(rec.file_path)) return null;
    return typeof rec.content === 'string' ? rec.content : null;
  };

  // Nested shape: assistant.message.content[].tool_use
  const msg = (ev as { message?: unknown }).message;
  if (msg && typeof msg === 'object') {
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as { type?: unknown; name?: unknown; input?: unknown };
        if (p.type === 'tool_use' && p.name === 'Write') {
          const captured = readContent(p.input);
          if (captured) return captured;
        }
      }
    }
  }
  // Legacy flat shape: { type: 'tool_use', name: 'Write', input: {...} }
  if (ev.type === 'tool_use' && ev.name === 'Write') {
    const captured = readContent((ev as { input?: unknown }).input);
    if (captured) return captured;
  }
  return null;
}

/**
 * Wire SIGTERM → SIGKILL after 5 s. Idempotent — safe to call multiple times.
 */
function killTree(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch {
    // already gone
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 5000).unref?.();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch a Claude subprocess and resolve with the structured run result once
 * it exits (or is killed). Never rejects on subprocess failure — errors are
 * returned via `exitCode` / `killedByControl` / `stderr`. Only rejects on
 * pre-spawn I/O failure (e.g. HOME dir creation).
 */
export async function spawnAsset(opts: SpawnAssetExtendedOpts): Promise<AssetRunResult> {
  const cfg = tryReadConfig();
  const outputFormat = opts.outputFormat ?? 'stream-json';
  const probeGitDiff =
    opts.probeGitDiff ?? (outputFormat === 'stream-json');

  const homeDir = await ensureIsolatedHome(opts.missionId);

  const args: string[] = [];
  if (opts.claudeArgsPrefix) args.push(...opts.claudeArgsPrefix);
  args.push(
    ...buildClaudeArgs({
      asset: opts.asset,
      rulesOfEngagement: opts.rulesOfEngagement,
      outputFormat,
      extraFlags: opts.extraFlags ?? [],
    }),
  );

  const startedAt = Date.now();
  const child = spawn(opts.claudeBinary ?? 'claude', args, {
    cwd: opts.worktreePath,
    env: {
      ...cleanEnv(),
      ...(opts.env ?? {}),
      HOME: homeDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (child.pid !== undefined) opts.onPid?.(child.pid);

  // Pipe briefing to stdin and close it.
  if (child.stdin) {
    child.stdin.on('error', () => {
      // EPIPE can occur if the child exits before we finish writing. Swallow.
    });
    child.stdin.end(opts.briefing);
  }

  // State accumulators.
  let stderrBuf = '';
  let stdoutBuf = '';
  let toolUseCount = 0;
  let stdoutResultSubtype: AssetRunResult['stdoutResultSubtype'] = null;
  let finalMessage: string | null = null;
  let debriefJson: string | null = null;
  let usage: AssetRunResult['usage'] = undefined;
  let sessionId: string | null = opts.sessionId ?? null;
  let killedByControl = false;
  let killReason: 'silence-kill' | 'timeout' | 'abort' | null = null;

  // Attach the liveness monitor.
  const monitor = attachLivenessMonitor(child, {
    stdoutSilenceMs: opts.stdoutSilenceMs ?? cfg.stdoutSilenceMs,
    hardTimeoutMs: opts.hardTimeoutMs ?? cfg.attemptHardTimeoutMs,
    onEvent: (ev: LivenessEvent) => {
      if (ev.type === 'silence-kill') {
        killedByControl = true;
        killReason = 'silence-kill';
      } else if (ev.type === 'timeout') {
        killedByControl = true;
        killReason = 'timeout';
      }
    },
  });

  // AbortSignal wiring.
  const onAbort = (): void => {
    killedByControl = true;
    killReason = 'abort';
    killTree(child);
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      onAbort();
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  // stdout: newline-delimited JSON.
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8');
    let idx = stdoutBuf.indexOf('\n');
    while (idx !== -1) {
      const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.length > 0) {
        monitor.notifyStdout();
        opts.onStdoutLine?.(line);
        try {
          const ev = JSON.parse(line) as StreamJsonEvent;
          opts.onCommsEvent?.(ev);
          if (ev.type === 'tool_use') toolUseCount += 1;
          // Debrief capture: the asset Writes its final JSON to
          // `debriefDropPath` inside the worktree. Intercept that specific
          // Write tool_use and stash `input.content` verbatim — this is the
          // structured debrief source of truth.
          if (opts.debriefDropPath) {
            const captured = maybeCaptureDebriefWrite(ev, opts.debriefDropPath);
            if (captured) debriefJson = captured;
          }
          if (ev.type === 'assistant') {
            // Flat legacy shape: `{type:'assistant', text:'...'}` (scripted fixtures).
            if (typeof ev.text === 'string') {
              finalMessage = ev.text;
            }
            // Nested real-Claude shape: message.content[] with text parts +
            // tool_use parts. Join text parts in order; ignore tool_use so
            // the <DEBRIEF> block isn't drowned out by tool input JSON.
            const nested = (ev as { message?: unknown }).message;
            if (nested && typeof nested === 'object') {
              const content = (nested as { content?: unknown }).content;
              if (Array.isArray(content)) {
                const texts: string[] = [];
                for (const part of content) {
                  if (part && typeof part === 'object') {
                    const p = part as { type?: unknown; text?: unknown };
                    if (p.type === 'text' && typeof p.text === 'string') {
                      texts.push(p.text);
                    }
                  }
                }
                if (texts.length > 0) finalMessage = texts.join('\n');
              }
            }
          }
          if (ev.type === 'result') {
            if (
              ev.subtype === 'success' ||
              ev.subtype === 'error_max_turns' ||
              ev.subtype === 'error_during_execution'
            ) {
              stdoutResultSubtype = ev.subtype;
            }
            // Prefer the authoritative `result.result` string when provided —
            // it is the model's final full answer after all tool turns.
            const res = (ev as { result?: unknown }).result;
            if (typeof res === 'string' && res.length > 0) {
              finalMessage = res;
            }
            if (ev.usage) {
              usage = {
                input: ev.usage.input_tokens ?? 0,
                output: ev.usage.output_tokens ?? 0,
                cache: ev.usage.cache_read_input_tokens ?? 0,
              };
            }
          }
          if (typeof ev.session_id === 'string') {
            sessionId = ev.session_id;
          }
        } catch {
          // Non-JSON stdout line — ignore for event parsing but still counts
          // as stdout activity (already notified liveness above).
        }
      }
      idx = stdoutBuf.indexOf('\n');
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf = appendStderr(stderrBuf, chunk.toString('utf8'));
  });

  // Wait for close.
  const exitCode: number | null = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });

  monitor.dispose();
  if (opts.signal) opts.signal.removeEventListener('abort', onAbort);

  // Flush any trailing non-newline-terminated JSON.
  if (stdoutBuf.trim().length > 0) {
    const line = stdoutBuf.trim();
    opts.onStdoutLine?.(line);
    try {
      const ev = JSON.parse(line) as StreamJsonEvent;
      opts.onCommsEvent?.(ev);
      if (ev.type === 'result' && (ev.subtype === 'success' || ev.subtype === 'error_max_turns' || ev.subtype === 'error_during_execution')) {
        stdoutResultSubtype = ev.subtype;
      }
    } catch {
      // ignore
    }
  }

  const hasDiff = probeGitDiff ? await probeHasDiff(opts.worktreePath) : false;

  // Keep killReason visible for future callers (§5.3 classification) — even
  // though `AssetRunResult` does not expose it today, we record it in stderr
  // header when a kill occurred so classifyExit can pick up on it. We do NOT
  // mutate the interface — mission-runner already consults `killedByControl`
  // plus `elapsedMs` to distinguish silence vs timeout.
  if (killedByControl && killReason) {
    const tag = `[CONTROL killed subprocess: ${killReason}]\n`;
    stderrBuf = appendStderr(tag, stderrBuf);
  }

  return {
    exitCode,
    stderr: stderrBuf,
    stdoutResultSubtype,
    finalMessage,
    debriefJson,
    toolUseCount,
    sessionId,
    hasDiff,
    killedByControl,
    pid: child.pid,
    elapsedMs: Date.now() - startedAt,
    usage,
  };
}

/**
 * One-shot Claude invocation used by OVERSEER classification / consult and
 * QUARTERMASTER conflict resolution. Forces `--print` output-format and
 * returns the parsed JSON payload from the final assistant message.
 *
 * Throws on:
 *   - non-zero exit code,
 *   - the subprocess being killed by CONTROL (abort, silence, timeout),
 *   - unparsable JSON in the final assistant message.
 *
 * Callers are responsible for catching these and mapping them to the
 * appropriate classification (spec §5.3: OVERSEER failure → COMPROMISED).
 */
export async function spawnClaudeOneShot(
  opts: SpawnOneShotOpts,
): Promise<OneShotResult> {
  const asset: AssetDefinition = opts.maxTurnsOverride !== undefined
    ? { ...opts.asset, maxTurns: opts.maxTurnsOverride }
    : opts.asset;

  const run = await spawnAsset({
    missionId: opts.missionId,
    worktreePath: opts.cwd,
    briefing: opts.briefing,
    assetCodename: opts.asset.codename,
    asset,
    rulesOfEngagement: opts.rulesOfEngagement,
    claudeBinary: opts.claudeBinary,
    claudeArgsPrefix: opts.claudeArgsPrefix,
    env: opts.env,
    outputFormat: 'print',
    extraFlags: ['--print', ...(opts.extraFlags ?? [])],
    signal: opts.signal,
    onStdoutLine: opts.onStdoutLine,
    hardTimeoutMs: opts.hardTimeoutMs,
    stdoutSilenceMs: opts.stdoutSilenceMs,
    probeGitDiff: false,
  });

  if (run.killedByControl) {
    throw new Error(
      `spawnClaudeOneShot(${opts.missionId}): subprocess killed by CONTROL (exitCode=${run.exitCode})`,
    );
  }
  if (run.exitCode !== 0) {
    throw new Error(
      `spawnClaudeOneShot(${opts.missionId}): non-zero exit ${run.exitCode} — stderr: ${run.stderr.slice(-500)}`,
    );
  }

  const text = run.finalMessage;
  if (text === null) {
    throw new Error(
      `spawnClaudeOneShot(${opts.missionId}): no assistant final message — stderr: ${run.stderr.slice(-500)}`,
    );
  }

  const parsed = tryParseJsonPayload(text);
  if (parsed === undefined) {
    throw new Error(
      `spawnClaudeOneShot(${opts.missionId}): final message is not valid JSON — message: ${text.slice(0, 500)}`,
    );
  }

  return {
    json: parsed,
    exitCode: run.exitCode,
    stderr: run.stderr,
    elapsedMs: run.elapsedMs,
  };
}

/**
 * Attempt to extract a JSON payload from an assistant message. Accepts:
 *   - a raw JSON document,
 *   - a JSON document wrapped in ```json fenced code,
 *   - a JSON document mixed with surrounding prose (first `{…}` block wins).
 */
function tryParseJsonPayload(text: string): unknown | undefined {
  const trimmed = text.trim();
  // Direct parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  // Fenced code block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // fall through
    }
  }
  // First balanced { … } span — naive but adequate for OVERSEER outputs.
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
    } catch {
      // fall through
    }
  }
  return undefined;
}

/**
 * Read Control config, falling back to built-in defaults if the settings
 * table is unavailable (e.g. running outside the Next.js runtime during
 * fixture tests). We never want config lookup to block a spawn.
 */
function tryReadConfig(): { stdoutSilenceMs: number; attemptHardTimeoutMs: number } {
  try {
    const cfg = getControlConfig();
    return {
      stdoutSilenceMs: cfg.stdoutSilenceMs,
      attemptHardTimeoutMs: cfg.attemptHardTimeoutMs,
    };
  } catch {
    return { stdoutSilenceMs: 300_000, attemptHardTimeoutMs: 1_800_000 };
  }
}
