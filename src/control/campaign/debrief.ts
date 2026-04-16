/**
 * Deterministic phase debrief composition.
 *
 * Pure function — no LLM, no I/O. Produces a markdown-ish string
 * summarizing a phase's missions for downstream reporting.
 */

import type { Debrief } from '@/control/debrief/schema';

export interface ComposePhaseDebriefInput {
  phase: { id: string; name: string; order: number; status: string };
  missions: { title: string; status: string; debriefStructured: Debrief | null }[];
  durationMs: number;
  totalTokens: number;
  totalPhases: number;
}

export function formatDuration(durationMs: number): string {
  const ms = Math.max(0, Math.floor(durationMs));
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function composePhaseDebrief(input: ComposePhaseDebriefInput): string {
  const lines: string[] = [];
  lines.push(`# Phase ${input.phase.order}: ${input.phase.name}`);
  lines.push(`Status: ${input.phase.status.toUpperCase()}`);
  lines.push(`Duration: ${formatDuration(input.durationMs)} | Tokens: ${input.totalTokens}`);
  lines.push('');
  for (const m of input.missions) {
    lines.push(`## Mission: ${m.title} (${m.status})`);
    if (m.debriefStructured) {
      lines.push(m.debriefStructured.summary);
      lines.push('');
      lines.push(`Files touched: ${m.debriefStructured.files_touched.length}`);
      lines.push(`Commits: ${m.debriefStructured.commits.length}`);
      if (m.debriefStructured.open_questions?.length) {
        lines.push(`Open questions: ${m.debriefStructured.open_questions.length}`);
      }
    } else {
      lines.push('(no debrief)');
    }
    lines.push('\n---\n');
  }
  return lines.join('\n');
}
