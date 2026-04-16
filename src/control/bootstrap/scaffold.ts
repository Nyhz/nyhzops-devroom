/**
 * Scaffold test infrastructure by asking INTEL to install a curated framework,
 * then verify the resulting test command exits 0 on HEAD.
 *
 * Spec §12 step 4 — "Fill gaps". Called by the bootstrap orchestrator
 * (`bootstrap.ts`) when detection did not surface a `test` command and we can
 * map the repo to a known language.
 *
 * `spawnAsset` is injected so tests can swap in scripted-claude or a pure
 * fixture-mutating stub (see `tests/control/integration/bootstrap.test.ts` for
 * the rationale: shelling out to `pnpm install` would be slow and
 * network-dependent).
 */

import type { SpawnAssetOpts, AssetRunResult } from '@/control/mission-runner';
import { runGates } from '@/control/gates';
import { FRAMEWORKS, type LanguageKey } from './frameworks';

export type InjectedSpawnAsset = (opts: SpawnAssetOpts) => Promise<AssetRunResult>;

export interface ScaffoldTestInfraOpts {
  repoPath: string;
  language: LanguageKey;
  /** Injected so tests can replace INTEL with a scripted/fixture-mutating
   *  stub. Matches the `SpawnAssetOpts → AssetRunResult` shape that
   *  `@/control/spawn-asset`'s `spawnAsset` already implements. */
  spawnAsset: InjectedSpawnAsset;
  /** Optional mission id override — defaults to `bootstrap-scaffold-<lang>`. */
  missionId?: string;
  /** Override for per-gate verify timeout (ms). Defaults to 120_000. */
  verifyTimeoutMs?: number;
}

export interface ScaffoldTestInfraResult {
  installed: boolean;
  testCommand: string;
  /** stderr from the verify gate run, empty string if verify passed. */
  verifyStderr: string;
}

export async function scaffoldTestInfra(
  opts: ScaffoldTestInfraOpts,
): Promise<ScaffoldTestInfraResult> {
  const framework = FRAMEWORKS[opts.language];
  if (!framework) {
    throw new Error(
      `scaffoldTestInfra: unknown language "${opts.language}" — no entry in FRAMEWORKS`,
    );
  }

  const missionId = opts.missionId ?? `bootstrap-scaffold-${opts.language}`;

  // Spawn INTEL with the framework's install briefing. The caller's
  // injected `spawnAsset` is expected to handle subprocess lifecycle — we
  // only care that it resolves (the underlying implementation never rejects
  // on subprocess failure; errors surface as non-zero `exitCode`).
  const run = await opts.spawnAsset({
    missionId,
    worktreePath: opts.repoPath,
    briefing: framework.installBriefing,
    assetCodename: 'INTEL',
  });

  // If INTEL itself blew up we still attempt to verify — perhaps the smoke
  // test already lived in-tree. But record the exit for the caller.
  const intelSucceeded =
    !run.killedByControl && (run.exitCode === 0 || run.exitCode === null);

  // Verify the canonical test command exits 0 on HEAD.
  const verify = await runGates({
    manifest: {
      build: null,
      test: framework.testCommand,
      lint: null,
      typecheck: null,
    },
    workingDir: opts.repoPath,
    perCommandTimeoutMs: opts.verifyTimeoutMs ?? 120_000,
    suiteTimeoutMs: opts.verifyTimeoutMs ?? 120_000,
  });

  const testResult = verify.results.find((r) => r.gate === 'test');
  const installed = verify.overallStatus === 'pass' && intelSucceeded;

  return {
    installed,
    testCommand: framework.testCommand,
    verifyStderr: testResult?.stderr ?? '',
  };
}
