import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { synthesizeDebrief } from '@/control/debrief/synthesize';
import { materializeRepo, MaterializedRepo } from '../../fixtures/repos/materialize';
import simpleGit from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('synthesizeDebrief', () => {
  let repo: MaterializedRepo;
  beforeEach(async () => {
    repo = await materializeRepo('ts-with-tests');
  });
  afterEach(async () => {
    if (repo) await repo.cleanup();
  });

  it('synthesizes commits and files_touched from git log + diff', async () => {
    const git = simpleGit(repo.path);
    await git.checkoutLocalBranch('feature');
    await fs.writeFile(path.join(repo.path, 'src/new.ts'), 'export const x = 1;');
    await git.add('.');
    await git.commit('add new file');
    const r = await synthesizeDebrief({
      repoPath: repo.path,
      targetBranch: 'master',
      sourceBranch: 'feature',
      finalMessageText: 'I did some stuff.',
    });
    expect(r.summary).toContain('did some stuff');
    expect(r.commits.length).toBeGreaterThan(0);
    expect(r.files_touched).toContain('src/new.ts');
    expect(r.confidence).toBe('unknown');
    expect(r.open_questions).toEqual([]);
  });

  it('falls back to default summary when finalMessageText is null', async () => {
    const r = await synthesizeDebrief({
      repoPath: repo.path,
      targetBranch: 'master',
      sourceBranch: 'master',
      finalMessageText: null,
    });
    expect(r.summary).toBe('No structured debrief provided by agent.');
    expect(r.commits).toEqual([]);
    expect(r.files_touched).toEqual([]);
    expect(r.confidence).toBe('unknown');
  });

  it('truncates long summaries to 2000 chars', async () => {
    const long = 'x'.repeat(3000);
    const r = await synthesizeDebrief({
      repoPath: repo.path,
      targetBranch: 'master',
      sourceBranch: 'master',
      finalMessageText: long,
    });
    expect(r.summary.length).toBe(2000);
  });
});
