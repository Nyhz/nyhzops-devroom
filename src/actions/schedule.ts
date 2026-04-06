'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, asc, like, and } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { scheduledTasks, missions } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { validateCron, getNextRun } from '@/lib/scheduler/cron';
import { getScheduleDossier, type ScheduleTaskType } from '@/lib/scheduler/dossiers';
import type { ScheduledTask, Mission } from '@/types';

// ---------------------------------------------------------------------------
// 1. createScheduledTask
// ---------------------------------------------------------------------------

interface CreateScheduledTaskInput {
  battlefieldId: string;
  name: string;
  type: ScheduleTaskType;
  dossierId: string;
  cron: string;
}

export async function createScheduledTask(
  data: CreateScheduledTaskInput,
): Promise<ScheduledTask> {
  if (!validateCron(data.cron)) {
    throw new Error(`createScheduledTask: invalid cron expression "${data.cron}"`);
  }

  const dossier = getScheduleDossier(data.dossierId);
  if (!dossier) {
    throw new Error(`createScheduledTask: Unknown schedule dossier "${data.dossierId}"`);
  }
  if (dossier.type !== data.type) {
    throw new Error(
      `createScheduledTask: type mismatch — dossier "${data.dossierId}" is ${dossier.type}, not ${data.type}`,
    );
  }

  const db = getDatabase();
  const id = generateId();
  const now = Date.now();
  const nextRunAt = getNextRun(data.cron);

  const record = db
    .insert(scheduledTasks)
    .values({
      id,
      battlefieldId: data.battlefieldId,
      name: data.name,
      type: data.type,
      cron: data.cron,
      enabled: 1,
      dossierId: data.dossierId,
      missionTemplate: null,
      campaignId: null,
      nextRunAt,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  revalidatePath(`/battlefields/${data.battlefieldId}/schedule`);
  return record;
}

// ---------------------------------------------------------------------------
// 2. updateScheduledTask
// ---------------------------------------------------------------------------

interface UpdateScheduledTaskInput {
  name?: string;
  cron?: string;
  type?: ScheduleTaskType;
  dossierId?: string;
}

export async function updateScheduledTask(
  id: string,
  data: UpdateScheduledTaskInput,
): Promise<ScheduledTask> {
  const db = getDatabase();
  const existing = getOrThrow(scheduledTasks, id, 'updateScheduledTask');

  const now = Date.now();

  // Validate cron if changed
  let nextRunAt = existing.nextRunAt;
  if (data.cron && data.cron !== existing.cron) {
    if (!validateCron(data.cron)) {
      throw new Error(`updateScheduledTask: invalid cron expression "${data.cron}"`);
    }
    nextRunAt = getNextRun(data.cron);
  }

  // Validate dossierId if changed
  const effectiveType = data.type ?? existing.type;
  if (data.dossierId) {
    const dossier = getScheduleDossier(data.dossierId);
    if (!dossier) {
      throw new Error(`updateScheduledTask: Unknown schedule dossier "${data.dossierId}"`);
    }
    if (dossier.type !== effectiveType) {
      throw new Error(
        `updateScheduledTask: type mismatch — dossier "${data.dossierId}" is ${dossier.type}, not ${effectiveType}`,
      );
    }
  }

  const record = db
    .update(scheduledTasks)
    .set({
      name: data.name ?? existing.name,
      cron: data.cron ?? existing.cron,
      type: effectiveType,
      dossierId: data.dossierId ?? existing.dossierId,
      nextRunAt,
      updatedAt: now,
    })
    .where(eq(scheduledTasks.id, id))
    .returning()
    .get();

  revalidatePath(`/battlefields/${existing.battlefieldId}/schedule`);
  return record;
}

// ---------------------------------------------------------------------------
// 3. deleteScheduledTask
// ---------------------------------------------------------------------------

export async function deleteScheduledTask(id: string): Promise<void> {
  const db = getDatabase();
  const existing = getOrThrow(scheduledTasks, id, 'deleteScheduledTask');

  db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run();
  revalidatePath(`/battlefields/${existing.battlefieldId}/schedule`);
}

// ---------------------------------------------------------------------------
// 4. listScheduledTasks
// ---------------------------------------------------------------------------

export async function listScheduledTasks(
  battlefieldId: string,
): Promise<ScheduledTask[]> {
  const db = getDatabase();

  return db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.battlefieldId, battlefieldId))
    .orderBy(asc(scheduledTasks.nextRunAt))
    .all();
}

// ---------------------------------------------------------------------------
// 5. toggleScheduledTask
// ---------------------------------------------------------------------------

export async function toggleScheduledTask(
  id: string,
  enabled: boolean,
): Promise<ScheduledTask> {
  const db = getDatabase();
  const existing = getOrThrow(scheduledTasks, id, 'toggleScheduledTask');

  const now = Date.now();
  const nextRunAt = enabled ? getNextRun(existing.cron) : existing.nextRunAt;

  const record = db
    .update(scheduledTasks)
    .set({
      enabled: enabled ? 1 : 0,
      nextRunAt,
      updatedAt: now,
    })
    .where(eq(scheduledTasks.id, id))
    .returning()
    .get();

  revalidatePath(`/battlefields/${existing.battlefieldId}/schedule`);
  return record;
}

// ---------------------------------------------------------------------------
// 6. getScheduleHistory
// ---------------------------------------------------------------------------

export async function getScheduleHistory(
  battlefieldId: string,
  limit = 10,
): Promise<Mission[]> {
  const db = getDatabase();

  return db
    .select()
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        like(missions.title, '[Scheduled]%'),
      ),
    )
    .orderBy(desc(missions.createdAt))
    .limit(limit)
    .all();
}
