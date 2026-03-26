import fs from 'fs';
import type { Mission, Battlefield, Asset } from '@/types';

function buildBootstrapPrompt(mission: Mission, battlefield: Battlefield): string {
  return `## Battlefield Bootstrap — Intelligence Generation

You are initializing a new battlefield for the DEVROOM agent orchestrator.
Your task is to analyze this repository and the Commander's briefing, then
generate two comprehensive documents.

### Commander's Briefing

${battlefield.initialBriefing || 'No briefing provided.'}

### Repository Analysis

Analyze the repository at the current working directory. Examine:
- File structure, language, frameworks, dependencies
- Existing configuration files (package.json, tsconfig, etc.)
- Code conventions, patterns, architecture
- Database schema if present
- Test setup and coverage tooling
- CI/CD configuration
- Any existing documentation

### Orders

Create TWO files in the repository root using your Write tool:

1. **CLAUDE.md** should include:
   - Project overview and purpose
   - Tech stack with rationale
   - Project structure (actual, from repo analysis)
   - Domain model (entities, relationships, database schema)
   - Coding rules and conventions (inferred from existing code + Commander's briefing)
   - Key patterns (API structure, state management, error handling)
   - Definition of Done checklist
   - Environment variables and configuration
   - Scripts / commands reference

2. **SPEC.md** should include:
   - Detailed feature specifications for every major feature
   - Screen/page descriptions with layout and behavior
   - User flows and workflows
   - API endpoint specifications if applicable
   - Business logic rules
   - Error handling specifications
   - Edge cases and constraints
   - Future features / backlog if mentioned in the briefing

Both documents should be written as if they are the authoritative reference
for any developer (or AI agent) working on this project. Be thorough,
precise, and specific to this actual codebase — not generic.

**IMPORTANT:** Write the files using your Write tool. Do NOT commit them.
The Commander will review and approve before committing.`;
}

export function buildPrompt(
  mission: Mission,
  battlefield: Battlefield,
  asset: Asset | null,
): string {
  if (mission.type === 'bootstrap') {
    return buildBootstrapPrompt(mission, battlefield);
  }

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
