import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '@/lib/config';

interface RunClaudePrintOptions {
  maxTurns?: number;
  cwd?: string;
  outputFormat?: string;
  jsonSchema?: string;
}

/**
 * Extract Claude Code OAuth credentials from the macOS Keychain.
 * Returns the credential JSON string, or null if extraction fails.
 */
export function extractKeychainCredentials(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -g 2>&1 | grep "^password:"',
      { encoding: 'utf-8', timeout: 5000 },
    );
    // Format is either: `password: {json}` or `password: "{json}"`
    let cred = raw.replace(/^password: /, '').trim();
    // Strip outer quotes if present
    if (cred.startsWith('"') && cred.endsWith('"')) {
      cred = cred.slice(1, -1);
    }
    if (!cred) return null;
    // Validate it's JSON
    JSON.parse(cred);
    return cred;
  } catch {
    return null;
  }
}

/**
 * Set up an isolated HOME for a Claude CLI process.
 * Prevents concurrent config/session corruption when multiple agents run in parallel.
 * Extracts auth credentials from macOS Keychain into the isolated HOME.
 * Returns the temp HOME path. Caller is responsible for cleanup.
 */
export function createAuthenticatedHome(): string {
  const tempHome = `/tmp/claude-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempClaudeDir = path.join(tempHome, '.claude');
  fs.mkdirSync(tempClaudeDir, { recursive: true });

  const realHome = process.env.HOME || os.homedir();

  // Copy .claude.json (profile info — prevents concurrent write corruption)
  try {
    fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(tempHome, '.claude.json'));
  } catch { /* fine */ }

  // Copy settings (read-only usage — prevents concurrent write corruption)
  try {
    fs.copyFileSync(path.join(realHome, '.claude', 'settings.json'), path.join(tempClaudeDir, 'settings.json'));
  } catch { /* fine */ }

  // Extract credentials from macOS Keychain into isolated HOME
  const cred = extractKeychainCredentials();
  if (cred) {
    fs.writeFileSync(path.join(tempClaudeDir, '.credentials.json'), cred, { mode: 0o600 });
  }

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
