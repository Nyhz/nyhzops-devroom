import { Server as SocketIOServer } from 'socket.io';
import { runClaudePrint } from '@/lib/process/claude-print';
import { getAssetMemory, updateAssetMemory } from '@/actions/asset';

interface SelfReflectionParams {
  assetId: string;
  assetCodename: string;
  debrief: string;
  currentMemory: string[];
  missionId: string;
  io: SocketIOServer;
}

interface SelfReflectionResult {
  added: number;
  removed: number;
  replaced: number;
}

interface ReflectionOutput {
  add?: string[];
  remove?: number[];
  replace?: Record<string, string>;
}

function buildReflectionPrompt(codename: string, debrief: string, memory: string[]): string {
  const used = memory.length;
  const memoryList = used === 0
    ? '(empty)'
    : memory.map((entry, i) => `${i}: ${entry}`).join('\n');

  return `You are ${codename}, a specialized agent. You just completed a mission. Here is your debrief:
${debrief}

Your current memory (lessons from past missions) has ${used}/15 slots used:
${memoryList}

Based on this mission, decide if any lessons are worth remembering for ALL future projects (not just this one). Output a JSON object with these optional fields:
- "add": string[] — new entries to add (each must be one concise sentence, battlefield-agnostic)
- "remove": number[] — indices of entries to remove (0-based)
- "replace": object — map of index to new text for entries to update

Rules:
- Only save patterns that apply to ANY project, not specific to this codebase
- Do NOT reference specific project names, file paths, repositories, or codebases
- Each entry must be one concise sentence
- Be ruthless — only save truly reusable lessons
- You have 15 slots maximum. Current usage: ${used}/15
- If nothing is worth saving, output: {}

Output ONLY the JSON object, no markdown, no explanation.`;
}

function parseReflectionResponse(raw: string, memoryLength: number): ReflectionOutput | null {
  try {
    // Strip potential markdown fences
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    }

    const parsed = JSON.parse(cleaned) as ReflectionOutput;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    // Validate add
    if (parsed.add !== undefined) {
      if (!Array.isArray(parsed.add)) return null;
      parsed.add = parsed.add.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
      if (parsed.add.length === 0) delete parsed.add;
    }

    // Validate remove
    if (parsed.remove !== undefined) {
      if (!Array.isArray(parsed.remove)) return null;
      parsed.remove = parsed.remove.filter(
        (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < memoryLength,
      );
      if (parsed.remove.length === 0) delete parsed.remove;
    }

    // Validate replace — convert Record<string, string> to array format for updateAssetMemory
    if (parsed.replace !== undefined) {
      if (typeof parsed.replace !== 'object' || Array.isArray(parsed.replace)) return null;
      const validEntries: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.replace)) {
        const idx = parseInt(key, 10);
        if (!isNaN(idx) && idx >= 0 && idx < memoryLength && typeof value === 'string' && value.trim().length > 0) {
          validEntries[String(idx)] = value;
        }
      }
      if (Object.keys(validEntries).length === 0) {
        delete parsed.replace;
      } else {
        parsed.replace = validEntries;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function runSelfReflection(params: SelfReflectionParams): Promise<SelfReflectionResult> {
  const { assetId, assetCodename, debrief, currentMemory, missionId, io } = params;
  const room = `mission:${missionId}`;

  const emitLog = (content: string) => {
    io.to(room).emit('mission:log', { content });
    io.to('hq:activity').emit('hq:activity', {
      type: 'memory:reflection',
      detail: content,
      timestamp: Date.now(),
    });
  };

  const prompt = buildReflectionPrompt(assetCodename, debrief, currentMemory);

  const raw = await runClaudePrint(prompt, {
    maxTurns: 1,
    extraArgs: ['--model', 'claude-haiku-4-5-20251001'],
  });

  const parsed = parseReflectionResponse(raw, currentMemory.length);

  if (!parsed || (!parsed.add && !parsed.remove && !parsed.replace)) {
    emitLog(`MEMORY: ${assetCodename} reviewed memories — no updates`);
    return { added: 0, removed: 0, replaced: 0 };
  }

  // Convert replace Record to array format expected by updateAssetMemory
  const replaceArray = parsed.replace
    ? Object.entries(parsed.replace).map(([key, value]) => ({ index: parseInt(key, 10), value }))
    : undefined;

  const result = await updateAssetMemory(assetId, {
    add: parsed.add,
    remove: parsed.remove,
    replace: replaceArray,
  });

  const added = parsed.add?.length ?? 0;
  const removed = parsed.remove?.length ?? 0;
  const replaced = replaceArray?.length ?? 0;
  const totalUsed = result.entries.length;

  emitLog(`MEMORY: ${assetCodename} updated ${added + removed + replaced} memories (${totalUsed}/15 used)`);

  return { added, removed, replaced };
}
