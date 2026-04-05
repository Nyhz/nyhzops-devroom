'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, count, like, sql, and } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { missions, assets, battlefields, missionLogs, overseerLogs, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
import type {
  Mission,
  CreateMissionInput,
  ListMissionsOptions,
  MissionWithDetails,
  MissionStatus,
} from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTitle(briefing: string): string {
  const firstLine = briefing.split('\n')[0].trim();
  // Strip leading markdown header characters and whitespace
  const stripped = firstLine.replace(/^#+\s*/, '').trim();
  const title = stripped || 'Untitled Mission';
  return title.length > 80 ? title.slice(0, 80) : title;
}

async function _createMission(
  data: CreateMissionInput,
  status: MissionStatus,
): Promise<Mission> {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  const title = data.title?.trim() || extractTitle(data.briefing);

  // Validate battlefield exists
  getOrThrow(battlefields, data.battlefieldId, '_createMission battlefield');

  const record = db.transaction(() => {
    const inserted = db
      .insert(missions)
      .values({
        id,
        battlefieldId: data.battlefieldId,
        title,
        briefing: data.briefing,
        status,
        priority: data.priority ?? 'routine',
        assetId: data.assetId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    // Auto-create intel note for board visibility
    db.insert(intelNotes)
      .values({
        id: generateId(),
        battlefieldId: data.battlefieldId,
        title,
        description: null,
        missionId: id,
        campaignId: null,
        column: 'tasked',
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return inserted;
  });

  emitStatusChange('mission', id, status);

  if (status === 'queued') {
    safeQueueMission(record.id);
  }

  return record;
}

// ---------------------------------------------------------------------------
// createMission
// ---------------------------------------------------------------------------
export async function createMission(
  data: CreateMissionInput,
): Promise<Mission> {
  return _createMission(data, 'standby');
}

// ---------------------------------------------------------------------------
// createAndDeployMission
// ---------------------------------------------------------------------------
export async function createAndDeployMission(
  data: CreateMissionInput,
): Promise<Mission> {
  return _createMission(data, 'queued');
}

// ---------------------------------------------------------------------------
// getMission
// ---------------------------------------------------------------------------
export async function getMission(
  id: string,
): Promise<MissionWithDetails | null> {
  const db = getDatabase();

  const row = db
    .select({
      // All mission columns
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
      // Joined columns
      assetCodename: assets.codename,
      assetSpecialty: assets.specialty,
      battlefieldCodename: battlefields.codename,
    })
    .from(missions)
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .innerJoin(battlefields, eq(missions.battlefieldId, battlefields.id))
    .where(eq(missions.id, id))
    .get();

  if (!row) return null;

  // Count logs
  const [logCountResult] = db
    .select({ value: count() })
    .from(missionLogs)
    .where(eq(missionLogs.missionId, id))
    .all();

  return {
    ...row,
    // Ensure non-null for battlefieldCodename (innerJoin guarantees it)
    battlefieldCodename: row.battlefieldCodename,
    logCount: logCountResult.value,
  } as MissionWithDetails;
}

// ---------------------------------------------------------------------------
// listMissions
// ---------------------------------------------------------------------------
export async function listMissions(
  battlefieldId: string,
  options?: ListMissionsOptions,
): Promise<(Mission & { assetCodename: string | null })[]> {
  const db = getDatabase();

  const statusOrder = sql<number>`CASE ${missions.status}
    WHEN 'in_combat' THEN 0
    WHEN 'deploying' THEN 1
    WHEN 'queued' THEN 2
    WHEN 'standby' THEN 3
    WHEN 'accomplished' THEN 4
    WHEN 'compromised' THEN 5
    WHEN 'abandoned' THEN 6
    ELSE 7
  END`;

  const whereClause = options?.search
    ? and(
        eq(missions.battlefieldId, battlefieldId),
        like(missions.title, `%${options.search}%`),
      )
    : eq(missions.battlefieldId, battlefieldId);

  const rows = db
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
    .where(whereClause)
    .orderBy(statusOrder, desc(missions.createdAt))
    .all();

  return rows as (Mission & { assetCodename: string | null })[];
}

// ---------------------------------------------------------------------------
// deployMission — move a standby mission to queued so the orchestrator picks it up
// ---------------------------------------------------------------------------
export async function deployMission(id: string): Promise<Mission> {
  const db = getDatabase();
  const mission = getOrThrow(missions, id, 'deployMission');

  if (mission.status !== 'standby') {
    throw new Error(
      `deployMission: mission ${id} cannot be deployed from status '${mission.status}' — only standby missions can be deployed`,
    );
  }

  const now = Date.now();

  const updated = db
    .update(missions)
    .set({
      status: 'queued',
      updatedAt: now,
    })
    .where(eq(missions.id, id))
    .returning()
    .get();

  if (!updated) {
    throw new Error(`deployMission: update failed for mission ${id}`);
  }

  emitStatusChange('mission', id, 'queued');

  // Notify the orchestrator to pick up the mission
  safeQueueMission(updated.id);

  return updated;
}

// ---------------------------------------------------------------------------
// abandonMission
// ---------------------------------------------------------------------------
export async function abandonMission(id: string): Promise<Mission> {
  const db = getDatabase();
  const mission = getOrThrow(missions, id, 'abandonMission');

  if (!['standby', 'queued', 'in_combat'].includes(mission.status!)) {
    throw new Error(
      `abandonMission: mission ${id} cannot be abandoned from status '${mission.status}' — only standby, queued, or in_combat missions can be abandoned`,
    );
  }

  // For in_combat missions, delegate to the executor via abort
  if (mission.status === 'in_combat') {
    globalThis.orchestrator?.onMissionAbort(id);
    // Return current mission — the executor will update status asynchronously
    return mission as Mission;
  }

  const now = Date.now();

  const updated = db
    .update(missions)
    .set({
      status: 'abandoned',
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(missions.id, id))
    .returning()
    .get();

  if (!updated) {
    throw new Error(`abandonMission: update failed for mission ${id}`);
  }

  emitStatusChange('mission', id, 'abandoned');

  return updated;
}

// ---------------------------------------------------------------------------
// continueMission
// ---------------------------------------------------------------------------
export async function continueMission(
  missionId: string,
  briefing: string,
): Promise<Mission> {
  const db = getDatabase();

  // Get the original mission
  const original = getOrThrow(missions, missionId, 'continueMission');
  if (original.status !== 'accomplished' && original.status !== 'compromised') {
    throw new Error('Can only continue accomplished or compromised missions');
  }
  if (!original.sessionId) {
    throw new Error('Cannot continue mission without a session ID');
  }

  const now = Date.now();
  const id = generateId();

  // Auto-generate title from new briefing
  let title = briefing.split('\n')[0].replace(/^#+\s*/, '').trim();
  if (title.length > 80) title = title.slice(0, 80) + '...';
  if (!title) title = 'Continued mission';

  // Build the new mission — carries over sessionId for context preservation
  const newMission: typeof missions.$inferInsert = {
    id,
    battlefieldId: original.battlefieldId,
    title,
    briefing,
    status: 'queued',
    priority: original.priority || 'routine',
    assetId: original.assetId,
    sessionId: original.sessionId, // KEY: reuse session for context
    // If original was compromised and has a preserved branch, reuse it
    worktreeBranch: original.status === 'compromised' ? original.worktreeBranch : null,
    useWorktree: 1,
    createdAt: now,
    updatedAt: now,
  };

  db.transaction(() => {
    db.insert(missions).values(newMission).run();

    // Auto-create intel note for board visibility
    db.insert(intelNotes)
      .values({
        id: generateId(),
        battlefieldId: original.battlefieldId,
        title,
        description: null,
        missionId: id,
        campaignId: null,
        column: 'tasked',
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  emitStatusChange('mission', id, 'queued');

  // Trigger orchestrator
  safeQueueMission(id);

  return db.select().from(missions).where(eq(missions.id, id)).get() as Mission;
}

// ---------------------------------------------------------------------------
// removeMission — permanently delete a mission and all related records
// ---------------------------------------------------------------------------
export async function removeMission(id: string): Promise<{ battlefieldId: string }> {
  const db = getDatabase();
  const mission = getOrThrow(missions, id, 'removeMission');

  // If in_combat, abort first
  if (mission.status === 'in_combat') {
    globalThis.orchestrator?.onMissionAbort(id);
  }

  const battlefieldId = mission.battlefieldId;

  // Delete related records and the mission in a single transaction
  db.transaction(() => {
    db.delete(intelNotes).where(eq(intelNotes.missionId, id)).run();
    db.delete(missionLogs).where(eq(missionLogs.missionId, id)).run();
    db.delete(overseerLogs).where(eq(overseerLogs.missionId, id)).run();
    db.delete(missions).where(eq(missions.id, id)).run();
  });

  // Get battlefield codename for activity event
  const battlefield = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (globalThis.io && battlefield) {
    globalThis.io.to('hq:activity').emit('activity:event', {
      type: 'mission:removed',
      battlefieldCodename: battlefield.codename,
      missionTitle: mission.title,
      timestamp: Date.now(),
    });
  }

  revalidatePath(`/battlefields/${battlefieldId}`);

  return { battlefieldId };
}

/**
 * Retry merging a mission's worktree branch by spawning an agent.
 * The agent checks out the target branch, merges the mission branch,
 * resolves any conflicts intelligently, runs tests, and commits.
 * Only works on compromised/abandoned missions with a preserved worktree branch.
 */
export async function retryMerge(missionId: string): Promise<void> {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) throw new Error('Mission not found');
  if (mission.status !== 'compromised' && mission.status !== 'abandoned') {
    throw new Error('Mission must be compromised or abandoned to retry merge');
  }
  if (!mission.worktreeBranch) throw new Error('No worktree branch to merge');

  const battlefield = db.select().from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId)).get();
  if (!battlefield) throw new Error('Battlefield not found');

  const { removeWorktree } = await import('@/lib/orchestrator/worktree');
  const { runClaudePrint } = await import('@/lib/process/claude-print');
  const path = await import('path');
  const fs = await import('fs');

  const targetBranch = battlefield.defaultBranch || 'main';

  // Update status to reviewing while merge agent works
  db.update(missions).set({ status: 'reviewing', updatedAt: Date.now() })
    .where(eq(missions.id, missionId)).run();
  emitStatusChange('mission', missionId, 'reviewing');

  const emitLog = (content: string) => {
    db.insert(missionLogs).values({
      id: generateId(),
      missionId,
      timestamp: Date.now(),
      type: 'sitrep',
      content,
    }).run();
    globalThis.io?.to(`mission:${missionId}`).emit('mission:log', {
      missionId,
      timestamp: Date.now(),
      type: 'sitrep',
      content: content + '\n',
    });
  };

  emitLog(`[RETRY MERGE] Spawning agent to merge \`${mission.worktreeBranch}\` into \`${targetBranch}\`...`);

  // Read CLAUDE.md for context
  let claudeMdContext = '';
  if (battlefield.claudeMdPath) {
    try {
      claudeMdContext = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
    } catch { /* skip */ }
  }

  const prompt = [
    claudeMdContext ? claudeMdContext : '',
    '## Merge Mission',
    '',
    `Merge branch \`${mission.worktreeBranch}\` into \`${targetBranch}\`.`,
    '',
    '### Mission Context',
    `**Title**: ${mission.title}`,
    mission.debrief ? `**Debrief**: ${mission.debrief.slice(0, 2000)}` : '',
    '',
    '### Orders',
    '',
    `1. You are on the \`${targetBranch}\` branch.`,
    `2. Run: \`git merge ${mission.worktreeBranch} --no-ff\``,
    '3. If there are conflicts:',
    '   - Read both sides of each conflicted file carefully.',
    '   - Understand what each branch intended.',
    '   - Merge them intelligently — keep both sides\' contributions.',
    '   - If files are duplicates (both branches created the same file independently), combine the best of both.',
    '   - Do NOT just pick one side. Integrate both.',
    '4. After resolving, stage all files and commit.',
    '5. If there is a test command available, run the tests to verify nothing is broken.',
    '6. Report what you did.',
  ].filter(Boolean).join('\n');

  try {
    await runClaudePrint(prompt, {
      maxTurns: 30,
      cwd: battlefield.repoPath,
    });

    // Verify the merge actually happened — check if the branch is an ancestor of HEAD
    const simpleGit = (await import('simple-git')).default;
    const git = simpleGit(battlefield.repoPath);
    const currentBranch = (await git.branch()).current;

    if (currentBranch !== targetBranch) {
      // Agent left us on wrong branch — switch back
      await git.checkout(targetBranch);
    }

    // Check if the mission branch was merged
    try {
      await git.raw(['merge-base', '--is-ancestor', mission.worktreeBranch, 'HEAD']);
      // Branch is merged — clean up
      const worktreePath = path.join(
        battlefield.repoPath, '.worktrees',
        mission.worktreeBranch.replace(/\//g, '-'),
      );
      try {
        await removeWorktree(battlefield.repoPath, worktreePath, mission.worktreeBranch);
      } catch { /* best effort */ }

      try {
        fs.rmSync(`/tmp/claude-config/${missionId}`, { recursive: true, force: true });
      } catch { /* best effort */ }

      db.update(missions).set({
        status: 'accomplished',
        compromiseReason: null,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();
      emitStatusChange('mission', missionId, 'accomplished');

      emitLog(`[RETRY MERGE] Agent successfully merged \`${mission.worktreeBranch}\` into \`${targetBranch}\`. Worktree cleaned up.`);

      // Notify campaign executor if applicable
      if (mission.campaignId) {
        const executor = globalThis.orchestrator?.activeCampaigns.get(mission.campaignId);
        if (executor) {
          executor.onCampaignMissionComplete(missionId).catch(() => {});
        }
      }
    } catch {
      // Branch not merged — agent failed
      db.update(missions).set({
        status: 'compromised',
        updatedAt: Date.now(),
      }).where(eq(missions.id, missionId)).run();
      emitStatusChange('mission', missionId, 'compromised');

      emitLog(`[RETRY MERGE] Agent finished but branch was not merged. Branch preserved.`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    db.update(missions).set({
      status: 'compromised',
      debrief: (mission.debrief || '') + `\n\n---\n\nRETRY MERGE AGENT FAILED: ${errorMsg}\nBranch \`${mission.worktreeBranch}\` preserved.`,
      updatedAt: Date.now(),
    }).where(eq(missions.id, missionId)).run();
    emitStatusChange('mission', missionId, 'compromised');

    emitLog(`[RETRY MERGE] Agent failed: ${errorMsg}`);
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}/missions/${missionId}`);
}

// ---------------------------------------------------------------------------
// retryReview — Re-run the Overseer review for a mission that failed at review
// ---------------------------------------------------------------------------
export async function retryReview(missionId: string): Promise<void> {
  const db = getDatabase();
  const mission = getOrThrow(missions, missionId, 'retryReview');

  if (mission.status !== 'compromised') {
    throw new Error('Can only retry review on compromised missions');
  }
  if (mission.compromiseReason !== 'escalated' && mission.compromiseReason !== 'review-failed') {
    throw new Error('Mission did not fail at the review step');
  }
  if (!mission.debrief) {
    throw new Error('Mission has no debrief to review');
  }

  // Reset to reviewing status
  db.update(missions).set({
    status: 'reviewing',
    compromiseReason: null,
    updatedAt: Date.now(),
  }).where(eq(missions.id, missionId)).run();

  emitStatusChange('mission', missionId, 'reviewing');
  revalidatePath(`/battlefields/${mission.battlefieldId}/missions/${missionId}`);

  // Re-run the Overseer review (async — don't await in the action)
  const { runOverseerReview } = await import('@/lib/overseer/review-handler');
  runOverseerReview(missionId).catch((err) => {
    console.error(`[retryReview] Overseer review failed for ${missionId}:`, err);
  });
}

// ---------------------------------------------------------------------------
// overrideApprove — Commander override: mark a compromised mission as approved
// ---------------------------------------------------------------------------
export async function overrideApprove(missionId: string): Promise<void> {
  const db = getDatabase();
  const mission = getOrThrow(missions, missionId, 'overrideApprove');

  if (mission.status !== 'compromised') {
    throw new Error('Can only override-approve compromised missions');
  }

  db.update(missions).set({
    status: 'approved',
    compromiseReason: null,
    updatedAt: Date.now(),
  }).where(eq(missions.id, missionId)).run();

  emitStatusChange('mission', missionId, 'approved');

  const { triggerQuartermaster } = await import('@/lib/quartermaster/quartermaster');
  triggerQuartermaster(missionId);

  revalidatePath(`/battlefields/${mission.battlefieldId}`);
}
