import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';

export interface MaterializedRepo {
  path: string;
  cleanup: () => Promise<void>;
}

export async function materializeRepo(
  template: 'ts-with-tests' | 'ts-no-tests' | 'red-main',
): Promise<MaterializedRepo> {
  const dir = await mkdtemp(path.join(tmpdir(), 'devroom-fixture-'));
  const src = path.join(__dirname, 'templates', template);
  await cp(src, dir, { recursive: true });

  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'fixture@local');
  await git.addConfig('user.name', 'Fixture');
  await git.add('.');
  await git.commit('initial fixture state');

  return {
    path: dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
