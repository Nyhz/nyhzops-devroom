'use server';

import { eq, inArray } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import { revalidatePath } from 'next/cache';
import type { PlanJSON } from '@/types';
import { revalidateCampaignPaths } from './campaign';

// ---------------------------------------------------------------------------
// cloneCampaignPlan
// ---------------------------------------------------------------------------

/**
 * Clone all phases and missions from one campaign to another.
 * Used by redeployCampaign and runTemplate.
 */
export function cloneCampaignPlan(
  sourceCampaignId: string,
  targetCampaignId: string,
  targetBattlefieldId: string,
) {
  const db = getDatabase();
  const now = Date.now();

  const originalPhases = db
    .select()
    .from(phases)
    .where(eq(phases.campaignId, sourceCampaignId))
    .orderBy(phases.phaseNumber)
    .all();

  for (const originalPhase of originalPhases) {
    const newPhaseId = generateId();

    db.insert(phases).values({
      id: newPhaseId,
      campaignId: targetCampaignId,
      phaseNumber: originalPhase.phaseNumber,
      name: originalPhase.name,
      objective: originalPhase.objective,
      status: 'standby',
      createdAt: now,
    }).run();

    const originalMissions = db
      .select()
      .from(missions)
      .where(eq(missions.phaseId, originalPhase.id))
      .all();

    for (const originalMission of originalMissions) {
      const newMissionId = generateId();

      db.insert(missions).values({
        id: newMissionId,
        battlefieldId: targetBattlefieldId,
        campaignId: targetCampaignId,
        phaseId: newPhaseId,
        type: originalMission.type,
        title: originalMission.title,
        briefing: originalMission.briefing,
        status: 'standby',
        priority: originalMission.priority,
        assetId: originalMission.assetId,
        dependsOn: originalMission.dependsOn ?? null,
        createdAt: now,
        updatedAt: now,
      }).run();

      db.insert(intelNotes)
        .values({
          id: generateId(),
          battlefieldId: targetBattlefieldId,
          title: originalMission.title,
          description: null,
          missionId: newMissionId,
          campaignId: targetCampaignId,
          column: 'backlog',
          position: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}

// ---------------------------------------------------------------------------
// insertPlanFromJSON
// ---------------------------------------------------------------------------

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
        dependsOn: planMission.dependsOn && planMission.dependsOn.length > 0
          ? JSON.stringify(planMission.dependsOn)
          : null,
        createdAt: now,
        updatedAt: now,
      }).run();

      db.insert(intelNotes)
        .values({
          id: generateId(),
          battlefieldId,
          title: planMission.title,
          description: null,
          missionId,
          campaignId,
          column: 'backlog',
          position: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}

// ---------------------------------------------------------------------------
// deletePlanData
// ---------------------------------------------------------------------------

/**
 * Delete all phases and missions (and their logs) for a campaign.
 * Must be called within a transaction or standalone.
 */
export function deletePlanData(campaignId: string) {
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

    // FK-safe cascade: logs → intel notes → missions → phases
    if (missionIds.length > 0) {
      db.delete(missionLogs)
        .where(inArray(missionLogs.missionId, missionIds))
        .run();
      db.delete(intelNotes)
        .where(inArray(intelNotes.missionId, missionIds))
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
// updateBattlePlan
// ---------------------------------------------------------------------------

export async function updateBattlePlan(
  campaignId: string,
  plan: PlanJSON,
): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, campaignId, 'updateBattlePlan');
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
// backToDraft
// ---------------------------------------------------------------------------

export async function backToDraft(campaignId: string): Promise<void> {
  const db = getDatabase();
  const campaign = getOrThrow(campaigns, campaignId, 'backToDraft');
  if (campaign.status !== 'planning') throw new Error('backToDraft: can only go back to draft from planning');

  db.update(campaigns).set({
    status: 'draft',
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();

  emitStatusChange('campaign', campaignId, 'draft');
  revalidatePath(`/battlefields/${campaign.battlefieldId}/campaigns/${campaignId}`);
}
