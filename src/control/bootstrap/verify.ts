import { runGates } from '@/control/gates';
import type { GateManifest, GateRunResults } from '@/control/gates';

export async function verifyGatesOnHead(opts: {
  repoPath: string;
  manifest: GateManifest;
}): Promise<GateRunResults> {
  return runGates({
    manifest: opts.manifest,
    workingDir: opts.repoPath,
    perCommandTimeoutMs: 300_000,
    suiteTimeoutMs: 900_000,
  });
}
