import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '@/lib/config';

interface AuthCheckResult {
  ok: boolean;
  error?: string;
}

/**
 * Pre-flight auth check — verifies the Claude CLI can authenticate
 * via macOS Keychain before spawning a mission.
 */
export async function checkCliAuth(): Promise<AuthCheckResult> {
  const tempHome = `/tmp/claude-auth-check-${Date.now()}`;
  const tempClaudeDir = path.join(tempHome, '.claude');

  try {
    fs.mkdirSync(tempClaudeDir, { recursive: true });

    // Copy .claude.json (profile info)
    const realHome = process.env.HOME || os.homedir();
    try {
      fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(tempHome, '.claude.json'));
    } catch { /* fine — not strictly required for auth check */ }

    // Run claude auth status with isolated HOME
    // Auth is handled natively via macOS Keychain — no credential file needed
    const result = await new Promise<AuthCheckResult>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ ok: false, error: 'Auth check timed out after 10s' });
      }, 10_000);

      const proc = spawn(config.claudePath, ['auth', 'status'], {
        env: { ...process.env, HOME: tempHome },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Exit code ${code}` });
          return;
        }
        try {
          const status = JSON.parse(stdout);
          if (status.loggedIn) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: 'CLI reports not logged in' });
          }
        } catch {
          resolve({ ok: false, error: `Failed to parse auth status: ${stdout.slice(0, 200)}` });
        }
      });
    });

    return result;
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}
