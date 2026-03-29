import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '@/lib/config';

interface RunClaudePrintOptions {
  maxTurns?: number;
  cwd?: string;
  outputFormat?: string;
  jsonSchema?: string;
}

/**
 * Set up a temporary HOME with host-synced credentials for a Claude CLI process.
 * Returns the temp HOME path. Caller is responsible for cleanup.
 */
export function createAuthenticatedHome(): string {
  const tempHome = `/tmp/claude-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempClaudeDir = path.join(tempHome, '.claude');
  fs.mkdirSync(tempClaudeDir, { recursive: true });

  const realHome = process.env.HOME || '/home/devroom';

  // Copy .claude.json (profile info)
  try {
    fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(tempHome, '.claude.json'));
  } catch { /* fine */ }

  // Copy settings
  try {
    fs.copyFileSync(path.join(realHome, '.claude', 'settings.json'), path.join(tempClaudeDir, 'settings.json'));
  } catch { /* fine */ }

  // Copy host-synced credentials
  try {
    fs.copyFileSync(config.hostCredentialsPath, path.join(tempClaudeDir, '.credentials.json'));
  } catch { /* no host credentials available */ }

  return tempHome;
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

  const tempHome = createAuthenticatedHome();

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

    const proc = spawn(config.claudePath, args, {
      cwd,
      env: { ...process.env, HOME: tempHome },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    const cleanup = () => {
      try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* best effort */ }
    };

    proc.on('close', (code) => {
      cleanup();
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(
          `Claude print exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
        ));
      }
    });

    proc.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}
