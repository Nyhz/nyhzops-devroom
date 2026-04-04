import { spawn } from 'child_process';
import fs from 'fs';
import simpleGit from 'simple-git';
import { config } from '@/lib/config';
import { createAuthenticatedHome } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import { filterFlag } from '@/lib/utils/cli';
import type { Mission } from '@/types';

const RESOLUTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Spawn Claude Code to resolve merge conflicts with rich context.
 * Returns true if conflicts were resolved and committed, false otherwise.
 */
export async function resolveConflicts(params: {
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  mission: Mission;
  claudeMdPath?: string | null;
}): Promise<boolean> {
  const { repoPath, sourceBranch, targetBranch, mission, claudeMdPath } = params;
  const git = simpleGit(repoPath);

  // Gather context for the prompt
  const sections: string[] = [];

  // 1. CLAUDE.md if available
  if (claudeMdPath) {
    try {
      const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
      sections.push(claudeMd);
    } catch {
      // Skip if not readable
    }
  }

  // 2-6. Build the conflict resolution prompt
  let upstreamLog = '';
  let branchLog = '';
  let conflictDiff = '';

  try {
    upstreamLog = await git.raw(['log', '--oneline', `${sourceBranch}..${targetBranch}`]);
  } catch {
    upstreamLog = 'Unable to retrieve upstream log.';
  }

  try {
    branchLog = await git.raw(['log', '--oneline', `${targetBranch}..${sourceBranch}`]);
  } catch {
    branchLog = 'Unable to retrieve branch log.';
  }

  try {
    conflictDiff = await git.diff();
  } catch {
    conflictDiff = 'Unable to retrieve conflict diff.';
  }

  const instructions = [
    '## Merge Conflict Resolution',
    '',
    `Branch \`${sourceBranch}\` into \`${targetBranch}\`.`,
    '',
    '### Mission Briefing',
    mission.briefing || 'No briefing available.',
    '',
    '### Mission Debrief',
    mission.debrief || 'No debrief available.',
    '',
    '### What the mission changed',
    '```',
    branchLog.trim() || '(no commits)',
    '```',
    '',
    '### What landed upstream',
    '```',
    upstreamLog.trim() || '(no commits)',
    '```',
    '',
    '### Conflict Diff',
    '```',
    conflictDiff,
    '```',
    '',
    '### Orders',
    '1. Analyze both sides of each conflict.',
    '2. Resolve preserving both intents.',
    '3. If incompatible, prefer source (new work). Note losses.',
    '4. Run tests if a test command is available.',
    `5. Commit: "Merge ${sourceBranch}: resolve conflicts"`,
    '6. Report to the Commander.',
  ].join('\n');
  sections.push(instructions);

  const prompt = sections.join('\n\n---\n\n');

  // Spawn Claude Code for conflict resolution with QUARTERMASTER asset config
  const authHome = createAuthenticatedHome();

  const quartermaster = getSystemAsset('QUARTERMASTER');
  const assetArgs = buildAssetCliArgs(quartermaster);
  // Filter --max-turns (we set our own)
  const filteredArgs = filterFlag(assetArgs, '--max-turns');

  return new Promise<boolean>((resolve) => {
    const proc = spawn(config.claudePath, [
      '--print',
      '--dangerously-skip-permissions',
      '--max-turns', '20',
      ...filteredArgs,
    ], {
      cwd: repoPath,
      env: { ...process.env, HOME: authHome },
    });

    // 10-minute timeout
    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* best effort */ }
    }, RESOLUTION_TIMEOUT_MS);

    // Drain stdout to prevent backpressure
    proc.stdout?.resume();

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('close', (code) => {
      clearTimeout(timeout);
      try { fs.rmSync(authHome, { recursive: true, force: true }); } catch { /* best effort */ }
      resolve(code === 0);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      try { fs.rmSync(authHome, { recursive: true, force: true }); } catch { /* best effort */ }
      resolve(false);
    });
  });
}
