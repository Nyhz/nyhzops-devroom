#!/usr/bin/env tsx
// Scripted claude stand-in. Reads a scenario path from env var SCRIPTED_CLAUDE_SCENARIO
// and emits pre-canned JSON stream events with optional delays.
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
