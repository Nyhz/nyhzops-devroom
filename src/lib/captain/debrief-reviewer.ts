import { spawn } from 'child_process';
import { config } from '@/lib/config';

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
  concerns: ['Captain review output could not be parsed — treating as inconclusive'],
  recommendation: 'retry',
  reasoning: 'Review parse failure — retrying to get a valid assessment',
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
- "escalate" only if there's a significant risk the Commander should know about.`);

  return sections.join('\n\n---\n\n');
}

function spawnReview(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.claudePath, [
      '--print',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--max-turns', '5',
      '--json-schema', REVIEW_JSON_SCHEMA,
    ], { cwd: '/tmp' });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(`Review process exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function parseReview(raw: string): DebriefReview | null {
  try {
    const envelope = JSON.parse(raw) as {
      subtype?: string;
      structured_output?: {
        satisfactory?: boolean;
        concerns?: unknown[];
        recommendation?: string;
        reasoning?: string;
      };
    };

    if (envelope.subtype !== 'success' || !envelope.structured_output) {
      return null;
    }

    const parsed = envelope.structured_output;

    if (typeof parsed.satisfactory !== 'boolean') return null;
    if (!['accept', 'retry', 'escalate'].includes(parsed.recommendation ?? '')) return null;
    if (typeof parsed.reasoning !== 'string' || parsed.reasoning.length === 0) return null;

    return {
      satisfactory: parsed.satisfactory,
      concerns: Array.isArray(parsed.concerns)
        ? parsed.concerns.filter((c): c is string => typeof c === 'string')
        : [],
      recommendation: parsed.recommendation as DebriefReview['recommendation'],
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
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
      const review = parseReview(stdout);

      if (review) {
        return review;
      }

      console.warn(
        `[Captain] Debrief review parse failed (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}). ` +
        `Output (${stdout.length} chars): ${stdout.slice(0, 300)}`,
      );
    } catch (err) {
      console.warn(
        `[Captain] Debrief review spawn failed (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.error(
    `[Captain] Debrief review: all ${MAX_PARSE_ATTEMPTS} parse attempts failed for mission ${params.missionId}. ` +
    `Returning inconclusive review (will trigger retry).`,
  );
  return PARSE_FAILURE_REVIEW;
}
