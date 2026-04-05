'use server';

import fs from 'node:fs';
import path from 'node:path';
import { eq, desc } from 'drizzle-orm';
import { getRepoPath } from './_helpers';
import { runCommand } from '@/lib/process/command-runner';
import { getDatabase } from '@/lib/db/index';
import { testRuns } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { createAndDeployMission } from '@/actions/mission';
import { getAssetByCodename } from '@/actions/asset';
import type {
  TestFramework,
  TestRunRow,
  TestSuiteResult,
  TestCaseResult,
} from '@/types';

// ---------------------------------------------------------------------------
// Module-level abort controller registry
// ---------------------------------------------------------------------------
const abortControllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// detectTestFramework
// ---------------------------------------------------------------------------
export async function detectTestFramework(
  battlefieldId: string,
): Promise<TestFramework | null> {
  const repoPath = await getRepoPath(battlefieldId);
  const pkgPath = path.join(repoPath, 'package.json');

  if (!fs.existsSync(pkgPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Priority order
  if (allDeps['vitest']) return 'vitest';
  if (allDeps['jest']) return 'jest';
  if (allDeps['@playwright/test']) return 'playwright';
  if (allDeps['mocha']) return 'mocha';

  // Fallback: scan scripts for framework keywords
  const scripts = pkg.scripts ?? {};
  const scriptValues = Object.values(scripts).join(' ');
  if (/\bvitest\b/.test(scriptValues)) return 'vitest';
  if (/\bjest\b/.test(scriptValues)) return 'jest';
  if (/\bplaywright\b/.test(scriptValues)) return 'playwright';
  if (/\bmocha\b/.test(scriptValues)) return 'mocha';

  return null;
}

// ---------------------------------------------------------------------------
// runTests
// ---------------------------------------------------------------------------
export async function runTests(
  battlefieldId: string,
  options?: { pattern?: string; failedOnly?: boolean },
): Promise<string> {
  const framework = await detectTestFramework(battlefieldId);
  if (!framework) {
    throw new Error(`No test framework detected for battlefield ${battlefieldId}`);
  }

  const repoPath = await getRepoPath(battlefieldId);
  const runId = generateId();
  const pattern = options?.pattern ?? '';
  const failedOnly = options?.failedOnly ?? false;

  // Build command based on framework
  let command: string;
  switch (framework) {
    case 'vitest': {
      command = 'npx vitest run --reporter=json --reporter=default';
      if (failedOnly) command += ' --changed';
      if (pattern) command += ` ${pattern}`;
      break;
    }
    case 'jest': {
      command = 'npx jest --json --verbose';
      if (failedOnly) command += ' --onlyFailures';
      if (pattern) command += ` ${pattern}`;
      break;
    }
    case 'playwright': {
      command = 'npx playwright test --reporter=json --reporter=list';
      if (pattern) command += ` ${pattern}`;
      break;
    }
    case 'mocha': {
      command = 'npx mocha --reporter=json';
      if (pattern) command += ` ${pattern}`;
      break;
    }
  }

  // Insert DB row
  const db = getDatabase();
  db.insert(testRuns)
    .values({
      id: runId,
      battlefieldId,
      framework,
      command,
      pattern: pattern || null,
      status: 'running',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      createdAt: Date.now(),
    })
    .run();

  // Set up abort controller
  const controller = new AbortController();
  abortControllers.set(runId, controller);

  const socketRoom = `tests:${battlefieldId}`;

  // Run and process asynchronously
  runCommand({
    command,
    cwd: repoPath,
    socketRoom,
    battlefieldId,
    abortSignal: controller.signal,
  })
    .then((result) => {
      const { stdout, durationMs } = result;

      // Parse results
      let suites: TestSuiteResult[] = [];
      try {
        const json = extractJson(stdout);
        if (json) {
          suites =
            framework === 'playwright'
              ? parsePlaywrightResults(json)
              : parseVitestJestResults(json);
        }
      } catch {
        // JSON parsing failed — results stay empty
      }

      // Calculate summary
      let totalTests = 0;
      let passed = 0;
      let failed = 0;
      let skipped = 0;
      for (const suite of suites) {
        for (const test of suite.tests) {
          totalTests++;
          if (test.status === 'passed') passed++;
          else if (test.status === 'failed') failed++;
          else if (test.status === 'skipped') skipped++;
        }
      }

      const status = failed > 0 ? 'failed' : 'passed';

      // Update DB
      db.update(testRuns)
        .set({
          status,
          totalTests,
          passed,
          failed,
          skipped,
          durationMs,
          results: JSON.stringify(suites),
          rawOutput: stdout,
        })
        .where(eq(testRuns.id, runId))
        .run();

      // Emit tests:complete via Socket.IO
      const io = globalThis.io;
      if (io) {
        io.to(socketRoom).emit('tests:complete', {
          battlefieldId,
          testRunId: runId,
          summary: { total: totalTests, passed, failed, skipped, durationMs },
        });
      }
    })
    .catch(() => {
      // Process errored (e.g. aborted)
      db.update(testRuns)
        .set({ status: 'error' })
        .where(eq(testRuns.id, runId))
        .run();
    })
    .finally(() => {
      abortControllers.delete(runId);
    });

  return runId;
}

// ---------------------------------------------------------------------------
// getTestRun
// ---------------------------------------------------------------------------
export async function getTestRun(
  runId: string,
): Promise<TestRunRow | null> {
  const db = getDatabase();
  const row = db
    .select()
    .from(testRuns)
    .where(eq(testRuns.id, runId))
    .get();

  if (!row) return null;

  return row;
}

// ---------------------------------------------------------------------------
// getTestHistory
// ---------------------------------------------------------------------------
export async function getTestHistory(
  battlefieldId: string,
  limit: number = 20,
): Promise<TestRunRow[]> {
  const db = getDatabase();
  return db
    .select()
    .from(testRuns)
    .where(eq(testRuns.battlefieldId, battlefieldId))
    .orderBy(desc(testRuns.createdAt))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// abortTestRun
// ---------------------------------------------------------------------------
export async function abortTestRun(runId: string): Promise<void> {
  const controller = abortControllers.get(runId);
  if (controller) {
    controller.abort();
    abortControllers.delete(runId);
  }

  const db = getDatabase();
  db.update(testRuns)
    .set({ status: 'error' })
    .where(eq(testRuns.id, runId))
    .run();
}

// ---------------------------------------------------------------------------
// getLatestTestRun
// ---------------------------------------------------------------------------
export async function getLatestTestRun(
  battlefieldId: string,
): Promise<TestRunRow | null> {
  const db = getDatabase();
  const row = db
    .select()
    .from(testRuns)
    .where(eq(testRuns.battlefieldId, battlefieldId))
    .orderBy(desc(testRuns.createdAt))
    .limit(1)
    .all()
    .find((r) => r.status !== 'running');

  return row ?? null;
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------
function extractJson(output: string): unknown | null {
  // Try to find a JSON object in the output — vitest/jest mix JSON with console lines
  // Look for the outermost { ... } block
  let depth = 0;
  let start = -1;

  for (let i = 0; i < output.length; i++) {
    if (output[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (output[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          return JSON.parse(output.slice(start, i + 1));
        } catch {
          // Not valid JSON at this boundary, keep scanning
          start = -1;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Vitest / Jest parser
// ---------------------------------------------------------------------------
function parseVitestJestResults(json: unknown): TestSuiteResult[] {
  const data = json as {
    testResults?: Array<{
      name?: string;
      assertionResults?: Array<{
        ancestorTitles?: string[];
        title?: string;
        status?: string;
        duration?: number;
        failureMessages?: string[];
      }>;
    }>;
  };

  if (!data.testResults) return [];

  return data.testResults.map((suite) => ({
    name: path.basename(suite.name ?? 'unknown'),
    file: suite.name ?? 'unknown',
    tests: (suite.assertionResults ?? []).map((test): TestCaseResult => {
      const failureMsg = test.failureMessages?.join('\n') ?? '';
      return {
        name: test.title ?? 'unknown',
        status:
          test.status === 'passed'
            ? 'passed'
            : test.status === 'pending' || test.status === 'skipped'
              ? 'skipped'
              : 'failed',
        durationMs: test.duration ?? 0,
        ...(failureMsg
          ? { error: { message: failureMsg } }
          : {}),
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// deployFixMission — 1-click deploy a mission to fix failing tests
// ---------------------------------------------------------------------------
export async function deployFixMission(
  battlefieldId: string,
  suites: TestSuiteResult[],
): Promise<string> {
  const assetId = await getAssetByCodename('ASSERT');
  if (!assetId) {
    throw new Error('ASSERT asset not found — create an asset with codename ASSERT to use this feature');
  }

  const briefing = buildFixBriefing(suites);

  const mission = await createAndDeployMission({
    battlefieldId,
    briefing,
    assetId,
  });

  return mission.id;
}

function buildFixBriefing(suites: TestSuiteResult[]): string {
  const lines: string[] = [
    '# Fix Failing Tests',
    '',
    'The following tests are failing. Investigate the test files and the source code they exercise, identify the root cause of each failure, and fix them.',
    '',
  ];

  for (const suite of suites) {
    const failedTests = suite.tests.filter((t) => t.status === 'failed');
    if (failedTests.length === 0) continue;

    const fileName = suite.file.split('/').pop() ?? suite.name;
    lines.push(`## ${fileName} (${failedTests.length} ${failedTests.length === 1 ? 'failure' : 'failures'})`);

    for (const test of failedTests) {
      const errorMsg = test.error?.message
        ? ` — ${test.error.message.split('\n')[0].slice(0, 200)}`
        : '';
      lines.push(`- ${test.name}${errorMsg}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Playwright parser
// ---------------------------------------------------------------------------
function parsePlaywrightResults(json: unknown): TestSuiteResult[] {
  const data = json as {
    suites?: Array<{
      title?: string;
      file?: string;
      specs?: Array<{
        title?: string;
        ok?: boolean;
        tests?: Array<{
          status?: string;
          results?: Array<{
            duration?: number;
            errors?: Array<{ message?: string; stack?: string }>;
          }>;
        }>;
      }>;
    }>;
  };

  if (!data.suites) return [];

  return data.suites.map((suite) => ({
    name: suite.title ?? 'unknown',
    file: suite.file ?? suite.title ?? 'unknown',
    tests: (suite.specs ?? []).flatMap((spec): TestCaseResult[] =>
      (spec.tests ?? []).map((test): TestCaseResult => {
        const firstResult = test.results?.[0];
        const error = firstResult?.errors?.[0];
        const status = test.status ?? (spec.ok ? 'passed' : 'failed');
        return {
          name: spec.title ?? 'unknown',
          status:
            status === 'expected' || status === 'passed'
              ? 'passed'
              : status === 'skipped'
                ? 'skipped'
                : 'failed',
          durationMs: firstResult?.duration ?? 0,
          ...(error
            ? {
                error: {
                  message: error.message ?? '',
                  stack: error.stack,
                },
              }
            : {}),
        };
      }),
    ),
  }));
}
