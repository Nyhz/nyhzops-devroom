'use server';

import { redirect } from 'next/navigation';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns, phases, missions, assets, battlefields, intelNotes, briefingSessions, briefingMessages } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitComm } from '@/control/comms';
import { emitStatusChange } from '@/lib/socket/emit';
import {
  launchCampaign as executorLaunchCampaign,
  abandonMission as executorAbandonMission,
} from '@/control/campaign/executor';
import type { Campaign, CampaignWithPlan } from '@/types';
import { cloneCampaignPlan, deletePlanData, revalidateCampaignPaths } from './campaign-helpers';

// ---------------------------------------------------------------------------
// deleteBriefingData — inlined from deleted @/lib/briefing/briefing-engine
// ---------------------------------------------------------------------------

function deleteBriefingData(campaignId: string): void {
  const db = getDatabase();
  const sessions = db
    .select({ id: briefingSessions.id })
    .from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId))
    .all();
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    for (const sid of sessionIds) {
      db.delete(briefingMessages)
        .where(eq(briefingMessages.briefingId, sid))
        .run();
    }
    db.delete(briefingSessions)
      .where(eq(briefingSessions.campaignId, campaignId))
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

  emitComm({
    campaignId: id,
    battlefieldId,
    actor: 'CONTROL',
    message: `Campaign "${name}" created — status DRAFT`,
  });

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
        debriefStructured: missions.debriefStructured,
        iterations: missions.iterations,
        costInput: missions.costInput,
        costOutput: missions.costOutput,
        costCacheHit: missions.costCacheHit,
        compromiseReason: missions.compromiseReason,
        nextAttemptAt: missions.nextAttemptAt,
        infrastructureRetryCount: missions.infrastructureRetryCount,
        reconViolatedReadonly: missions.reconViolatedReadonly,
        currentSortieAttempts: missions.currentSortieAttempts,
        mergeResult: missions.mergeResult,
        mergeConflictFiles: missions.mergeConflictFiles,
        mergeTimestamp: missions.mergeTimestamp,
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
  deleteBriefingData(id);
  db.delete(intelNotes).where(eq(intelNotes.campaignId, id)).run();
  deletePlanData(id);
  db.delete(campaigns).where(eq(campaigns.id, id)).run();

  revalidateCampaignPaths(battlefieldId);
  redirect(`/battlefields/${battlefieldId}/campaigns`);
}

// ---------------------------------------------------------------------------
// 6. launchCampaign
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

  db.transaction(() => {
    // Delete briefing data — no longer needed once campaign is live
    deleteBriefingData(campaignId);

    // Replace original backlog notes with mission-linked notes.
    // The original notes (selected from the intel board) no longer match the actual
    // missions after planning with STRATEGIST. Delete them and create new notes that
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
        column: 'ops_ready',
        missionId: m.id,
        campaignId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  });

  // Delegate to executor — transitions campaign draft/planning → active, queues phase 1 missions
  executorLaunchCampaign(campaignId);

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// 7. abandonCampaign
// ---------------------------------------------------------------------------

export async function abandonCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, id, 'abandonCampaign');

  // Abandon non-terminal missions via executor (emits comms, cascades deps).
  // Exclude 'merging' (let in-flight merges finish) and 'compromised' (already
  // terminal-awaiting-Commander — overwriting compromiseReason/completedAt would
  // destroy audit information per spec §3).
  const nonTerminalMissions = db
    .select({ id: missions.id })
    .from(missions)
    .where(
      and(
        eq(missions.campaignId, id),
        inArray(missions.status, ['standby', 'queued', 'deploying', 'in_combat']),
      ),
    )
    .all();

  // Each executorAbandonMission call has its own internal transaction. Wrap
  // individual calls in try/catch so a single failure does not halt the rest.
  for (const m of nonTerminalMissions) {
    try {
      executorAbandonMission(m.id, { reason: 'campaign-abandoned' });
    } catch (err) {
      emitComm({
        campaignId: id,
        battlefieldId: campaign.battlefieldId,
        actor: 'CONTROL',
        level: 'warn',
        message: `abandonCampaign: failed to abandon mission ${m.id} — ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const now = Date.now();

  // Wrap phase + campaign updates in a single transaction for atomicity.
  db.transaction(() => {
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

    // Only update campaign when it is in a non-terminal status. Include
    // 'compromised' because the executor's settleCampaign may have set it
    // to compromised during the mission-abandon loop above — that
    // executor-issued compromised is superseded by the Commander's explicit
    // abandon. The only statuses we must NOT overwrite are 'accomplished'
    // and 'abandoned' (already done by a previous Commander action).
    db.update(campaigns)
      .set({
        status: 'abandoned',
        updatedAt: now,
      })
      .where(
        and(
          eq(campaigns.id, id),
          inArray(campaigns.status, ['draft', 'planning', 'active', 'paused', 'compromised']),
        ),
      )
      .run();
  });

  emitComm({
    campaignId: id,
    battlefieldId: campaign.battlefieldId,
    actor: 'COMMANDER',
    message: 'Campaign ABANDONED — all active missions terminated',
    level: 'warn',
  });

  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 8. acceptCampaign — force accomplishment (meta-level "declare done")
// ---------------------------------------------------------------------------

export async function acceptCampaign(id: string): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, id, 'acceptCampaign');

  db.update(campaigns)
    .set({
      status: 'accomplished',
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, id))
    .run();

  emitComm({
    campaignId: id,
    battlefieldId: campaign.battlefieldId,
    actor: 'COMMANDER',
    message: 'Campaign declared ACCOMPLISHED — Commander override',
  });

  revalidateCampaignPaths(campaign.battlefieldId, id);
}

// ---------------------------------------------------------------------------
// 9. completeCampaign — alias for acceptCampaign (UI compat)
// ---------------------------------------------------------------------------

export async function completeCampaign(id: string): Promise<void> {
  return acceptCampaign(id);
}

// ---------------------------------------------------------------------------
// 10. saveAsTemplate
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
// 11. runTemplate
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
// 12. listTemplates
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
// 13. redeployCampaign
// ---------------------------------------------------------------------------

export async function redeployCampaign(id: string): Promise<Campaign> {
  const db = getDatabase();
  const source = getOrThrow(campaigns, id, 'redeployCampaign');

  const now = Date.now();
  const newCampaignId = generateId();

  db.insert(campaigns).values({
    id: newCampaignId,
    battlefieldId: source.battlefieldId,
    name: source.name,
    objective: source.objective,
    status: 'planning',
    worktreeMode: source.worktreeMode,
    currentPhase: 0,
    isTemplate: 0,
    templateId: source.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  cloneCampaignPlan(id, newCampaignId, source.battlefieldId);

  const newCampaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, newCampaignId))
    .get();

  if (!newCampaign) {
    throw new Error(`redeployCampaign: failed to retrieve cloned campaign ${newCampaignId}`);
  }

  revalidateCampaignPaths(source.battlefieldId, newCampaignId);
  return newCampaign;
}

// ---------------------------------------------------------------------------
// 14. resumeCampaign
// ---------------------------------------------------------------------------

export async function resumeCampaign(campaignId: string): Promise<void> {
  const db = getDatabase();
  const campaign = getOrThrow(campaigns, campaignId, 'resumeCampaign');

  if (campaign.status !== 'paused') {
    throw new Error(`resumeCampaign: campaign must be paused to resume (current: ${campaign.status})`);
  }

  db.update(campaigns).set({
    status: 'active',
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();

  emitStatusChange('campaign', campaignId, 'active');
  // CONTROL polls DB for status='active' campaigns — no explicit trigger needed.
  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}
