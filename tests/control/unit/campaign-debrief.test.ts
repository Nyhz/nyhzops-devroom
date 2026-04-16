import { describe, it, expect } from 'vitest';
import { composePhaseDebrief, formatDuration } from '@/control/campaign/debrief';
import type { Debrief } from '@/control/debrief/schema';

describe('formatDuration', () => {
  it('formats sub-minute durations', () => {
    expect(formatDuration(45_000)).toBe('0m 45s');
  });

  it('formats multi-minute durations', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('clamps negative durations to zero', () => {
    expect(formatDuration(-1000)).toBe('0m 0s');
  });
});

describe('composePhaseDebrief', () => {
  const structured: Debrief = {
    summary: 'Implemented login flow and added tests.',
    commits: ['abc123', 'def456'],
    files_touched: ['src/auth.ts', 'tests/auth.test.ts', 'README.md'],
    confidence: 'high',
    open_questions: [
      { title: 'Rate limits?', description: 'Need to confirm policy', severity: 'medium' },
    ],
  };

  const input = {
    phase: { id: 'p1', name: 'Recon', order: 1, status: 'secured' },
    missions: [
      { title: 'Scan perimeter', status: 'ACCOMPLISHED', debriefStructured: structured },
      { title: 'Breach gate', status: 'COMPROMISED', debriefStructured: null },
    ],
    durationMs: 125_000,
    totalTokens: 42_000,
    totalPhases: 3,
  };

  const output = composePhaseDebrief(input);

  it('renders the phase heading with 1-based order and name', () => {
    expect(output).toContain('# Phase 1: Recon');
  });

  it('renders status as uppercase', () => {
    expect(output).toContain('Status: SECURED');
  });

  it('renders duration and tokens', () => {
    expect(output).toContain('Duration: 2m 5s | Tokens: 42000');
  });

  it('renders a section per mission with status in parens', () => {
    expect(output).toContain('## Mission: Scan perimeter (ACCOMPLISHED)');
    expect(output).toContain('## Mission: Breach gate (COMPROMISED)');
  });

  it('includes structured debrief details when present', () => {
    expect(output).toContain('Implemented login flow and added tests.');
    expect(output).toContain('Files touched: 3');
    expect(output).toContain('Commits: 2');
    expect(output).toContain('Open questions: 1');
  });

  it('renders "(no debrief)" placeholder when structured debrief is missing', () => {
    expect(output).toContain('(no debrief)');
  });

  it('separates missions with horizontal rule', () => {
    expect(output).toContain('---');
  });

  it('omits open questions line when none present', () => {
    const out = composePhaseDebrief({
      ...input,
      missions: [
        {
          title: 'Solo',
          status: 'ACCOMPLISHED',
          debriefStructured: { ...structured, open_questions: [] },
        },
      ],
    });
    expect(out).not.toContain('Open questions:');
  });
});
