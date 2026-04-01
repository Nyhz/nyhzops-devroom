import { runClaudePrint } from '@/lib/process/claude-print';

export interface DebriefReview {
  satisfactory: boolean;
  concerns: string[];
  recommendation: 'accept' | 'retry' | 'escalate';
  reasoning: string;
}

const REVIEW_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    satisfactory: { type: 'boolean', description: 'Whether the mission was completed successfully' },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of specific concerns found (empty array if none)',
    },
    recommendation: {
      type: 'string',
      enum: ['accept', 'retry', 'escalate'],
      description: 'accept = approve, retry = agent should redo, escalate = Commander must intervene',
    },
    reasoning: { type: 'string', description: 'Brief explanation of the judgment' },
  },
  required: ['satisfactory', 'concerns', 'recommendation', 'reasoning'],
  additionalProperties: false,
});

const PARSE_FAILURE_REVIEW: DebriefReview = {
  satisfactory: false,
  concerns: ['Overseer review output could not be parsed — escalating to Commander'],
  recommendation: 'escalate',
  reasoning: 'Review parse failure after all attempts — Commander should decide',
};

function buildReviewPrompt(params: {
  missionBriefing: string;
  missionDebrief: string;
  claudeMd: string | null;
}): string {
  const sections: string[] = [];

  sections.push(`You are reviewing a mission debrief for quality and completeness.

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

  sections.push(`Review the debrief and assess:
1. Did the agent complete what was requested in the briefing?
2. Are there any warnings, risks, or concerns mentioned?
3. Are there indicators of test failures or incomplete work?
4. Did the agent make unexpected decisions that deviate from conventions?

Rules:
- Most debriefs are satisfactory. Only flag genuine issues.
- Minor style differences are not concerns.
- "retry" only if the agent clearly failed to complete the task.
- "escalate" only if there's a significant risk the Commander should know about.

IMPORTANT: Do NOT use any tools. Do NOT read files. Do NOT run commands. You have all the information you need above. Analyze the text and respond with your assessment only.`);

  return sections.join('\n\n---\n\n');
}

function spawnReview(prompt: string): Promise<string> {
  return runClaudePrint(prompt, {
    maxTurns: 2,
    outputFormat: 'json',
    jsonSchema: REVIEW_JSON_SCHEMA,
  });
}

function parseReview(raw: string): { review: DebriefReview | null; reason?: string } {
  try {
    const envelope = JSON.parse(raw) as {
      subtype?: string;
      is_error?: boolean;
      result?: string;
      structured_output?: {
        satisfactory?: boolean;
        concerns?: unknown[];
        recommendation?: string;
        reasoning?: string;
      };
    };

    if (envelope.subtype !== 'success' || !envelope.structured_output) {
      return {
        review: null,
        reason: `Envelope subtype="${envelope.subtype}", is_error=${envelope.is_error}, result="${(envelope.result ?? '').slice(0, 200)}"`,
      };
    }

    const parsed = envelope.structured_output;

    if (typeof parsed.satisfactory !== 'boolean') {
      return { review: null, reason: `satisfactory is ${typeof parsed.satisfactory}, expected boolean` };
    }
    if (!['accept', 'retry', 'escalate'].includes(parsed.recommendation ?? '')) {
      return { review: null, reason: `recommendation="${parsed.recommendation}", expected accept|retry|escalate` };
    }
    if (typeof parsed.reasoning !== 'string' || parsed.reasoning.length === 0) {
      return { review: null, reason: `reasoning is empty or not a string` };
    }

    return {
      review: {
        satisfactory: parsed.satisfactory,
        concerns: Array.isArray(parsed.concerns)
          ? parsed.concerns.filter((c): c is string => typeof c === 'string')
          : [],
        recommendation: parsed.recommendation as DebriefReview['recommendation'],
        reasoning: parsed.reasoning,
      },
    };
  } catch (err) {
    return { review: null, reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const MAX_PARSE_ATTEMPTS = 2;

export async function reviewDebrief(params: {
  missionBriefing: string;
  missionDebrief: string;
  claudeMd: string | null;
  missionId: string;
  battlefieldId: string;
}): Promise<DebriefReview> {
  const prompt = buildReviewPrompt({
    missionBriefing: params.missionBriefing,
    missionDebrief: params.missionDebrief,
    claudeMd: params.claudeMd,
  });

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    try {
      const stdout = await spawnReview(prompt);
      const { review, reason } = parseReview(stdout);

      if (review) {
        return review;
      }

      console.warn(
        `[Overseer] Debrief review parse failed (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}). ` +
        `Reason: ${reason}. Output (${stdout.length} chars): ${stdout.slice(0, 500)}`,
      );
    } catch (err) {
      console.warn(
        `[Overseer] Debrief review spawn failed (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.error(
    `[Overseer] Debrief review: all ${MAX_PARSE_ATTEMPTS} parse attempts failed for mission ${params.missionId}. ` +
    `Escalating to Commander instead of retrying mission.`,
  );
  return PARSE_FAILURE_REVIEW;
}
