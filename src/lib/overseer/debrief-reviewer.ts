import { runClaudePrint } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/actions/asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
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
}): string {
  const sections: string[] = [];

  sections.push(`You are the Overseer, reviewing a mission debrief for quality and completeness.

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

Rules:
- Most debriefs are satisfactory. Only flag genuine issues.
- Minor style differences are not concerns.
- "retry" only if the agent clearly failed to complete the task.
- "escalate" only if there's a significant risk the Commander should know about.

IMPORTANT: Do NOT use any tools. Do NOT read files. Do NOT run commands. You have all the information you need above. Analyze the text and respond with your assessment only.`);

  return sections.join('\n\n---\n\n');
}

/**
 * Filter a flag and its value from an args array.
 * E.g., filterFlag(['--max-turns', '5', '--model', 'x'], '--max-turns') => ['--model', 'x']
 */
function filterFlag(args: string[], flag: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) { i++; continue; } // skip flag and its value
    result.push(args[i]);
  }
  return result;
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
}): Promise<OverseerReview> {
  const prompt = buildReviewPrompt({
    missionBriefing: params.missionBriefing,
    missionDebrief: params.missionDebrief,
    claudeMd: params.claudeMd,
    gitDiffStat: params.gitDiffStat,
    gitDiff: params.gitDiff,
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
