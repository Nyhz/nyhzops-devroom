import type { ChildProcess } from 'node:child_process';

export type LivenessEvent =
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'silence-kill'; silenceMs: number }
  | { type: 'timeout'; elapsedMs: number };

export interface LivenessOptions {
  stdoutSilenceMs: number;
  hardTimeoutMs: number;
  onEvent: (ev: LivenessEvent) => void;
}

export interface LivenessMonitor {
  notifyStdout(): void;
  dispose(): void;
}

export function attachLivenessMonitor(
  process: ChildProcess,
  opts: LivenessOptions,
): LivenessMonitor {
  let disposed = false;
  let silenceTimer: NodeJS.Timeout | null = null;
  let hardTimer: NodeJS.Timeout | null = null;
  const startedAt = Date.now();

  const resetSilence = () => {
    if (disposed) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (disposed) return;
      opts.onEvent({ type: 'silence-kill', silenceMs: opts.stdoutSilenceMs });
      process.kill('SIGTERM');
      setTimeout(() => { if (!disposed) process.kill('SIGKILL'); }, 5000);
    }, opts.stdoutSilenceMs);
  };

  hardTimer = setTimeout(() => {
    if (disposed) return;
    opts.onEvent({ type: 'timeout', elapsedMs: Date.now() - startedAt });
    process.kill('SIGTERM');
    setTimeout(() => { if (!disposed) process.kill('SIGKILL'); }, 5000);
  }, opts.hardTimeoutMs);

  process.on('close', (code, signal) => {
    opts.onEvent({ type: 'exit', code, signal });
    dispose();
  });

  resetSilence();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (silenceTimer) clearTimeout(silenceTimer);
    if (hardTimer) clearTimeout(hardTimer);
  }

  return {
    notifyStdout: () => resetSilence(),
    dispose,
  };
}
