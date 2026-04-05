import { eq, and } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { runClaudePrint } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import { filterFlag } from '@/lib/utils/cli';
import { overseerLogs } from '@/lib/db/schema';
import type { Campaign, Phase, Mission } from '@/types';
import { parsePhaseFailureDecision, FALLBACK_PHASE_DECISION, type PhaseFailureDecision } from './parse-decision';
export type { PhaseFailureDecision } from './parse-decision';

function buildPhaseFailurePrompt(params: {
  campaign: Campaign;
  phase: Phase;
  compromisedMissions: Mission[];
  accomplishedMissions: Mission[];
  claudeMd: string | null;
  totalPhases: number;
}): string {
  const sections: string[] = [];

  sections.push(`You are assessing a campaign phase failure.

CAMPAIGN: ${params.campaign.name}
OBJECTIVE: ${params.campaign.objective}
PHASE: ${params.phase.name} (${params.phase.phaseNumber} of ${params.totalPhases})
PHASE OBJECTIVE: ${params.phase.objective || 'Not specified'}`);

  // Compromised missions
  const compromisedLines = params.compromisedMissions.map(m =>
    `**${m.title}** (ID: ${m.id})\nBriefing: ${m.briefing}\nDebrief: ${m.debrief || 'No debrief available.'}`,
  ).join('\n\n');
  sections.push(`COMPROMISED MISSIONS:\n${compromisedLines}`);

  // Accomplished missions
  if (params.accomplishedMissions.length > 0) {
    const accomplishedLines = params.accomplishedMissions.map(m =>
      `**${m.title}**: ${(m.debrief || 'No debrief.').slice(0, 200)}`,
    ).join('\n');
    sections.push(`ACCOMPLISHED MISSIONS:\n${accomplishedLines}`);
  }

  if (params.claudeMd) {
    const trimmed = params.claudeMd.length > 2000
      ? params.claudeMd.slice(0, 2000) + '\n\n[...truncated]'
      : params.claudeMd;
    sections.push(`PROJECT CONVENTIONS:\n${trimmed}`);
  }

  sections.push(`Decide the best course of action:
- "retry": Redeploy the failed missions (good for transient failures)
- "skip": Skip failed missions and advance to next phase (good for non-critical failures)
- "escalate": Pause and alert the Commander (for critical failures or uncertainty)

If "retry", provide modified briefings that address the failure reasons.

Respond with JSON:
{
  "decision": "retry" | "skip" | "escalate",
  "reasoning": "Why this decision",
  "retryBriefings": { "missionId": "modified briefing..." }
}

The retryBriefings field is only needed if decision is "retry". Use the actual mission IDs shown above.

Respond with a JSON object only. No markdown fences, no extra text.`);

  return sections.join('\n\n---\n\n');
}

/**
 * Check how many retry decisions the Overseer has already made for this
 * campaign's current phase. If >= 2, force escalation.
 */
function getPhaseRetryCount(campaignId: string): number {
  const db = getDatabase();
  const logs = db
    .select()
    .from(overseerLogs)
    .where(
      and(
        eq(overseerLogs.campaignId, campaignId),
        eq(overseerLogs.decisionType, 'phase-retry'),
      ),
    )
    .all();

  return logs.length;
}

export async function handlePhaseFailure(params: {
  campaign: Campaign;
  phase: Phase;
  compromisedMissions: Mission[];
  accomplishedMissions: Mission[];
  claudeMd: string | null;
  totalPhases: number;
}): Promise<PhaseFailureDecision> {
  // Check retry limit before even asking Overseer
  const retryCount = getPhaseRetryCount(params.campaign.id);
  if (retryCount >= 2) {
    return {
      decision: 'escalate',
      reasoning: `Auto-retry limit reached (${retryCount} retries). Escalating to Commander.`,
    };
  }

  const prompt = buildPhaseFailurePrompt(params);

  const overseer = getSystemAsset('OVERSEER');
  const assetArgs = buildAssetCliArgs(overseer);
  const filtered = filterFlag(assetArgs, '--max-turns');

  try {
    const stdout = await runClaudePrint(prompt, {
      maxTurns: 1,
      extraArgs: filtered,
    });
    const decision = parsePhaseFailureDecision(stdout);
    if (decision.decision === 'retry' && retryCount >= 2) {
      return {
        decision: 'escalate',
        reasoning: `Overseer recommended retry but limit reached (${retryCount}). Escalating.`,
      };
    }
    return decision;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Overseer] Phase failure handler failed: ${msg}`);
    return FALLBACK_PHASE_DECISION;
  }
}
