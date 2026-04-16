import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import simpleGit from 'simple-git';
import { materializeRepo, type MaterializedRepo } from '../materialize';

describe('materializeRepo', () => {
  let repo: MaterializedRepo | undefined;

  afterEach(async () => {
    if (repo) {
      await repo.cleanup();
      repo = undefined;
    }
  });

  it('materializes ts-with-tests with a single initial commit', async () => {
    repo = await materializeRepo('ts-with-tests');

    expect(existsSync(repo.path)).toBe(true);
    expect(existsSync(path.join(repo.path, 'package.json'))).toBe(true);

    const log = await simpleGit(repo.path).log();
    expect(log.total).toBe(1);
  });
});
