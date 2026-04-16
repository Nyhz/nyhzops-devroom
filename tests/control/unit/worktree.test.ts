import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { materializeRepo, MaterializedRepo } from '@/../tests/control/fixtures/repos/materialize';
import simpleGit from 'simple-git';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  createMissionWorktree,
  removeMissionWorktree,
  resetWorktreeToHead,
  sanitizeBranchForPath,
} from '@/control/worktree';

describe('sanitizeBranchForPath', () => {
  it('replaces non [a-zA-Z0-9._-] with -', () => {
    expect(sanitizeBranchForPath('devroom/fix-auth/01h')).toBe('devroom-fix-auth-01h');
    expect(sanitizeBranchForPath('feat foo')).toBe('feat-foo');
  });
});

describe('createMissionWorktree', () => {
  let repo: MaterializedRepo;
  beforeEach(async () => {
    repo = await materializeRepo('ts-with-tests');
  });
  afterEach(async () => {
    if (repo) await repo.cleanup();
  });

  it('creates a worktree branched off target', async () => {
    const w = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    expect(existsSync(w.path)).toBe(true);
    expect(w.branch).toBe('devroom/m1/fix');
    const branches = await simpleGit(repo.path).branch();
    expect(branches.all).toContain('devroom/m1/fix');
  });

  it('reuses existing worktree when branch already exists', async () => {
    await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    const w2 = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    expect(w2.path).toMatch(/devroom-m1-fix$/);
  });

  it('resetWorktreeToHead discards dirty + untracked files', async () => {
    const w = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(w.path, 'dirty.txt'), 'garbage');
    await fs.appendFile(path.join(w.path, 'src/index.ts'), '\n// edit\n');
    await resetWorktreeToHead(w.path);
    expect(existsSync(path.join(w.path, 'dirty.txt'))).toBe(false);
    const idx = await fs.readFile(path.join(w.path, 'src/index.ts'), 'utf8');
    expect(idx).not.toContain('// edit');
  });

  it('removeMissionWorktree removes worktree directory and branch', async () => {
    const w = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/fix',
    });
    await removeMissionWorktree({
      repoPath: repo.path,
      worktreePath: w.path,
      branch: 'devroom/m1/fix',
      deleteBranch: true,
    });
    expect(existsSync(w.path)).toBe(false);
    const branches = await simpleGit(repo.path).branch();
    expect(branches.all).not.toContain('devroom/m1/fix');
  });
});
