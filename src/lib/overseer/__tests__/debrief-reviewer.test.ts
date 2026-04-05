import { describe, it, expect } from 'vitest';
import { composeReviewSystemPrompt, buildReviewUserPrompt } from '@/lib/overseer/debrief-reviewer';

describe('composeReviewSystemPrompt', () => {
  it('returns the stored prompt unchanged when claudeMd is null', () => {
    expect(composeReviewSystemPrompt('STORED', null)).toBe('STORED');
  });

  it('appends a PROJECT CONVENTIONS section when claudeMd is provided', () => {
    const result = composeReviewSystemPrompt('STORED', 'CONVENTIONS-TEXT');
    expect(result).toContain('STORED');
    expect(result).toContain('PROJECT CONVENTIONS');
    expect(result).toContain('CONVENTIONS-TEXT');
  });

  it('truncates claudeMd at 3000 chars with a marker', () => {
    const huge = 'x'.repeat(5000);
    const result = composeReviewSystemPrompt('STORED', huge);
    expect(result).toContain('[...truncated]');
    // The result should be STORED + header text + at most 3000 chars of claudeMd + marker
    expect(result.length).toBeLessThan('STORED'.length + 3500);
    expect(result).toContain('x'.repeat(3000));
    expect(result).not.toContain('x'.repeat(3001));
  });
});

describe('buildReviewUserPrompt', () => {
  it('does NOT include claudeMd in the user prompt (it lives in the system prompt now)', () => {
    const result = buildReviewUserPrompt({
      missionBriefing: 'BRIEFING',
      missionDebrief: 'DEBRIEF',
      gitDiffStat: 'STAT',
      gitDiff: 'DIFF',
      missionType: 'direct_action',
      commitCount: 3,
    });
    expect(result).not.toContain('PROJECT CONVENTIONS');
  });

  it('includes briefing, debrief, diff stat, and diff markers', () => {
    const result = buildReviewUserPrompt({
      missionBriefing: 'BRIEFING-MARKER',
      missionDebrief: 'DEBRIEF-MARKER',
      gitDiffStat: 'STAT-MARKER',
      gitDiff: 'DIFF-MARKER',
      missionType: 'direct_action',
      commitCount: 3,
    });
    expect(result).toContain('BRIEFING-MARKER');
    expect(result).toContain('DEBRIEF-MARKER');
    expect(result).toContain('STAT-MARKER');
    expect(result).toContain('DIFF-MARKER');
  });

  it('includes MISSION TYPE and commit count', () => {
    const result = buildReviewUserPrompt({
      missionBriefing: 'B',
      missionDebrief: 'D',
      gitDiffStat: null,
      gitDiff: null,
      missionType: 'verification',
      commitCount: null,
    });
    expect(result).toContain('VERIFICATION');
    expect(result).toContain('n/a (no worktree)');
  });
});
