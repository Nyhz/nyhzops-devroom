/**
 * Pure prompt builders for CONTROL. Each exported function is a
 * `(input) => string` with no I/O — it substitutes structured inputs into
 * the templates defined verbatim by spec §11 ("Prompt Architecture") of
 * `docs/superpowers/specs/2026-04-16-control-reliability-refactor-design.md`.
 *
 * Section headings are load-bearing — downstream agents (and the Rules of
 * Engagement prompt) reference them by name. Do not rename them.
 */

// ---------------------------------------------------------------------------
// Mission prompts
// ---------------------------------------------------------------------------

export interface StandardCombatInput {
  claudeMd: string;
  briefing: string;
  workspace: string;
}

/** Standard combat prompt: CLAUDE.md + Mission Briefing + Workspace. */
export function buildStandardCombatPrompt(input: StandardCombatInput): string {
  return [
    input.claudeMd.trim(),
    '',
    '## Mission Briefing',
    '',
    input.briefing.trim(),
    '',
    '## Workspace',
    '',
    input.workspace.trim(),
    '',
  ].join('\n');
}

export interface PhaseDebriefSummary {
  /** Prose summary of the phase outcome — injected verbatim. */
  text: string;
}

export interface CampaignContext {
  operationName: string;
  phaseName: string;
  /**
   * Deterministically composed phase debriefs from prior phases, in order.
   * Injected under "## Previous Phase Results".
   */
  previousPhaseDebriefs: PhaseDebriefSummary[];
}

export interface CampaignCombatInput extends StandardCombatInput {
  campaignContext: CampaignContext;
}

/**
 * Campaign combat prompt: standard + `## Campaign Context` + phase debriefs
 * under `## Previous Phase Results`.
 */
export function buildCampaignCombatPrompt(input: CampaignCombatInput): string {
  const ctx = input.campaignContext;
  const previous = ctx.previousPhaseDebriefs.length
    ? ctx.previousPhaseDebriefs.map(d => d.text.trim()).join('\n\n---\n\n')
    : '_No previous phases._';

  return [
    input.claudeMd.trim(),
    '',
    '## Mission Briefing',
    '',
    input.briefing.trim(),
    '',
    '## Campaign Context',
    '',
    `Operation: ${ctx.operationName}`,
    `Phase: ${ctx.phaseName}`,
    '',
    '## Previous Phase Results',
    '',
    previous,
    '',
    '## Workspace',
    '',
    input.workspace.trim(),
    '',
  ].join('\n');
}

export interface ReconInput {
  claudeMd: string;
  briefing: string;
  repoRootPath: string;
}

/**
 * Recon prompt: CLAUDE.md + Recon Briefing + read-only boundary warning.
 * No worktree workspace — recon runs in repo root.
 */
export function buildReconPrompt(input: ReconInput): string {
  return [
    input.claudeMd.trim(),
    '',
    '## Recon Briefing',
    '',
    input.briefing.trim(),
    '',
    '## Operating Boundary',
    '',
    `You are operating in read-only mode inside the repository root: ${input.repoRootPath}`,
    'You may not write, edit, delete, or move any files. You are producing a prose report only.',
    'CONTROL verifies the working tree after exit — any change reverts the tree and flags your mission.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Retry prompts
// ---------------------------------------------------------------------------

export interface DeterministicRetryInput {
  retryNumber: number;
  gateStderr: string;
}

/** Deterministic retry prompt shown on attempts 2 and 3 after gate failure. */
export function buildDeterministicRetryPrompt(input: DeterministicRetryInput): string {
  return [
    `OVERSEER REVIEW FEEDBACK (Retry ${input.retryNumber})`,
    '========================================',
    'Gates failed. Output:',
    input.gateStderr.trim(),
    '',
    'Please fix the gate failures. Your previous session context is preserved.',
    '',
  ].join('\n');
}

export interface OverseerRedirectInput {
  retryNumber: number;
  /** The reframed prompt authored by the OVERSEER for attempt N. */
  newPrompt: string;
}

/** OVERSEER-redirected retry prompt shown on attempt 4. */
export function buildOverseerRedirectPrompt(input: OverseerRedirectInput): string {
  return [
    `OVERSEER REDIRECT (Retry ${input.retryNumber})`,
    '========================================',
    'The Overseer has reviewed your attempts and reframed the approach.',
    '',
    input.newPrompt.trim(),
    '',
    'Your previous session context is preserved.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// OVERSEER prompts
// ---------------------------------------------------------------------------

export interface OverseerClassificationInput {
  exitCode: number;
  rawStderr: string;
  /** Last ~2000 chars of stdout. Caller is responsible for truncation. */
  stdoutTail: string;
}

/** OVERSEER exit-classification prompt (ambiguous subprocess exit). */
export function buildOverseerClassificationPrompt(input: OverseerClassificationInput): string {
  return [
    'You are the OVERSEER. Classify this subprocess exit. Do NOT judge the work.',
    '',
    `EXIT CODE: ${input.exitCode}`,
    'STDERR:',
    input.rawStderr,
    '',
    'STDOUT TAIL:',
    input.stdoutTail,
    '',
    'Respond with JSON:',
    '{',
    '  "category": "INFRASTRUCTURE" | "AGENT_FAILURE" | "NEEDS_COMMANDER",',
    '  "reasoning": "<one sentence>"',
    '}',
    '',
  ].join('\n');
}

/** One line per prior attempt — see spec §11 example. */
export interface AttemptSummary {
  /** Pre-formatted one-liner, e.g. "Attempt 1 (7m 12s): exit=clean, gates failed on [test], diff: +41 -12 across 3 files". */
  line: string;
}

export interface OverseerConsultInput {
  briefing: string;
  attemptSummaries: AttemptSummary[];
  /**
   * Combined stderr from the last failing gate run. `null` for recon missions
   * (see spec §7 last paragraph — no gates).
   */
  gateStderr: string | null;
  /**
   * `git diff --stat` + truncated diff of the final attempt. `null` for recon
   * missions (no worktree, no diff).
   */
  finalDiff: string | null;
  /** Excerpt of the battlefield's CLAUDE.md conventions. */
  claudeMdExcerpt: string;
}

/**
 * OVERSEER consult prompt (gate failure after retries, or recon retry budget
 * exhausted). For recon variant, pass `gateStderr: null` and `finalDiff: null`
 * and those sections are omitted from the prompt.
 */
export function buildOverseerConsultPrompt(input: OverseerConsultInput): string {
  const history = input.attemptSummaries.length
    ? input.attemptSummaries.map(a => a.line).join('\n')
    : '_No prior attempts recorded._';

  const lines: string[] = [
    'You are the OVERSEER. The combat asset has exhausted deterministic retries.',
    'Decide: redirect (write a new prompt reframing the approach, agent gets 1 more attempt)',
    'or escalate (this needs the Commander — write a specific question).',
    '',
    "DO NOT decide whether the mission should continue — that is the Commander's call.",
    '',
    'MISSION BRIEFING:',
    input.briefing.trim(),
    '',
    'ATTEMPT HISTORY:',
    history,
    '',
  ];

  if (input.gateStderr !== null) {
    lines.push('LAST GATE OUTPUT:', input.gateStderr, '');
  }
  if (input.finalDiff !== null) {
    lines.push('FINAL DIFF:', input.finalDiff, '');
  }

  lines.push(
    'PROJECT CONVENTIONS:',
    input.claudeMdExcerpt.trim(),
    '',
    'Respond with JSON matching the schema.',
    '',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// QUARTERMASTER prompt
// ---------------------------------------------------------------------------

export interface QuartermasterInput {
  briefing: string;
  /** Parsed or synthesized mission debrief text. */
  debrief: string;
  /** `git diff` of the conflicted merge state. */
  conflictDiff: string;
  /** `git log source..target` summary. */
  logSourceToTarget: string;
  /** `git log target..source` summary. */
  logTargetToSource: string;
  claudeMdExcerpt: string;
}

/** QUARTERMASTER conflict resolution prompt (worktree merge with conflicts). */
export function buildQuartermasterPrompt(input: QuartermasterInput): string {
  return [
    'You are the QUARTERMASTER. A worktree merge produced conflicts. Resolve them or',
    'escalate to the Commander with a specific question.',
    '',
    'MISSION BRIEFING:',
    input.briefing.trim(),
    '',
    'MISSION DEBRIEF:',
    input.debrief.trim(),
    '',
    'CONFLICT DIFF:',
    input.conflictDiff,
    '',
    'LOG (source..target):',
    input.logSourceToTarget,
    '',
    'LOG (target..source):',
    input.logTargetToSource,
    '',
    'PROJECT CONVENTIONS:',
    input.claudeMdExcerpt.trim(),
    '',
    'ORDERS: resolve the conflicts with commits that preserve both the mission intent',
    'and the target branch history, or emit an escalation with a precise question for',
    'the Commander.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Rules of Engagement composition helper
// ---------------------------------------------------------------------------

export interface GateManifestEntry {
  /** Gate name, e.g. "build", "test", "lint", "typecheck". */
  name: string;
  /** Shell command for the gate. `null` when unavailable for this battlefield. */
  command: string | null;
}

export interface ComposeRoEInput {
  /** RoE text from settings (contains `{{GATE_MANIFEST}}` placeholder). */
  roe: string;
  gateManifest: GateManifestEntry[];
}

/**
 * Substitute `{{GATE_MANIFEST}}` in the Rules of Engagement text with a
 * human-readable manifest block. Used at CLI-build time (mission-runner /
 * cli-builder) to tailor the RoE to each battlefield's gate set.
 */
export function composeRulesOfEngagement(input: ComposeRoEInput): string {
  const block = input.gateManifest.length
    ? input.gateManifest
        .map(g => `     - ${g.name}: ${g.command === null ? '(unavailable — skip)' : g.command}`)
        .join('\n')
    : '     (no gates configured)';
  return input.roe.replace(/\{\{GATE_MANIFEST\}\}/g, block);
}
