import fs from 'fs';
import type { Mission, Battlefield, Asset } from '@/types';

export function buildPrompt(
  mission: Mission,
  battlefield: Battlefield,
  asset: Asset | null,
): string {
  const sections: string[] = [];

  // 1. CLAUDE.md from disk (STATIC — cached across missions)
  if (battlefield.claudeMdPath) {
    try {
      const claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      sections.push(claudeMd);
    } catch {
      // File doesn't exist or can't be read — skip
    }
  }

  // 2. Asset system prompt (SEMI-STATIC — cached per asset)
  if (asset?.systemPrompt) {
    sections.push(asset.systemPrompt);
  }

  // 3. Mission briefing (DYNAMIC — unique per mission)
  const briefingSection = [
    '## Mission Briefing',
    '',
    `**Mission**: ${mission.title}`,
    `**Battlefield**: ${battlefield.codename}`,
    `**Priority**: ${mission.priority || 'normal'}`,
    '',
    mission.briefing,
  ].join('\n');
  sections.push(briefingSection);

  // 4. Operational parameters (STATIC suffix)
  const parameters = [
    '## Operational Parameters',
    '',
    '- Execute the task described above.',
    '- Commit with clear, descriptive messages.',
    '- Upon completion, provide a debrief addressed to the Commander:',
    '  what was done, what changed, risks, and recommended next actions.',
  ].join('\n');
  sections.push(parameters);

  return sections.join('\n\n---\n\n');
}
