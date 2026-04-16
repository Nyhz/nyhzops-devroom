import { spawn as nodeSpawn } from 'node:child_process';

export interface GateManifest {
  build: string | null;
  test: string | null;
  lint: string | null;
  typecheck: string | null;
}

export interface GateResult {
  gate: 'build' | 'test' | 'lint' | 'typecheck';
  status: 'pass' | 'fail' | 'skipped' | 'timeout' | 'command-missing';
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface GateRunResults {
  results: GateResult[];
  overallStatus: 'pass' | 'fail';
}

export interface SpawnShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  commandMissing: boolean;
}

export interface RunGatesOptions {
  manifest: GateManifest;
  workingDir: string;
  perCommandTimeoutMs: number;
  suiteTimeoutMs: number;
  /** Injected for tests. */
  spawnShell?: (
    cmd: string,
    opts: { cwd: string; timeout: number },
  ) => Promise<SpawnShellResult>;
}

export async function runGates(opts: RunGatesOptions): Promise<GateRunResults> {
  const shell = opts.spawnShell ?? defaultSpawnShell;
  const order: Array<keyof GateManifest> = ['lint', 'typecheck', 'build', 'test'];
  const results: GateResult[] = [];
  const suiteStart = Date.now();

  for (const gate of order) {
    const cmd = opts.manifest[gate];
    if (!cmd) {
      results.push({ gate, status: 'skipped', stdout: '', stderr: '', durationMs: 0 });
      continue;
    }
    const elapsed = Date.now() - suiteStart;
    if (elapsed >= opts.suiteTimeoutMs) {
      results.push({ gate, status: 'timeout', stdout: '', stderr: 'suite timeout', durationMs: 0 });
      return { results, overallStatus: 'fail' };
    }
    const remaining = Math.min(opts.perCommandTimeoutMs, opts.suiteTimeoutMs - elapsed);
    const outcome = await shell(cmd, { cwd: opts.workingDir, timeout: remaining });
    let status: GateResult['status'];
    if (outcome.commandMissing) status = 'command-missing';
    else if (outcome.timedOut) status = 'timeout';
    else if (outcome.code === 0) status = 'pass';
    else status = 'fail';
    results.push({
      gate,
      status,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      durationMs: outcome.durationMs,
    });
    if (status !== 'pass') {
      return { results, overallStatus: 'fail' };
    }
  }
  return { results, overallStatus: 'pass' };
}

async function defaultSpawnShell(
  cmd: string,
  opts: { cwd: string; timeout: number },
): Promise<SpawnShellResult> {
  return new Promise<SpawnShellResult>((resolve) => {
    const start = Date.now();
    const child = nodeSpawn('sh', ['-c', cmd], { cwd: opts.cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let commandMissing = false;
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    const to = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, opts.timeout);
    child.on('error', (err) => {
      clearTimeout(to);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') commandMissing = true;
      resolve({
        code: null,
        stdout,
        stderr: stderr + (err.message ?? ''),
        durationMs: Date.now() - start,
        timedOut,
        commandMissing,
      });
    });
    child.on('close', (code) => {
      clearTimeout(to);
      if (code === 127) commandMissing = true;
      resolve({
        code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
        commandMissing,
      });
    });
  });
}
