import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields } from '@/lib/db/schema';
import { emitStatusChange } from '@/lib/socket/emit';
import { removeWorktree } from '@/lib/orchestrator/worktree';
import { extractAndSaveSuggestions } from '@/actions/follow-up';
import { escalate } from '@/lib/overseer/escalation';
import { executeMerge } from './merge-executor';
import type { Mission } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanupMissionHome(missionId: string) {
  try {
    fs.rmSync(`/tmp/claude-config/${missionId}`, { recursive: true, force: true });
  } catch { /* best effort */ }
}

async function notifyCampaignIfNeeded(mission: Mission): Promise<void> {
  if (!mission.campaignId) return;
  try {
    let executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
    if (!executor && globalThis.orchestrator) {
      const { CampaignExecutor } = await import('@/lib/orchestrator/campaign-executor');
      executor = new CampaignExecutor(mission.campaignId, globalThis.io!);
      globalThis.orchestrator.activeCampaigns.set(mission.campaignId, executor);
    }
    if (executor) {
      await executor.onCampaignMissionComplete(mission.id);
    }
  } catch (err) {
    console.error(`[Quartermaster] Campaign notification failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// triggerQuartermaster
// ---------------------------------------------------------------------------

/**
 * Main Quartermaster entry point. Triggered by Overseer after approving a mission.
 * Handles merge (for worktree missions) or direct completion (non-worktree),
 * follow-up extraction, and campaign notification.
 */
export async function triggerQuartermaster(missionId: string): Promise<void> {
  const db = getDatabase();

  // Load mission + battlefield
  const mission = db
    .select()
    .from(missions)
    .where(eq(missions.id, missionId))
    .get();

  if (!mission) {
    console.error(`[Quartermaster] Mission ${missionId} not found`);
    return;
  }

  if (mission.status !== 'approved') {
    console.warn(`[Quartermaster] Mission ${missionId} status is '${mission.status}', expected 'approved'. Skipping.`);
    return;
  }

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId))
    .get();

  if (!battlefield) {
    console.error(`[Quartermaster] Battlefield ${mission.battlefieldId} not found for mission ${missionId}`);
    return;
  }

  // -----------------------------------------------------------------------
  // Non-worktree missions: skip merge, go directly to accomplished
  // -----------------------------------------------------------------------
  if (!mission.worktreeBranch) {
    const now = Date.now();
    db.update(missions)
      .set({ status: 'accomplished', completedAt: now, updatedAt: now })
      .where(eq(missions.id, missionId))
      .run();

    emitStatusChange('mission', missionId, 'accomplished');
    cleanupMissionHome(missionId);

    // Extract follow-up suggestions
    if (mission.debrief) {
      try {
        await extractAndSaveSuggestions({
          battlefieldId: mission.battlefieldId,
          missionId: mission.id,
          campaignId: mission.campaignId ?? undefined,
          debrief: mission.debrief,
        });
      } catch (err) {
        console.error(`[Quartermaster] Follow-up extraction failed:`, err);
      }
    }

    await notifyCampaignIfNeeded(mission);
    return;
  }

  // -----------------------------------------------------------------------
  // Worktree missions: full merge flow
  // -----------------------------------------------------------------------
  const now = Date.now();
  db.update(missions)
    .set({ status: 'merging', updatedAt: now })
    .where(eq(missions.id, missionId))
    .run();

  emitStatusChange('mission', missionId, 'merging');

  const targetBranch = battlefield.defaultBranch || 'main';
  const sourceBranch = mission.worktreeBranch;
  const worktreeDir = path.join(
    battlefield.repoPath,
    '.worktrees',
    sourceBranch.replace(/\//g, '-'),
  );

  const result = await executeMerge({
    missionId,
    repoPath: battlefield.repoPath,
    sourceBranch,
    targetBranch,
    mission,
    claudeMdPath: battlefield.claudeMdPath,
    onRetryScheduled: (retryAt: number) => {
      db.update(missions)
        .set({ mergeRetryAt: retryAt, updatedAt: Date.now() })
        .where(eq(missions.id, missionId))
        .run();

      emitStatusChange('mission', missionId, 'merging', { mergeRetryAt: retryAt });
    },
  });

  if (result.success) {
    // Clean up worktree
    try {
      await removeWorktree(battlefield.repoPath, worktreeDir, sourceBranch);
    } catch (err) {
      console.warn(`[Quartermaster] Worktree cleanup failed for ${missionId}:`, err);
    }

    cleanupMissionHome(missionId);

    const completedNow = Date.now();
    db.update(missions)
      .set({ status: 'accomplished', completedAt: completedNow, updatedAt: completedNow })
      .where(eq(missions.id, missionId))
      .run();

    emitStatusChange('mission', missionId, 'accomplished');

    // Extract follow-up suggestions
    if (mission.debrief) {
      try {
        await extractAndSaveSuggestions({
          battlefieldId: mission.battlefieldId,
          missionId: mission.id,
          campaignId: mission.campaignId ?? undefined,
          debrief: mission.debrief,
        });
      } catch (err) {
        console.error(`[Quartermaster] Follow-up extraction failed:`, err);
      }
    }

    await notifyCampaignIfNeeded(mission);
  } else {
    // Merge failed — preserve branch for manual review
    cleanupMissionHome(missionId);

    const failedNow = Date.now();
    db.update(missions)
      .set({
        status: 'compromised',
        compromiseReason: 'merge-failed',
        completedAt: failedNow,
        updatedAt: failedNow,
      })
      .where(eq(missions.id, missionId))
      .run();

    emitStatusChange('mission', missionId, 'compromised');

    await escalate({
      level: 'critical',
      title: `Merge failed for mission ${mission.title}`,
      detail: result.error || 'Merge failed after retry. Branch preserved for manual review.',
      entityType: 'mission',
      entityId: missionId,
      battlefieldId: mission.battlefieldId,
    });
  }
}
