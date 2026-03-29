import { eq, and, like } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { runClaudePrint } from '@/lib/process/claude-print';
import { captainLogs } from '@/lib/db/schema';
import type { Campaign, Phase, Mission } from '@/types';

export interface PhaseFailureDecision {
  decision: 'retry' | 'skip' | 'escalate';
  reasoning: string;
  retryBriefings?: Record<string, string>; // missionId -> modified briefing
}

const FALLBACK_DECISION: PhaseFailureDecision = {
  decision: 'escalate',
  reasoning: 'Unable to parse Captain decision. Escalating to Commander.',
};

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

function parseDecision(raw: string): PhaseFailureDecision {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return FALLBACK_DECISION;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      decision?: string;
      reasoning?: string;
      retryBriefings?: Record<string, string>;
    };

    const validDecisions = ['retry', 'skip', 'escalate'] as const;
    const decision = validDecisions.includes(
      parsed.decision as typeof validDecisions[number],
    )
      ? (parsed.decision as PhaseFailureDecision['decision'])
      : 'escalate';

    return {
      decision,
      reasoning: parsed.reasoning || 'No reasoning provided.',
      retryBriefings: decision === 'retry' ? (parsed.retryBriefings || {}) : undefined,
    };
  } catch {
    return FALLBACK_DECISION;
  }
}

/**
 * Check how many retry decisions the Captain has already made for this
 * campaign's current phase. If >= 2, force escalation.
 */
function getPhaseRetryCount(campaignId: string, phaseId: string): number {
  const db = getDatabase();
  const logs = db
    .select()
    .from(captainLogs)
    .where(
      and(
        eq(captainLogs.campaignId, campaignId),
        like(captainLogs.question, `[PHASE_FAILURE] Phase%`),
      ),
    )
    .all();

  // Count logs where the answer indicates a retry decision for this phase
  // The answer field stores "Decision: retry. ..." so we check for that
  return logs.filter(
    (l) => l.answer.startsWith('Decision: retry'),
  ).length;
}

export async function handlePhaseFailure(params: {
  campaign: Campaign;
  phase: Phase;
  compromisedMissions: Mission[];
  accomplishedMissions: Mission[];
  claudeMd: string | null;
  totalPhases: number;
}): Promise<PhaseFailureDecision> {
  // Check retry limit before even asking Captain
  const retryCount = getPhaseRetryCount(params.campaign.id, params.phase.id);
  if (retryCount >= 2) {
    return {
      decision: 'escalate',
      reasoning: `Auto-retry limit reached (${retryCount} retries). Escalating to Commander.`,
    };
  }

  const prompt = buildPhaseFailurePrompt(params);

  try {
    const stdout = await runClaudePrint(prompt);
    const decision = parseDecision(stdout);
    if (decision.decision === 'retry' && retryCount >= 2) {
      return {
        decision: 'escalate',
        reasoning: `Captain recommended retry but limit reached (${retryCount}). Escalating.`,
      };
    }
    return decision;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Captain] Phase failure handler failed: ${msg}`);
    return FALLBACK_DECISION;
  }
}
