import { describe, it, expect, afterEach } from 'vitest';
import simpleGit from 'simple-git';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  materializeRepo,
  MaterializedRepo,
} from '@/../tests/control/fixtures/repos/materialize';
import { createMissionWorktree } from '@/control/worktree';
import {
  MergeLockManager,
  runMerge,
  type QuartermasterCallback,
} from '@/control/merge';
import type { GateManifest, GateRunResults, RunGatesOptions } from '@/control/gates';

// Dependency-injection strategy: we inject a custom `runGates` implementation
// into `runMerge` via its `runGates` option. This is the cleanest way to make
// the gate-run outcome deterministic per scenario without relying on the
// real subprocess spawn or the shape of the stub manifest. The real gate
// path is exercised separately in tests/control/unit/gates.test.ts and
// tests/control/unit/bootstrap-verify.test.ts.

const emptyManifest: GateManifest = { build: null, test: null, lint: null, typecheck: null };

const stubGates = (overallStatus: 'pass' | 'fail') =>
  async (_opts: RunGatesOptions): Promise<GateRunResults> => ({
    results: [],
    overallStatus,
  });

async function setupRepoAndWorktree(template: 'ts-with-tests' = 'ts-with-tests'): Promise<{
  repo: MaterializedRepo;
  targetBranch: string;
  sourceBranch: string;
  worktreePath: string;
  targetHead: string;
}> {
  const repo = await materializeRepo(template);
  const git = simpleGit(repo.path);
  const status = await git.branch();
  const targetBranch = status.current;
  const sourceBranch = 'devroom/m1/feat';

  const wt = await createMissionWorktree({
    repoPath: repo.path,
    targetBranch,
    missionBranch: sourceBranch,
  });

  // Make a commit on the worktree branch so we have something to merge.
  await writeFile(path.join(wt.path, 'feature.txt'), 'hello from mission\n');
  const wtGit = simpleGit(wt.path);
  await wtGit.addConfig('user.email', 'fixture@local');
  await wtGit.addConfig('user.name', 'Fixture');
  await wtGit.add('.');
  await wtGit.commit('feat(mission): add feature.txt');

  const targetHead = (await git.revparse([targetBranch])).trim();
  return { repo, targetBranch, sourceBranch, worktreePath: wt.path, targetHead };
}

async function createConflict(setup: {
  repo: MaterializedRepo;
  targetBranch: string;
  worktreePath: string;
}): Promise<void> {
  // Overwrite src/index.ts on the worktree branch with one version...
  const wtGit = simpleGit(setup.worktreePath);
  await wtGit.addConfig('user.email', 'fixture@local');
  await wtGit.addConfig('user.name', 'Fixture');
  await writeFile(
    path.join(setup.worktreePath, 'src/index.ts'),
    'export function add(a: number, b: number): number {\n  return a + b + 0; // mission edit\n}\n',
  );
  await wtGit.add('.');
  await wtGit.commit('feat(mission): rewrite add');

  // ...then overwrite the same file on target with a different version to
  // guarantee a non-trivial conflict on rebase.
  await advanceTarget(
    setup.repo.path,
    setup.targetBranch,
    'src/index.ts',
    'export function add(a: number, b: number): number {\n  return a * b; // target edit\n}\n',
  );
}

async function advanceTarget(
  repoPath: string,
  targetBranch: string,
  filename: string,
  contents: string,
): Promise<string> {
  const git = simpleGit(repoPath);
  const prev = (await git.branch()).current;
  await git.checkout(targetBranch);
  await writeFile(path.join(repoPath, filename), contents);
  await git.add('.');
  await git.commit(`chore(target): advance with ${filename}`);
  if (prev && prev !== targetBranch) {
    // Best-effort restore; fixture repos may not have the branch still checked out.
    try {
      await git.checkout(prev);
    } catch {
      // ignore
    }
  }
  return (await git.revparse([targetBranch])).trim();
}

describe('runMerge', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) {
      const c = cleanups.pop();
      if (c) await c();
    }
  });

  it('fast-forwards when target did not advance', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    const result = await runMerge({
      battlefieldId: 'bf-1',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      runGates: stubGates('pass'),
    });

    expect(result).toEqual({ status: 'accomplished' });

    // Target should now contain the mission commit.
    const log = await simpleGit(setup.repo.path).log([setup.targetBranch]);
    expect(log.latest?.message).toContain('feat(mission): add feature.txt');
  });

  it('rebases cleanly and merges when target advanced and gates pass', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    await advanceTarget(setup.repo.path, setup.targetBranch, 'unrelated.txt', 'new on target\n');

    const result = await runMerge({
      battlefieldId: 'bf-2',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      runGates: stubGates('pass'),
    });

    expect(result).toEqual({ status: 'accomplished' });
    const log = await simpleGit(setup.repo.path).log([setup.targetBranch]);
    const messages = log.all.map((c) => c.message);
    expect(messages.some((m) => m.includes('feat(mission): add feature.txt'))).toBe(true);
    expect(messages.some((m) => m.includes('chore(target): advance with unrelated.txt'))).toBe(true);
  });

  it('compromises with post-rebase-gate-failure when gates fail after clean rebase', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    await advanceTarget(setup.repo.path, setup.targetBranch, 'unrelated.txt', 'new on target\n');

    const result = await runMerge({
      battlefieldId: 'bf-3',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      runGates: stubGates('fail'),
    });

    expect(result).toEqual({ status: 'compromised', reason: 'post-rebase-gate-failure' });
  });

  it('compromises with merge-conflict when rebase conflicts and no QUARTERMASTER provided', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    await createConflict(setup);

    const result = await runMerge({
      battlefieldId: 'bf-4',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      runGates: stubGates('pass'),
    });

    expect(result).toEqual({ status: 'compromised', reason: 'merge-conflict' });
  });

  it('compromises with merge-conflict when QUARTERMASTER fails to resolve', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    await createConflict(setup);

    const qm: QuartermasterCallback = async () => ({ resolved: false, stderr: 'give up' });

    const result = await runMerge({
      battlefieldId: 'bf-5',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      onQuartermaster: qm,
      runGates: stubGates('pass'),
    });

    expect(result).toEqual({ status: 'compromised', reason: 'merge-conflict' });
  });

  it('accomplishes when QUARTERMASTER resolves and gates pass', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    await createConflict(setup);

    // QUARTERMASTER stub: simulate a resolution by rebasing using "ours"
    // strategy so the worktree branch cleanly sits on top of the advanced target.
    const qm: QuartermasterCallback = async (input) => {
      const g = simpleGit(input.worktreePath);
      await g.addConfig('user.email', 'qm@local');
      await g.addConfig('user.name', 'Quartermaster');
      // Reset to origin-equivalent target then reapply our change.
      await g.raw(['rebase', '--strategy-option=ours', input.targetBranch]).catch(async () => {
        // If rebase still leaves conflicts, abort and report unresolved.
        await g.rebase(['--abort']).catch(() => {});
      });
      return { resolved: true };
    };

    const result = await runMerge({
      battlefieldId: 'bf-6',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      onQuartermaster: qm,
      runGates: stubGates('pass'),
    });

    expect(result).toEqual({ status: 'accomplished' });
  });

  it('compromises with post-qm-gate-failure when QUARTERMASTER resolves but gates fail', async () => {
    const setup = await setupRepoAndWorktree();
    cleanups.push(setup.repo.cleanup);

    await createConflict(setup);

    const qm: QuartermasterCallback = async (input) => {
      const g = simpleGit(input.worktreePath);
      await g.raw(['rebase', '--strategy-option=ours', input.targetBranch]).catch(async () => {
        await g.rebase(['--abort']).catch(() => {});
      });
      return { resolved: true };
    };

    const result = await runMerge({
      battlefieldId: 'bf-7',
      repoPath: setup.repo.path,
      targetBranch: setup.targetBranch,
      sourceBranch: setup.sourceBranch,
      targetHeadAtStart: setup.targetHead,
      worktreePath: setup.worktreePath,
      manifest: emptyManifest,
      onQuartermaster: qm,
      runGates: stubGates('fail'),
    });

    expect(result).toEqual({ status: 'compromised', reason: 'post-qm-gate-failure' });
  });

  it('serializes concurrent runMerge calls on the same battlefieldId', async () => {
    const lockMgr = new MergeLockManager();

    const order: string[] = [];

    // Set up two completely independent repos; we only need the lock to
    // serialize entry by battlefieldId, so the underlying work is irrelevant.
    const s1 = await setupRepoAndWorktree();
    cleanups.push(s1.repo.cleanup);
    const s2 = await setupRepoAndWorktree();
    cleanups.push(s2.repo.cleanup);

    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const qmFirst: QuartermasterCallback = async () => {
      order.push('qm1-start');
      await firstGate;
      order.push('qm1-end');
      return { resolved: false };
    };

    const qmSecond: QuartermasterCallback = async () => {
      order.push('qm2-start');
      return { resolved: false };
    };

    // Both need to actually hit the QM path. Create a conflict in each.
    for (const s of [s1, s2]) {
      await createConflict(s);
    }

    const p1 = runMerge(
      {
        battlefieldId: 'same-bf',
        repoPath: s1.repo.path,
        targetBranch: s1.targetBranch,
        sourceBranch: s1.sourceBranch,
        targetHeadAtStart: s1.targetHead,
        worktreePath: s1.worktreePath,
        manifest: emptyManifest,
        onQuartermaster: qmFirst,
        runGates: stubGates('pass'),
      },
      lockMgr,
    );

    // Wait until p1 has actually entered its QM callback.
    while (!order.includes('qm1-start')) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const p2 = runMerge(
      {
        battlefieldId: 'same-bf',
        repoPath: s2.repo.path,
        targetBranch: s2.targetBranch,
        sourceBranch: s2.sourceBranch,
        targetHeadAtStart: s2.targetHead,
        worktreePath: s2.worktreePath,
        manifest: emptyManifest,
        onQuartermaster: qmSecond,
        runGates: stubGates('pass'),
      },
      lockMgr,
    );

    // Wait to let p2 potentially race.
    await new Promise((r) => setTimeout(r, 50));

    // Assert: p2's QM has NOT started while p1 is still inside the lock.
    expect(order).toEqual(['qm1-start']);

    releaseFirst();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe('compromised');
    expect(r2.status).toBe('compromised');
    expect(order).toEqual(['qm1-start', 'qm1-end', 'qm2-start']);
  });
});
