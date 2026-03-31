import { describe, it, expect } from 'vitest';
import { extractNextActions } from '../debrief-parser';

describe('extractNextActions', () => {
  it('extracts standard bullet points from Recommended Next Actions section', () => {
    const debrief = `## Summary
Mission completed successfully.

## Recommended Next Actions
- Add error handling to the API endpoint
- Write integration tests for the new feature
- Update the documentation
- Refactor the database queries`;

    expect(extractNextActions(debrief)).toEqual([
      'Add error handling to the API endpoint',
      'Write integration tests for the new feature',
      'Update the documentation',
      'Refactor the database queries',
    ]);
  });

  it('returns empty array when no section is found', () => {
    const debrief = `## Summary
Mission completed successfully.

## Risks
None identified.`;

    expect(extractNextActions(debrief)).toEqual([]);
  });

  it('returns empty array for empty/null/undefined debrief', () => {
    expect(extractNextActions('')).toEqual([]);
    expect(extractNextActions(null)).toEqual([]);
    expect(extractNextActions(undefined)).toEqual([]);
  });

  it('handles h3 heading level', () => {
    const debrief = `### Recommended Next Actions
- First action
- Second action`;

    expect(extractNextActions(debrief)).toEqual([
      'First action',
      'Second action',
    ]);
  });

  it('handles "Next Steps" heading variant', () => {
    const debrief = `## Next Steps
- Migrate the legacy data
- Deploy to staging`;

    expect(extractNextActions(debrief)).toEqual([
      'Migrate the legacy data',
      'Deploy to staging',
    ]);
  });

  it('handles "Follow-up Actions" heading variant', () => {
    const debrief = `## Follow-up Actions
- Review the PR
- Run performance benchmarks`;

    expect(extractNextActions(debrief)).toEqual([
      'Review the PR',
      'Run performance benchmarks',
    ]);
  });

  it('handles "Next Actions" heading variant', () => {
    const debrief = `## Next Actions
- Check logs for anomalies`;

    expect(extractNextActions(debrief)).toEqual([
      'Check logs for anomalies',
    ]);
  });

  it('preserves bold markdown formatting in bullets', () => {
    const debrief = `## Recommended Next Actions
- **Critical**: Fix the memory leak
- Update **config.ts** with new defaults`;

    expect(extractNextActions(debrief)).toEqual([
      '**Critical**: Fix the memory leak',
      'Update **config.ts** with new defaults',
    ]);
  });

  it('stops extracting at the next heading', () => {
    const debrief = `## Recommended Next Actions
- First action
- Second action

## Risks
- This is not an action`;

    expect(extractNextActions(debrief)).toEqual([
      'First action',
      'Second action',
    ]);
  });

  it('strips trailing periods from bullets', () => {
    const debrief = `## Next Steps
- Add validation to inputs.
- Update the schema...`;

    expect(extractNextActions(debrief)).toEqual([
      'Add validation to inputs',
      'Update the schema',
    ]);
  });

  it('handles asterisk-style bullets', () => {
    const debrief = `## Recommended Next Actions
* First with asterisk
* Second with asterisk`;

    expect(extractNextActions(debrief)).toEqual([
      'First with asterisk',
      'Second with asterisk',
    ]);
  });

  it('returns empty array when heading exists but no bullets follow', () => {
    const debrief = `## Recommended Next Actions

## Another Section
Some content.`;

    expect(extractNextActions(debrief)).toEqual([]);
  });

  it('skips nested sub-items (indented bullets)', () => {
    const debrief = `## Next Steps
- Top-level action
  - Sub-item that should be skipped
  - Another sub-item
- Another top-level action`;

    expect(extractNextActions(debrief)).toEqual([
      'Top-level action',
      'Another top-level action',
    ]);
  });
});
