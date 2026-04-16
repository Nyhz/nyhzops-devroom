import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectGates } from '@/control/bootstrap/detect';
import {
  materializeRepo,
  MaterializedRepo,
} from '@/../tests/control/fixtures/repos/materialize';

describe('detectGates', () => {
  const repos: MaterializedRepo[] = [];
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (repos.length) {
      const r = repos.pop();
      if (r) await r.cleanup();
    }
    while (tmpDirs.length) {
      const d = tmpDirs.pop();
      if (d) await rm(d, { recursive: true, force: true });
    }
  });

  it('detects pnpm test + build + tsc typecheck for ts-with-tests fixture', async () => {
    const repo = await materializeRepo('ts-with-tests');
    repos.push(repo);

    const gates = await detectGates(repo.path);

    expect(gates).toEqual({
      build: 'pnpm build',
      test: 'pnpm test',
      lint: null,
      typecheck: 'tsc --noEmit',
    });
  });

  it('returns test=null for ts-no-tests fixture (build + typecheck still detected)', async () => {
    const repo = await materializeRepo('ts-no-tests');
    repos.push(repo);

    const gates = await detectGates(repo.path);

    expect(gates).toEqual({
      build: 'pnpm build',
      test: null,
      lint: null,
      typecheck: 'tsc --noEmit',
    });
  });

  it('returns all nulls for a fresh empty directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'devroom-detect-empty-'));
    tmpDirs.push(dir);

    const gates = await detectGates(dir);

    expect(gates).toEqual({
      build: null,
      test: null,
      lint: null,
      typecheck: null,
    });
  });

  it('detects go gates when go.mod is present', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'devroom-detect-go-'));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, 'go.mod'), 'module example.com/fixture\n\ngo 1.22\n', 'utf8');

    const gates = await detectGates(dir);

    expect(gates).toEqual({
      build: 'go build ./...',
      test: 'go test ./...',
      lint: null,
      typecheck: null,
    });
  });
});
