import { describe, it, expect } from 'vitest';
import {
  buildStandardCombatPrompt,
  buildCampaignCombatPrompt,
  buildReconPrompt,
  buildDeterministicRetryPrompt,
  buildOverseerRedirectPrompt,
  buildOverseerClassificationPrompt,
  buildOverseerConsultPrompt,
  buildQuartermasterPrompt,
  composeRulesOfEngagement,
} from '@/control/prompt-builder';

describe('buildStandardCombatPrompt', () => {
  it('includes CLAUDE.md, Mission Briefing, and Workspace headings with substitutions', () => {
    const out = buildStandardCombatPrompt({
      claudeMd: '# Project\nConventions here.',
      briefing: 'Fix the flaky refresh test.',
      workspace: '/var/worktrees/mission-abc',
    });
    expect(out).toMatch(/# Project/);
    expect(out).toMatch(/^## Mission Briefing$/m);
    expect(out).toContain('Fix the flaky refresh test.');
    expect(out).toMatch(/^## Workspace$/m);
    expect(out).toContain('/var/worktrees/mission-abc');
    // Must NOT include campaign context.
    expect(out).not.toContain('## Campaign Context');
    expect(out).not.toContain('## Previous Phase Results');
  });
});

describe('buildCampaignCombatPrompt', () => {
  it('adds Campaign Context and Previous Phase Results with injected debriefs', () => {
    const out = buildCampaignCombatPrompt({
      claudeMd: '# Project',
      briefing: 'Wire up the new endpoint.',
      workspace: '/var/worktrees/mission-def',
      campaignContext: {
        operationName: 'OPERATION NIGHTFALL',
        phaseName: 'Phase 2: Integration',
        previousPhaseDebriefs: [
          { text: '# Phase 1\nStatus: SECURED\nDetails: token rotation landed.' },
        ],
      },
    });
    expect(out).toMatch(/^## Mission Briefing$/m);
    expect(out).toMatch(/^## Campaign Context$/m);
    expect(out).toContain('OPERATION NIGHTFALL');
    expect(out).toContain('Phase 2: Integration');
    expect(out).toMatch(/^## Previous Phase Results$/m);
    expect(out).toContain('token rotation landed.');
    expect(out).toMatch(/^## Workspace$/m);
  });

  it('handles empty previous phase debriefs gracefully', () => {
    const out = buildCampaignCombatPrompt({
      claudeMd: '# P',
      briefing: 'b',
      workspace: '/w',
      campaignContext: {
        operationName: 'OP A',
        phaseName: 'Phase 1',
        previousPhaseDebriefs: [],
      },
    });
    expect(out).toContain('## Previous Phase Results');
    expect(out).toMatch(/No previous phases/i);
  });
});

describe('buildReconPrompt', () => {
  it('includes Recon Briefing, repo root, and a read-only warning but no workspace section', () => {
    const out = buildReconPrompt({
      claudeMd: '# Project',
      briefing: 'Scout the auth module and report structure.',
      repoRootPath: '/var/battlefields/repo',
    });
    expect(out).toMatch(/^## Recon Briefing$/m);
    expect(out).toContain('Scout the auth module');
    expect(out).toContain('/var/battlefields/repo');
    expect(out).toMatch(/read-only|may not write/i);
    expect(out).not.toMatch(/^## Workspace$/m);
  });
});

describe('buildDeterministicRetryPrompt', () => {
  it('uses the REVIEW FEEDBACK header and injects gate stderr + retry number', () => {
    const out = buildDeterministicRetryPrompt({
      retryNumber: 2,
      gateStderr: 'FAIL auth.test.ts (3 tests failed)',
    });
    expect(out).toContain('OVERSEER REVIEW FEEDBACK (Retry 2)');
    expect(out).toContain('FAIL auth.test.ts');
    expect(out).toContain('previous session context is preserved');
    // Clearly distinct from the redirect template.
    expect(out).not.toContain('OVERSEER REDIRECT');
  });
});

describe('buildOverseerRedirectPrompt', () => {
  it('uses a different header than deterministic retry and embeds the new prompt', () => {
    const out = buildOverseerRedirectPrompt({
      retryNumber: 4,
      newPrompt: 'Reframe: use the existing tokenStore singleton.',
    });
    expect(out).toContain('OVERSEER REDIRECT (Retry 4)');
    expect(out).toContain('tokenStore singleton');
    expect(out).toContain('previous session context is preserved');
    expect(out).not.toContain('OVERSEER REVIEW FEEDBACK');
  });
});

describe('buildOverseerClassificationPrompt', () => {
  it('includes exit code, stderr, stdout tail, and requests JSON with the documented categories', () => {
    const out = buildOverseerClassificationPrompt({
      exitCode: 137,
      rawStderr: 'killed: OOM',
      stdoutTail: '...last 2000 chars of stdout...',
    });
    expect(out).toContain('EXIT CODE: 137');
    expect(out).toContain('killed: OOM');
    expect(out).toContain('last 2000 chars of stdout');
    expect(out).toContain('INFRASTRUCTURE');
    expect(out).toContain('AGENT_FAILURE');
    expect(out).toContain('NEEDS_COMMANDER');
    expect(out).toMatch(/Respond with JSON/);
  });
});

describe('buildOverseerConsultPrompt', () => {
  const base = {
    briefing: 'Port the refresh flow.',
    attemptSummaries: [
      { line: 'Attempt 1 (7m 12s): exit=clean, gates failed on [test], diff: +41 -12 across 3 files' },
      { line: 'Attempt 2 (4m 03s): exit=clean, gates failed on [test], diff: +41 -12 across 3 files (identical to attempt 1)' },
    ],
    claudeMdExcerpt: 'Use pnpm. Strict TS.',
  };

  it('includes gate output and final diff for combat variant', () => {
    const out = buildOverseerConsultPrompt({
      ...base,
      gateStderr: 'FAIL auth.test.ts',
      finalDiff: 'diffstat: 3 files changed',
    });
    expect(out).toContain('MISSION BRIEFING:');
    expect(out).toContain('Port the refresh flow.');
    expect(out).toContain('ATTEMPT HISTORY:');
    expect(out).toContain('Attempt 1 (7m 12s)');
    expect(out).toContain('Attempt 2 (4m 03s)');
    expect(out).toContain('LAST GATE OUTPUT:');
    expect(out).toContain('FAIL auth.test.ts');
    expect(out).toContain('FINAL DIFF:');
    expect(out).toContain('diffstat: 3 files changed');
    expect(out).toContain('PROJECT CONVENTIONS:');
    expect(out).toContain('Use pnpm.');
  });

  it('omits LAST GATE OUTPUT and FINAL DIFF when both are null (recon variant, spec §7)', () => {
    const out = buildOverseerConsultPrompt({
      ...base,
      gateStderr: null,
      finalDiff: null,
    });
    expect(out).toContain('MISSION BRIEFING:');
    expect(out).toContain('ATTEMPT HISTORY:');
    expect(out).toContain('PROJECT CONVENTIONS:');
    expect(out).not.toContain('LAST GATE OUTPUT');
    expect(out).not.toContain('FINAL DIFF');
  });
});

describe('buildQuartermasterPrompt', () => {
  it('includes briefing, debrief, conflict diff, both log summaries, and orders', () => {
    const out = buildQuartermasterPrompt({
      briefing: 'Merge feature X.',
      debrief: 'Implemented X with 2 commits.',
      conflictDiff: '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>>',
      logSourceToTarget: 'abc1234 mission commit',
      logTargetToSource: 'def5678 main commit',
      claudeMdExcerpt: '# Project',
    });
    expect(out).toContain('QUARTERMASTER');
    expect(out).toContain('MISSION BRIEFING:');
    expect(out).toContain('Merge feature X.');
    expect(out).toContain('MISSION DEBRIEF:');
    expect(out).toContain('Implemented X');
    expect(out).toContain('CONFLICT DIFF:');
    expect(out).toContain('<<<<<<< HEAD');
    expect(out).toContain('LOG (source..target):');
    expect(out).toContain('abc1234 mission commit');
    expect(out).toContain('LOG (target..source):');
    expect(out).toContain('def5678 main commit');
    expect(out).toContain('PROJECT CONVENTIONS:');
    expect(out).toContain('ORDERS:');
  });
});

describe('composeRulesOfEngagement', () => {
  it('substitutes {{GATE_MANIFEST}} with a formatted manifest block', () => {
    const roe = 'Header\nGates:\n{{GATE_MANIFEST}}\nFooter';
    const out = composeRulesOfEngagement({
      roe,
      gateManifest: [
        { name: 'build', command: 'pnpm build' },
        { name: 'test', command: 'pnpm test' },
        { name: 'lint', command: null },
      ],
    });
    expect(out).not.toContain('{{GATE_MANIFEST}}');
    expect(out).toContain('build: pnpm build');
    expect(out).toContain('test: pnpm test');
    expect(out).toMatch(/lint:.*unavailable/);
    expect(out).toContain('Header');
    expect(out).toContain('Footer');
  });

  it('renders a placeholder when no gates are configured', () => {
    const out = composeRulesOfEngagement({
      roe: '{{GATE_MANIFEST}}',
      gateManifest: [],
    });
    expect(out).toMatch(/no gates configured/i);
  });
});
