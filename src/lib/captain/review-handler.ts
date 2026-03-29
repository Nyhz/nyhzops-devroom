import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields, missionLogs } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { reviewDebrief, type DebriefReview } from './debrief-reviewer';
import { storeCaptainLog } from './captain-db';
import { escalate } from './escalation';
import { mergeBranch } from '@/lib/orchestrator/merger';
import { removeWorktree } from '@/lib/orchestrator/worktree';
import type { Mission } from '@/types';

function emitMissionLog(missionId: string, content: string) {
  const db = getDatabase();
  const now = Date.now();
  db.insert(missionLogs).values({
    id: generateId(),
    missionId,
    timestamp: now,
    type: 'status',
    content,
  }).run();
  globalThis.io?.to(`mission:${missionId}`).emit('mission:log', {
    missionId,
    timestamp: now,
    type: 'status',
    content: content + '\n',
  });
}

// Max retries: 2 for reviewing (successful missions), 1 for compromised (failed missions)
const MAX_REVIEW_RETRIES = 2;
const MAX_TRIAGE_RETRIES = 1;

/**
 * Run the captain review for a mission and handle the result.
 * Called asynchronously after the executor releases the slot.
 */
export async function runCaptainReview(missionId: string): Promise<void> {
  const db = getDatabase();

  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) {
    console.error(`[Captain] Review: mission ${missionId} not found`);
    return;
  }

  if (!mission.debrief) {
    console.warn(`[Captain] Review: mission ${missionId} has no debrief — marking compromised and escalating`);
    db.update(missions).set({
      status: 'compromised',
      debrief: '## Mission Compromised\n\nAgent produced no debrief. The process may have crashed or exited without completing work.',
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }).where(eq(missions.id, missionId)).run();
    emitStatusChange(missionId, 'compromised', mission.battlefieldId);
    await escalate({
      level: 'critical',
      title: `No debrief: ${mission.title}`,
      detail: `Mission ${missionId} reached review with no debrief. Marked compromised. The agent may have crashed without producing output.`,
      entityType: 'mission',
      entityId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
    return;
  }

  const battlefield = db.select().from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId)).get();
  if (!battlefield) {
    console.error(`[Captain] Review: battlefield not found for mission ${missionId}`);
    return;
  }

  // Read CLAUDE.md for context
  let claudeMd: string | null = null;
  if (battlefield.claudeMdPath) {
    try {
      const fs = await import('fs');
      claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
    } catch { /* file may not exist */ }
  }

  // Run the captain review
  let review: DebriefReview;
  try {
    review = await reviewDebrief({
      missionBriefing: mission.briefing,
      missionDebrief: mission.debrief,
      claudeMd,
      missionId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
  } catch (err) {
    console.error(`[Captain] Review failed for mission ${missionId}:`, err);
    // On review failure, escalate — never auto-accept
    await escalate({
      level: 'warning',
      title: `Captain review failed: ${mission.title}`,
      detail: `The Captain could not review this debrief: ${err instanceof Error ? err.message : String(err)}. Mission remains in ${mission.status} status.`,
      entityType: 'mission',
      entityId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
    return;
  }

  // Store the captain log
  storeCaptainLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
    answer: review.satisfactory
      ? 'Satisfactory'
      : `Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: review.satisfactory ? 'high' : 'medium',
    escalated: review.recommendation === 'escalate' ? 1 : 0,
  });

  const isReviewing = mission.status === 'reviewing';
  const maxRetries = isReviewing ? MAX_REVIEW_RETRIES : MAX_TRIAGE_RETRIES;
  const currentAttempts = mission.reviewAttempts ?? 0;

  // Handle the captain's recommendation
  if (review.recommendation === 'accept' || (review.satisfactory && review.recommendation !== 'escalate')) {
    // Captain approves — merge + promote
    await promoteMission(missionId, 'accomplished');

    if (review.concerns.length > 0) {
      // Satisfactory but with concerns — info notification
      await escalate({
        level: 'info',
        title: `Debrief Note: ${mission.title}`,
        detail: review.concerns.join('. '),
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });
    }
  } else if (review.recommendation === 'retry') {
    if (currentAttempts < maxRetries) {
      // Retry — re-queue with captain feedback
      await requeueMissionWithFeedback(mission as Mission, review);
    } else {
      // Exhausted retries — compromise and escalate
      exhaustRetries(mission as Mission, review);
    }
  } else if (review.recommendation === 'escalate') {
    // Direct escalation
    if (isReviewing) {
      db.update(missions).set({
        status: 'compromised',
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();
    }

    emitStatusChange(missionId, isReviewing ? 'compromised' : mission.status!, mission.battlefieldId);

    await escalate({
      level: 'warning',
      title: `Captain Escalation: ${mission.title}`,
      detail: `Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
      entityType: 'mission',
      entityId: mission.id,
      battlefieldId: mission.battlefieldId,
    });

    // Notify campaign executor
    if (mission.campaignId) {
      const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
      if (executor) {
        executor.onCampaignMissionComplete(missionId).catch(err => {
          console.error(`[Captain] Campaign mission complete notification failed:`, err);
        });
      }
    }
  }
}

async function promoteMission(missionId: string, status: 'accomplished'): Promise<void> {
  const db = getDatabase();

  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();

  // Only promote if still in reviewing — merge failure may have set compromised
  if (!mission || mission.status !== 'reviewing') {
    console.log(`[Captain] Skipping promotion of ${missionId} — status is ${mission?.status}, not reviewing`);
    return;
  }

  // Merge worktree branch BEFORE promoting — only merge Captain-approved work
  if (mission.worktreeBranch) {
    const battlefield = db.select().from(battlefields)
      .where(eq(battlefields.id, mission.battlefieldId)).get();

    if (battlefield) {
      const worktreePath = path.join(
        battlefield.repoPath, '.worktrees',
        mission.worktreeBranch.replace(/\//g, '-'),
      );

      console.log(`[Captain] Merging ${mission.worktreeBranch} into ${battlefield.defaultBranch || 'main'}...`);

      const mergeResult = await mergeBranch(
        battlefield.repoPath,
        mission.worktreeBranch,
        battlefield.defaultBranch || 'main',
        mission as Mission,
        battlefield.claudeMdPath,
      );

      if (mergeResult.success) {
        await removeWorktree(battlefield.repoPath, worktreePath, mission.worktreeBranch);
        const mergeMsg = mergeResult.conflictResolved
          ? `[CAPTAIN] Merged ${mission.worktreeBranch} into ${battlefield.defaultBranch || 'main'} (conflicts auto-resolved). Worktree cleaned up.`
          : `[CAPTAIN] Merged ${mission.worktreeBranch} into ${battlefield.defaultBranch || 'main'}. Worktree cleaned up.`;
        emitMissionLog(missionId, mergeMsg);
        console.log(`[Captain] Merge complete${mergeResult.conflictResolved ? ' (conflicts auto-resolved)' : ''}. Worktree cleaned up.`);
      } else {
        // Merge failed — mark compromised instead of accomplished
        console.error(`[Captain] Merge failed for ${missionId}: ${mergeResult.error}`);
        db.update(missions).set({
          status: 'compromised',
          debrief: (mission.debrief || '') + `\n\n---\n\nMERGE FAILED: ${mergeResult.error}\nBranch \`${mission.worktreeBranch}\` preserved for inspection.`,
          completedAt: Date.now(),
          updatedAt: Date.now(),
        }).where(eq(missions.id, missionId)).run();
        emitStatusChange(missionId, 'compromised', mission.battlefieldId);
        return;
      }
    }
  }

  // Promote to accomplished
  db.update(missions).set({
    status,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  }).where(eq(missions.id, missionId)).run();

  emitStatusChange(missionId, status, mission.battlefieldId);
  emitMissionLog(missionId, `[CAPTAIN] Mission approved and promoted to ACCOMPLISHED.`);
  console.log(`[Captain] Mission ${missionId} → ${status}`);

  // Clean up per-mission Claude config isolation dir
  try {
    fs.rmSync(`/tmp/claude-config/${missionId}`, { recursive: true, force: true });
  } catch { /* best effort */ }

  // Notify campaign executor if this is a campaign mission
  if (mission.campaignId) {
    const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
    if (executor) {
      executor.onCampaignMissionComplete(missionId).catch(err => {
        console.error(`[Captain] Campaign mission complete notification failed:`, err);
      });
    }
  }
}

async function requeueMissionWithFeedback(
  mission: Mission,
  review: DebriefReview,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  db.update(missions).set({
    status: 'queued',
    reviewAttempts: (mission.reviewAttempts ?? 0) + 1,
    completedAt: null,
    startedAt: null,
    updatedAt: now,
  }).where(eq(missions.id, mission.id)).run();

  emitStatusChange(mission.id, 'queued', mission.battlefieldId);

  console.log(`[Captain] Mission ${mission.id} re-queued (attempt ${(mission.reviewAttempts ?? 0) + 1}). Concerns: ${review.concerns.join(', ')}`);

  // Store the feedback so the executor can build the retry prompt
  storeCaptainLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[RETRY_FEEDBACK] Mission: ${mission.title}`,
    answer: `Retry requested. Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: 'medium',
    escalated: 0,
  });

  // Notify orchestrator
  globalThis.orchestrator?.onMissionQueued(mission.id);
}

function exhaustRetries(mission: Mission, review: DebriefReview): void {
  const db = getDatabase();
  const isReviewing = mission.status === 'reviewing';

  if (isReviewing) {
    db.update(missions).set({
      status: 'compromised',
      debrief: (mission.debrief || '') +
        `\n\n---\n\nCAPTAIN REVIEW: Mission rejected after ${mission.reviewAttempts ?? 0} retries.\nConcerns: ${review.concerns.join(', ')}\nReasoning: ${review.reasoning}`,
      updatedAt: Date.now(),
    }).where(eq(missions.id, mission.id)).run();
  }

  emitStatusChange(mission.id, 'compromised', mission.battlefieldId);

  escalate({
    level: 'warning',
    title: `Mission Rejected: ${mission.title}`,
    detail: `Captain exhausted ${isReviewing ? MAX_REVIEW_RETRIES : MAX_TRIAGE_RETRIES} retries. Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
    entityType: 'mission',
    entityId: mission.id,
    battlefieldId: mission.battlefieldId,
  });

  console.log(`[Captain] Mission ${mission.id} → compromised (retries exhausted)`);

  // Notify campaign executor
  if (mission.campaignId) {
    const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
    if (executor) {
      executor.onCampaignMissionComplete(mission.id).catch(err => {
        console.error(`[Captain] Campaign mission complete notification failed:`, err);
      });
    }
  }
}

function emitStatusChange(missionId: string, status: string, battlefieldId?: string): void {
  if (globalThis.io) {
    const payload = { missionId, status, timestamp: Date.now() };
    globalThis.io.to(`mission:${missionId}`).emit('mission:status', payload);
    if (battlefieldId) {
      globalThis.io.to(`battlefield:${battlefieldId}`).emit('mission:status', payload);
    }
  }
}
