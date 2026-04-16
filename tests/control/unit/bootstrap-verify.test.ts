import { describe, it, expect, afterEach } from 'vitest';
import { verifyGatesOnHead } from '@/control/bootstrap/verify';
import {
  materializeRepo,
  MaterializedRepo,
} from '@/../tests/control/fixtures/repos/materialize';

// Approach: rather than running `pnpm install` inside each fixture (slow,
// network-dependent, adds 30s+ per test), we override the manifest with
// lightweight `node -e` smoke commands that exercise the same verify path
// without needing node_modules. For ts-with-tests we use all-passing
// commands; for red-main we use a test gate that exits non-zero to mirror
// the intended failure mode. This keeps both tests well under the 60s
// budget while still exercising runGates end-to-end against a real repo.

describe('verifyGatesOnHead', () => {
  const repos: MaterializedRepo[] = [];

  afterEach(async () => {
    while (repos.length) {
      const r = repos.pop();
      if (r) await r.cleanup();
    }
  });

  it('returns overallStatus=pass when all gate commands succeed (ts-with-tests)', async () => {
    const repo = await materializeRepo('ts-with-tests');
    repos.push(repo);

    const results = await verifyGatesOnHead({
      repoPath: repo.path,
      manifest: {
        build: 'node -e "process.exit(0)"',
        test: 'node -e "process.exit(0)"',
        lint: null,
        typecheck: 'node -e "process.exit(0)"',
      },
    });

    expect(results.overallStatus).toBe('pass');
    const byGate = Object.fromEntries(results.results.map((r) => [r.gate, r.status]));
    expect(byGate.build).toBe('pass');
    expect(byGate.test).toBe('pass');
    expect(byGate.typecheck).toBe('pass');
    expect(byGate.lint).toBe('skipped');
  });

  it('returns overallStatus=fail when the test gate fails (red-main)', async () => {
    const repo = await materializeRepo('red-main');
    repos.push(repo);

    const results = await verifyGatesOnHead({
      repoPath: repo.path,
      manifest: {
        build: 'node -e "process.exit(0)"',
        test: 'node -e "process.exit(1)"',
        lint: null,
        typecheck: 'node -e "process.exit(0)"',
      },
    });

    expect(results.overallStatus).toBe('fail');
    const testResult = results.results.find((r) => r.gate === 'test');
    expect(testResult?.status).toBe('fail');
  });
});
