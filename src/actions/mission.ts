'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, count, like, sql, and } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { missions, assets, battlefields, missionLogs, captainLogs, campaigns } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
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

  const battlefield = getOrThrow(battlefields, data.battlefieldId, '_createMission battlefield');

  const record = db
    .insert(missions)
    .values({
      id,
      battlefieldId: data.battlefieldId,
      title,
      briefing: data.briefing,
      status,
      priority: data.priority ?? 'normal',
      assetId: data.assetId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  // Emit Socket.IO activity event
  if (globalThis.io) {
    globalThis.io.to('hq:activity').emit('activity:event', {
      type: 'mission:created',
      battlefieldCodename: battlefield.codename,
      missionTitle: title,
      timestamp: now,
      detail: `Status: ${status === 'queued' ? 'QUEUED' : 'STANDBY'}`,
    });
  }

  revalidatePath(`/battlefields/${data.battlefieldId}`);

  if (status === 'queued') {
    globalThis.orchestrator?.onMissionQueued(record.id);
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

  // Get battlefield codename for activity event
  const battlefield = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId))
    .get();

  if (globalThis.io && battlefield) {
    globalThis.io.to('hq:activity').emit('activity:event', {
      type: 'mission:queued',
      battlefieldCodename: battlefield.codename,
      missionTitle: mission.title,
      timestamp: now,
    });
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}`);

  // Notify the orchestrator to pick up the mission
  globalThis.orchestrator?.onMissionQueued(updated.id);

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

  // Get battlefield codename for activity event
  const battlefield = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId))
    .get();

  if (globalThis.io && battlefield) {
    globalThis.io.to('hq:activity').emit('activity:event', {
      type: 'mission:abandoned',
      battlefieldCodename: battlefield.codename,
      missionTitle: mission.title,
      timestamp: now,
    });
  }

  revalidatePath(`/battlefields/${mission.battlefieldId}`);

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
    priority: original.priority || 'normal',
    assetId: original.assetId,
    sessionId: original.sessionId, // KEY: reuse session for context
    // If original was compromised and has a preserved branch, reuse it
    worktreeBranch: original.status === 'compromised' ? original.worktreeBranch : null,
    useWorktree: 1,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(missions).values(newMission).run();

  // Emit activity
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, original.battlefieldId))
    .get();

  globalThis.io?.to('hq:activity').emit('activity:event', {
    type: 'mission:created',
    battlefieldCodename: bf?.codename || 'UNKNOWN',
    missionTitle: title,
    timestamp: now,
    detail: `Continued from mission: ${original.title}. Status: QUEUED`,
  });

  revalidatePath(`/battlefields/${original.battlefieldId}`);

  // Trigger orchestrator
  globalThis.orchestrator?.onMissionQueued(id);

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

  // Delete related records first (no cascade in SQLite by default)
  db.delete(missionLogs).where(eq(missionLogs.missionId, id)).run();
  db.delete(captainLogs).where(eq(captainLogs.missionId, id)).run();

  // Delete the mission
  db.delete(missions).where(eq(missions.id, id)).run();

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
