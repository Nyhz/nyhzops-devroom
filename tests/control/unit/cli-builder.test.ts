import { describe, it, expect } from 'vitest';
import { buildClaudeArgs } from '@/control/assets/cli-builder';

type AssetArg = Parameters<typeof buildClaudeArgs>[0]['asset'];

describe('buildClaudeArgs', () => {
  it('produces flags for a combat asset with RoE prepended', () => {
    const args = buildClaudeArgs({
      asset: { codename: 'OPERATIVE', model: 'claude-sonnet-4-6', maxTurns: 100, effort: 'medium', isSystem: 0, systemPrompt: 'You are OPERATIVE.', skills: [], mcpServers: [] } satisfies AssetArg,
      rulesOfEngagement: 'ROE-TEXT',
      outputFormat: 'stream-json',
      extraFlags: [],
    });
    expect(args).toContain('--model'); expect(args).toContain('claude-sonnet-4-6');
    expect(args).toContain('--max-turns'); expect(args).toContain('100');
    expect(args).toContain('--effort'); expect(args).toContain('medium');
    expect(args).toContain('--output-format'); expect(args).toContain('stream-json');
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(args[sysIdx + 1]).toContain('ROE-TEXT');
    expect(args[sysIdx + 1]).toContain('You are OPERATIVE.');
  });

  it('omits RoE for system assets', () => {
    const args = buildClaudeArgs({
      asset: { codename: 'OVERSEER', model: 'claude-sonnet-4-6', maxTurns: 2, effort: 'medium', isSystem: 1, systemPrompt: 'OVERSEER prompt', skills: [], mcpServers: [] } satisfies AssetArg,
      rulesOfEngagement: 'ROE-TEXT',
      outputFormat: 'print',
      extraFlags: ['--print'],
    });
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(args[sysIdx + 1]).not.toContain('ROE-TEXT');
    expect(args).toContain('--print');
  });
});
