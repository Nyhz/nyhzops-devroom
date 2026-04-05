import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import type { Asset } from '@/types';
import { __setRulesOfEngagementOverride } from '@/lib/settings/rules-of-engagement';

// Mock fs before importing the module under test
vi.mock('fs');

import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import fs from 'fs';

function makeAsset(overrides = {}): Asset {
  return {
    id: 'test',
    codename: 'TEST',
    specialty: 'test',
    systemPrompt: null,
    model: 'claude-sonnet-4-6',
    status: 'active',
    missionsCompleted: 0,
    skills: null,
    mcpServers: null,
    maxTurns: null,
    effort: null,
    isSystem: 0,
    createdAt: Date.now(),
    ...overrides,
  } as Asset;
}

describe('buildAssetCliArgs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setRulesOfEngagementOverride('');
  });

  afterEach(() => {
    __setRulesOfEngagementOverride(undefined);
  });

  it('returns --model when set', () => {
    const args = buildAssetCliArgs(makeAsset({ model: 'claude-opus-4-5' }));
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-5');
  });

  it('returns --max-turns when set', () => {
    const args = buildAssetCliArgs(makeAsset({ maxTurns: 20 }));
    expect(args).toContain('--max-turns');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('20');
  });

  it('returns --effort when set', () => {
    const args = buildAssetCliArgs(makeAsset({ effort: 'high' }));
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('returns --append-system-prompt when systemPrompt is set', () => {
    const args = buildAssetCliArgs(makeAsset({ systemPrompt: 'You are a tactical specialist.' }));
    expect(args).toContain('--append-system-prompt');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('You are a tactical specialist.');
  });

  it('omits all flags when values are null', () => {
    const args = buildAssetCliArgs(makeAsset({
      model: null,
      maxTurns: null,
      effort: null,
      systemPrompt: null,
      skills: null,
      mcpServers: null,
    }));
    expect(args).toEqual([]);
  });

  it('resolves skills to --plugin-dir flags', () => {
    const skillId = 'web-search@anthropic';
    const expectedBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'anthropic', 'web-search');
    const expectedPath = path.join(expectedBase, '1.0.0');

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === expectedBase || p === expectedPath;
    });
    vi.mocked(fs.readdirSync).mockImplementation((_p) => {
      return ['1.0.0'] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const args = buildAssetCliArgs(makeAsset({ skills: JSON.stringify([skillId]) }));
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe(expectedPath);
  });

  it('applies skill overrides — removes default, adds new', () => {
    const defaultSkill = 'web-search@anthropic';
    const newSkill = 'code-review@nyhz';

    const defaultBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'anthropic', 'web-search');
    const defaultPath = path.join(defaultBase, '1.0.0');
    const newBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'nyhz', 'code-review');
    const newPath = path.join(newBase, '2.1.0');

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === newBase || p === newPath;
    });
    vi.mocked(fs.readdirSync).mockImplementation((_p) => {
      return ['2.1.0'] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const args = buildAssetCliArgs(
      makeAsset({ skills: JSON.stringify([defaultSkill]) }),
      { removed: [defaultSkill], added: [newSkill] },
    );

    // The old skill path should NOT appear
    expect(args).not.toContain(defaultPath);
    // The new skill path should appear
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe(newPath);
  });

  it('does not add --plugin-dir if skill path does not exist on disk', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const args = buildAssetCliArgs(makeAsset({ skills: JSON.stringify(['missing-skill@vendor']) }));
    expect(args).not.toContain('--plugin-dir');
  });

  it('returns --mcp-config when mcpServers is set and non-empty', () => {
    const mcpConfig = JSON.stringify({ server1: { command: 'npx', args: ['some-mcp'] } });
    const args = buildAssetCliArgs(makeAsset({ mcpServers: mcpConfig }));
    expect(args).toContain('--mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(mcpConfig);
  });

  it('omits --mcp-config when mcpServers is an empty object', () => {
    const args = buildAssetCliArgs(makeAsset({ mcpServers: '{}' }));
    expect(args).not.toContain('--mcp-config');
  });

  it('picks the latest version when multiple versions exist', () => {
    const skillId = 'analyzer@tools';
    const skillBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'tools', 'analyzer');
    const latestPath = path.join(skillBase, '2.0.0');

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === skillBase || p === latestPath;
    });
    vi.mocked(fs.readdirSync).mockImplementation((_p) => {
      return ['1.0.0', '2.0.0', '1.5.0'] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const args = buildAssetCliArgs(makeAsset({ skills: JSON.stringify([skillId]) }));
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe(latestPath);
  });
});

describe('buildAssetCliArgs — rules of engagement composition', () => {
  beforeEach(() => {
    __setRulesOfEngagementOverride('ROE-TEXT');
  });

  afterEach(() => {
    __setRulesOfEngagementOverride(undefined);
  });

  it('prepends ROE to mission asset system prompt', () => {
    const args = buildAssetCliArgs(
      makeAsset({ isSystem: 0, systemPrompt: 'You are OPERATIVE.' }),
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('ROE-TEXT\n\nYou are OPERATIVE.');
  });

  it('does NOT prepend ROE to system asset system prompt', () => {
    const args = buildAssetCliArgs(
      makeAsset({ isSystem: 1, systemPrompt: 'You are OVERSEER.' }),
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(args[idx + 1]).toBe('You are OVERSEER.');
  });

  it('does not prepend when ROE is empty', () => {
    __setRulesOfEngagementOverride('');
    const args = buildAssetCliArgs(
      makeAsset({ isSystem: 0, systemPrompt: 'You are OPERATIVE.' }),
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(args[idx + 1]).toBe('You are OPERATIVE.');
  });
});
