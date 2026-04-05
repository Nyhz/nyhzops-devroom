import { runClaudePrint } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import { filterFlag } from '@/lib/utils/cli';
import type { OverseerLog } from '@/types';
import { parseOverseerDecision, type OverseerDecision } from './parse-decision';
export type { OverseerDecision } from './parse-decision';

interface AskOverseerParams {
  question: string;
  missionBriefing: string;
  claudeMd: string | null;
  recentOutput: string;
  overseerHistory: OverseerLog[];
  campaignContext?: string;
}

function buildOverseerPrompt(params: AskOverseerParams): string {
  const sections: string[] = [];

  // 1. CLAUDE.md content
  if (params.claudeMd) {
    sections.push(`## Project Conventions (CLAUDE.md)\n\n${params.claudeMd}`);
  }

  // 2. Mission briefing
  sections.push(`## Mission Briefing\n\n${params.missionBriefing}`);

  // 3. Campaign context
  if (params.campaignContext) {
    sections.push(`## Campaign Context\n\n${params.campaignContext}`);
  }

  // 4. Recent agent output
  if (params.recentOutput) {
    sections.push(`## Recent Agent Output (last ~2000 chars)\n\n${params.recentOutput}`);
  }

  // 5. The question
  sections.push(`## Agent's Question\n\nThe agent has paused and is asking:\n\n${params.question}`);

  // 6. Overseer history
  if (params.overseerHistory.length > 0) {
    const historyText = params.overseerHistory
      .map((h) => `Q: ${h.question}\nA: ${h.answer} (confidence: ${h.confidence})`)
      .join('\n---\n');
    sections.push(`## Your Recent Decisions (for consistency)\n\n${historyText}`);
  }

  sections.push('Respond with a JSON object only. No markdown fences, no extra text.');

  return sections.join('\n\n---\n\n');
}

export async function askOverseer(params: AskOverseerParams): Promise<OverseerDecision> {
  const prompt = buildOverseerPrompt(params);

  const overseer = getSystemAsset('OVERSEER');
  const assetArgs = buildAssetCliArgs(overseer);
  const filtered = filterFlag(assetArgs, '--max-turns');

  try {
    const stdout = await runClaudePrint(prompt, {
      maxTurns: 1,
      extraArgs: filtered,
    });
    return parseOverseerDecision(stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Overseer] Process failed: ${msg}`);
    return {
      answer: 'Proceed with your best judgment based on the project conventions.',
      reasoning: `Overseer process failed: ${msg}. Providing fallback guidance.`,
      escalate: true,
      confidence: 'low',
    };
  }
}
