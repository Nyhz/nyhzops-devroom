'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, count, like, sql, and } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { missions, assets, battlefields, missionLogs, intelNotes } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { emitStatusChange } from '@/lib/socket/emit';
import { emitComm } from '@/control/comms';
import {
  tacticalOverride as executorTacticalOverride,
  abandonMission as executorAbandonMission,
  acceptAndMerge,
} from '@/control/campaign/executor';
import { removeMissionWorktree, sanitizeBranchForPath } from '@/control/worktree';
import path from 'node:path';
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

  // CONTROL's dispatch loop polls the DB — no explicit enqueue needed.
  emitComm({
    missionId: id,
    battlefieldId: data.battlefieldId,
    actor: 'CONTROL',
    message: status === 'queued' ? 'Mission queued — CONTROL dispatch will pick up' : 'Mission created (standby)',
    level: 'info',
  });

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
  if (!data.assetId) {
    throw new Error('An asset must be selected to deploy a mission');
  }
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
      compromiseReason: missions.compromiseReason,
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
// deployMission — move a standby mission to queued so CONTROL picks it up
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

  // CONTROL's dispatch loop polls the DB — no explicit enqueue needed.
  emitComm({
    missionId: id,
    battlefieldId: mission.battlefieldId,
    actor: 'CONTROL',
    message: 'Mission queued — CONTROL dispatch will pick up',
    level: 'info',
  });

  revalidatePath(`/battlefields/${mission.battlefieldId}`);

  return updated;
}

// ---------------------------------------------------------------------------
// abandonMission — thin wrapper over executor; also handles worktree cleanup
// ---------------------------------------------------------------------------
export async function abandonMission(id: string): Promise<Mission> {
  const db = getDatabase();
  const mission = getOrThrow(missions, id, 'abandonMission');

  // Delegate to executor: sets status→abandoned, emits comm, cascades.
  executorAbandonMission(id, { reason: 'commander-abandon' });

  // Best-effort worktree cleanup
  if (mission.worktreeBranch) {
    const battlefield = db
      .select({ repoPath: battlefields.repoPath })
      .from(battlefields)
      .where(eq(battlefields.id, mission.battlefieldId))
      .get();
    if (battlefield) {
      const worktreePath = path.join(
        battlefield.repoPath,
        '.worktrees',
        sanitizeBranchForPath(mission.worktreeBranch),
      );
      removeMissionWorktree({
        repoPath: battlefield.repoPath,
        worktreePath,
        branch: mission.worktreeBranch,
        deleteBranch: false,
      }).catch(() => {
        // best-effort — ignore errors
      });
    }
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}`);

  // Return the updated mission state
  const updated = db
    .select()
    .from(missions)
    .where(eq(missions.id, id))
    .get();

  return (updated ?? mission) as Mission;
}

// ---------------------------------------------------------------------------
// tacticalOverride — thin revalidatePath wrapper over executor.tacticalOverride
// ---------------------------------------------------------------------------
export async function tacticalOverride(
  missionId: string,
  newBriefing: string,
): Promise<void> {
  const mission = getOrThrow(missions, missionId, 'tacticalOverride');

  executorTacticalOverride(missionId, newBriefing);

  revalidatePath(`/battlefields/${mission.battlefieldId}`);
  revalidatePath(`/battlefields/${mission.battlefieldId}/missions/${missionId}`);
}

// ---------------------------------------------------------------------------
// acceptMergeOverride — Commander force-merges a COMPROMISED mission
// ---------------------------------------------------------------------------
export async function acceptMergeOverride(missionId: string): Promise<void> {
  const mission = getOrThrow(missions, missionId, 'acceptMergeOverride');

  if (mission.status !== 'compromised') {
    throw new Error(
      `acceptMergeOverride: mission ${missionId} is not compromised (status=${mission.status})`,
    );
  }

  await acceptAndMerge(missionId);

  revalidatePath(`/battlefields/${mission.battlefieldId}`);
  revalidatePath(`/battlefields/${mission.battlefieldId}/missions/${missionId}`);
}

// ---------------------------------------------------------------------------
// answerEscalation — inject Commander answer into next retry attempt
// ---------------------------------------------------------------------------
export async function answerEscalation(
  missionId: string,
  answer: string,
): Promise<void> {
  const db = getDatabase();
  const mission = getOrThrow(missions, missionId, 'answerEscalation');

  const guidanceSection =
    `\n\n---\n\n## Commander Guidance (escalation answer)\n\n${answer}`;
  const updatedBriefing = (mission.briefing ?? '') + guidanceSection;
  const now = Date.now();

  db.transaction(() => {
    db.update(missions)
      .set({
        briefing: updatedBriefing,
        currentSortieAttempts: 0,
        compromiseReason: null,
        status: 'queued',
        updatedAt: now,
      })
      .where(eq(missions.id, missionId))
      .run();
  });

  emitComm({
    missionId,
    campaignId: mission.campaignId ?? undefined,
    battlefieldId: mission.battlefieldId,
    actor: 'COMMANDER',
    message: `Escalation answered — mission re-queued. Answer excerpt: ${answer.slice(0, 120)}`,
    level: 'info',
  });

  revalidatePath(`/battlefields/${mission.battlefieldId}`);
  revalidatePath(`/battlefields/${mission.battlefieldId}/missions/${missionId}`);
}

// ---------------------------------------------------------------------------
// continueMission — create new mission reusing sessionId
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

  // CONTROL's dispatch loop polls the DB — no explicit enqueue needed.
  emitComm({
    missionId: id,
    battlefieldId: original.battlefieldId,
    actor: 'CONTROL',
    message: `Continued mission queued (continues session from ${missionId})`,
    level: 'info',
  });

  revalidatePath(`/battlefields/${original.battlefieldId}`);

  return db.select().from(missions).where(eq(missions.id, id)).get() as Mission;
}

