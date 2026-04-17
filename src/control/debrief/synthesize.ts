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

  const summary = cleanFinalMessageForSummary(opts.finalMessageText);

  return {
    summary,
    commits,
    files_touched,
    confidence: 'unknown',
    open_questions: [],
  };
}

/**
 * Strip the synthesizer's input down to something readable. Agents that
 * ignore the debrief schema typically dump a `<DEBRIEF>…</DEBRIEF>` block
 * with custom YAML-ish keys (summary:, changes:, risks:, openQuestions:,
 * nextActions:) inside their final message. Persisting that verbatim makes
 * the Mission Detail page show raw markup. Prefer the explicit `summary:`
 * line when present; otherwise fall back to the wrapper-stripped body.
 */
function cleanFinalMessageForSummary(raw: string | null): string {
  if (!raw) return 'No structured debrief provided by agent.';

  const debriefMatch = raw.match(/<DEBRIEF>([\s\S]*?)<\/DEBRIEF>/);
  const body = (debriefMatch ? debriefMatch[1] : raw).trim();

  // If the body contains a `summary:` field (YAML-style or JSON-string),
  // pull that out — it's almost always the part the Commander wants to read.
  const summaryLine = body.match(/^summary:\s*([\s\S]+?)(?:\n[a-zA-Z_][\w]*:|$)/);
  if (summaryLine) {
    const candidate = summaryLine[1]
      .replace(/^["']|["']$/g, '')
      .trim();
    if (candidate.length > 0) return candidate.slice(0, 2000);
  }

  return body.slice(0, 2000);
}
