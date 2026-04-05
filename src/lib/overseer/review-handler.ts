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
    type: 'sitrep',
    content,
  }).run();
  globalThis.io?.to(`mission:${missionId}`).emit('mission:log', {
    missionId,
    timestamp: now,
    type: 'sitrep',
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
  let commitCount: number | null = null;

  if (mission.worktreeBranch && battlefield?.repoPath) {
    try {
      const git = simpleGit(battlefield.repoPath);
      const target = battlefield.defaultBranch || 'main';
      gitDiffStat = await git.diff(['--stat', `${target}...${mission.worktreeBranch}`]);
      gitDiff = await git.diff([`${target}...${mission.worktreeBranch}`]);
      // Count commits on the mission branch ahead of the default branch.
      // This is the authoritative signal of whether the asset actually changed anything.
      const countRaw = await git.raw(['rev-list', '--count', `${target}..${mission.worktreeBranch}`]);
      const parsed = parseInt(countRaw.trim(), 10);
      commitCount = Number.isFinite(parsed) ? parsed : null;
    } catch (err) {
      console.warn(`[Overseer] Could not get git diff for mission ${missionId}:`, err);
    }
  }

  const missionType: 'direct_action' | 'verification' =
    mission.type === 'verification' ? 'verification' : 'direct_action';

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
      missionType,
      commitCount,
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
    // Hard enforcement gate: mission type × commit count invariants.
    // Overseer's verdict is input, not final word, for these invariants — this
    // protects against LLM drift and ensures verification missions can complete
    // cleanly without going through the Quartermaster merge path.
    const hasWorktree = !!mission.worktreeBranch;
    const effectiveCommitCount = hasWorktree ? (commitCount ?? 0) : 0;

    if (missionType === 'verification' && hasWorktree && effectiveCommitCount > 0) {
      // Violation: verification mission modified code.
      db.update(missions).set({
        status: 'compromised',
        compromiseReason: 'verification-mutated-code',
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();

      emitStatusChange('mission', missionId, 'compromised');
      emitMissionLog(
        missionId,
        `[Overseer] Approval overridden — verification mission produced ${effectiveCommitCount} commit(s). Verification missions must not modify code. Marked compromised.`,
      );

      await escalate({
        level: 'warning',
        title: `Verification mission modified code: ${mission.title}`,
        detail: `Verification mission produced ${effectiveCommitCount} commit(s) on branch ${mission.worktreeBranch}. Branch preserved for review.`,
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });

      if (mission.campaignId) {
        const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
        if (executor) {
          executor.onCampaignMissionComplete(missionId).catch(err => {
            console.error(`[Overseer] Campaign notification failed:`, err);
          });
        }
      }
      return;
    }

    if (missionType === 'direct_action' && hasWorktree && effectiveCommitCount === 0) {
      // Violation: direct_action mission committed nothing.
      db.update(missions).set({
        status: 'compromised',
        compromiseReason: 'no-commits-produced',
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();

      emitStatusChange('mission', missionId, 'compromised');
      emitMissionLog(
        missionId,
        `[Overseer] Approval overridden — direct_action mission produced no commits. The asset did not make any changes. Marked compromised.`,
      );

      await escalate({
        level: 'warning',
        title: `Direct-action mission committed nothing: ${mission.title}`,
        detail: `Direct-action mission ${mission.title} finished with zero commits on branch ${mission.worktreeBranch}. The asset did not make any changes.`,
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });

      if (mission.campaignId) {
        const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
        if (executor) {
          executor.onCampaignMissionComplete(missionId).catch(err => {
            console.error(`[Overseer] Campaign notification failed:`, err);
          });
        }
      }
      return;
    }

    if (missionType === 'verification' && hasWorktree) {
      // Happy path for verification: approved + zero commits → accomplished, skip Quartermaster.
      // Clean up the worktree and branch without attempting a merge.
      const completedAt = Date.now();
      db.update(missions).set({
        status: 'accomplished',
        completedAt,
        updatedAt: completedAt,
      }).where(eq(missions.id, missionId)).run();

      emitStatusChange('mission', missionId, 'accomplished');
      emitMissionLog(
        missionId,
        `[Overseer] Verification mission approved with zero commits. No merge performed. Cleaning worktree.`,
      );

      // Clean up worktree (best effort — don't block completion on cleanup failure)
      try {
        const path = await import('path');
        const { removeWorktree } = await import('@/lib/orchestrator/worktree');
        const worktreeDir = path.join(
          battlefield.repoPath,
          '.worktrees',
          mission.worktreeBranch!.replace(/\//g, '-'),
        );
        await removeWorktree(battlefield.repoPath, worktreeDir, mission.worktreeBranch!);
      } catch (err) {
        console.warn(`[Overseer] Verification worktree cleanup failed for ${missionId}:`, err);
      }

      // Clean up mission home (same as Quartermaster does)
      try {
        const fs = await import('fs');
        fs.rmSync(`/tmp/claude-config/${missionId}`, { recursive: true, force: true });
      } catch { /* best effort */ }

      if (review.concerns.length > 0) {
        await escalate({
          level: 'info',
          title: `Verification Note: ${mission.title}`,
          detail: review.concerns.join('. '),
          entityType: 'mission',
          entityId: mission.id,
          battlefieldId: mission.battlefieldId,
        });
      }

      await escalate({
        level: 'info',
        title: `Mission Accomplished — ${mission.title}`,
        detail: `Verification complete. No code changes, no merge performed.`,
        entityType: 'mission',
        entityId: mission.id,
        battlefieldId: mission.battlefieldId,
      });

      // Extract follow-up suggestions from the debrief, same as Quartermaster
      if (mission.debrief) {
        try {
          const { extractAndSaveSuggestions } = await import('@/actions/follow-up');
          await extractAndSaveSuggestions({
            battlefieldId: mission.battlefieldId,
            missionId: mission.id,
            campaignId: mission.campaignId ?? undefined,
            debrief: mission.debrief,
          });
        } catch (err) {
          console.error(`[Overseer] Follow-up extraction failed:`, err);
        }
      }

      if (mission.campaignId) {
        const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
        if (executor) {
          executor.onCampaignMissionComplete(missionId).catch(err => {
            console.error(`[Overseer] Campaign notification failed:`, err);
          });
        }
      }
      return;
    }

    // Standard direct_action path: Overseer approves → set approved, hand off to Quartermaster.
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
