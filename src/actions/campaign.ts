'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns, phases, missions, missionLogs, assets, battlefields, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
import type { Campaign, CampaignWithPlan, PlanJSON } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * If a campaign exists and isn't active, move it back to active.
 */
function reactivateCampaignIfNeeded(campaignId: string) {
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
async function notifyCampaignExecutor(campaignId: string, missionId: string) {
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

function revalidateCampaignPaths(battlefieldId: string, campaignId?: string) {
  revalidatePath(`/battlefields/${battlefieldId}/campaigns`);
  if (campaignId) {
    revalidatePath(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
  }
}

/**
 * Clone all phases and missions from one campaign to another.
 * Used by redeployCampaign and runTemplate.
 */
function cloneCampaignPlan(
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

/**
 * Shared helper: insert phases and missions from a PlanJSON structure.
 * Used by both generateBattlePlan (Task 3) and updateBattlePlan.
 */
function insertPlanFromJSON(
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
// 1. createCampaign
// ---------------------------------------------------------------------------

export async function createCampaign(
  battlefieldId: string,
  name: string,
  objective: string,
): Promise<Campaign> {
  const db = getDatabase();

  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
  if (!battlefield) throw new Error('Battlefield not found');

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
        dependsOn: missions.dependsOn,
        sessionId: missions.sessionId,
        debrief: missions.debrief,
        iterations: missions.iterations,
        costInput: missions.costInput,
        costOutput: missions.costOutput,
        costCacheHit: missions.costCacheHit,
        reviewAttempts: missions.reviewAttempts,
        compromiseReason: missions.compromiseReason,
        mergeRetryAt: missions.mergeRetryAt,
        skillOverrides: missions.skillOverrides,
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

  const campaign = getOrThrow(campaigns, id, 'updateCampaign');
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

  const campaign = getOrThrow(campaigns, id, 'deleteCampaign');
  if (campaign.status !== 'draft' && campaign.status !== 'planning') {
    throw new Error(
      `deleteCampaign: can only delete draft or planning campaigns (current: ${campaign.status})`,
    );
  }

  const battlefieldId = campaign.battlefieldId;

  // FK-safe cascade: briefing → intel notes → logs → missions → phases → campaign
  const { deleteBriefingData } = await import('@/lib/briefing/briefing-engine');
  deleteBriefingData(id);
  db.delete(intelNotes).where(eq(intelNotes.campaignId, id)).run();
  deletePlanData(id);
  db.delete(campaigns).where(eq(campaigns.id, id)).run();

  revalidateCampaignPaths(battlefieldId);
  redirect(`/battlefields/${battlefieldId}/campaigns`);
}

// ---------------------------------------------------------------------------
// 6. backToDraft
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

// ---------------------------------------------------------------------------
// 7. updateBattlePlan
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
// 8. launchCampaign
// ---------------------------------------------------------------------------

export async function launchCampaign(
  campaignId: string,
): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, campaignId, 'launchCampaign');

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
      .select({ id: missions.id, title: missions.title, dependsOn: missions.dependsOn })
      .from(missions)
      .where(eq(missions.phaseId, phase.id))
      .all();

    if (phaseMissions.length === 0) {
      throw new Error(
        `launchCampaign: phase "${phase.name}" (${phase.id}) has no missions`,
      );
    }

    // Validate dependsOn references
    const titleSet = new Set(phaseMissions.map((m) => m.title));
    for (const mission of phaseMissions) {
      if (mission.dependsOn) {
        const deps = JSON.parse(mission.dependsOn) as string[];
        for (const dep of deps) {
          if (!titleSet.has(dep)) {
            throw new Error(
              `launchCampaign: mission "${mission.title}" depends on "${dep}" which doesn't exist in phase "${phase.name}"`,
            );
          }
        }
      }
    }
  }

  const { deleteBriefingData } = await import('@/lib/briefing/briefing-engine');

  db.transaction(() => {
    db.update(campaigns)
      .set({
        status: 'active',
        currentPhase: 1,
        updatedAt: Date.now(),
      })
      .where(eq(campaigns.id, campaignId))
      .run();

    // Delete briefing data — no longer needed once campaign is live
    deleteBriefingData(campaignId);

    // Replace original backlog notes with mission-linked notes.
    // The original notes (selected from the intel board) no longer match the actual
    // missions after planning with GENERAL. Delete them and create new notes that
    // track real mission status on the board.
    db.delete(intelNotes).where(eq(intelNotes.campaignId, campaignId)).run();

    // Create a note for each mission in the campaign
    const now = Date.now();
    const allCampaignMissions = db.select().from(missions)
      .where(eq(missions.campaignId, campaignId)).all();
    for (const m of allCampaignMissions) {
      db.insert(intelNotes).values({
        id: generateId(),
        battlefieldId: campaign.battlefieldId,
        title: m.title,
        description: m.briefing,
        column: 'planned',
        missionId: m.id,
        campaignId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  });

  emitStatusChange('campaign', campaignId, 'active');

  // Trigger orchestrator to begin campaign execution — outside transaction
  globalThis.orchestrator?.startCampaign(campaignId);

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 9. completeCampaign
// ---------------------------------------------------------------------------

export async function completeCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, id, 'completeCampaign');

  db.update(campaigns)
    .set({
      status: 'accomplished',
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, id))
    .run();

  emitStatusChange('campaign', id, 'accomplished');
  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 10. abandonCampaign
// ---------------------------------------------------------------------------

export async function abandonCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, id, 'abandonCampaign');

  // Abort all running missions via orchestrator
  globalThis.orchestrator?.abortCampaign(id);

  const now = Date.now();

  db.transaction(() => {
    // Set all non-terminal missions to abandoned
    db.update(missions)
      .set({ status: 'abandoned', updatedAt: now })
      .where(
        and(
          eq(missions.campaignId, id),
          inArray(missions.status, ['standby', 'queued', 'deploying', 'in_combat']),
        ),
      )
      .run();

    // Set all non-terminal phases to compromised
    const campaignPhases = db
      .select({ id: phases.id })
      .from(phases)
      .where(eq(phases.campaignId, id))
      .all();

    const phaseIds = campaignPhases.map((p) => p.id);
    if (phaseIds.length > 0) {
      db.update(phases)
        .set({ status: 'compromised' })
        .where(
          and(
            inArray(phases.id, phaseIds),
            inArray(phases.status, ['standby', 'active']),
          ),
        )
        .run();
    }

    db.update(campaigns)
      .set({
        status: 'abandoned',
        updatedAt: now,
      })
      .where(eq(campaigns.id, id))
      .run();
  });

  emitStatusChange('campaign', id, 'abandoned');
  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 11. redeployCampaign
// ---------------------------------------------------------------------------

export async function redeployCampaign(id: string): Promise<Campaign> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, id, 'redeployCampaign');

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

  cloneCampaignPlan(id, newCampaignId, campaign.battlefieldId);

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

// ---------------------------------------------------------------------------
// 12. saveAsTemplate
// ---------------------------------------------------------------------------

export async function saveAsTemplate(campaignId: string): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, campaignId, 'saveAsTemplate');
  if (campaign.status !== 'accomplished' && campaign.status !== 'planning') {
    throw new Error(
      `saveAsTemplate: can only save accomplished or planning campaigns as templates (current: ${campaign.status})`,
    );
  }

  db.update(campaigns)
    .set({ isTemplate: 1, updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 13. runTemplate
// ---------------------------------------------------------------------------

export async function runTemplate(templateId: string): Promise<Campaign> {
  const db = getDatabase();

  const template = getOrThrow(campaigns, templateId, 'runTemplate');
  if (!template.isTemplate) {
    throw new Error(`runTemplate: campaign ${templateId} is not a template`);
  }

  const now = Date.now();
  const newCampaignId = generateId();

  // Clone campaign from template
  db.insert(campaigns).values({
    id: newCampaignId,
    battlefieldId: template.battlefieldId,
    name: `${template.name} (from template)`,
    objective: template.objective,
    status: 'planning',
    worktreeMode: template.worktreeMode,
    currentPhase: 0,
    isTemplate: 0,
    templateId: template.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  cloneCampaignPlan(templateId, newCampaignId, template.battlefieldId);

  const newCampaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, newCampaignId))
    .get();

  if (!newCampaign) {
    throw new Error(`runTemplate: failed to retrieve cloned campaign ${newCampaignId}`);
  }

  revalidateCampaignPaths(template.battlefieldId, newCampaignId);
  return newCampaign;
}

// ---------------------------------------------------------------------------
// 14. listTemplates
// ---------------------------------------------------------------------------

export async function listTemplates(battlefieldId: string): Promise<Campaign[]> {
  const db = getDatabase();

  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.battlefieldId, battlefieldId), eq(campaigns.isTemplate, 1)))
    .orderBy(desc(campaigns.updatedAt))
    .all();
}

// ---------------------------------------------------------------------------
// 15. resumeCampaign
// ---------------------------------------------------------------------------

export async function resumeCampaign(campaignId: string): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, campaignId, 'resumeCampaign');
  if (campaign.status !== 'paused') {
    throw new Error(
      `resumeCampaign: campaign must be paused to resume (current: ${campaign.status})`,
    );
  }

  db.update(campaigns)
    .set({ status: 'active', updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId))
    .run();

  emitStatusChange('campaign', campaignId, 'active');
  globalThis.orchestrator?.resumeCampaign(campaignId);

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 16. skipAndContinueCampaign
// ---------------------------------------------------------------------------

export async function skipAndContinueCampaign(
  campaignId: string,
): Promise<void> {
  const campaign = getOrThrow(campaigns, campaignId, 'skipAndContinueCampaign');
  if (campaign.status !== 'paused') {
    throw new Error(
      `skipAndContinueCampaign: campaign must be paused to skip (current: ${campaign.status})`,
    );
  }

  globalThis.orchestrator?.skipAndContinueCampaign(campaignId);

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 17. tacticalOverride
// ---------------------------------------------------------------------------

export async function tacticalOverride(
  missionId: string,
  newBriefing: string,
): Promise<void> {
  const db = getDatabase();
  const mission = getOrThrow(missions, missionId, 'tacticalOverride');
  if (mission.status !== 'compromised' && mission.status !== 'abandoned') throw new Error('tacticalOverride: can only override compromised or abandoned missions');

  const now = Date.now();

  db.update(missions).set({
    briefing: newBriefing,
    status: 'queued',
    sessionId: null,
    debrief: null,
    reviewAttempts: 0,
    completedAt: null,
    startedAt: null,
    updatedAt: now,
  }).where(eq(missions.id, missionId)).run();

  if (mission.campaignId) {
    reactivateCampaignIfNeeded(mission.campaignId);
  }

  emitStatusChange('mission', missionId, 'queued');
  revalidatePath(`/battlefields/${mission.battlefieldId}`);
  safeQueueMission(missionId);
}

// ---------------------------------------------------------------------------
// 18. commanderOverride — Commander approves a compromised mission, overriding Overseer
// ---------------------------------------------------------------------------

export async function commanderOverride(missionId: string): Promise<void> {
  const db = getDatabase();
  const mission = getOrThrow(missions, missionId, 'commanderOverride');
  if (mission.status !== 'compromised') throw new Error('commanderOverride: can only override compromised missions');

  const now = Date.now();

  db.update(missions).set({
    status: 'accomplished',
    completedAt: now,
    updatedAt: now,
  }).where(eq(missions.id, missionId)).run();

  if (mission.campaignId) {
    reactivateCampaignIfNeeded(mission.campaignId);
    await notifyCampaignExecutor(mission.campaignId, missionId);
  }

  emitStatusChange('mission', missionId, 'accomplished');
  revalidatePath(`/battlefields/${mission.battlefieldId}`);
}

// ---------------------------------------------------------------------------
// 19. skipMission
// ---------------------------------------------------------------------------

export async function skipMission(missionId: string): Promise<void> {
  const db = getDatabase();
  const mission = getOrThrow(missions, missionId, 'skipMission');
  if (mission.status !== 'compromised') throw new Error('skipMission: can only skip compromised missions');

  const now = Date.now();

  db.transaction(() => {
    db.update(missions).set({
      status: 'abandoned',
      completedAt: now,
      updatedAt: now,
    }).where(eq(missions.id, missionId)).run();

    // Cascade-abandon dependent missions in same phase
    if (mission.phaseId) {
      const phaseMissions = db.select().from(missions)
        .where(eq(missions.phaseId, mission.phaseId)).all();

      const abandonedTitles = new Set<string>([mission.title]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const m of phaseMissions) {
          if (m.status === 'standby' && m.dependsOn) {
            const deps = JSON.parse(m.dependsOn) as string[];
            if (deps.some(d => abandonedTitles.has(d))) {
              db.update(missions).set({
                status: 'abandoned',
                completedAt: now,
                updatedAt: now,
              }).where(eq(missions.id, m.id)).run();
              abandonedTitles.add(m.title);
              m.status = 'abandoned';
              changed = true;
            }
          }
        }
      }
    }
  });

  emitStatusChange('mission', missionId, 'abandoned');

  if (mission.campaignId) {
    reactivateCampaignIfNeeded(mission.campaignId);
    if (mission.phaseId) {
      await notifyCampaignExecutor(mission.campaignId, missionId);
    }
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}`);
}

// ---------------------------------------------------------------------------
// retryPhaseDebrief — Retry debrief generation for a stalled campaign
// ---------------------------------------------------------------------------

export async function retryPhaseDebrief(campaignId: string): Promise<void> {
  const db = getDatabase();
  const campaign = getOrThrow(campaigns, campaignId, 'retryPhaseDebrief');

  if (campaign.status !== 'paused' || !campaign.stalledPhaseId) {
    throw new Error('Campaign is not stalled');
  }

  // Clear stall state and reactivate
  db.update(campaigns).set({
    status: 'active',
    stallReason: null,
    stalledPhaseId: null,
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();
  emitStatusChange('campaign', campaignId, 'active');

  // Re-trigger generateAndAdvance via the campaign executor
  const executor = globalThis.orchestrator?.activeCampaigns.get(campaignId);
  if (executor) {
    executor.retryGenerateAndAdvance(campaign.stalledPhaseId).catch((err: Error) => {
      console.error('[Campaign] Retry phase debrief failed:', err);
    });
  } else {
    globalThis.orchestrator?.startCampaign(campaignId);
  }

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// updateMissionSkillOverrides — Persist per-mission skill/MCP overrides
// ---------------------------------------------------------------------------

export async function updateMissionSkillOverrides(
  missionId: string,
  overrides: { added?: string[]; removed?: string[] } | null,
): Promise<void> {
  const db = getDatabase();
  db.update(missions).set({
    skillOverrides: overrides ? JSON.stringify(overrides) : null,
    updatedAt: Date.now(),
  }).where(eq(missions.id, missionId)).run();

  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (mission?.battlefieldId) {
    revalidatePath(`/battlefields/${mission.battlefieldId}`);
  }
}

// ---------------------------------------------------------------------------
// skipPhaseDebrief — Skip debrief and advance to next phase
// ---------------------------------------------------------------------------

export async function skipPhaseDebrief(campaignId: string): Promise<void> {
  const db = getDatabase();
  const campaign = getOrThrow(campaigns, campaignId, 'skipPhaseDebrief');

  if (campaign.status !== 'paused' || !campaign.stalledPhaseId) {
    throw new Error('Campaign is not stalled');
  }

  const phaseId = campaign.stalledPhaseId;

  // Write a fallback debrief from mission debriefs
  const phaseMissions = db.select().from(missions)
    .where(eq(missions.phaseId, phaseId)).all();
  const phase = db.select().from(phases)
    .where(eq(phases.id, phaseId)).get();

  if (phase) {
    const fallback = [
      `PHASE DEBRIEF — ${phase.name} (Skipped by Commander)`,
      '',
      ...phaseMissions.map(m =>
        `### ${m.title} (${m.status})\n${m.debrief || 'No debrief available.'}`,
      ),
    ].join('\n\n');

    db.update(phases).set({ debrief: fallback })
      .where(eq(phases.id, phaseId)).run();
  }

  // Clear stall state and reactivate
  db.update(campaigns).set({
    status: 'active',
    stallReason: null,
    stalledPhaseId: null,
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();
  emitStatusChange('campaign', campaignId, 'active');

  // Advance to next phase
  const executor = globalThis.orchestrator?.activeCampaigns.get(campaignId);
  if (executor) {
    executor.retryAdvanceToNextPhase().catch((err: Error) => {
      console.error('[Campaign] Skip + advance failed:', err);
    });
  } else {
    globalThis.orchestrator?.startCampaign(campaignId);
  }

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}
