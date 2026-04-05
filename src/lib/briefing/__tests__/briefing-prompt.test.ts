import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildBriefingSystemPrompt,
  buildBriefingUserMessage,
} from '../briefing-prompt';
import { CLAUDE_MD_CAP, SPEC_MD_CAP } from '../briefing-contract';
import type { Asset } from '@/types';

function makeAsset(codename: string, specialty: string, systemPrompt?: string | null): Asset {
  return {
    id: 'id-' + codename,
    codename,
    specialty,
    systemPrompt: systemPrompt ?? null,
    model: 'claude-sonnet-4-6',
    status: 'active',
    missionsCompleted: 0,
    skills: null,
    mcpServers: null,
    maxTurns: null,
    effort: null,
    isSystem: 0,
    memory: null,
    createdAt: 0,
  } as Asset;
}

describe('buildBriefingSystemPrompt', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'briefing-prompt-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  const baseParams = {
    campaignName: 'Operation Dawn',
    campaignObjective: 'Rebuild the ingest pipeline',
    battlefieldCodename: 'FOUNDRY',
    claudeMdPath: null,
    specMdPath: null,
    allAssets: [
      makeAsset('CIPHER', 'Backend / APIs / data / auth', 'You are CIPHER — the backend specialist.'),
    ],
  };

  it('includes STRATEGIST identity', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('STRATEGIST');
  });

  it('includes the planning contract (direct_action and verification)', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('direct_action');
    expect(sp).toContain('verification');
  });

  it('includes the JSON schema keys', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('assetCodename');
    expect(sp).toContain('dependsOn');
  });

  it('includes the asset roster with identity lines', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).toContain('CIPHER');
    expect(sp).toContain('the backend specialist.');
  });

  it('omits the CLAUDE.md section when path is null', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).not.toContain('PROJECT CONTEXT (CLAUDE.md)');
  });

  it('omits the SPEC.md section when path is null', () => {
    const sp = buildBriefingSystemPrompt(baseParams);
    expect(sp).not.toContain('PROJECT SPEC (SPEC.md)');
  });

  it('silently tolerates a missing CLAUDE.md file on disk', () => {
    const sp = buildBriefingSystemPrompt({
      ...baseParams,
      claudeMdPath: join(workdir, 'does-not-exist.md'),
    });
    expect(sp).not.toContain('PROJECT CONTEXT (CLAUDE.md)');
  });

  it('pins CLAUDE.md truncation to exactly CLAUDE_MD_CAP characters', () => {
    const bigFile = join(workdir, 'CLAUDE.md');
    writeFileSync(bigFile, 'A'.repeat(CLAUDE_MD_CAP + 5000));

    const sp = buildBriefingSystemPrompt({ ...baseParams, claudeMdPath: bigFile });

    const marker = 'PROJECT CONTEXT (CLAUDE.md):\n';
    const start = sp.indexOf(marker) + marker.length;
    const truncMarker = '\n\n[...truncated]';
    const end = sp.indexOf(truncMarker, start);
    expect(end).toBeGreaterThan(start);
    const body = sp.slice(start, end);
    expect(body.length).toBe(CLAUDE_MD_CAP);
  });

  it('pins SPEC.md truncation to exactly SPEC_MD_CAP characters', () => {
    const bigFile = join(workdir, 'SPEC.md');
    writeFileSync(bigFile, 'B'.repeat(SPEC_MD_CAP + 5000));

    const sp = buildBriefingSystemPrompt({ ...baseParams, specMdPath: bigFile });

    const marker = 'PROJECT SPEC (SPEC.md):\n';
    const start = sp.indexOf(marker) + marker.length;
    const truncMarker = '\n\n[...truncated]';
    const end = sp.indexOf(truncMarker, start);
    expect(end).toBeGreaterThan(start);
    const body = sp.slice(start, end);
    expect(body.length).toBe(SPEC_MD_CAP);
  });

  it('does not truncate files shorter than the cap', () => {
    const smallFile = join(workdir, 'CLAUDE.md');
    writeFileSync(smallFile, 'short content');
    const sp = buildBriefingSystemPrompt({ ...baseParams, claudeMdPath: smallFile });
    expect(sp).toContain('short content');
    expect(sp).not.toContain('[...truncated]');
  });
});

describe('buildBriefingUserMessage', () => {
  it('contains campaign name, battlefield, objective, and commander message', () => {
    const msg = buildBriefingUserMessage({
      campaignName: 'Operation Dawn',
      campaignObjective: 'Rebuild the ingest pipeline',
      battlefieldCodename: 'FOUNDRY',
      commanderMessage: 'What do you think about starting with the parser?',
    });

    expect(msg).toContain('Operation Dawn');
    expect(msg).toContain('FOUNDRY');
    expect(msg).toContain('Rebuild the ingest pipeline');
    expect(msg).toContain('What do you think about starting with the parser?');
  });
});
