/**
 * Full battlefield bootstrap orchestration — spec §12.
 *
 * Flow:
 *   1. Load battlefield row, flip status → `initializing`, emit comms.
 *   2. `detectGates` on repo root.
 *   3. For any missing required gate (test / build) where a language can be
 *      inferred, call `scaffoldTestInfra` and merge the resulting command
 *      into the manifest.
 *   4. Docs generation via INTEL — writes CLAUDE.md + SPEC.md to the repo
 *      root when the battlefield carries a non-empty `initialBriefing`.
 *      Files are NOT committed here; `approveBootstrap` commits them after
 *      Commander review in <BootstrapReview />.
 *   5. `verifyGatesOnHead` on the final manifest.
 *   6. Persist manifest; set `mainIsRed` if verify failed; clear
 *      `needsGateManifest`; flip status → `initializing` (when docs were
 *      generated, pending review) or `active` (when no docs step ran).
 *
 * `spawnAsset` is injected so integration tests can substitute a
 * fixture-mutating stub (see spec §12 notes + tests for scaffold simulation).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import { battlefields, comms } from '@/lib/db/schema';
import type { GateManifest, GateRunResults } from '@/control/gates';

import { detectGates, type DetectedGates } from './detect';
import { scaffoldTestInfra, type InjectedSpawnAsset } from './scaffold';
import { generateBootstrapDocs } from './docs';
import { verifyGatesOnHead } from './verify';
import type { LanguageKey } from './frameworks';

export interface BootstrapOpts {
  battlefieldId: string;
  /** Injected so tests can stub INTEL runs. Production wires `@/control/spawn-asset`'s
   *  `spawnAsset`. */
  spawnAsset: InjectedSpawnAsset;
}

export interface BootstrapResult {
  manifest: GateManifest;
  mainIsRed: boolean;
  /** Languages that required a scaffold step. */
  scaffolded: LanguageKey[];
  gateResults: GateRunResults;
  /** True when INTEL produced CLAUDE.md + SPEC.md awaiting Commander review. */
  docsGenerated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function inferLanguage(repoPath: string): Promise<LanguageKey | null> {
  const hasFile = async (p: string) =>
    fs
      .access(path.join(repoPath, p))
      .then(() => true)
      .catch(() => false);

  if (await hasFile('package.json')) return 'ts';
  if ((await hasFile('pyproject.toml')) || (await hasFile('setup.py'))) return 'py';
  if (await hasFile('go.mod')) return 'go';
  if (await hasFile('Cargo.toml')) return 'rust';
  return null;
}

function emitComm(
  battlefieldId: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const db = getDatabase();
  db.insert(comms)
    .values({
      id: `comm-bootstrap-${battlefieldId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      battlefieldId,
      actor: 'CONTROL',
      message,
      level,
      createdAt: Date.now(),
    })
    .run();
}

function mergeDetected(base: GateManifest, detected: DetectedGates): GateManifest {
  return {
    build: detected.build ?? base.build,
    test: detected.test ?? base.test,
    lint: detected.lint ?? base.lint,
    typecheck: detected.typecheck ?? base.typecheck,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function bootstrapBattlefield(
  opts: BootstrapOpts,
): Promise<BootstrapResult> {
  const db = getDatabase();
  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, opts.battlefieldId))
    .get();

  if (!bf) {
    throw new Error(`bootstrapBattlefield: battlefield ${opts.battlefieldId} not found`);
  }

  // Step 1: initializing.
  db.update(battlefields)
    .set({ status: 'initializing', updatedAt: Date.now() })
    .where(eq(battlefields.id, opts.battlefieldId))
    .run();
  emitComm(opts.battlefieldId, 'Bootstrap: detecting gates.');

  // Step 2: detect.
  const detected = await detectGates(bf.repoPath);
  let manifest: GateManifest = {
    build: detected.build,
    test: detected.test,
    lint: detected.lint,
    typecheck: detected.typecheck,
  };

  // Step 3: scaffold missing test gate if we can infer a language.
  const scaffolded: LanguageKey[] = [];
  if (!manifest.test) {
    const lang = await inferLanguage(bf.repoPath);
    if (lang) {
      emitComm(
        opts.battlefieldId,
        `Bootstrap: test gate missing — scaffolding ${lang} framework via INTEL.`,
      );
      const result = await scaffoldTestInfra({
        repoPath: bf.repoPath,
        language: lang,
        spawnAsset: opts.spawnAsset,
      });
      if (result.installed) {
        manifest = mergeDetected(manifest, {
          build: null,
          test: result.testCommand,
          lint: null,
          typecheck: null,
        });
        scaffolded.push(lang);
        emitComm(
          opts.battlefieldId,
          `Bootstrap: ${lang} test framework installed (${result.testCommand}).`,
        );
      } else {
        emitComm(
          opts.battlefieldId,
          `Bootstrap: scaffold for ${lang} failed verify — leaving test gate null.`,
          'warn',
        );
      }
    } else {
      emitComm(
        opts.battlefieldId,
        'Bootstrap: test gate missing and no language inferred — skipping scaffold.',
        'warn',
      );
    }
  }

  // Step 4: docs generation via INTEL (spec §12 step 5).
  // Only runs when the Commander supplied an initialBriefing. Files land on
  // disk at repo root; they are NOT committed here — `approveBootstrap`
  // commits them after Commander review in <BootstrapReview />.
  // Run the docs step when there's *any* signal: a Commander briefing, or
  // a pre-written CLAUDE.md / SPEC.md already on disk (supplied at creation
  // time). `generateBootstrapDocs` handles the internal skip/narrow logic.
  const [claudeMdExists, specMdExists] = await Promise.all([
    fs.access(path.join(bf.repoPath, 'CLAUDE.md')).then(() => true).catch(() => false),
    fs.access(path.join(bf.repoPath, 'SPEC.md')).then(() => true).catch(() => false),
  ]);
  const hasBriefing = Boolean(bf.initialBriefing && bf.initialBriefing.trim().length > 0);
  const shouldRunDocs = hasBriefing || claudeMdExists || specMdExists;

  let docsGenerated = false;
  if (shouldRunDocs) {
    emitComm(opts.battlefieldId, 'Bootstrap: checking docs and running INTEL if needed.');
    try {
      const docsResult = await generateBootstrapDocs({
        repoPath: bf.repoPath,
        initialBriefing: bf.initialBriefing ?? '',
        spawnAsset: opts.spawnAsset,
      });
      docsGenerated = docsResult.generated;
      if (docsResult.skipped) {
        emitComm(
          opts.battlefieldId,
          'Bootstrap: CLAUDE.md and SPEC.md supplied by Commander — INTEL skipped, awaiting review.',
        );
      } else if (docsGenerated) {
        emitComm(
          opts.battlefieldId,
          'Bootstrap: docs generated — awaiting Commander review.',
        );
      } else {
        emitComm(
          opts.battlefieldId,
          `Bootstrap: INTEL finished but docs incomplete (CLAUDE.md: ${docsResult.claudeMdPath ? 'ok' : 'missing'}, SPEC.md: ${docsResult.specMdPath ? 'ok' : 'missing'}). Commander can regenerate from the review screen.`,
          'warn',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitComm(
        opts.battlefieldId,
        `Bootstrap: docs generation failed — ${msg}. Commander can regenerate from the review screen.`,
        'error',
      );
    }
  } else {
    emitComm(
      opts.battlefieldId,
      'Bootstrap: no briefing or pre-supplied docs — skipping INTEL doc generation.',
    );
  }

  // Step 5: verify on HEAD.
  emitComm(opts.battlefieldId, 'Bootstrap: verifying gates on HEAD.');
  const gateResults = await verifyGatesOnHead({
    repoPath: bf.repoPath,
    manifest,
  });
  const mainIsRed = gateResults.overallStatus !== 'pass';

  // Step 6/7: persist manifest, update flags. Status transition depends on
  // whether docs were generated: if so, stay `initializing` so the Commander
  // reviews via <BootstrapReview />; otherwise flip directly to `active`.
  // Also auto-populate claudeMdPath / specMdPath from whatever landed on
  // disk so the Battlefield → Config screen reflects reality without the
  // Commander typing paths by hand.
  const finalStatus: 'initializing' | 'active' = docsGenerated ? 'initializing' : 'active';
  const claudeMdAbs = path.join(bf.repoPath, 'CLAUDE.md');
  const specMdAbs = path.join(bf.repoPath, 'SPEC.md');
  const [claudeMdOnDisk, specMdOnDisk] = await Promise.all([
    fs.access(claudeMdAbs).then(() => true).catch(() => false),
    fs.access(specMdAbs).then(() => true).catch(() => false),
  ]);
  db.update(battlefields)
    .set({
      gateManifest: JSON.stringify(manifest),
      needsGateManifest: 0,
      mainIsRed: mainIsRed ? 1 : 0,
      status: finalStatus,
      claudeMdPath: claudeMdOnDisk ? claudeMdAbs : null,
      specMdPath: specMdOnDisk ? specMdAbs : null,
      updatedAt: Date.now(),
    })
    .where(eq(battlefields.id, opts.battlefieldId))
    .run();

  if (docsGenerated) {
    emitComm(
      opts.battlefieldId,
      mainIsRed
        ? `Bootstrap complete: docs ready for review — main is RED on ${gateResults.results
            .filter((r) => r.status === 'fail' || r.status === 'timeout')
            .map((r) => r.gate)
            .join(', ')}.`
        : 'Bootstrap complete: docs ready for review — all gates green on HEAD.',
      mainIsRed ? 'warn' : 'info',
    );
  } else {
    emitComm(
      opts.battlefieldId,
      mainIsRed
        ? `Bootstrap complete: battlefield ACTIVE — main is RED on ${gateResults.results
            .filter((r) => r.status === 'fail' || r.status === 'timeout')
            .map((r) => r.gate)
            .join(', ')}.`
        : 'Bootstrap complete: battlefield ACTIVE — all gates green on HEAD.',
      mainIsRed ? 'warn' : 'info',
    );
  }

  return { manifest, mainIsRed, scaffolded, gateResults, docsGenerated };
}
