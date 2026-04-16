#!/usr/bin/env tsx
// Scripted claude stand-in. Reads a scenario path from env var SCRIPTED_CLAUDE_SCENARIO
// and emits pre-canned JSON stream events with optional delays.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadScenario } from './scenario';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const scenarioPath = process.env.SCRIPTED_CLAUDE_SCENARIO;
  if (!scenarioPath) {
    process.stderr.write('SCRIPTED_CLAUDE_SCENARIO env var required\n');
    process.exit(2);
  }

  const scenario = loadScenario(scenarioPath);

  if (scenario.writeFiles && scenario.writeFiles.length > 0) {
    for (const f of scenario.writeFiles) {
      const abs = path.resolve(process.cwd(), f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.contents);
    }
  }

  if (scenario.shellCommands && scenario.shellCommands.length > 0) {
    for (const c of scenario.shellCommands) {
      const cwd = c.cwd ? path.resolve(process.cwd(), c.cwd) : process.cwd();
      // Substitute ${ENV_VAR} references from process.env. Useful for passing
      // the target branch name to scripted rebase commands.
      const cmd = c.cmd.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => {
        return process.env[name] ?? '';
      });
      try {
        execSync(cmd, { cwd, stdio: 'inherit' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`scripted-claude shell command failed: ${msg}\n`);
        // Continue — tests rely on the post-exit git state, which will
        // reflect the failure naturally.
      }
    }
  }

  if (scenario.hangMs && scenario.hangMs > 0) {
    await sleep(scenario.hangMs);
  }

  for (const event of scenario.events) {
    if (event.delayMs && event.delayMs > 0) {
      await sleep(event.delayMs);
    }
    process.stdout.write(JSON.stringify(event) + '\n');
  }

  if (scenario.stderr) {
    process.stderr.write(scenario.stderr + '\n');
  }

  process.exit(scenario.exitCode ?? 0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`scripted-claude error: ${message}\n`);
  process.exit(2);
});
