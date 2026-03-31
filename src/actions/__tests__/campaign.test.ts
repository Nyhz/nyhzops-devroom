import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestCampaign,
  createTestPhase,
  createTestMission,
  createTestAsset,
} from '@/lib/test/fixtures';
import { campaigns, phases, missions, intelNotes, missionLogs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createMockDbModule } from '@/lib/test/mock-db';
import type { DB } from '@/lib/db/index';
import type { PlanJSON } from '@/types';

// ---------------------------------------------------------------------------
// Mock next/cache and next/navigation at module level
// ---------------------------------------------------------------------------
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const mockRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
  },
}));

// ---------------------------------------------------------------------------
// Mock briefing engine
// ---------------------------------------------------------------------------
vi.mock('@/lib/briefing/briefing-engine', () => ({
  deleteBriefingData: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock campaign executor (dynamic import in notifyCampaignExecutor)
// ---------------------------------------------------------------------------
vi.mock('@/lib/orchestrator/campaign-executor', () => ({
  CampaignExecutor: class MockCampaignExecutor {
    onCampaignMissionComplete = vi.fn().mockResolvedValue(undefined);
  },
}));

// ---------------------------------------------------------------------------
// DB injection — swap getDatabase/getOrThrow to use in-memory test db
// ---------------------------------------------------------------------------
let testDb: DB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => createMockDbModule(() => testDb));

// ---------------------------------------------------------------------------
// Mock globalThis.orchestrator and io
// ---------------------------------------------------------------------------
const mockOrchestrator = {
  startCampaign: vi.fn(),
  abortCampaign: vi.fn(),
  resumeCampaign: vi.fn(),
  skipAndContinueCampaign: vi.fn(),
  onMissionQueued: vi.fn(),
  activeCampaigns: new Map(),
};

const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));

beforeEach(() => {
  globalThis.orchestrator = mockOrchestrator as unknown as typeof globalThis.orchestrator;
  globalThis.io = { emit: mockEmit, to: mockTo, in: mockTo } as unknown as typeof globalThis.io;
});

// ---------------------------------------------------------------------------
// Import actions AFTER mocks are registered
// ---------------------------------------------------------------------------
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  backToDraft,
  updateBattlePlan,
  launchCampaign,
  completeCampaign,
  abandonCampaign,
  redeployCampaign,
  saveAsTemplate,
  runTemplate,
  listTemplates,
  resumeCampaign,
  skipAndContinueCampaign,
  tacticalOverride,
  commanderOverride,
  skipMission,
} from '@/actions/campaign';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
let battlefieldId: string;

beforeEach(() => {
  const result = getTestDb();
  testDb = result.db;
  sqlite = result.sqlite;

  const bf = createTestBattlefield(testDb);
  battlefieldId = bf.id;

  vi.clearAllMocks();
  mockOrchestrator.activeCampaigns.clear();
});

afterEach(() => {
  closeTestDb(sqlite);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a campaign with phases and missions ready for launch */
function createLaunchableCampaign(status = 'planning' as string) {
  const campaign = createTestCampaign(testDb, {
    battlefieldId,
    status,
  });
  const phase = createTestPhase(testDb, {
    campaignId: campaign.id,
    phaseNumber: 1,
    name: 'Phase Alpha',
  });
  const mission = createTestMission(testDb, {
    battlefieldId,
    campaignId: campaign.id,
    phaseId: phase.id,
    title: 'Mission Alpha',
  });
  return { campaign, phase, mission };
}

function createPlanJSON(overrides?: Partial<PlanJSON>): PlanJSON {
  return {
    summary: 'Test plan',
    phases: [
      {
        name: 'Phase 1',
        objective: 'Objective 1',
        missions: [
          {
            title: 'Mission 1',
            briefing: 'Do the thing',
            assetCodename: 'TESTER',
            priority: 'normal',
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('createCampaign', () => {
  it('creates a campaign in draft status', async () => {
    const result = await createCampaign(battlefieldId, 'Op Thunder', 'Storm the gates');
    expect(result.name).toBe('Op Thunder');
    expect(result.objective).toBe('Storm the gates');
    expect(result.status).toBe('draft');
    expect(result.battlefieldId).toBe(battlefieldId);
    expect(result.id).toBeDefined();
  });

  it('persists to database', async () => {
    const result = await createCampaign(battlefieldId, 'Op Thunder', 'Storm the gates');
    const row = testDb.select().from(campaigns).where(eq(campaigns.id, result.id)).get();
    expect(row).toBeDefined();
    expect(row!.name).toBe('Op Thunder');
  });
});

describe('getCampaign', () => {
  it('returns null for non-existent campaign', async () => {
    const result = await getCampaign('nonexistent');
    expect(result).toBeNull();
  });

  it('returns campaign with phases and missions', async () => {
    const { campaign, phase, mission } = createLaunchableCampaign();
    const result = await getCampaign(campaign.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(campaign.id);
    expect(result!.phases).toHaveLength(1);
    expect(result!.phases[0].id).toBe(phase.id);
    expect(result!.phases[0].missions).toHaveLength(1);
    expect(result!.phases[0].missions[0].id).toBe(mission.id);
  });

  it('includes asset codename when asset is assigned', async () => {
    const asset = createTestAsset(testDb, { codename: 'SHADOW' });
    const campaign = createTestCampaign(testDb, { battlefieldId });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      assetId: asset.id,
    });

    const result = await getCampaign(campaign.id);
    expect(result!.phases[0].missions[0].assetCodename).toBe('SHADOW');
  });

  it('returns phases ordered by phaseNumber', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId });
    createTestPhase(testDb, { campaignId: campaign.id, phaseNumber: 3, name: 'Phase C' });
    createTestPhase(testDb, { campaignId: campaign.id, phaseNumber: 1, name: 'Phase A' });
    createTestPhase(testDb, { campaignId: campaign.id, phaseNumber: 2, name: 'Phase B' });

    const result = await getCampaign(campaign.id);
    expect(result!.phases.map((p) => p.name)).toEqual(['Phase A', 'Phase B', 'Phase C']);
  });
});

describe('listCampaigns', () => {
  it('returns empty array when no campaigns', async () => {
    const result = await listCampaigns(battlefieldId);
    expect(result).toEqual([]);
  });

  it('returns campaigns for the given battlefield', async () => {
    createTestCampaign(testDb, { battlefieldId, name: 'Campaign A' });
    createTestCampaign(testDb, { battlefieldId, name: 'Campaign B' });

    const otherBf = createTestBattlefield(testDb, { codename: 'OTHER' });
    createTestCampaign(testDb, { battlefieldId: otherBf.id, name: 'Other Campaign' });

    const result = await listCampaigns(battlefieldId);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name).sort()).toEqual(['Campaign A', 'Campaign B']);
  });

  it('orders by updatedAt descending', async () => {
    createTestCampaign(testDb, { battlefieldId, name: 'Old', updatedAt: 1000 });
    createTestCampaign(testDb, { battlefieldId, name: 'New', updatedAt: 3000 });
    createTestCampaign(testDb, { battlefieldId, name: 'Mid', updatedAt: 2000 });

    const result = await listCampaigns(battlefieldId);
    expect(result.map((c) => c.name)).toEqual(['New', 'Mid', 'Old']);
  });
});

describe('updateCampaign', () => {
  it('updates name and objective for draft campaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'draft' });
    await updateCampaign(campaign.id, { name: 'New Name', objective: 'New Obj' });

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.name).toBe('New Name');
    expect(row!.objective).toBe('New Obj');
  });

  it('allows updates for planning campaigns', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    await updateCampaign(campaign.id, { name: 'Updated' });

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.name).toBe('Updated');
  });

  it('rejects updates for active campaigns', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await expect(updateCampaign(campaign.id, { name: 'Nope' }))
      .rejects.toThrow('can only update draft or planning');
  });

  it('rejects updates for accomplished campaigns', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'accomplished' });
    await expect(updateCampaign(campaign.id, { name: 'Nope' }))
      .rejects.toThrow('can only update draft or planning');
  });

  it('throws for non-existent campaign', async () => {
    await expect(updateCampaign('nonexistent', { name: 'Nope' }))
      .rejects.toThrow('not found');
  });
});

describe('deleteCampaign', () => {
  it('deletes a draft campaign and its plan data', async () => {
    const { campaign, phase, mission } = createLaunchableCampaign('draft');

    await deleteCampaign(campaign.id);

    expect(testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get()).toBeUndefined();
    expect(testDb.select().from(phases).where(eq(phases.id, phase.id)).get()).toBeUndefined();
    expect(testDb.select().from(missions).where(eq(missions.id, mission.id)).get()).toBeUndefined();
  });

  it('calls redirect after deletion', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'draft' });
    await deleteCampaign(campaign.id);
    expect(mockRedirect).toHaveBeenCalledWith(`/battlefields/${battlefieldId}/campaigns`);
  });

  it('rejects deletion of active campaigns', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await expect(deleteCampaign(campaign.id))
      .rejects.toThrow('can only delete draft or planning');
  });

  it('rejects deletion of accomplished campaigns', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'accomplished' });
    await expect(deleteCampaign(campaign.id))
      .rejects.toThrow('can only delete draft or planning');
  });
});

describe('backToDraft', () => {
  it('transitions planning campaign to draft', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    await backToDraft(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('draft');
  });

  it('rejects if campaign is not in planning', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'draft' });
    await expect(backToDraft(campaign.id))
      .rejects.toThrow('can only go back to draft from planning');
  });

  it('rejects for active campaigns', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await expect(backToDraft(campaign.id))
      .rejects.toThrow('can only go back to draft from planning');
  });
});

describe('updateBattlePlan', () => {
  it('replaces phases and missions from PlanJSON', async () => {
    const asset = createTestAsset(testDb, { codename: 'TESTER' });
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    // Create an old phase to be replaced
    createTestPhase(testDb, { campaignId: campaign.id, name: 'Old Phase' });

    const plan = createPlanJSON();
    await updateBattlePlan(campaign.id, plan);

    const campaignPhases = testDb.select().from(phases).where(eq(phases.campaignId, campaign.id)).all();
    expect(campaignPhases).toHaveLength(1);
    expect(campaignPhases[0].name).toBe('Phase 1');

    const phaseMissions = testDb.select().from(missions).where(eq(missions.phaseId, campaignPhases[0].id)).all();
    expect(phaseMissions).toHaveLength(1);
    expect(phaseMissions[0].title).toBe('Mission 1');
    expect(phaseMissions[0].assetId).toBe(asset.id);
  });

  it('creates intel notes for each mission', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    await updateBattlePlan(campaign.id, createPlanJSON());

    const notes = testDb.select().from(intelNotes).where(eq(intelNotes.campaignId, campaign.id)).all();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Mission 1');
    expect(notes[0].column).toBe('backlog');
  });

  it('rejects if campaign is not in planning status', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'draft' });
    await expect(updateBattlePlan(campaign.id, createPlanJSON()))
      .rejects.toThrow('can only update plan for planning campaigns');
  });

  it('handles multi-phase plans', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    const plan: PlanJSON = {
      summary: 'Multi-phase plan',
      phases: [
        {
          name: 'Phase A',
          objective: 'First',
          missions: [
            { title: 'M1', briefing: 'B1', assetCodename: 'NONE', priority: 'normal' },
          ],
        },
        {
          name: 'Phase B',
          objective: 'Second',
          missions: [
            { title: 'M2', briefing: 'B2', assetCodename: 'NONE', priority: 'high' },
            { title: 'M3', briefing: 'B3', assetCodename: 'NONE', priority: 'critical' },
          ],
        },
      ],
    };

    await updateBattlePlan(campaign.id, plan);

    const allPhases = testDb.select().from(phases).where(eq(phases.campaignId, campaign.id)).all();
    expect(allPhases).toHaveLength(2);

    const allMissions = testDb.select().from(missions).where(eq(missions.campaignId, campaign.id)).all();
    expect(allMissions).toHaveLength(3);
  });
});

describe('launchCampaign', () => {
  it('activates a campaign with valid phases and missions', async () => {
    const { campaign } = createLaunchableCampaign('planning');
    await launchCampaign(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('active');
    expect(row!.currentPhase).toBe(1);
  });

  it('calls orchestrator.startCampaign', async () => {
    const { campaign } = createLaunchableCampaign('planning');
    await launchCampaign(campaign.id);
    expect(mockOrchestrator.startCampaign).toHaveBeenCalledWith(campaign.id);
  });

  it('rejects launch with no phases', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    await expect(launchCampaign(campaign.id))
      .rejects.toThrow('campaign has no phases');
  });

  it('rejects launch with empty phase (no missions)', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    createTestPhase(testDb, { campaignId: campaign.id, name: 'Empty Phase' });
    await expect(launchCampaign(campaign.id))
      .rejects.toThrow('has no missions');
  });

  it('rejects launch with invalid dependsOn references', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Mission A',
      dependsOn: JSON.stringify(['Nonexistent Mission']),
    });
    await expect(launchCampaign(campaign.id))
      .rejects.toThrow("doesn't exist in phase");
  });

  it('accepts valid dependsOn references', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Mission A',
    });
    createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Mission B',
      dependsOn: JSON.stringify(['Mission A']),
    });

    await launchCampaign(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('active');
  });
});

describe('completeCampaign', () => {
  it('marks campaign as accomplished', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await completeCampaign(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('accomplished');
  });

  it('throws for non-existent campaign', async () => {
    await expect(completeCampaign('nonexistent')).rejects.toThrow('not found');
  });
});

describe('abandonCampaign', () => {
  it('sets campaign status to abandoned', async () => {
    const { campaign } = createLaunchableCampaign('active');
    await abandonCampaign(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('abandoned');
  });

  it('aborts via orchestrator', async () => {
    const { campaign } = createLaunchableCampaign('active');
    await abandonCampaign(campaign.id);
    expect(mockOrchestrator.abortCampaign).toHaveBeenCalledWith(campaign.id);
  });

  it('sets non-terminal missions to abandoned', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    const m1 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      status: 'standby',
      title: 'Standby Mission',
    });
    const m2 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      status: 'in_combat',
      title: 'Running Mission',
    });
    const m3 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      status: 'accomplished',
      title: 'Done Mission',
    });

    await abandonCampaign(campaign.id);

    expect(testDb.select().from(missions).where(eq(missions.id, m1.id)).get()!.status).toBe('abandoned');
    expect(testDb.select().from(missions).where(eq(missions.id, m2.id)).get()!.status).toBe('abandoned');
    // Already-terminal missions should not change
    expect(testDb.select().from(missions).where(eq(missions.id, m3.id)).get()!.status).toBe('accomplished');
  });

  it('sets non-terminal phases to compromised', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    const p1 = createTestPhase(testDb, { campaignId: campaign.id, phaseNumber: 1, status: 'active' });
    const p2 = createTestPhase(testDb, { campaignId: campaign.id, phaseNumber: 2, status: 'standby' });
    const p3 = createTestPhase(testDb, { campaignId: campaign.id, phaseNumber: 3, status: 'secured' });
    // Add missions so phase data is valid
    createTestMission(testDb, { battlefieldId, campaignId: campaign.id, phaseId: p1.id });
    createTestMission(testDb, { battlefieldId, campaignId: campaign.id, phaseId: p2.id });
    createTestMission(testDb, { battlefieldId, campaignId: campaign.id, phaseId: p3.id });

    await abandonCampaign(campaign.id);

    expect(testDb.select().from(phases).where(eq(phases.id, p1.id)).get()!.status).toBe('compromised');
    expect(testDb.select().from(phases).where(eq(phases.id, p2.id)).get()!.status).toBe('compromised');
    // Already-terminal phases should not change
    expect(testDb.select().from(phases).where(eq(phases.id, p3.id)).get()!.status).toBe('secured');
  });
});

describe('redeployCampaign', () => {
  it('clones campaign into a new planning campaign', async () => {
    const { campaign, phase, mission } = createLaunchableCampaign('accomplished');

    const cloned = await redeployCampaign(campaign.id);
    expect(cloned.status).toBe('planning');
    expect(cloned.name).toBe(campaign.name);
    expect(cloned.objective).toBe(campaign.objective);
    expect(cloned.templateId).toBe(campaign.id);
    expect(cloned.id).not.toBe(campaign.id);
  });

  it('clones phases and missions', async () => {
    const { campaign } = createLaunchableCampaign('accomplished');

    const cloned = await redeployCampaign(campaign.id);

    const clonedPhases = testDb.select().from(phases).where(eq(phases.campaignId, cloned.id)).all();
    expect(clonedPhases).toHaveLength(1);
    expect(clonedPhases[0].status).toBe('standby');

    const clonedMissions = testDb.select().from(missions).where(eq(missions.campaignId, cloned.id)).all();
    expect(clonedMissions).toHaveLength(1);
    expect(clonedMissions[0].status).toBe('standby');
  });

  it('creates intel notes for cloned missions', async () => {
    const { campaign } = createLaunchableCampaign('accomplished');
    const cloned = await redeployCampaign(campaign.id);

    const notes = testDb.select().from(intelNotes).where(eq(intelNotes.campaignId, cloned.id)).all();
    expect(notes).toHaveLength(1);
  });
});

describe('saveAsTemplate', () => {
  it('marks accomplished campaign as template', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'accomplished' });
    await saveAsTemplate(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.isTemplate).toBe(1);
  });

  it('allows saving planning campaign as template', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'planning' });
    await saveAsTemplate(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.isTemplate).toBe(1);
  });

  it('rejects saving draft campaign as template', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'draft' });
    await expect(saveAsTemplate(campaign.id))
      .rejects.toThrow('can only save accomplished or planning campaigns as templates');
  });

  it('rejects saving active campaign as template', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await expect(saveAsTemplate(campaign.id))
      .rejects.toThrow('can only save accomplished or planning campaigns as templates');
  });
});

describe('runTemplate', () => {
  it('creates new campaign from template', async () => {
    const template = createTestCampaign(testDb, {
      battlefieldId,
      name: 'Template Op',
      status: 'accomplished',
      isTemplate: 1,
    });
    const phase = createTestPhase(testDb, { campaignId: template.id });
    createTestMission(testDb, { battlefieldId, campaignId: template.id, phaseId: phase.id });

    const result = await runTemplate(template.id);
    expect(result.name).toBe('Template Op (from template)');
    expect(result.status).toBe('planning');
    expect(result.templateId).toBe(template.id);
    expect(result.isTemplate).toBe(0);
  });

  it('clones phases and missions from template', async () => {
    const template = createTestCampaign(testDb, {
      battlefieldId,
      status: 'accomplished',
      isTemplate: 1,
    });
    const phase = createTestPhase(testDb, { campaignId: template.id });
    createTestMission(testDb, { battlefieldId, campaignId: template.id, phaseId: phase.id, title: 'Template Mission' });

    const result = await runTemplate(template.id);

    const clonedMissions = testDb.select().from(missions).where(eq(missions.campaignId, result.id)).all();
    expect(clonedMissions).toHaveLength(1);
    expect(clonedMissions[0].title).toBe('Template Mission');
    expect(clonedMissions[0].status).toBe('standby');
  });

  it('rejects if campaign is not a template', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, isTemplate: 0 });
    await expect(runTemplate(campaign.id)).rejects.toThrow('is not a template');
  });
});

describe('listTemplates', () => {
  it('returns only template campaigns for battlefield', async () => {
    createTestCampaign(testDb, { battlefieldId, name: 'Regular', isTemplate: 0 });
    createTestCampaign(testDb, { battlefieldId, name: 'Template', isTemplate: 1 });

    const result = await listTemplates(battlefieldId);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Template');
  });

  it('returns empty array when no templates', async () => {
    const result = await listTemplates(battlefieldId);
    expect(result).toEqual([]);
  });
});

describe('resumeCampaign', () => {
  it('resumes a paused campaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'paused' });
    await resumeCampaign(campaign.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('active');
  });

  it('calls orchestrator.resumeCampaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'paused' });
    await resumeCampaign(campaign.id);
    expect(mockOrchestrator.resumeCampaign).toHaveBeenCalledWith(campaign.id);
  });

  it('rejects if campaign is not paused', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await expect(resumeCampaign(campaign.id))
      .rejects.toThrow('campaign must be paused to resume');
  });

  it('rejects for draft campaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'draft' });
    await expect(resumeCampaign(campaign.id))
      .rejects.toThrow('campaign must be paused to resume');
  });
});

describe('skipAndContinueCampaign', () => {
  it('calls orchestrator.skipAndContinueCampaign for paused campaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'paused' });
    await skipAndContinueCampaign(campaign.id);
    expect(mockOrchestrator.skipAndContinueCampaign).toHaveBeenCalledWith(campaign.id);
  });

  it('rejects if campaign is not paused', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    await expect(skipAndContinueCampaign(campaign.id))
      .rejects.toThrow('campaign must be paused to skip');
  });
});

describe('tacticalOverride', () => {
  it('requeues a compromised mission with new briefing', async () => {
    const mission = createTestMission(testDb, {
      battlefieldId,
      status: 'compromised',
      title: 'Failed Mission',
    });

    await tacticalOverride(mission.id, 'New approach: try harder');

    const row = testDb.select().from(missions).where(eq(missions.id, mission.id)).get();
    expect(row!.status).toBe('queued');
    expect(row!.briefing).toBe('New approach: try harder');
    expect(row!.sessionId).toBeNull();
    expect(row!.debrief).toBeNull();
    expect(row!.reviewAttempts).toBe(0);
  });

  it('works on abandoned missions', async () => {
    const mission = createTestMission(testDb, {
      battlefieldId,
      status: 'abandoned',
    });

    await tacticalOverride(mission.id, 'Retry briefing');

    const row = testDb.select().from(missions).where(eq(missions.id, mission.id)).get();
    expect(row!.status).toBe('queued');
  });

  it('calls orchestrator.onMissionQueued', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'compromised' });
    await tacticalOverride(mission.id, 'New briefing');
    expect(mockOrchestrator.onMissionQueued).toHaveBeenCalledWith(mission.id);
  });

  it('reactivates parent campaign if present', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'paused' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    const mission = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      status: 'compromised',
    });

    await tacticalOverride(mission.id, 'Retry');

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('active');
  });

  it('rejects for standby missions', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'standby' });
    await expect(tacticalOverride(mission.id, 'Nope'))
      .rejects.toThrow('can only override compromised or abandoned missions');
  });

  it('rejects for accomplished missions', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'accomplished' });
    await expect(tacticalOverride(mission.id, 'Nope'))
      .rejects.toThrow('can only override compromised or abandoned missions');
  });
});

describe('commanderOverride', () => {
  it('marks compromised mission as accomplished', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'compromised' });
    await commanderOverride(mission.id);

    const row = testDb.select().from(missions).where(eq(missions.id, mission.id)).get();
    expect(row!.status).toBe('accomplished');
    expect(row!.completedAt).toBeDefined();
  });

  it('emits socket event', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'compromised' });
    await commanderOverride(mission.id);

    expect(mockTo).toHaveBeenCalledWith(`mission:${mission.id}`);
    expect(mockEmit).toHaveBeenCalledWith('mission:status', expect.objectContaining({
      missionId: mission.id,
      status: 'accomplished',
    }));
  });

  it('reactivates parent campaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'paused' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    const mission = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      status: 'compromised',
    });

    await commanderOverride(mission.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('active');
  });

  it('rejects for non-compromised missions', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'standby' });
    await expect(commanderOverride(mission.id))
      .rejects.toThrow('can only override compromised missions');
  });

  it('rejects for abandoned missions', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'abandoned' });
    await expect(commanderOverride(mission.id))
      .rejects.toThrow('can only override compromised missions');
  });
});

describe('skipMission', () => {
  it('marks compromised mission as abandoned', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'compromised' });
    await skipMission(mission.id);

    const row = testDb.select().from(missions).where(eq(missions.id, mission.id)).get();
    expect(row!.status).toBe('abandoned');
    expect(row!.completedAt).toBeDefined();
  });

  it('cascade-abandons dependent missions', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });

    const m1 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Root Mission',
      status: 'compromised',
    });
    const m2 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Child Mission',
      status: 'standby',
      dependsOn: JSON.stringify(['Root Mission']),
    });
    const m3 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Grandchild Mission',
      status: 'standby',
      dependsOn: JSON.stringify(['Child Mission']),
    });

    await skipMission(m1.id);

    expect(testDb.select().from(missions).where(eq(missions.id, m1.id)).get()!.status).toBe('abandoned');
    expect(testDb.select().from(missions).where(eq(missions.id, m2.id)).get()!.status).toBe('abandoned');
    expect(testDb.select().from(missions).where(eq(missions.id, m3.id)).get()!.status).toBe('abandoned');
  });

  it('does not abandon non-standby dependent missions', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'active' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });

    const m1 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Root',
      status: 'compromised',
    });
    const m2 = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      title: 'Already Done',
      status: 'accomplished',
      dependsOn: JSON.stringify(['Root']),
    });

    await skipMission(m1.id);

    // Already-accomplished mission should not be cascade-abandoned
    expect(testDb.select().from(missions).where(eq(missions.id, m2.id)).get()!.status).toBe('accomplished');
  });

  it('rejects for non-compromised missions', async () => {
    const mission = createTestMission(testDb, { battlefieldId, status: 'standby' });
    await expect(skipMission(mission.id))
      .rejects.toThrow('can only skip compromised missions');
  });

  it('reactivates parent campaign', async () => {
    const campaign = createTestCampaign(testDb, { battlefieldId, status: 'paused' });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    const mission = createTestMission(testDb, {
      battlefieldId,
      campaignId: campaign.id,
      phaseId: phase.id,
      status: 'compromised',
    });

    await skipMission(mission.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
    expect(row!.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle integration test
// ---------------------------------------------------------------------------
describe('full campaign lifecycle', () => {
  it('create → plan → launch → complete', async () => {
    // 1. Create
    const created = await createCampaign(battlefieldId, 'Lifecycle Op', 'End to end');
    expect(created.status).toBe('draft');

    // 2. Update to planning manually (simulating briefing completion)
    testDb.update(campaigns).set({ status: 'planning' }).where(eq(campaigns.id, created.id)).run();

    // 3. Set battle plan
    createTestAsset(testDb, { codename: 'LIFECYCLE' });
    const plan: PlanJSON = {
      summary: 'Lifecycle test',
      phases: [{
        name: 'Only Phase',
        objective: 'Do it all',
        missions: [{
          title: 'Only Mission',
          briefing: 'Execute the lifecycle',
          assetCodename: 'LIFECYCLE',
          priority: 'high',
        }],
      }],
    };
    await updateBattlePlan(created.id, plan);

    // Verify plan was set
    const withPlan = await getCampaign(created.id);
    expect(withPlan!.phases).toHaveLength(1);
    expect(withPlan!.phases[0].missions).toHaveLength(1);

    // 4. Launch
    await launchCampaign(created.id);
    const launched = testDb.select().from(campaigns).where(eq(campaigns.id, created.id)).get();
    expect(launched!.status).toBe('active');

    // 5. Complete
    await completeCampaign(created.id);
    const completed = testDb.select().from(campaigns).where(eq(campaigns.id, created.id)).get();
    expect(completed!.status).toBe('accomplished');
  });

  it('create → plan → launch → abandon', async () => {
    const created = await createCampaign(battlefieldId, 'Abort Op', 'Will be abandoned');
    testDb.update(campaigns).set({ status: 'planning' }).where(eq(campaigns.id, created.id)).run();

    const phase = createTestPhase(testDb, { campaignId: created.id });
    createTestMission(testDb, {
      battlefieldId,
      campaignId: created.id,
      phaseId: phase.id,
      title: 'Will Abandon',
    });

    await launchCampaign(created.id);
    await abandonCampaign(created.id);

    const row = testDb.select().from(campaigns).where(eq(campaigns.id, created.id)).get();
    expect(row!.status).toBe('abandoned');
  });

  it('create → plan → launch → complete → redeploy → save as template → run template', async () => {
    // Setup and launch
    const created = await createCampaign(battlefieldId, 'Template Lifecycle', 'Full cycle');
    testDb.update(campaigns).set({ status: 'planning' }).where(eq(campaigns.id, created.id)).run();

    const phase = createTestPhase(testDb, { campaignId: created.id });
    createTestMission(testDb, {
      battlefieldId,
      campaignId: created.id,
      phaseId: phase.id,
      title: 'Template Mission',
    });

    await launchCampaign(created.id);
    await completeCampaign(created.id);

    // Redeploy
    const redeployed = await redeployCampaign(created.id);
    expect(redeployed.status).toBe('planning');

    // Save original as template
    await saveAsTemplate(created.id);
    const templates = await listTemplates(battlefieldId);
    expect(templates).toHaveLength(1);

    // Run template
    const fromTemplate = await runTemplate(created.id);
    expect(fromTemplate.name).toBe('Template Lifecycle (from template)');

    const fromTemplateMissions = testDb.select().from(missions)
      .where(eq(missions.campaignId, fromTemplate.id)).all();
    expect(fromTemplateMissions).toHaveLength(1);
    expect(fromTemplateMissions[0].title).toBe('Template Mission');
  });
});
