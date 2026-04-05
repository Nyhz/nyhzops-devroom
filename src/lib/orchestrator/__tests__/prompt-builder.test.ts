import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mission, Battlefield, Asset } from '@/types';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

// Mock fs so we don't read from disk
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue('# CLAUDE.md content'),
    existsSync: vi.fn().mockReturnValue(true),
  },
}));

// Mock @/lib/db to return a minimal stub (standalone missions don't need DB queries)
vi.mock('@/lib/db/index', () => ({
  getDatabase: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnValue(null),
    all: vi.fn().mockReturnValue([]),
  })),
  getOrThrow: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { buildPrompt } from '../prompt-builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-001',
    battlefieldId: 'bf-001',
    title: 'Test Mission',
    briefing: 'Execute the test plan.',
    status: 'standby',
    priority: 'routine',
    type: 'direct_action',
    campaignId: null,
    phaseId: null,
    assetId: null,
    worktreeBranch: null,
    useWorktree: 0,
    debrief: null,
    compromiseReason: null,
    mergeResult: null,
    overseerVerdict: null,
    overseerConcerns: null,
    retryCount: 0,
    parentMissionId: null,
    dossierVariables: null,
    createdAt: Date.now(),
    completedAt: null,
    ...overrides,
  } as Mission;
}

function makeBattlefield(overrides: Partial<Battlefield> = {}): Battlefield {
  return {
    id: 'bf-001',
    name: 'Test Battlefield',
    codename: 'TESTFIELD',
    repoPath: '/tmp/test-repo',
    status: 'active',
    claudeMdPath: '/tmp/test-repo/CLAUDE.md',
    specMdPath: null,
    defaultBranch: 'main',
    initialBriefing: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Battlefield;
}

function makeAsset(overrides: Partial<Asset & { memory?: string | null }> = {}): Asset {
  return {
    id: 'asset-001',
    codename: 'ALPHA',
    specialty: 'testing',
    systemPrompt: null,
    model: 'claude-sonnet-4-6',
    status: 'active',
    missionsCompleted: 0,
    skills: null,
    mcpServers: null,
    maxTurns: null,
    effort: null,
    isSystem: 0,
    memory: null,
    createdAt: Date.now(),
    ...overrides,
  } as Asset;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Memory section inclusion
  // -------------------------------------------------------------------------

  describe('memory section', () => {
    it('includes memory section when asset has memory entries', () => {
      const memory = ['Always write tests.', 'Keep commits small.'];
      const asset = makeAsset({ memory: JSON.stringify(memory) });
      const mission = makeMission();
      const battlefield = makeBattlefield();

      const prompt = buildPrompt(mission, battlefield, asset);

      expect(prompt).toContain('YOUR MEMORY (lessons from past missions):');
      expect(prompt).toContain('- Always write tests.');
      expect(prompt).toContain('- Keep commits small.');
    });

    it('omits memory section when asset has null memory', () => {
      const asset = makeAsset({ memory: null });
      const prompt = buildPrompt(makeMission(), makeBattlefield(), asset);

      expect(prompt).not.toContain('YOUR MEMORY');
    });

    it('omits memory section when asset memory is an empty array', () => {
      const asset = makeAsset({ memory: JSON.stringify([]) });
      const prompt = buildPrompt(makeMission(), makeBattlefield(), asset);

      expect(prompt).not.toContain('YOUR MEMORY');
    });

    it('omits memory section when asset is null', () => {
      const prompt = buildPrompt(makeMission(), makeBattlefield(), null);

      expect(prompt).not.toContain('YOUR MEMORY');
    });

    it('omits memory section when memory is a JSON string (not array)', () => {
      const asset = makeAsset({ memory: '"just a string"' });
      const prompt = buildPrompt(makeMission(), makeBattlefield(), asset);

      expect(prompt).not.toContain('YOUR MEMORY');
    });
  });

  // -------------------------------------------------------------------------
  // Memory entry formatting
  // -------------------------------------------------------------------------

  describe('memory entry formatting', () => {
    it('formats each entry as a bullet point prefixed with "- "', () => {
      const entries = ['Lesson alpha.', 'Lesson bravo.'];
      const asset = makeAsset({ memory: JSON.stringify(entries) });
      const prompt = buildPrompt(makeMission(), makeBattlefield(), asset);

      for (const entry of entries) {
        expect(prompt).toContain(`- ${entry}`);
      }
    });

    it('includes the header and context line above the entries', () => {
      const asset = makeAsset({ memory: JSON.stringify(['One lesson.']) });
      const prompt = buildPrompt(makeMission(), makeBattlefield(), asset);

      expect(prompt).toContain('YOUR MEMORY (lessons from past missions):');
      expect(prompt).toContain('These are patterns and lessons you have accumulated');
    });
  });

  // -------------------------------------------------------------------------
  // Memory section placement
  // -------------------------------------------------------------------------

  describe('memory section placement', () => {
    it('places memory section after the mission briefing', () => {
      const entries = ['Memory entry.'];
      const asset = makeAsset({ memory: JSON.stringify(entries) });
      const mission = makeMission({ briefing: 'Execute the recon.' });
      const prompt = buildPrompt(mission, makeBattlefield(), asset);

      const briefingPos = prompt.indexOf('Execute the recon.');
      const memoryPos = prompt.indexOf('YOUR MEMORY');

      expect(briefingPos).toBeGreaterThan(-1);
      expect(memoryPos).toBeGreaterThan(-1);
      expect(memoryPos).toBeGreaterThan(briefingPos);
    });
  });

  // -------------------------------------------------------------------------
  // Mission briefing is always included
  // -------------------------------------------------------------------------

  describe('mission briefing', () => {
    it('includes the mission title and briefing text', () => {
      const mission = makeMission({ title: 'Recon Alpha', briefing: 'Identify all entry points.' });
      const prompt = buildPrompt(mission, makeBattlefield(), null);

      expect(prompt).toContain('Recon Alpha');
      expect(prompt).toContain('Identify all entry points.');
    });

    it('includes the battlefield codename for standalone missions', () => {
      const battlefield = makeBattlefield({ codename: 'DELTA-9' });
      const prompt = buildPrompt(makeMission(), battlefield, null);

      expect(prompt).toContain('DELTA-9');
    });
  });

  // -------------------------------------------------------------------------
  // Bootstrap missions bypass memory injection
  // -------------------------------------------------------------------------

  describe('bootstrap missions', () => {
    it('does not include memory section for bootstrap missions', () => {
      const asset = makeAsset({ memory: JSON.stringify(['Should not appear.']) });
      const mission = makeMission({ type: 'bootstrap' });
      const battlefield = makeBattlefield({ initialBriefing: 'Bootstrap briefing text.' });

      const prompt = buildPrompt(mission, battlefield, asset);

      expect(prompt).not.toContain('YOUR MEMORY');
    });
  });

  // -------------------------------------------------------------------------
  // CLAUDE.md inclusion
  // -------------------------------------------------------------------------

  describe('CLAUDE.md', () => {
    it('includes CLAUDE.md content when claudeMdPath is set', () => {
      import('fs').then((fsModule) => {
        vi.mocked((fsModule.default ?? fsModule) as { readFileSync: ReturnType<typeof vi.fn> }).readFileSync
          .mockReturnValue('# Project Docs');
      });

      const prompt = buildPrompt(makeMission(), makeBattlefield({ claudeMdPath: '/some/path/CLAUDE.md' }), null);
      // fs is mocked to return '# CLAUDE.md content'
      expect(prompt).toContain('# CLAUDE.md content');
    });

    it('skips CLAUDE.md when claudeMdPath is null', () => {
      const prompt = buildPrompt(makeMission(), makeBattlefield({ claudeMdPath: null }), null);
      expect(prompt).not.toContain('# CLAUDE.md content');
    });
  });
});
