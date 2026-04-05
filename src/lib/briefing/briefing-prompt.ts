import fs from 'fs';
import type { Asset } from '@/types';
import { BRIEFING_CONTRACT, CLAUDE_MD_CAP, SPEC_MD_CAP } from './briefing-contract';
import { formatAssetRoster } from './asset-roster';

export interface BriefingSystemPromptParams {
  claudeMdPath: string | null;
  specMdPath: string | null;
  allAssets: Asset[];
}

export interface BriefingUserMessageParams {
  campaignName: string;
  campaignObjective: string;
  battlefieldCodename: string;
  commanderMessage: string;
}

/**
 * Compose the stable block for --append-system-prompt.
 *
 * Contents (all stable within a briefing session and across briefings on the
 * same battlefield, so eligible for prompt caching):
 *   - STRATEGIST identity and planning contract (BRIEFING_CONTRACT)
 *   - CLAUDE.md (truncated to CLAUDE_MD_CAP)
 *   - SPEC.md (truncated to SPEC_MD_CAP)
 *   - Asset roster (formatAssetRoster)
 *
 * Campaign-specific volatile data (name, objective, battlefield, Commander
 * message) is delivered via buildBriefingUserMessage instead.
 */
export function buildBriefingSystemPrompt(params: BriefingSystemPromptParams): string {
  const sections: string[] = [BRIEFING_CONTRACT];

  const claudeMd = readTruncated(params.claudeMdPath, CLAUDE_MD_CAP);
  if (claudeMd !== null) {
    sections.push(`PROJECT CONTEXT (CLAUDE.md):\n${claudeMd}`);
  }

  const specMd = readTruncated(params.specMdPath, SPEC_MD_CAP);
  if (specMd !== null) {
    sections.push(`PROJECT SPEC (SPEC.md):\n${specMd}`);
  }

  sections.push(`AVAILABLE MISSION ASSETS:\n${formatAssetRoster(params.allAssets)}`);

  return sections.join('\n\n---\n\n');
}

/**
 * Compose the volatile first-message stdin content: campaign header + the
 * Commander's actual message. For subsequent messages in a briefing, callers
 * send only the raw Commander message (no header needed — the session has it).
 */
export function buildBriefingUserMessage(params: BriefingUserMessageParams): string {
  return `Campaign: "${params.campaignName}" | Battlefield: ${params.battlefieldCodename}

CAMPAIGN OBJECTIVE:
${params.campaignObjective}

---

Commander says: ${params.commanderMessage}`;
}

function readTruncated(path: string | null, cap: number): string | null {
  if (!path) return null;
  try {
    const content = fs.readFileSync(path, 'utf-8');
    return content.length > cap
      ? content.slice(0, cap) + '\n\n[...truncated]'
      : content;
  } catch {
    return null;
  }
}
