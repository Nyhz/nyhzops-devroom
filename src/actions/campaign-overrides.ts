'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns, phases, missions } from '@/lib/db/schema';
import { emitStatusChange } from '@/lib/socket/emit';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
import { reactivateCampaignIfNeeded, notifyCampaignExecutor, revalidateCampaignPaths } from './campaign-helpers';

// ---------------------------------------------------------------------------
// skipAndContinueCampaign
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
// tacticalOverride
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
// commanderOverride
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
// skipMission
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
// retryPhaseDebrief
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
// updateMissionSkillOverrides
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
// skipPhaseDebrief
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
