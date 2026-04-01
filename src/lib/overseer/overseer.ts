import { runClaudePrint } from '@/lib/process/claude-print';
import type { OverseerLog, OverseerConfidence } from '@/types';

export interface OverseerDecision {
  answer: string;
  reasoning: string;
  escalate: boolean;
  confidence: OverseerConfidence;
}

interface AskOverseerParams {
  question: string;
  missionBriefing: string;
  claudeMd: string | null;
  recentOutput: string;
  overseerHistory: OverseerLog[];
  campaignContext?: string;
}

const OVERSEER_SYSTEM_PROMPT = `You are the OVERSEER of DEVROOM operations, serving under the Commander.
Your role is to make tactical decisions for AI agents executing missions.

RULES:
- Be decisive. Never hedge or ask for more information.
- Align decisions with the project's conventions (CLAUDE.md provided).
- Align with the mission briefing objectives.
- Choose the simplest approach that satisfies the requirements.
- If the question involves a MAJOR architectural change that contradicts
  CLAUDE.md or the mission briefing, set escalate=true.
- If you're genuinely uncertain between two valid approaches, set
  confidence='low' and escalate=true.
- Keep answers concise — the agent is waiting.
- Log your reasoning clearly — the Commander reviews your decisions.

Respond ONLY with a JSON object:
{
  "answer": "Your decisive response to the agent",
  "reasoning": "Why you chose this approach (1-2 sentences)",
  "escalate": false,
  "confidence": "high"
}`;

function buildOverseerPrompt(params: AskOverseerParams): string {
  const sections: string[] = [];

  // 1. System prompt
  sections.push(OVERSEER_SYSTEM_PROMPT);

  // 2. CLAUDE.md content
  if (params.claudeMd) {
    sections.push(`## Project Conventions (CLAUDE.md)\n\n${params.claudeMd}`);
  }

  // 3. Mission briefing
  sections.push(`## Mission Briefing\n\n${params.missionBriefing}`);

  // 4. Campaign context
  if (params.campaignContext) {
    sections.push(`## Campaign Context\n\n${params.campaignContext}`);
  }

  // 5. Recent agent output
  if (params.recentOutput) {
    sections.push(`## Recent Agent Output (last ~2000 chars)\n\n${params.recentOutput}`);
  }

  // 6. The question
  sections.push(`## Agent's Question\n\nThe agent has paused and is asking:\n\n${params.question}`);

  // 7. Overseer history
  if (params.overseerHistory.length > 0) {
    const historyText = params.overseerHistory
      .map((h) => `Q: ${h.question}\nA: ${h.answer} (confidence: ${h.confidence})`)
      .join('\n---\n');
    sections.push(`## Your Recent Decisions (for consistency)\n\n${historyText}`);
  }

  sections.push('Respond with a JSON object only. No markdown fences, no extra text.');

  return sections.join('\n\n---\n\n');
}

function parseDecision(raw: string): OverseerDecision {
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

export async function askOverseer(params: AskOverseerParams): Promise<OverseerDecision> {
  const prompt = buildOverseerPrompt(params);

  try {
    const stdout = await runClaudePrint(prompt);
    return parseDecision(stdout);
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
