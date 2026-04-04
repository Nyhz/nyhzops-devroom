import type { OverseerConfidence } from '@/types';

export interface OverseerDecision {
  answer: string;
  reasoning: string;
  escalate: boolean;
  confidence: OverseerConfidence;
}

export interface PhaseFailureDecision {
  decision: 'retry' | 'skip' | 'escalate';
  reasoning: string;
  retryBriefings?: Record<string, string>; // missionId -> modified briefing
}

export const FALLBACK_PHASE_DECISION: PhaseFailureDecision = {
  decision: 'escalate',
  reasoning: 'Unable to parse Overseer decision. Escalating to Commander.',
};

export function parseOverseerDecision(raw: string): OverseerDecision {
  // Try to extract JSON from the output — may have markdown fences or extra text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      answer: raw.trim(),
      reasoning: 'Failed to parse structured response — using raw output.',
      escalate: false,
      confidence: 'low',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      answer?: string;
      reasoning?: string;
      escalate?: boolean;
      confidence?: string;
    };

    if (!parsed.answer) {
      return {
        answer: raw.trim(),
        reasoning: 'Parsed JSON had no answer field — using raw output.',
        escalate: false,
        confidence: 'low',
      };
    }

    const validConfidence = ['high', 'medium', 'low'];
    const confidence = validConfidence.includes(parsed.confidence || '')
      ? (parsed.confidence as OverseerConfidence)
      : 'low';

    return {
      answer: parsed.answer,
      reasoning: parsed.reasoning || 'No reasoning provided.',
      escalate: !!parsed.escalate,
      confidence,
    };
  } catch {
    return {
      answer: raw.trim(),
      reasoning: 'JSON parse failed — using raw output.',
      escalate: false,
      confidence: 'low',
    };
  }
}

export function parsePhaseFailureDecision(raw: string): PhaseFailureDecision {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return FALLBACK_PHASE_DECISION;
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
    return FALLBACK_PHASE_DECISION;
  }
}
