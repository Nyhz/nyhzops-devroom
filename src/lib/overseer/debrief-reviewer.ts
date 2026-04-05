import { runClaudePrint } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import { filterFlag } from '@/lib/utils/cli';
import { parseReviewOutput } from './review-parser';
import type { OverseerReview } from '@/types';

const REVIEW_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['approve', 'retry', 'escalate'],
      description: 'approve = debrief is satisfactory, retry = agent should redo, escalate = Commander must intervene',
    },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of specific concerns found (empty array if none)',
    },
    reasoning: { type: 'string', description: 'Brief explanation of the judgment' },
  },
  required: ['verdict', 'concerns', 'reasoning'],
  additionalProperties: false,
});

const CLAUDE_MD_CAP = 3000;
const GIT_DIFF_CAP = 3000;

/**
 * Composes the system prompt for the review call: the stored OVERSEER prompt
 * plus the battlefield's CLAUDE.md content (if any). Placed in the system
 * prompt — not the user message — so Claude's prompt cache can hit on
 * consecutive reviews for the same battlefield.
 */
export function composeReviewSystemPrompt(storedPrompt: string, claudeMd: string | null): string {
  if (!claudeMd) return storedPrompt;
  const trimmed = claudeMd.length > CLAUDE_MD_CAP
    ? claudeMd.slice(0, CLAUDE_MD_CAP) + '\n\n[...truncated]'
    : claudeMd;
  return `${storedPrompt}\n\n---\n\nPROJECT CONVENTIONS (from CLAUDE.md):\n\n${trimmed}`;
}

/**
 * Builds the dynamic user message for the review. Contains only mission-specific
 * content that changes per call: briefing, debrief, mission type, git diff.
 * CLAUDE.md lives in the system prompt now — see composeReviewSystemPrompt.
 */
export function buildReviewUserPrompt(params: {
  missionBriefing: string;
  missionDebrief: string;
  gitDiffStat: string | null;
  gitDiff: string | null;
  missionType: 'direct_action' | 'verification';
  commitCount: number | null;
}): string {
  const sections: string[] = [];

  const typeLabel = params.missionType === 'verification' ? 'VERIFICATION' : 'DIRECT_ACTION';
  const commitLine = params.commitCount === null
    ? 'Commit count on worktree branch: n/a (no worktree)'
    : `Commit count on worktree branch: ${params.commitCount}`;

  sections.push(`You are reviewing a mission debrief for quality and completeness.

MISSION TYPE: ${typeLabel}
${commitLine}

MISSION BRIEFING (what was requested):
${params.missionBriefing}

MISSION DEBRIEF (what was done):
${params.missionDebrief}`);

  if (params.gitDiffStat) {
    sections.push(`FILES CHANGED:\n${params.gitDiffStat}`);
  }

  if (params.gitDiff) {
    const trimmed = params.gitDiff.length > GIT_DIFF_CAP
      ? params.gitDiff.slice(0, GIT_DIFF_CAP) + '\n\n[...truncated]'
      : params.gitDiff;
    sections.push(`CODE CHANGES:\n${trimmed}`);
  }

  sections.push(`Review the debrief and assess:
1. Did the agent complete what was requested in the briefing?
2. Are there any warnings, risks, or concerns mentioned?
3. Are there indicators of test failures or incomplete work?
4. Did the agent make unexpected decisions that deviate from conventions?
5. Do the code changes match what the debrief claims?

MISSION TYPE RULES:
- DIRECT_ACTION missions MUST produce at least one commit on their worktree branch. If the commit count is 0, the asset did nothing — respond with verdict "retry" and concern "no commits produced".
- VERIFICATION missions are strictly read-only. They MUST produce zero commits. If the commit count is >0, the asset violated its scope — respond with verdict "retry" and concern "verification mission modified code".
- VERIFICATION missions with zero commits and a quality debrief are the expected happy path — approve them normally.

Output must be a JSON object matching the provided schema:
{ "verdict": "approve"|"retry"|"escalate", "concerns": ["..."], "reasoning": "..." }

Do NOT use any tools. Do NOT read files. You have all the information you need above.`);

  return sections.join('\n\n---\n\n');
}

/**
 * Replaces the --append-system-prompt value in the given CLI args with a new
 * value that combines the stored OVERSEER prompt and CLAUDE.md. If the flag is
 * not present in the args, appends it.
 */
function injectSystemPromptOverride(args: string[], newSystemPrompt: string): string[] {
  const result = [...args];
  const idx = result.indexOf('--append-system-prompt');
  if (idx >= 0 && idx + 1 < result.length) {
    result[idx + 1] = newSystemPrompt;
    return result;
  }
  result.push('--append-system-prompt', newSystemPrompt);
  return result;
}

function spawnReview(userPrompt: string, claudeMd: string | null): Promise<string> {
  const overseer = getSystemAsset('OVERSEER');
  const assetArgs = buildAssetCliArgs(overseer);
  const filtered = filterFlag(assetArgs, '--max-turns');

  const composed = composeReviewSystemPrompt(overseer.systemPrompt ?? '', claudeMd);
  const argsWithSystemPrompt = injectSystemPromptOverride(filtered, composed);

  return runClaudePrint(userPrompt, {
    maxTurns: 2,
    outputFormat: 'json',
    jsonSchema: REVIEW_JSON_SCHEMA,
    extraArgs: argsWithSystemPrompt,
  });
}

const ESCALATE_FALLBACK: OverseerReview = {
  verdict: 'escalate',
  concerns: ['Overseer review spawn failed — escalating to Commander'],
  reasoning: 'Review process failure — Commander should decide',
  parseFailure: true,
};

export async function reviewDebrief(params: {
  missionBriefing: string;
  missionDebrief: string;
  claudeMd: string | null;
  gitDiffStat: string | null;
  gitDiff: string | null;
  missionId: string;
  battlefieldId: string;
  missionType: 'direct_action' | 'verification';
  commitCount: number | null;
}): Promise<OverseerReview> {
  const userPrompt = buildReviewUserPrompt({
    missionBriefing: params.missionBriefing,
    missionDebrief: params.missionDebrief,
    gitDiffStat: params.gitDiffStat,
    gitDiff: params.gitDiff,
    missionType: params.missionType,
    commitCount: params.commitCount,
  });

  let stdout: string;
  try {
    stdout = await spawnReview(userPrompt, params.claudeMd);
  } catch (err) {
    console.error(
      `[Overseer] Debrief review spawn failed for mission ${params.missionId}:`,
      err instanceof Error ? err.message : err,
    );
    return ESCALATE_FALLBACK;
  }

  const result = parseReviewOutput(stdout);
  if (result.ok) {
    return result.review;
  }

  console.warn(
    `[Overseer] Debrief review parse failed for mission ${params.missionId}. ` +
    `Diagnostic: ${result.diagnostic}. Output (${stdout.length} chars): ${stdout.slice(0, 500)}`,
  );
  return { ...result.fallback, parseFailure: true };
}
