/**
 * Generate CLAUDE.md and SPEC.md for a new battlefield by spawning INTEL
 * against the repo root with the Commander's initial briefing.
 *
 * Spec §12 step 5 — "Docs generation". Called from `bootstrap.ts` when the
 * battlefield row carries a non-empty `initialBriefing`. Three paths:
 *
 *   1. Both CLAUDE.md and SPEC.md already exist on disk (Commander pasted
 *      them into the creation form) — INTEL is skipped entirely.
 *   2. One of the two exists — INTEL is briefed to author only the missing
 *      file and told to treat the existing one as ground truth.
 *   3. Neither exists — full authoring of both.
 *
 * Files are NOT committed here; `approveBootstrap` commits them after the
 * Commander reviews via `<BootstrapReview />`.
 *
 * `spawnAsset` is injected so tests can substitute a fixture-mutating stub
 * that writes the files without actually invoking Claude.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { InjectedSpawnAsset } from './scaffold';

export interface GenerateBootstrapDocsOpts {
  repoPath: string;
  initialBriefing: string;
  spawnAsset: InjectedSpawnAsset;
  /** Optional mission id override — defaults to `bootstrap-docs-<timestamp>`. */
  missionId?: string;
}

export interface GenerateBootstrapDocsResult {
  /** Both files present on disk after (optional) INTEL exit. */
  generated: boolean;
  claudeMdPath: string | null;
  specMdPath: string | null;
  /** INTEL exit code, or null when the subprocess was killed or skipped. */
  intelExitCode: number | null;
  /** True when INTEL was skipped entirely because both files already
   *  existed on disk before the step ran. */
  skipped: boolean;
}

type Missing = 'both' | 'claude' | 'spec' | 'none';

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

function buildBothMissingBriefing(initialBriefing: string): string {
  return [
    'Bootstrap a new DEVROOM battlefield. Your deliverable is two files at the repo root with SHARPLY SEPARATED roles. Do NOT duplicate content between them. When the same fact could live in either, it goes in SPEC.md and CLAUDE.md links to it ("see SPEC §N") — never both.',
    '',
    'SPEC.md — the product. What this project IS and DOES.',
    '  Belongs here (and NOWHERE else): stack table, feature list, routes / screens / workflows, domain entities and fields, data model, pricing / FX / import logic (the behaviour, not the rule for agents), acceptance criteria, out-of-scope list, project directory layout, environment variables.',
    '  Treat SPEC.md as ground truth for the product. Write it first in your head.',
    '',
    'CLAUDE.md — the rulebook. HOW TO WORK here.',
    '  Belongs here: scripts / commands, Coding Rules (TS strict, Server Actions only, no raw SQL, etc.), Data-access discipline (e.g. "all mutations in Server Actions with Zod + transaction + audit + revalidatePath"), UI discipline (e.g. "monetary values always wrapped in SensitiveValue"), Definition of Done, Don\'t-do list, cross-refs into SPEC for everything else.',
    '  Forbidden in CLAUDE.md: stack tables, feature descriptions, route lists, entity fields, design-system tokens, behaviour walkthroughs. Those live in SPEC. Reference them with "see SPEC §N."',
    '  Target length: tight. Aim for ~100-180 lines. Dense, opinionated, no hedging.',
    '',
    'Duplication test: before writing a paragraph in CLAUDE.md, ask "could this sentence appear verbatim in SPEC.md?" If yes, it belongs in SPEC only, and CLAUDE links to it. Scripts and coding rules are the only operational content that lives in CLAUDE exclusively.',
    '',
    'Commander briefing follows. Primary input — the repo survey is secondary context:',
    '',
    '--- COMMANDER BRIEFING ---',
    initialBriefing.trim(),
    '--- END BRIEFING ---',
    '',
    'Process:',
    '  - Survey the repo first (Read, Glob, Grep). Note existing stack, package manager, directory layout, any existing docs or conventions. Document reality first, aspiration second. Do NOT invent facts.',
    '  - Draft SPEC.md first (product truth). Draft CLAUDE.md second, writing only rules/commands and linking into SPEC for context.',
    '  - Write both files to the repo root (plain markdown, no outer code fences, no preamble).',
    '  - Do NOT run git add or git commit — the Commander reviews and approval commits.',
    '  - Do NOT create any other files.',
    '',
    'Style:',
    '  - Mirror the tone of the DEVROOM reference CLAUDE.md (tactical-operations-center voice, dense, opinionated).',
    '  - Reference file paths and identifiers inline without code fences.',
    '  - Use code fences only for actual copy-pasteable code or shell snippets.',
    '',
    'When both files exist on disk and the duplication test passes, stop.',
  ].join('\n');
}

function buildOneMissingBriefing(
  initialBriefing: string,
  missing: 'claude' | 'spec',
): string {
  const produce = missing === 'claude' ? 'CLAUDE.md' : 'SPEC.md';
  const existing = missing === 'claude' ? 'SPEC.md' : 'CLAUDE.md';

  const roleBlock =
    missing === 'claude'
      ? [
          'CLAUDE.md — the rulebook. HOW TO WORK in this project.',
          '  Belongs here: scripts / commands, Coding Rules (language strictness, mutation discipline, etc.), Data-access discipline, UI discipline, Definition of Done, Don\'t-do list, cross-refs into SPEC for everything else.',
          '  Forbidden in CLAUDE.md: stack tables, feature descriptions, route lists, entity fields, design-system tokens, behaviour walkthroughs, environment variables, directory layout, out-of-scope list. Those already live in SPEC.md — reference them with "see SPEC §N."',
          '  Target length: tight. Aim for ~100-180 lines. Dense, opinionated, no hedging.',
          '',
          'Duplication test: before writing a paragraph, ask "could this sentence appear verbatim in SPEC.md?" If yes, it belongs in SPEC only — use a cross-ref instead. Scripts and coding rules are the only operational content that lives in CLAUDE exclusively.',
        ].join('\n')
      : [
          'SPEC.md — the product. What this project IS and DOES.',
          '  Belongs here: stack table, feature list, routes / screens / workflows, domain entities and fields, data model, pricing / FX / import logic (the behaviour, not the rule for agents), acceptance criteria, out-of-scope list, project directory layout, environment variables.',
          '  Do NOT repeat CLAUDE.md\'s scripts, coding rules, or definition of done — those belong in CLAUDE. Reference them with "see CLAUDE.md" when unavoidable.',
        ].join('\n');

  return [
    `Bootstrap a new DEVROOM battlefield. The Commander has already provided ${existing} at the repo root; your deliverable is ONLY ${produce}.`,
    '',
    `Read ${existing} first — treat it as GROUND TRUTH. Do NOT copy its content into ${produce}. Instead, cross-reference it.`,
    '',
    roleBlock,
    '',
    'Commander briefing follows:',
    '',
    '--- COMMANDER BRIEFING ---',
    initialBriefing.trim(),
    '--- END BRIEFING ---',
    '',
    'Process:',
    `  - Read ${existing} end-to-end. Survey the repo (Read, Glob, Grep) only for what ${produce} uniquely needs.`,
    `  - Draft ${produce} using cross-refs into ${existing} wherever the content could live in either. If you find yourself rewriting a stack table, directory layout, entity list, or route list for ${produce}, stop and replace it with a one-line pointer into ${existing}.`,
    `  - Write ${produce} to the repo root (plain markdown, no outer code fences, no preamble).`,
    `  - Do NOT modify ${existing}.`,
    '  - Do NOT run git add or git commit — the Commander reviews first and approval commits.',
    '  - Do NOT create any other files.',
    '',
    'Style:',
    '  - Mirror the tone of the DEVROOM reference CLAUDE.md (tactical-operations-center voice, dense, opinionated).',
    '  - Reference file paths and identifiers inline without code fences.',
    '  - Use code fences only for actual copy-pasteable code or shell snippets.',
    '',
    `When ${produce} exists on disk, the duplication test passes, and it is consistent with ${existing}, stop.`,
  ].join('\n');
}

export async function generateBootstrapDocs(
  opts: GenerateBootstrapDocsOpts,
): Promise<GenerateBootstrapDocsResult> {
  const claudeMdAbs = path.join(opts.repoPath, 'CLAUDE.md');
  const specMdAbs = path.join(opts.repoPath, 'SPEC.md');

  const [claudeExistsBefore, specExistsBefore] = await Promise.all([
    fileExists(claudeMdAbs),
    fileExists(specMdAbs),
  ]);

  // Commander supplied both — skip INTEL entirely, go straight to review.
  if (claudeExistsBefore && specExistsBefore) {
    return {
      generated: true,
      claudeMdPath: claudeMdAbs,
      specMdPath: specMdAbs,
      intelExitCode: null,
      skipped: true,
    };
  }

  const missing: Missing =
    !claudeExistsBefore && !specExistsBefore
      ? 'both'
      : !claudeExistsBefore
        ? 'claude'
        : 'spec';

  const briefing =
    missing === 'both'
      ? buildBothMissingBriefing(opts.initialBriefing)
      : buildOneMissingBriefing(opts.initialBriefing, missing);

  const missionId = opts.missionId ?? `bootstrap-docs-${Date.now()}`;

  const run = await opts.spawnAsset({
    missionId,
    worktreePath: opts.repoPath,
    briefing,
    assetCodename: 'INTEL',
  });

  const [claudeExistsAfter, specExistsAfter] = await Promise.all([
    fileExists(claudeMdAbs),
    fileExists(specMdAbs),
  ]);

  return {
    generated: claudeExistsAfter && specExistsAfter,
    claudeMdPath: claudeExistsAfter ? claudeMdAbs : null,
    specMdPath: specExistsAfter ? specMdAbs : null,
    intelExitCode: run.exitCode ?? null,
    skipped: false,
  };
}
