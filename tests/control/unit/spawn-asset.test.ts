import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';

import { spawnAsset, spawnClaudeOneShot, type AssetDefinition } from '@/control/spawn-asset';

// ---------------------------------------------------------------------------
// Scripted-claude plumbing
// ---------------------------------------------------------------------------
//
// We inject the scripted-claude fixture by invoking `tsx <scriptPath>` as the
// claude binary. `spawnAsset` supports `claudeArgsPrefix` for exactly this
// purpose — the fixture's script path is passed as `claudeArgsPrefix[0]` so
// that `tsx` sees it as the module to run. Scenario selection happens via the
// `SCRIPTED_CLAUDE_SCENARIO` env var, threaded through `opts.env`.
//
// `tsx` is installed as a devDependency; its binary lives at
// `node_modules/.bin/tsx`. We resolve the absolute path at test-time to avoid
// relying on `PATH` inheritance.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTED_CLAUDE = path.join(
  REPO_ROOT,
  'tests/control/fixtures/scripted-claude/scripted-claude.ts',
);
const TSX_BIN = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
const SCENARIO_DIR = path.join(REPO_ROOT, 'tests/control/fixtures/scenarios');

const MINIMAL_ASSET: AssetDefinition = {
  codename: 'OPERATIVE',
  model: 'claude-opus-4-7',
  maxTurns: 30,
  effort: 'medium',
  isSystem: 0,
  systemPrompt: 'You are the operative.',
  skills: [],
  mcpServers: [],
};

async function makeGitRepo(): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spawn-asset-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@local');
  await git.addConfig('user.name', 'Test');
  await writeFile(path.join(dir, 'README.md'), 'seed\n');
  await git.add('.');
  await git.commit('init');
  return {
    cwd: dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe('spawnAsset (scripted-claude)', () => {
  let repo: { cwd: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    repo = await makeGitRepo();
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  it('happy path: resolves with success subtype, captures final message + tool-use count', async () => {
    const result = await spawnAsset({
      missionId: 'MISSION_HAPPY',
      worktreePath: repo.cwd,
      briefing: 'do the thing',
      assetCodename: 'OPERATIVE',
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'roe',
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: {
        SCRIPTED_CLAUDE_SCENARIO: path.join(SCENARIO_DIR, 'happy-path-combat.json'),
      },
      stdoutSilenceMs: 10_000,
      hardTimeoutMs: 15_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutResultSubtype).toBe('success');
    expect(result.finalMessage).toContain('<DEBRIEF>');
    expect(result.toolUseCount).toBe(2);
    expect(result.killedByControl).toBe(false);
    expect(result.usage).toEqual({ input: 100, output: 50, cache: 900 });
    // hasDiff — scripted-claude doesn't touch the worktree, so should be false.
    expect(result.hasDiff).toBe(false);
  }, 20_000);

  it('hang: L3 stdout-silence fires → subprocess killed, killedByControl=true', async () => {
    const result = await spawnAsset({
      missionId: 'MISSION_HANG',
      worktreePath: repo.cwd,
      briefing: 'hang please',
      assetCodename: 'OPERATIVE',
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'roe',
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: {
        SCRIPTED_CLAUDE_SCENARIO: path.join(SCENARIO_DIR, 'hang.json'),
      },
      // First assistant event arrives at 20 ms. Next event is delayed 5000 ms.
      // Set silence threshold to 200 ms so the silence-kill fires well before
      // the second event.
      stdoutSilenceMs: 200,
      hardTimeoutMs: 15_000,
    });

    expect(result.killedByControl).toBe(true);
    // exitCode is either null (signal) or non-zero when killed.
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
    expect(result.stderr).toContain('silence-kill');
  }, 20_000);

  it('non-zero exit: resolves with exitCode=1 and no result subtype', async () => {
    const result = await spawnAsset({
      missionId: 'MISSION_NONZERO',
      worktreePath: repo.cwd,
      briefing: 'fail',
      assetCodename: 'OPERATIVE',
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'roe',
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: {
        SCRIPTED_CLAUDE_SCENARIO: path.join(SCENARIO_DIR, 'exit-nonzero.json'),
      },
      stdoutSilenceMs: 10_000,
      hardTimeoutMs: 15_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdoutResultSubtype).toBeNull();
    expect(result.killedByControl).toBe(false);
    expect(result.stderr).toContain('something went wrong');
  }, 20_000);

  it('stdin pipe: succeeds regardless of briefing length (no EPIPE-induced failure)', async () => {
    const bigBriefing = 'x'.repeat(10_000);
    const result = await spawnAsset({
      missionId: 'MISSION_STDIN',
      worktreePath: repo.cwd,
      briefing: bigBriefing,
      assetCodename: 'OPERATIVE',
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'roe',
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: {
        SCRIPTED_CLAUDE_SCENARIO: path.join(SCENARIO_DIR, 'happy-path-combat.json'),
      },
      stdoutSilenceMs: 10_000,
      hardTimeoutMs: 15_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutResultSubtype).toBe('success');
  }, 20_000);
});

describe('spawnClaudeOneShot', () => {
  let repo: { cwd: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    repo = await makeGitRepo();
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  it('parses final assistant JSON payload from --print invocation', async () => {
    const result = await spawnClaudeOneShot({
      missionId: 'MISSION_CLASSIFY',
      cwd: repo.cwd,
      briefing: 'classify this exit',
      asset: MINIMAL_ASSET,
      rulesOfEngagement: 'roe',
      maxTurnsOverride: 3,
      claudeBinary: TSX_BIN,
      claudeArgsPrefix: [SCRIPTED_CLAUDE],
      env: {
        SCRIPTED_CLAUDE_SCENARIO: path.join(SCENARIO_DIR, 'classification-oneshot.json'),
      },
      stdoutSilenceMs: 10_000,
      hardTimeoutMs: 15_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      category: 'INFRASTRUCTURE',
      reasoning: 'network flake',
    });
  }, 20_000);
});
