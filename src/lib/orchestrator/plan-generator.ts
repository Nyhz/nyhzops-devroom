import { spawn } from 'child_process';
import fs from 'fs';
import { config } from '@/lib/config';
import type { PlanJSON, Campaign, Battlefield, Asset } from '@/types';

export class PlanGenerationError extends Error {
  rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(message);
    this.name = 'PlanGenerationError';
    this.rawOutput = rawOutput;
  }
}

export async function generatePlan(
  campaign: Campaign,
  battlefield: Battlefield,
  availableAssets: Asset[],
): Promise<PlanJSON> {
  const prompt = buildPlanningPrompt(campaign, battlefield, availableAssets);

  // Spawn Claude Code for one-shot generation
  const stdout = await runClaudeForPlan(prompt, battlefield.repoPath);

  // Parse JSON from output
  const plan = parsePlanJSON(stdout);

  // Validate structure
  validatePlan(plan, availableAssets);

  return plan;
}

function buildPlanningPrompt(
  campaign: Campaign,
  battlefield: Battlefield,
  availableAssets: Asset[],
): string {
  const sections: string[] = [];

  sections.push('## Campaign Battle Plan Generation\n\nYou are a strategic planner for the DEVROOM agent orchestrator.\nAnalyze this project and generate a detailed battle plan for the following objective.');

  // Project intelligence
  if (battlefield.claudeMdPath) {
    try {
      const claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      sections.push(`### Project Intelligence — CLAUDE.md\n\n${claudeMd}`);
    } catch { /* skip */ }
  }
  if (battlefield.specMdPath) {
    try {
      const specMd = fs.readFileSync(battlefield.specMdPath, 'utf-8');
      sections.push(`### Project Intelligence — SPEC.md\n\n${specMd}`);
    } catch { /* skip */ }
  }

  // Objective
  sections.push(`### Campaign Objective\n\n${campaign.objective}`);

  // Assets
  const assetList = availableAssets.map(a =>
    `- ${a.codename} (${a.specialty}): ${(a.systemPrompt || '').slice(0, 100)}`
  ).join('\n');
  sections.push(`### Available Assets\n\n${assetList}`);

  // Execution model + rules
  sections.push(`### Execution Model

- Phases execute SEQUENTIALLY. Phase N must fully complete before Phase N+1 starts.
- All missions within a phase execute IN PARALLEL on separate git branches.
- After each phase: all branches merge to main, a debrief summary passes to the next phase.
- Each agent has full codebase access and the project's CLAUDE.md as context.
- If Mission B depends on Mission A's output AND they are in the same phase, add Mission A's title to Mission B's "dependsOn" array.

### Planning Rules

- Pin dependency versions in install commands
- Include infrastructure missions early: dependency installation, env vars, DB migrations
- Ensure API/service missions complete BEFORE frontend missions that call them
- Include a final verification/testing phase
- Write detailed briefings with specific file paths and acceptance criteria
- End every briefing with "Do NOT..." constraints to prevent scope creep
- Assign the most appropriate asset based on specialty
- Keep phases focused: 2-5 missions per phase is ideal`);

  // Output format
  sections.push(`### Output

Respond with ONLY a JSON object. No preamble, no markdown fences, no explanation.

{
  "summary": "2-3 sentence overview",
  "phases": [
    {
      "name": "Tactical phase name",
      "objective": "What and why",
      "missions": [
        {
          "title": "Short title",
          "briefing": "Detailed instructions with file paths and acceptance criteria. End with Do NOT constraints.",
          "assetCodename": "ASSET_NAME",
          "priority": "low|normal|high|critical",
          "dependsOn": []
        }
      ]
    }
  ]
}`);

  return sections.join('\n\n---\n\n');
}

async function runClaudeForPlan(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write prompt to temp file to avoid shell arg length limits
    const tmpFile = `/tmp/devroom-plan-prompt-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    const proc = spawn(config.claudePath, [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', '10',
      '--prompt-file', tmpFile,
    ], { cwd });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new PlanGenerationError(
          `Claude exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`,
          stdout,
        ));
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      reject(err);
    });
  });
}

function parsePlanJSON(output: string): PlanJSON {
  // Try direct parse first
  try {
    return JSON.parse(output.trim());
  } catch { /* continue */ }

  // Try extracting from markdown fences
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch { /* continue */ }
  }

  // Try finding JSON object in output
  const braceStart = output.indexOf('{');
  const braceEnd = output.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(output.slice(braceStart, braceEnd + 1));
    } catch { /* continue */ }
  }

  throw new PlanGenerationError('Failed to parse plan JSON from Claude output', output);
}

function validatePlan(plan: PlanJSON, availableAssets: Asset[]): void {
  if (!plan.phases || !Array.isArray(plan.phases) || plan.phases.length === 0) {
    throw new PlanGenerationError('Plan has no phases', JSON.stringify(plan));
  }

  const assetCodenames = new Set(availableAssets.map(a => a.codename));

  for (const phase of plan.phases) {
    if (!phase.name) throw new PlanGenerationError(`Phase missing name`, JSON.stringify(plan));
    if (!phase.missions || phase.missions.length === 0) {
      throw new PlanGenerationError(`Phase "${phase.name}" has no missions`, JSON.stringify(plan));
    }

    const missionTitles = new Set(phase.missions.map(m => m.title));

    for (const mission of phase.missions) {
      if (!mission.title) throw new PlanGenerationError(`Mission missing title in phase "${phase.name}"`, JSON.stringify(plan));
      if (!mission.briefing) throw new PlanGenerationError(`Mission "${mission.title}" missing briefing`, JSON.stringify(plan));

      // Warn but don't reject on unknown asset
      if (mission.assetCodename && !assetCodenames.has(mission.assetCodename)) {
        console.warn(`[PlanGenerator] Unknown asset "${mission.assetCodename}" in mission "${mission.title}". Commander can reassign in editor.`);
      }

      // Check for circular dependsOn
      if (mission.dependsOn) {
        for (const dep of mission.dependsOn) {
          if (dep === mission.title) {
            throw new PlanGenerationError(`Mission "${mission.title}" depends on itself`, JSON.stringify(plan));
          }
          if (!missionTitles.has(dep)) {
            console.warn(`[PlanGenerator] Mission "${mission.title}" depends on unknown sibling "${dep}". Ignoring.`);
          }
        }
      }
    }
  }
}
