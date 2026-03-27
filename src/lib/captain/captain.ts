import { spawn } from 'child_process';
import fs from 'fs';
import { config } from '@/lib/config';
import type { CaptainLog, CaptainConfidence } from '@/types';

export interface CaptainDecision {
  answer: string;
  reasoning: string;
  escalate: boolean;
  confidence: CaptainConfidence;
}

interface AskCaptainParams {
  question: string;
  missionBriefing: string;
  claudeMd: string | null;
  recentOutput: string;
  captainHistory: CaptainLog[];
  campaignContext?: string;
}

const CAPTAIN_SYSTEM_PROMPT = `You are the CAPTAIN of DEVROOM operations, serving under the Commander.
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

function buildCaptainPrompt(params: AskCaptainParams): string {
  const sections: string[] = [];

  // 1. System prompt
  sections.push(CAPTAIN_SYSTEM_PROMPT);

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

  // 7. Captain history
  if (params.captainHistory.length > 0) {
    const historyText = params.captainHistory
      .map((h) => `Q: ${h.question}\nA: ${h.answer} (confidence: ${h.confidence})`)
      .join('\n---\n');
    sections.push(`## Your Recent Decisions (for consistency)\n\n${historyText}`);
  }

  sections.push('Respond with a JSON object only. No markdown fences, no extra text.');

  return sections.join('\n\n---\n\n');
}

function parseDecision(raw: string): CaptainDecision {
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
      ? (parsed.confidence as CaptainConfidence)
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

export async function askCaptain(params: AskCaptainParams): Promise<CaptainDecision> {
  const prompt = buildCaptainPrompt(params);

  // Write prompt to temp file to avoid shell arg length limits
  const tmpFile = `/tmp/devroom-captain-prompt-${Date.now()}.txt`;
  fs.writeFileSync(tmpFile, prompt, 'utf-8');

  return new Promise<CaptainDecision>((resolve) => {
    const proc = spawn(config.claudePath, [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', '1',
      '--prompt-file', tmpFile,
    ], { cwd: '/tmp' });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      if (code === 0 && stdout.trim()) {
        resolve(parseDecision(stdout));
      } else {
        console.warn(`[Captain] Process exited with code ${code}. stderr: ${stderr.slice(0, 200)}`);
        resolve({
          answer: 'Proceed with your best judgment based on the project conventions.',
          reasoning: `Captain process failed (exit code ${code}). Providing fallback guidance.`,
          escalate: true,
          confidence: 'low',
        });
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      console.error(`[Captain] Spawn error:`, err.message);
      resolve({
        answer: 'Proceed with your best judgment based on the project conventions.',
        reasoning: `Captain spawn error: ${err.message}. Providing fallback guidance.`,
        escalate: true,
        confidence: 'low',
      });
    });
  });
}
