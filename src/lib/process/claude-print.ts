import { spawn } from 'child_process';
import { config } from '@/lib/config';

interface RunClaudePrintOptions {
  maxTurns?: number;
  cwd?: string;
  outputFormat?: string;
  jsonSchema?: string;
}

/**
 * Spawn Claude Code in --print mode, write prompt to stdin, and return stdout.
 * Shared utility replacing duplicated spawn patterns across captain, debrief-reviewer,
 * phase-failure-handler, and campaign-executor.
 */
export function runClaudePrint(
  prompt: string,
  options: RunClaudePrintOptions = {},
): Promise<string> {
  const {
    maxTurns = 1,
    cwd = '/tmp',
    outputFormat,
    jsonSchema,
  } = options;

  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', String(maxTurns),
    ];

    if (outputFormat) {
      args.push('--output-format', outputFormat);
    }
    if (jsonSchema) {
      args.push('--json-schema', jsonSchema);
    }

    const proc = spawn(config.claudePath, args, { cwd });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(
          `Claude print exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
        ));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
