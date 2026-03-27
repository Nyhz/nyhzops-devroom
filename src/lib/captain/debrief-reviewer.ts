import { spawn } from 'child_process';
import { config } from '@/lib/config';

export interface DebriefReview {
  satisfactory: boolean;
  concerns: string[];
  recommendation: 'accept' | 'retry' | 'escalate';
  reasoning: string;
}

const FALLBACK_REVIEW: DebriefReview = {
  satisfactory: true,
  concerns: [],
  recommendation: 'accept',
  reasoning: 'Unable to parse review',
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
    // Include a trimmed version — key rules only
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

Respond with JSON:
{
  "satisfactory": true/false,
  "concerns": ["specific concern 1", "..."],
  "recommendation": "accept" | "retry" | "escalate",
  "reasoning": "Brief explanation"
}

Rules:
- Most debriefs are satisfactory. Only flag genuine issues.
- Minor style differences are not concerns.
- "retry" only if the agent clearly failed to complete the task.
- "escalate" only if there's a significant risk the Commander should know about.

Respond with a JSON object only. No markdown fences, no extra text.`);

  return sections.join('\n\n---\n\n');
}

function parseReview(raw: string): DebriefReview {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return FALLBACK_REVIEW;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      satisfactory?: boolean;
      concerns?: string[];
      recommendation?: string;
      reasoning?: string;
    };

    const validRecommendations = ['accept', 'retry', 'escalate'] as const;
    const recommendation = validRecommendations.includes(
      parsed.recommendation as typeof validRecommendations[number],
    )
      ? (parsed.recommendation as DebriefReview['recommendation'])
      : 'accept';

    return {
      satisfactory: parsed.satisfactory !== false, // Default true
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      recommendation,
      reasoning: parsed.reasoning || 'No reasoning provided.',
    };
  } catch {
    return FALLBACK_REVIEW;
  }
}

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

  return new Promise<DebriefReview>((resolve) => {
    const proc = spawn(config.claudePath, [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', '1',
    ], { cwd: '/tmp' });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    // Pipe prompt via stdin
    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const review = parseReview(stdout);
        if (review.reasoning === 'Unable to parse review') {
          console.warn(`[Captain] Debrief review: could not parse JSON from output (${stdout.length} chars). First 300 chars: ${stdout.slice(0, 300)}`);
        }
        resolve(review);
      } else {
        console.warn(`[Captain] Debrief review exited with code ${code}. stderr: ${stderr.slice(0, 500)}`);
        resolve(FALLBACK_REVIEW);
      }
    });

    proc.on('error', (err) => {
      console.error(`[Captain] Debrief review spawn error:`, err.message);
      resolve(FALLBACK_REVIEW);
    });
  });
}
