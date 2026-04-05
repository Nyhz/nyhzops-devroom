import { describe, it, expect } from 'vitest';
import { formatAssetRoster, extractAssetIdentityLine } from '../asset-roster';
import type { Asset } from '@/types';

function makeAsset(overrides: Partial<Asset>): Asset {
  return {
    id: overrides.id ?? 'id-' + (overrides.codename ?? 'X'),
    codename: overrides.codename ?? 'TEST',
    specialty: overrides.specialty ?? 'testing',
    systemPrompt: overrides.systemPrompt ?? null,
    model: overrides.model ?? 'claude-sonnet-4-6',
    status: overrides.status ?? 'active',
    missionsCompleted: overrides.missionsCompleted ?? 0,
    skills: overrides.skills ?? null,
    mcpServers: overrides.mcpServers ?? null,
    maxTurns: overrides.maxTurns ?? null,
    effort: overrides.effort ?? null,
    isSystem: overrides.isSystem ?? 0,
    memory: overrides.memory ?? null,
    createdAt: overrides.createdAt ?? 0,
  } as Asset;
}

describe('extractAssetIdentityLine', () => {
  it('returns empty string for null prompt', () => {
    expect(extractAssetIdentityLine(null)).toBe('');
  });

  it('returns empty string for empty prompt', () => {
    expect(extractAssetIdentityLine('')).toBe('');
  });

  it('returns the first non-empty line', () => {
    const prompt = '\n\nYou are CIPHER — the backend specialist.\n\nMore details here.';
    expect(extractAssetIdentityLine(prompt)).toBe('the backend specialist.');
  });

  it('strips the "You are CODENAME — " prefix (em dash)', () => {
    expect(extractAssetIdentityLine('You are CIPHER — backend engineer.')).toBe('backend engineer.');
  });

  it('strips the "You are CODENAME - " prefix (hyphen)', () => {
    expect(extractAssetIdentityLine('You are CIPHER - backend engineer.')).toBe('backend engineer.');
  });

  it('leaves lines without the prefix untouched', () => {
    expect(extractAssetIdentityLine('Backend specialist for the API layer.')).toBe(
      'Backend specialist for the API layer.',
    );
  });

  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(500);
    const result = extractAssetIdentityLine(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('formatAssetRoster', () => {
  it('excludes system assets', () => {
    const all = [
      makeAsset({ codename: 'OVERSEER', isSystem: 1, specialty: 'review' }),
      makeAsset({ codename: 'CIPHER', isSystem: 0, specialty: 'backend' }),
    ];
    const roster = formatAssetRoster(all);
    expect(roster).not.toContain('OVERSEER');
    expect(roster).toContain('CIPHER');
  });

  it('excludes inactive assets', () => {
    const all = [
      makeAsset({ codename: 'RETIRED', status: 'inactive', isSystem: 0 }),
      makeAsset({ codename: 'CIPHER', status: 'active', isSystem: 0 }),
    ];
    expect(formatAssetRoster(all)).not.toContain('RETIRED');
  });

  it('sorts entries by codename ascending', () => {
    const all = [
      makeAsset({ codename: 'VANGUARD', isSystem: 0 }),
      makeAsset({ codename: 'ARCHITECT', isSystem: 0 }),
      makeAsset({ codename: 'CIPHER', isSystem: 0 }),
    ];
    const roster = formatAssetRoster(all);
    const idxA = roster.indexOf('ARCHITECT');
    const idxC = roster.indexOf('CIPHER');
    const idxV = roster.indexOf('VANGUARD');
    expect(idxA).toBeLessThan(idxC);
    expect(idxC).toBeLessThan(idxV);
  });

  it('renders codename, specialty, and identity line when systemPrompt present', () => {
    const all = [
      makeAsset({
        codename: 'CIPHER',
        specialty: 'Backend / APIs / data / auth',
        systemPrompt: 'You are CIPHER — the backend, API, and data specialist.',
        isSystem: 0,
      }),
    ];
    const roster = formatAssetRoster(all);
    expect(roster).toContain('CIPHER');
    expect(roster).toContain('Backend / APIs / data / auth');
    expect(roster).toContain('the backend, API, and data specialist.');
  });

  it('falls back to codename + specialty only when systemPrompt is null', () => {
    const all = [
      makeAsset({
        codename: 'OPERATIVE',
        specialty: 'Generalist / catch-all',
        systemPrompt: null,
        isSystem: 0,
      }),
    ];
    const roster = formatAssetRoster(all);
    expect(roster).toContain('OPERATIVE');
    expect(roster).toContain('Generalist / catch-all');
    // No trailing ": " with empty identity
    expect(roster).not.toMatch(/OPERATIVE.*:\s*$/m);
  });

  it('returns an empty-state placeholder when no assets match', () => {
    expect(formatAssetRoster([])).toBe('(no active mission assets)');
  });
});
