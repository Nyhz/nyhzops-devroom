import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import simpleGit from 'simple-git';
import { eq } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import { assets } from '@/lib/db/schema';
import {
  runMerge,
  type QuartermasterInput,
  type QuartermasterResult,
} from '@/control/merge';
import {
  spawnQuartermaster,
  type SpawnQuartermasterOptions,
} from '@/control/merge/quartermaster';
import type { GateManifest, GateRunResults, RunGatesOptions } from '@/control/gates';
import {
  materializeRepo,
  type MaterializedRepo,
} from '@/../tests/control/fixtures/repos/materialize';
import { createMissionWorktree } from '@/control/worktree';

// ---------------------------------------------------------------------------
// Scripted-claude wiring — matches combat-lifecycle.test.ts
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTED_CLAUDE = path.join(
  REPO_ROOT,
  'tests/control/fixtures/scripted-claude/scripted-claude.ts',
);
const TSX_BIN = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
const SCENARIO_DIR = path.join(REPO_ROOT, 'tests/control/fixtures/scenarios');

function scriptedQuartermaster(
  scenarioPath: string,
  overrides: Partial<SpawnQuartermasterOptions> = {},
) {
  return (input: QuartermasterInput): Promise<QuartermasterResult> =>
    spawnQuartermaster(input, {
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: { SCRIPTED_CLAUDE_SCENARIO: scenarioPath },
      hardTimeoutMs: 30_000,
      stdoutSilenceMs: 30_000,
      ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Ensure QUARTERMASTER asset exists. The repo's seed adds it, but the test DB
// may have been created before that migration ran — insert defensively.
// ---------------------------------------------------------------------------
beforeAll(() => {
  const db = getDatabase();
  const existing = db
    .select()
    .from(assets)
    .where(eq(assets.codename, 'QUARTERMASTER'))
    .get();
  if (!existing) {
    db.insert(assets)
      .values({
        id: 'qm-test-fixture',
        codename: 'QUARTERMASTER',
        specialty: 'Merge conflict resolution',
        systemPrompt: 'You are the QUARTERMASTER.',
        model: 'claude-sonnet-4-6',
        status: 'active',
        missionsCompleted: 0,
        skills: null,
        mcpServers: null,
        maxTurns: 15,
        effort: 'medium',
        isSystem: 1,
        memory: null,
        createdAt: Date.now(),
      })
      .run();
  }
});

// ---------------------------------------------------------------------------
// Fixture helpers (mirror merge.test.ts)
// ---------------------------------------------------------------------------

const emptyManifest: GateManifest = {
  build: null,
  test: null,
  lint: null,
  typecheck: null,
};

const stubGates = (overallStatus: 'pass' | 'fail') =>
  async (_opts: RunGatesOptions): Promise<GateRunResults> => ({
    results: [],
    overallStatus,
  });

interface ConflictSetup {
  repo: MaterializedRepo;
  targetBranch: string;
  sourceBranch: string;
  worktreePath: string;
  targetHead: string;
}

async function setupRepoWithConflict(): Promise<ConflictSetup> {
  const repo = await materializeRepo('ts-with-tests');
  const git = simpleGit(repo.path);
  const targetBranch = (await git.branch()).current;
  const sourceBranch = 'devroom/qm-test/feat';

  const wt = await createMissionWorktree({
    repoPath: repo.path,
    targetBranch,
    missionBranch: sourceBranch,
  });

  // Mission commit: rewrite src/index.ts.
  const wtGit = simpleGit(wt.path);
  await wtGit.addConfig('user.email', 'fixture@local');
  await wtGit.addConfig('user.name', 'Fixture');
  await writeFile(
    path.join(wt.path, 'src/index.ts'),
    'export function add(a: number, b: number): number {\n  return a + b + 0; // mission edit\n}\n',
  );
  await wtGit.add('.');
  await wtGit.commit('feat(mission): rewrite add');

  // Advance target with a conflicting edit to the same file (two commits).
  await git.checkout(targetBranch);
  await writeFile(
    path.join(repo.path, 'src/index.ts'),
    'export function add(a: number, b: number): number {\n  return a * b; // target edit 1\n}\n',
  );
  await git.add('.');
  await git.commit('chore(target): first advance');

  await writeFile(
    path.join(repo.path, 'src/index.ts'),
    'export function add(a: number, b: number): number {\n  return a * b + 1; // target edit 2\n}\n',
  );
  await git.add('.');
  await git.commit('chore(target): second advance');

  // targetHead captured BEFORE target advanced — this is what `runMerge`
  // expects as `targetHeadAtStart`.
  const initialCommits = await git.log([targetBranch]);
  // The third-from-latest commit is the initial fixture state.
  const earliest = initialCommits.all[initialCommits.all.length - 1];
  return {
    repo,
    targetBranch,
    sourceBranch,
    worktreePath: wt.path,
    targetHead: earliest.hash,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spawnQuartermaster (integration)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) {
      const c = cleanups.pop();
      if (c) await c();
    }
  });

  it('resolves a conflict when scripted QM rewrites the file and commits', async () => {
    const setup = await setupRepoWithConflict();
    cleanups.push(setup.repo.cleanup);

    const scenarioPath = path.join(SCENARIO_DIR, 'quartermaster-resolved.json');
    const onQuartermaster = scriptedQuartermaster(scenarioPath, {
      env: {
        SCRIPTED_CLAUDE_SCENARIO: scenarioPath,
        QM_TARGET_BRANCH: setup.targetBranch,
      },
    });

    const result = await runMerge({
      battlefieldId: 'bf-qm-ok',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      onQuartermaster,
      runGates: stubGates('pass'),
    });

    expect(result.status).toBe('accomplished');

    // Target branch should now contain the rebased mission commit.
    const log = await simpleGit(setup.repo.path).log([setup.targetBranch]);
    const messages = log.all.map((c) => c.message);
    expect(messages.some((m) => m.includes('feat(mission): rewrite add'))).toBe(true);
    expect(messages.some((m) => m.includes('chore(target): second advance'))).toBe(true);
  }, 60_000);

  it('reports unresolved when scripted QM leaves the index dirty and does not commit', async () => {
    const setup = await setupRepoWithConflict();
    cleanups.push(setup.repo.cleanup);

    const scenarioPath = path.join(SCENARIO_DIR, 'quartermaster-unresolved.json');
    const onQuartermaster = scriptedQuartermaster(scenarioPath);

    const result = await runMerge({
      battlefieldId: 'bf-qm-unresolved',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      onQuartermaster,
      runGates: stubGates('pass'),
    });

    expect(result).toEqual({ status: 'compromised', reason: 'merge-conflict' });
  }, 60_000);

  it('times out when the scripted QM hangs past hardTimeoutMs', async () => {
    const setup = await setupRepoWithConflict();
    cleanups.push(setup.repo.cleanup);

    const scenarioPath = path.join(SCENARIO_DIR, 'quartermaster-hang.json');
    // Direct unit-level invocation — we want to observe the exact reason
    // string on QuartermasterResult, which `runMerge` collapses.
    const input: QuartermasterInput = {
      worktreePath: setup.worktreePath,
      repoPath: setup.repo.path,
      sourceBranch: setup.sourceBranch,
      targetBranch: setup.targetBranch,
      briefing: 'simulate',
      debrief: '',
      conflictDiff: '',
      logSourceToTarget: '',
      logTargetToSource: '',
      claudeMdExcerpt: '',
    };

    const result = await spawnQuartermaster(input, {
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: { SCRIPTED_CLAUDE_SCENARIO: scenarioPath },
      hardTimeoutMs: 500,
      stdoutSilenceMs: 30_000,
    });

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('timeout');
  }, 30_000);
});
