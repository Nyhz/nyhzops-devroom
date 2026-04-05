import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import type { PlanJSON } from '@/types';

// ---------------------------------------------------------------------------
// Campaign lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * If a campaign exists and isn't active, move it back to active.
 */
export function reactivateCampaignIfNeeded(campaignId: string) {
  const db = getDatabase();
  const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (campaign && campaign.status !== 'active') {
    db.update(campaigns).set({
      status: 'active',
      updatedAt: Date.now(),
    }).where(eq(campaigns.id, campaignId)).run();
    emitStatusChange('campaign', campaignId, 'active');
  }
}

/**
 * Ensure a CampaignExecutor is registered and notify it of mission completion.
 * Auto-registers executor if missing (e.g. after server restart).
 */
export async function notifyCampaignExecutor(campaignId: string, missionId: string) {
  let executor = globalThis.orchestrator?.activeCampaigns.get(campaignId);
  if (!executor && globalThis.orchestrator) {
    const { CampaignExecutor } = await import('@/lib/orchestrator/campaign-executor');
    executor = new CampaignExecutor(campaignId, globalThis.io!);
    globalThis.orchestrator.activeCampaigns.set(campaignId, executor);
  }
  if (executor) {
    executor.onCampaignMissionComplete(missionId).catch(console.error);
  }
}

export function revalidateCampaignPaths(battlefieldId: string, campaignId?: string) {
  revalidatePath(`/battlefields/${battlefieldId}/campaigns`);
  if (campaignId) {
    revalidatePath(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
  }
}

// ---------------------------------------------------------------------------
// Plan data helpers (non-server-action, called from server action files)
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
          column: 'tasked',
          position: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}

/**
 * Shared helper: insert phases and missions from a PlanJSON structure.
 */
export function insertPlanFromJSON(
  campaignId: string,
  battlefieldId: string,
  plan: PlanJSON,
) {
  const db = getDatabase();
  const now = Date.now();

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
        type: 'direct_action',
        title: planMission.title,
        briefing: planMission.briefing,
        status: 'standby',
        priority: planMission.priority || 'routine',
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
          column: 'tasked',
          position: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}

/**
 * Delete all phases and missions (and their logs) for a campaign.
 */
export function deletePlanData(campaignId: string) {
  const db = getDatabase();

  const campaignPhases = db
    .select({ id: phases.id })
    .from(phases)
    .where(eq(phases.campaignId, campaignId))
    .all();
  const phaseIds = campaignPhases.map((p) => p.id);

  if (phaseIds.length > 0) {
    const campaignMissions = db
      .select({ id: missions.id })
      .from(missions)
      .where(inArray(missions.phaseId, phaseIds))
      .all();
    const missionIds = campaignMissions.map((m) => m.id);

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
