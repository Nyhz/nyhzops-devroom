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

function buildReviewPrompt(params: {
  missionBriefing: string;
  missionDebrief: string;
  claudeMd: string | null;
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

  sections.push(`You are the Overseer, reviewing a mission debrief for quality and completeness.

MISSION TYPE: ${typeLabel}
${commitLine}

MISSION BRIEFING (what was requested):
${params.missionBriefing}

MISSION DEBRIEF (what was done):
${params.missionDebrief}`);

  if (params.claudeMd) {
    const trimmed = params.claudeMd.length > 3000
      ? params.claudeMd.slice(0, 3000) + '\n\n[...truncated]'
      : params.claudeMd;
    sections.push(`PROJECT CONVENTIONS:\n${trimmed}`);
  }

  if (params.gitDiffStat) {
    sections.push(`FILES CHANGED:\n${params.gitDiffStat}`);
  }

  if (params.gitDiff) {
    const trimmed = params.gitDiff.length > 3000
      ? params.gitDiff.slice(0, 3000) + '\n\n[...truncated]'
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

General rules:
- Most debriefs are satisfactory. Only flag genuine issues.
- Minor style differences are not concerns.
- "retry" only if the agent clearly failed to complete the task OR violated mission type rules.
- "escalate" only if there's a significant risk the Commander should know about.

IMPORTANT: Do NOT use any tools. Do NOT read files. Do NOT run commands. You have all the information you need above. Analyze the text and respond with your assessment only.`);

  return sections.join('\n\n---\n\n');
}

function spawnReview(prompt: string): Promise<string> {
  const overseer = getSystemAsset('OVERSEER');
  const assetArgs = buildAssetCliArgs(overseer);
  const filtered = filterFlag(assetArgs, '--max-turns');

  return runClaudePrint(prompt, {
    maxTurns: 2,
    outputFormat: 'json',
    jsonSchema: REVIEW_JSON_SCHEMA,
    extraArgs: filtered,
  });
}

const ESCALATE_FALLBACK: OverseerReview = {
  verdict: 'escalate',
  concerns: ['Overseer review spawn failed — escalating to Commander'],
  reasoning: 'Review process failure — Commander should decide',
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
  const prompt = buildReviewPrompt({
    missionBriefing: params.missionBriefing,
    missionDebrief: params.missionDebrief,
    claudeMd: params.claudeMd,
    gitDiffStat: params.gitDiffStat,
    gitDiff: params.gitDiff,
    missionType: params.missionType,
    commitCount: params.commitCount,
  });

  let stdout: string;
  try {
    stdout = await spawnReview(prompt);
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
  return result.fallback;
}
