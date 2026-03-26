'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets, battlefields } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { generatePlan } from '@/lib/orchestrator/plan-generator';
import type { Campaign, CampaignWithPlan, PlanJSON, Phase, Mission } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function revalidateCampaignPaths(battlefieldId: string, campaignId?: string) {
  revalidatePath(`/projects/${battlefieldId}/campaigns`);
  if (campaignId) {
    revalidatePath(`/projects/${battlefieldId}/campaigns/${campaignId}`);
  }
}

/**
 * Shared helper: insert phases and missions from a PlanJSON structure.
 * Used by both generateBattlePlan (Task 3) and updateBattlePlan.
 */
export function insertPlanFromJSON(
  campaignId: string,
  battlefieldId: string,
  plan: PlanJSON,
) {
  const db = getDatabase();
  const now = Date.now();

  // Pre-fetch all active assets for codename → id lookup
  const allAssets = db.select().from(assets).all();
  const assetByCodename = new Map(allAssets.map((a) => [a.codename, a]));

  for (let i = 0; i < plan.phases.length; i++) {
    const planPhase = plan.phases[i];
    const phaseId = generateId();

    db.insert(phases).values({
      id: phaseId,
      campaignId,
      phaseNumber: i + 1,
      name: planPhase.name,
      objective: planPhase.objective || null,
      status: 'standby',
      createdAt: now,
    }).run();

    for (const planMission of planPhase.missions) {
      const asset = assetByCodename.get(planMission.assetCodename);
      const missionId = generateId();

      db.insert(missions).values({
        id: missionId,
        battlefieldId,
        campaignId,
        phaseId,
        type: 'standard',
        title: planMission.title,
        briefing: planMission.briefing,
        status: 'standby',
        priority: planMission.priority || 'normal',
        assetId: asset?.id ?? null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }
}

/**
 * Delete all phases and missions (and their logs) for a campaign.
 * Must be called within a transaction or standalone.
 */
function deletePlanData(campaignId: string) {
  const db = getDatabase();

  // Get phase IDs
  const campaignPhases = db
    .select({ id: phases.id })
    .from(phases)
    .where(eq(phases.campaignId, campaignId))
    .all();
  const phaseIds = campaignPhases.map((p) => p.id);

  if (phaseIds.length > 0) {
    // Get mission IDs for these phases
    const campaignMissions = db
      .select({ id: missions.id })
      .from(missions)
      .where(inArray(missions.phaseId, phaseIds))
      .all();
    const missionIds = campaignMissions.map((m) => m.id);

    // FK-safe cascade: logs → missions → phases
    if (missionIds.length > 0) {
      db.delete(missionLogs)
        .where(inArray(missionLogs.missionId, missionIds))
        .run();
      db.delete(missions)
        .where(inArray(missions.id, missionIds))
        .run();
    }

    db.delete(phases)
      .where(inArray(phases.id, phaseIds))
      .run();
  }
}

// ---------------------------------------------------------------------------
// 1. createCampaign
// ---------------------------------------------------------------------------

export async function createCampaign(
  battlefieldId: string,
  name: string,
  objective: string,
): Promise<Campaign> {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  db.insert(campaigns).values({
    id,
    battlefieldId,
    name,
    objective,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }).run();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) {
    throw new Error(`createCampaign: failed to retrieve campaign ${id}`);
  }

  revalidateCampaignPaths(battlefieldId, id);
  return campaign;
}

// ---------------------------------------------------------------------------
// 2. getCampaign
// ---------------------------------------------------------------------------

export async function getCampaign(
  id: string,
): Promise<CampaignWithPlan | null> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) return null;

  // Get phases ordered by phaseNumber
  const campaignPhases = db
    .select()
    .from(phases)
    .where(eq(phases.campaignId, id))
    .orderBy(phases.phaseNumber)
    .all();

  // For each phase, get missions with asset codename
  const phasesWithMissions = campaignPhases.map((phase) => {
    const phaseMissions = db
      .select({
        id: missions.id,
        battlefieldId: missions.battlefieldId,
        campaignId: missions.campaignId,
        phaseId: missions.phaseId,
        type: missions.type,
        title: missions.title,
        briefing: missions.briefing,
        status: missions.status,
        priority: missions.priority,
        assetId: missions.assetId,
        useWorktree: missions.useWorktree,
        worktreeBranch: missions.worktreeBranch,
        sessionId: missions.sessionId,
        debrief: missions.debrief,
        iterations: missions.iterations,
        costInput: missions.costInput,
        costOutput: missions.costOutput,
        costCacheHit: missions.costCacheHit,
        durationMs: missions.durationMs,
        startedAt: missions.startedAt,
        completedAt: missions.completedAt,
        createdAt: missions.createdAt,
        updatedAt: missions.updatedAt,
        assetCodename: assets.codename,
      })
      .from(missions)
      .leftJoin(assets, eq(missions.assetId, assets.id))
      .where(eq(missions.phaseId, phase.id))
      .all();

    return {
      ...phase,
      missions: phaseMissions.map((m) => ({
        ...m,
        assetCodename: m.assetCodename ?? null,
      })),
    };
  });

  return {
    ...campaign,
    phases: phasesWithMissions,
  };
}

// ---------------------------------------------------------------------------
// 3. listCampaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(
  battlefieldId: string,
): Promise<Campaign[]> {
  const db = getDatabase();

  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.battlefieldId, battlefieldId))
    .orderBy(desc(campaigns.updatedAt))
    .all();
}

// ---------------------------------------------------------------------------
// 4. updateCampaign
// ---------------------------------------------------------------------------

export async function updateCampaign(
  id: string,
  data: { name?: string; objective?: string },
): Promise<void> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) throw new Error(`updateCampaign: campaign ${id} not found`);
  if (campaign.status !== 'draft' && campaign.status !== 'planning') {
    throw new Error(
      `updateCampaign: can only update draft or planning campaigns (current: ${campaign.status})`,
    );
  }

  db.update(campaigns)
    .set({
      ...data,
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, id))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 5. deleteCampaign
// ---------------------------------------------------------------------------

export async function deleteCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) throw new Error(`deleteCampaign: campaign ${id} not found`);
  if (campaign.status !== 'draft' && campaign.status !== 'planning') {
    throw new Error(
      `deleteCampaign: can only delete draft or planning campaigns (current: ${campaign.status})`,
    );
  }

  // FK-safe cascade: logs → missions → phases → campaign
  deletePlanData(id);
  db.delete(campaigns).where(eq(campaigns.id, id)).run();

  revalidateCampaignPaths(campaign.battlefieldId);
}

// ---------------------------------------------------------------------------
// 6. generateBattlePlan (placeholder — wired in Task 3)
// ---------------------------------------------------------------------------

export async function generateBattlePlan(
  campaignId: string,
): Promise<void> {
  const db = getDatabase();

  const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign) throw new Error(`generateBattlePlan: campaign ${campaignId} not found`);
  if (campaign.status !== 'draft' && campaign.status !== 'planning') {
    throw new Error(
      `generateBattlePlan: can only generate plan for draft or planning campaigns (current: ${campaign.status})`,
    );
  }

  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, campaign.battlefieldId)).get();
  if (!battlefield) throw new Error(`generateBattlePlan: battlefield ${campaign.battlefieldId} not found`);

  const availableAssets = db.select().from(assets).where(eq(assets.status, 'active')).all();

  // Generate plan via Claude Code
  const plan = await generatePlan(campaign, battlefield, availableAssets);

  // Clear existing plan if regenerating
  deletePlanData(campaignId);

  // Insert new phases and missions from generated plan
  insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);

  // Update campaign status to 'planning'
  db.update(campaigns).set({
    status: 'planning',
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 7. updateBattlePlan
// ---------------------------------------------------------------------------

export async function updateBattlePlan(
  campaignId: string,
  plan: PlanJSON,
): Promise<void> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .get();

  if (!campaign) {
    throw new Error(`updateBattlePlan: campaign ${campaignId} not found`);
  }
  if (campaign.status !== 'planning') {
    throw new Error(
      `updateBattlePlan: can only update plan for planning campaigns (current: ${campaign.status})`,
    );
  }

  // Delete existing plan data
  deletePlanData(campaignId);

  // Insert new plan
  insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);

  // Update campaign timestamp
  db.update(campaigns)
    .set({ updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 8. launchCampaign
// ---------------------------------------------------------------------------

export async function launchCampaign(
  campaignId: string,
): Promise<void> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .get();

  if (!campaign) {
    throw new Error(`launchCampaign: campaign ${campaignId} not found`);
  }

  // Validate has phases with missions
  const campaignPhases = db
    .select()
    .from(phases)
    .where(eq(phases.campaignId, campaignId))
    .all();

  if (campaignPhases.length === 0) {
    throw new Error('launchCampaign: campaign has no phases');
  }

  for (const phase of campaignPhases) {
    const phaseMissions = db
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.phaseId, phase.id))
      .all();

    if (phaseMissions.length === 0) {
      throw new Error(
        `launchCampaign: phase "${phase.name}" (${phase.id}) has no missions`,
      );
    }
  }

  db.update(campaigns)
    .set({
      status: 'active',
      currentPhase: 1,
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, campaignId))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 9. completeCampaign
// ---------------------------------------------------------------------------

export async function completeCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) throw new Error(`completeCampaign: campaign ${id} not found`);

  db.update(campaigns)
    .set({
      status: 'accomplished',
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, id))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 10. abandonCampaign
// ---------------------------------------------------------------------------

export async function abandonCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) throw new Error(`abandonCampaign: campaign ${id} not found`);

  db.update(campaigns)
    .set({
      status: 'compromised',
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, id))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 11. redeployCampaign
// ---------------------------------------------------------------------------

export async function redeployCampaign(id: string): Promise<Campaign> {
  const db = getDatabase();

  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .get();

  if (!campaign) throw new Error(`redeployCampaign: campaign ${id} not found`);

  const now = Date.now();
  const newCampaignId = generateId();

  // Clone campaign
  db.insert(campaigns).values({
    id: newCampaignId,
    battlefieldId: campaign.battlefieldId,
    name: campaign.name,
    objective: campaign.objective,
    status: 'planning',
    worktreeMode: campaign.worktreeMode,
    currentPhase: 0,
    isTemplate: 0,
    templateId: campaign.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Clone phases and missions
  const originalPhases = db
    .select()
    .from(phases)
    .where(eq(phases.campaignId, id))
    .orderBy(phases.phaseNumber)
    .all();

  for (const originalPhase of originalPhases) {
    const newPhaseId = generateId();

    db.insert(phases).values({
      id: newPhaseId,
      campaignId: newCampaignId,
      phaseNumber: originalPhase.phaseNumber,
      name: originalPhase.name,
      objective: originalPhase.objective,
      status: 'standby',
      createdAt: now,
    }).run();

    // Clone missions for this phase
    const originalMissions = db
      .select()
      .from(missions)
      .where(eq(missions.phaseId, originalPhase.id))
      .all();

    for (const originalMission of originalMissions) {
      const newMissionId = generateId();

      db.insert(missions).values({
        id: newMissionId,
        battlefieldId: campaign.battlefieldId,
        campaignId: newCampaignId,
        phaseId: newPhaseId,
        type: originalMission.type,
        title: originalMission.title,
        briefing: originalMission.briefing,
        status: 'standby',
        priority: originalMission.priority,
        assetId: originalMission.assetId,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }

  const newCampaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, newCampaignId))
    .get();

  if (!newCampaign) {
    throw new Error(
      `redeployCampaign: failed to retrieve cloned campaign ${newCampaignId}`,
    );
  }

  revalidateCampaignPaths(campaign.battlefieldId, newCampaignId);
  return newCampaign;
}
