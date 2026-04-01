import { eq } from 'drizzle-orm';
import simpleGit from 'simple-git';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields, missionLogs } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { reviewDebrief } from './debrief-reviewer';
import { storeOverseerLog } from './overseer-db';
import { escalate } from './escalation';
import { emitStatusChange } from '@/lib/socket/emit';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
import type { Mission, OverseerReview } from '@/types';

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
 * Run the overseer review for a mission and handle the result.
 * Called asynchronously after the executor releases the slot.
 *
 * The Overseer ONLY judges debrief quality and sets status.
 * Merge logic is handled by the Quartermaster module.
 */
export async function runOverseerReview(missionId: string): Promise<void> {
  const db = getDatabase();

  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) {
    console.error(`[Overseer] Review: mission ${missionId} not found`);
    return;
  }

  if (!mission.debrief) {
    console.warn(`[Overseer] Review: mission ${missionId} has no debrief — marking compromised and escalating`);
    db.update(missions).set({
      status: 'compromised',
      compromiseReason: 'execution-failed',
      debrief: '## Mission Compromised\n\nAgent produced no debrief. The process may have crashed or exited without completing work.',
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }).where(eq(missions.id, missionId)).run();
    emitStatusChange('mission', missionId, 'compromised');
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
    console.error(`[Overseer] Review: battlefield not found for mission ${missionId}`);
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

  // Get git diffs for code review context
  let gitDiffStat: string | null = null;
  let gitDiff: string | null = null;

  if (mission.worktreeBranch && battlefield?.repoPath) {
    try {
      const git = simpleGit(battlefield.repoPath);
      const target = battlefield.defaultBranch || 'main';
      gitDiffStat = await git.diff(['--stat', `${target}...${mission.worktreeBranch}`]);
      gitDiff = await git.diff([`${target}...${mission.worktreeBranch}`]);
    } catch (err) {
      console.warn(`[Overseer] Could not get git diff for mission ${missionId}:`, err);
    }
  }

  // Run the overseer review
  let review: OverseerReview;
  try {
    review = await reviewDebrief({
      missionBriefing: mission.briefing,
      missionDebrief: mission.debrief,
      claudeMd,
      gitDiffStat,
      gitDiff,
      missionId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
  } catch (err) {
    console.error(`[Overseer] Review failed for mission ${missionId}:`, err);
    // On review failure, escalate — never auto-accept
    await escalate({
      level: 'warning',
      title: `Overseer review failed: ${mission.title}`,
      detail: `The Overseer could not review this debrief: ${err instanceof Error ? err.message : String(err)}. Mission remains in ${mission.status} status.`,
      entityType: 'mission',
      entityId: mission.id,
      battlefieldId: mission.battlefieldId,
    });
    return;
  }

  // Store the overseer log
  storeOverseerLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
    answer: review.verdict === 'approve'
      ? 'Approved'
      : `Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: review.verdict === 'approve' ? 'high' : 'medium',
    escalated: review.verdict === 'escalate' ? 1 : 0,
  });

  const isReviewing = mission.status === 'reviewing';
  const maxRetries = isReviewing ? MAX_REVIEW_RETRIES : MAX_TRIAGE_RETRIES;
  const currentAttempts = mission.reviewAttempts ?? 0;

  // Handle the overseer's verdict
  if (review.verdict === 'approve') {
    // Overseer approves — set approved status and hand off to Quartermaster
    db.update(missions).set({
      status: 'approved',
      updatedAt: Date.now(),
    }).where(eq(missions.id, missionId)).run();

    emitStatusChange('mission', missionId, 'approved');
    emitMissionLog(missionId, '[Overseer] Debrief approved. Handing off to Quartermaster.');

    if (review.concerns.length > 0) {
      // Approved but with concerns — info notification
      await escalate({
        level: 'info',
        title: `Debrief Note: ${mission.title}`,
        detail: review.concerns.join('. '),
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });
    }

    // Trigger Quartermaster (async import to avoid circular deps)
    try {
      const { triggerQuartermaster } = await import('@/lib/quartermaster/quartermaster');
      triggerQuartermaster(missionId);
    } catch (err) {
      console.warn(`[Overseer] Could not trigger Quartermaster for mission ${missionId}:`, err);
    }
  } else if (review.verdict === 'retry') {
    if (currentAttempts < maxRetries) {
      // Retry — re-queue with overseer feedback
      await requeueMissionWithFeedback(mission as Mission, review);
    } else {
      // Exhausted retries — compromise and escalate
      exhaustRetries(mission as Mission, review);
    }
  } else if (review.verdict === 'escalate') {
    // Direct escalation
    if (isReviewing) {
      db.update(missions).set({
        status: 'compromised',
        compromiseReason: 'escalated',
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();
    }

    emitStatusChange('mission', missionId, isReviewing ? 'compromised' : mission.status!);

    await escalate({
      level: 'warning',
      title: `Overseer Escalation: ${mission.title}`,
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
          console.error(`[Overseer] Campaign mission complete notification failed:`, err);
        });
      }
    }
  }
}

async function requeueMissionWithFeedback(
  mission: Mission,
  review: OverseerReview,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  db.update(missions).set({
    status: 'queued',
    compromiseReason: null,
    reviewAttempts: (mission.reviewAttempts ?? 0) + 1,
    completedAt: null,
    startedAt: null,
    updatedAt: now,
  }).where(eq(missions.id, mission.id)).run();

  emitStatusChange('mission', mission.id, 'queued');

  console.log(`[Overseer] Mission ${mission.id} re-queued (attempt ${(mission.reviewAttempts ?? 0) + 1}). Concerns: ${review.concerns.join(', ')}`);

  // Store the feedback so the executor can build the retry prompt
  storeOverseerLog({
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
  safeQueueMission(mission.id);
}

function exhaustRetries(mission: Mission, review: OverseerReview): void {
  const db = getDatabase();
  const isReviewing = mission.status === 'reviewing';

  if (isReviewing) {
    db.update(missions).set({
      status: 'compromised',
      compromiseReason: 'review-failed',
      debrief: (mission.debrief || '') +
        `\n\n---\n\nOVERSEER REVIEW: Mission rejected after ${mission.reviewAttempts ?? 0} retries.\nConcerns: ${review.concerns.join(', ')}\nReasoning: ${review.reasoning}`,
      updatedAt: Date.now(),
    }).where(eq(missions.id, mission.id)).run();
  }

  emitStatusChange('mission', mission.id, 'compromised');

  escalate({
    level: 'warning',
    title: `Mission Rejected: ${mission.title}`,
    detail: `Overseer exhausted ${isReviewing ? MAX_REVIEW_RETRIES : MAX_TRIAGE_RETRIES} retries. Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
    entityType: 'mission',
    entityId: mission.id,
    battlefieldId: mission.battlefieldId,
  });

  console.log(`[Overseer] Mission ${mission.id} → compromised (retries exhausted)`);

  // Notify campaign executor
  if (mission.campaignId) {
    const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
    if (executor) {
      executor.onCampaignMissionComplete(mission.id).catch(err => {
        console.error(`[Overseer] Campaign mission complete notification failed:`, err);
      });
    }
  }
}
