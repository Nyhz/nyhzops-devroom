import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface CtlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CtlRunner {
  run(path: string, args: string[], timeoutMs?: number): Promise<CtlResult>;
}

export const defaultCtlRunner: CtlRunner = {
  async run(path, args, timeoutMs = 30_000) {
    try {
      const { stdout, stderr } = await execFileAsync(path, args, {
        timeout: timeoutMs,
        maxBuffer: 1 << 20,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
      };
    }
  },
};
