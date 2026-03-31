import fs from 'fs';
import { count, eq, and } from 'drizzle-orm';
import type { Mission, Battlefield, Asset } from '@/types';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions as missionsTable } from '@/lib/db/schema';

function buildCampaignMissionPrompt(
  mission: Mission,
  battlefield: Battlefield,
  asset: Asset | null,
): string {
  const db = getDatabase();
  const sections: string[] = [];

  // 1. CLAUDE.md (static, cached)
  if (battlefield.claudeMdPath) {
    try {
      sections.push(fs.readFileSync(battlefield.claudeMdPath, 'utf-8'));
    } catch { /* skip */ }
  }

  // 2. Asset system prompt
  if (asset?.systemPrompt) {
    sections.push(asset.systemPrompt);
  }

  // 3. Campaign context
  const campaign = db.select().from(campaigns)
    .where(eq(campaigns.id, mission.campaignId!)).get();

  let phaseContext = '';
  if (mission.phaseId) {
    const phase = db.select().from(phases)
      .where(eq(phases.id, mission.phaseId)).get();

    if (phase && campaign) {
      const totalPhases = db.select({ value: count() }).from(phases)
        .where(eq(phases.campaignId, campaign.id)).all();

      // Get debriefs from all completed previous phases
      const prevPhaseSections: string[] = [];
      if (phase.phaseNumber > 1) {
        const completedPhases = db.select().from(phases)
          .where(and(
            eq(phases.campaignId, campaign.id),
          ))
          .orderBy(phases.phaseNumber)
          .all()
          .filter(p => p.phaseNumber < phase.phaseNumber);

        for (const prevPhase of completedPhases) {
          // Get actual mission debriefs from this phase
          const phaseMissions = db.select().from(missionsTable)
            .where(eq(missionsTable.phaseId, prevPhase.id))
            .all();

          const missionDebriefs = phaseMissions
            .filter(m => m.debrief)
            .map(m => `**${m.title}** (${m.status}):\n${m.debrief}`)
            .join('\n\n');

          if (missionDebriefs) {
            prevPhaseSections.push(
              `#### Phase ${prevPhase.phaseNumber}: ${prevPhase.name}\n${missionDebriefs}`
            );
          }
        }
      }

      const prevContext = prevPhaseSections.length > 0
        ? prevPhaseSections.join('\n\n---\n\n')
        : 'This is Phase 1 — no previous work to reference.';

      // Build sibling missions context (current phase, excluding self)
      const currentPhaseMissions = db.select().from(missionsTable)
        .where(eq(missionsTable.phaseId, phase.id))
        .all()
        .filter(m => m.id !== mission.id);

      let siblingContext = '';
      if (currentPhaseMissions.length > 0) {
        const siblingLines = currentPhaseMissions
          .map(m => `- ${m.title} (${m.status})`)
          .join('\n');
        siblingContext = `### Other Missions in This Phase\n${siblingLines}`;
      }

      // Build future phases context
      const futurePhases = db.select().from(phases)
        .where(eq(phases.campaignId, campaign.id))
        .orderBy(phases.phaseNumber)
        .all()
        .filter(p => p.phaseNumber > phase.phaseNumber);

      let futureContext = '';
      if (futurePhases.length > 0) {
        const futureLines: string[] = [];
        for (const fp of futurePhases) {
          const fpMissions = db.select().from(missionsTable)
            .where(eq(missionsTable.phaseId, fp.id))
            .all();
          const missionList = fpMissions.map(m => `  - ${m.title}`).join('\n');
          futureLines.push(`**Phase ${fp.phaseNumber}: ${fp.name}**\n${missionList}`);
        }
        futureContext = `### Upcoming Phases\n${futureLines.join('\n\n')}`;
      }

      phaseContext = [
        '## Campaign Context',
        '',
        `**Operation**: ${campaign.name}`,
        `**Objective**: ${campaign.objective}`,
        `**Phase**: ${phase.name} (${phase.phaseNumber} of ${totalPhases[0]?.value || '?'})`,
        '',
        '### Previous Phase Results',
        prevContext,
        ...(siblingContext ? ['', siblingContext] : []),
        ...(futureContext ? ['', futureContext] : []),
        '',
        '*Do not recommend actions that are already covered by missions listed above.*',
      ].join('\n');
    }
  }

  if (phaseContext) sections.push(phaseContext);

  // 4. Mission briefing
  sections.push([
    '## Mission Briefing',
    '',
    `**Mission**: ${mission.title}`,
    `**Priority**: ${mission.priority || 'normal'}`,
    '',
    mission.briefing,
  ].join('\n'));

  // 5. Operational parameters (campaign-specific)
  sections.push([
    '## Operational Parameters',
    '',
    'You are a black ops asset deployed on a surgical mission. Rules of engagement:',
    '',
    '1. **MISSION SCOPE IS ABSOLUTE.** Execute exactly what the briefing describes. Nothing more.',
    '   Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice.',
    '   If it is not in the briefing, it does not exist.',
    '',
    '2. **REPORT, DON\'T FIX.** If you encounter errors, warnings, code smells, or issues outside',
    '   your mission scope — log them in your debrief under "Recommended Next Actions". The Commander',
    '   will decide whether to deploy a follow-up mission. Unsanctioned detours compromise the operation.',
    '',
    '3. **SPEED AND PRECISION.** Get in, execute, get out. Minimal file reads — only what you need.',
    '   Surgical edits — only the lines that matter. Every unnecessary change is noise.',
    '',
    '4. **COMMIT DISCIPLINE.** Commit with clear, descriptive messages. Only commit files related to',
    '   your mission objective.',
    '',
    '5. **DEBRIEF IS MANDATORY.** Upon completion, provide a debrief addressed to the Commander.',
    '   Structure your debrief with these sections:',
    '   - What was done (precise changes, not summaries)',
    '   - What changed (files modified)',
    '   - Risks (anything that could break)',
    '   - ## Recommended Next Actions (bullet list of concrete follow-up tasks, if any)',
    '',
    '- Other missions may run in parallel. Stay within your assigned scope.',
  ].join('\n'));

  return sections.join('\n\n---\n\n');
}

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

  if (mission.campaignId) {
    return buildCampaignMissionPrompt(mission, battlefield, asset);
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
    'You are a black ops asset deployed on a surgical mission. Rules of engagement:',
    '',
    '1. **MISSION SCOPE IS ABSOLUTE.** Execute exactly what the briefing describes. Nothing more.',
    '   Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice.',
    '   If it is not in the briefing, it does not exist.',
    '',
    '2. **REPORT, DON\'T FIX.** If you encounter errors, warnings, code smells, or issues outside',
    '   your mission scope — log them in your debrief under "Recommended Next Actions". The Commander',
    '   will decide whether to deploy a follow-up mission. Unsanctioned detours compromise the operation.',
    '',
    '3. **SPEED AND PRECISION.** Get in, execute, get out. Minimal file reads — only what you need.',
    '   Surgical edits — only the lines that matter. Every unnecessary change is noise.',
    '',
    '4. **COMMIT DISCIPLINE.** Commit with clear, descriptive messages. Only commit files related to',
    '   your mission objective.',
    '',
    '5. **DEBRIEF IS MANDATORY.** Upon completion, provide a debrief addressed to the Commander.',
    '   Structure your debrief with these sections:',
    '   - What was done (precise changes, not summaries)',
    '   - What changed (files modified)',
    '   - Risks (anything that could break)',
    '   - ## Recommended Next Actions (bullet list of concrete follow-up tasks, if any)',
  ].join('\n');
  sections.push(parameters);

  return sections.join('\n\n---\n\n');
}
