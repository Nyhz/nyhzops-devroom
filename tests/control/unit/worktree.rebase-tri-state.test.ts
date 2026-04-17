import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { materializeRepo, MaterializedRepo } from '@/../tests/control/fixtures/repos/materialize';
import simpleGit from 'simple-git';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createMissionWorktree, rebaseOntoTarget } from '@/control/worktree';

describe('rebaseOntoTarget — tri-state result', () => {
  let repo: MaterializedRepo;

  beforeEach(async () => {
    repo = await materializeRepo('ts-with-tests');
  });
  afterEach(async () => {
    if (repo) await repo.cleanup();
  });

  it('returns { rebased: true, conflict: false } on clean rebase when target advanced', async () => {
    // Create mission worktree off master.
    const wt = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m1/feature',
    });
    // Commit something on the mission branch (in the worktree).
    const wtGit = simpleGit(wt.path);
    await wtGit.addConfig('user.email', 'mission@local');
    await wtGit.addConfig('user.name', 'Mission');
    await writeFile(path.join(wt.path, 'mission.txt'), 'mission work');
    await wtGit.add('.');
    await wtGit.commit('mission commit');

    // Advance master in the main repo with an unrelated commit.
    const repoGit = simpleGit(repo.path);
    await writeFile(path.join(repo.path, 'upstream.txt'), 'upstream change');
    await repoGit.add('.');
    await repoGit.commit('upstream commit');

    const result = await rebaseOntoTarget(wt.path, 'master');
    expect(result).toEqual({ rebased: true, conflict: false });
  });

  it('returns { rebased: false, conflict: true } on conflicting rebase without throwing', async () => {
    const wt = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m2/conflict',
    });
    // Modify the same file divergently on both branches.
    const wtGit = simpleGit(wt.path);
    await wtGit.addConfig('user.email', 'mission@local');
    await wtGit.addConfig('user.name', 'Mission');
    await writeFile(path.join(wt.path, 'shared.txt'), 'mission-side');
    await wtGit.add('.');
    await wtGit.commit('mission edit');

    const repoGit = simpleGit(repo.path);
    await writeFile(path.join(repo.path, 'shared.txt'), 'upstream-side');
    await repoGit.add('.');
    await repoGit.commit('upstream edit');

    const result = await rebaseOntoTarget(wt.path, 'master');
    expect(result).toEqual({ rebased: false, conflict: true });
  });

  it('returns { rebased: false, conflict: false, error } when rebasing onto a non-existent branch (no throw)', async () => {
    const wt = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: 'devroom/m3/hard-error',
    });

    const result = await rebaseOntoTarget(wt.path, 'this-branch-does-not-exist-xyz');
    expect('error' in result).toBe(true);
    if ('error' in result && typeof result.error === 'string') {
      expect(result.rebased).toBe(false);
      expect(result.conflict).toBe(false);
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
