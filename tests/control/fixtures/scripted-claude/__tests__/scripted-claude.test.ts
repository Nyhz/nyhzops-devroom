import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

describe('scripted-claude fixture', () => {
  it('emits scenario events as JSON lines and exits with specified code', async () => {
    const scenarioPath = path.join(
      __dirname,
      '../../scenarios/happy-path-combat.json',
    );
    const scriptPath = path.join(__dirname, '../scripted-claude.ts');

    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn('tsx', [scriptPath], {
        env: { ...process.env, SCRIPTED_CLAUDE_SCENARIO: scenarioPath },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    expect(result.code).toBe(0);

    const lines = result.stdout
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);

    // Every line must be valid JSON.
    const parsed = lines.map((l) => JSON.parse(l));

    const last = parsed[parsed.length - 1];
    expect(last.type).toBe('result');
    expect(last.subtype).toBe('success');
  }, 15_000);
});
