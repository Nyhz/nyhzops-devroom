import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { materializeRepo, MaterializedRepo } from '@/../tests/control/fixtures/repos/materialize';
import simpleGit from 'simple-git';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createMissionWorktree, parseWorktreeList } from '@/control/worktree';

describe('parseWorktreeList', () => {
  it('parses main + linked worktree blocks with branch', () => {
    const out = [
      'worktree /repo',
      'HEAD abcdef',
      'branch refs/heads/master',
      '',
      'worktree /repo/.worktrees/mission-a',
      'HEAD 123456',
      'branch refs/heads/devroom/m1/fix',
      '',
    ].join('\n');
    const parsed = parseWorktreeList(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ path: '/repo', branch: 'master', detached: false });
    expect(parsed[1]).toEqual({
      path: '/repo/.worktrees/mission-a',
      branch: 'devroom/m1/fix',
      detached: false,
    });
  });

  it('marks detached worktrees with detached=true and null branch', () => {
    const out = ['worktree /repo/det', 'HEAD abc', 'detached', ''].join('\n');
    const parsed = parseWorktreeList(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ path: '/repo/det', branch: null, detached: true });
  });
});

describe('createMissionWorktree — structured pre-flight', () => {
  let repo: MaterializedRepo;
  beforeEach(async () => {
    repo = await materializeRepo('ts-with-tests');
  });
  afterEach(async () => {
    if (repo) await repo.cleanup();
  });

  it('re-entrant call with same branch returns info for same path without error', async () => {
    const first = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    const second = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    expect(second.path).toBe(first.path);
    expect(second.branch).toBe('devroom/m1/fix');
  });

  it('throws descriptive error when path is registered for a different branch', async () => {
    const git = simpleGit(repo.path);
    // Pre-register the sanitized path under a different branch name manually.
    const wtPath = path.join(repo.path, '.worktrees', 'devroom-m1-fix');
    await git.raw(['worktree', 'add', '-b', 'devroom/other/branch', wtPath, 'master']);

    await expect(
      createMissionWorktree({
        repoPath: repo.path,
        targetBranch: 'master',
        missionBranch: 'devroom/m1/fix',
      }),
    ).rejects.toThrow(/devroom\/other\/branch.*devroom\/m1\/fix|devroom\/m1\/fix.*devroom\/other\/branch/);
  });

  it('propagates unrelated errors from git worktree add', async () => {
    // Invalid target branch — not "already" — must not be swallowed.
    await expect(
      createMissionWorktree({
        repoPath: repo.path,
        targetBranch: 'this-branch-does-not-exist-xyz',
        missionBranch: 'devroom/m2/new',
      }),
    ).rejects.toThrow();
  });

  it('does not swallow "destination path already exists and is not empty" (non-registered path)', async () => {
    // Create a non-empty directory at the would-be worktree path without registering it as a worktree.
    const wtPath = path.join(repo.path, '.worktrees', 'devroom-m3-collide');
    await mkdir(wtPath, { recursive: true });
    await writeFile(path.join(wtPath, 'stray.txt'), 'not a worktree');
    await expect(
      createMissionWorktree({
        repoPath: repo.path,
        targetBranch: 'master',
        missionBranch: 'devroom/m3/collide',
      }),
    ).rejects.toThrow();
  });
});
