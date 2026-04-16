import simpleGit from 'simple-git';
import { Debrief } from './schema';

export interface SynthesizeDebriefOpts {
  repoPath: string;
  targetBranch: string;
  sourceBranch: string;
  finalMessageText: string | null;
}

/**
 * Deterministic debrief fallback — built from git state when the agent did
 * not emit a valid <DEBRIEF> block. Confidence is always 'unknown' for
 * synthesized debriefs so downstream consumers know it was not authored.
 */
export async function synthesizeDebrief(opts: SynthesizeDebriefOpts): Promise<Debrief> {
  const git = simpleGit(opts.repoPath);
  const logRaw = await git
    .raw(['log', '--format=%h', '--abbrev=12', `${opts.targetBranch}..${opts.sourceBranch}`])
    .catch(() => '');
  const commits = logRaw.split('\n').map((l) => l.trim()).filter(Boolean);

  const diffNames = await git
    .raw(['diff', '--name-only', `${opts.targetBranch}..${opts.sourceBranch}`])
    .catch(() => '');
  const files_touched = diffNames.split('\n').map((l) => l.trim()).filter(Boolean);

  const summary = opts.finalMessageText?.slice(0, 2000) ?? 'No structured debrief provided by agent.';

  return {
    summary,
    commits,
    files_touched,
    confidence: 'unknown',
    open_questions: [],
  };
}
