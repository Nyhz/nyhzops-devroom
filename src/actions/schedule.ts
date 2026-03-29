'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, asc, like, and } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { scheduledTasks, missions } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { validateCron, getNextRun } from '@/lib/scheduler/cron';
import type { ScheduledTask, Mission } from '@/types';

// ---------------------------------------------------------------------------
// 1. createScheduledTask
// ---------------------------------------------------------------------------

interface CreateScheduledTaskInput {
  battlefieldId: string;
  name: string;
  type: 'mission' | 'campaign' | 'maintenance';
  cron: string;
  // Mission fields
  briefing?: string;
  assetId?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  // Campaign fields
  campaignId?: string;
}

export async function createScheduledTask(
  data: CreateScheduledTaskInput,
): Promise<ScheduledTask> {
  if (!validateCron(data.cron)) {
    throw new Error(`createScheduledTask: invalid cron expression "${data.cron}"`);
  }

  const db = getDatabase();
  const id = generateId();
  const now = Date.now();
  const nextRunAt = getNextRun(data.cron);

  let missionTemplate: string | null = null;
  if (data.type === 'mission') {
    missionTemplate = JSON.stringify({
      briefing: data.briefing || '',
      assetId: data.assetId || null,
      priority: data.priority || 'normal',
    });
  }

  const record = db
    .insert(scheduledTasks)
    .values({
      id,
      battlefieldId: data.battlefieldId,
      name: data.name,
      type: data.type,
      cron: data.cron,
      enabled: 1,
      missionTemplate,
      campaignId: data.type === 'campaign' ? (data.campaignId ?? null) : null,
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
  type?: 'mission' | 'campaign' | 'maintenance';
  briefing?: string;
  assetId?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  campaignId?: string;
}

export async function updateScheduledTask(
  id: string,
  data: UpdateScheduledTaskInput,
): Promise<ScheduledTask> {
  const db = getDatabase();
  const existing = getOrThrow(scheduledTasks, id, 'updateScheduledTask');

  const now = Date.now();
  const updatedCron = data.cron ?? existing.cron;

  // Recompute nextRunAt if cron changed
  let nextRunAt = existing.nextRunAt;
  if (data.cron && data.cron !== existing.cron) {
    if (!validateCron(data.cron)) {
      throw new Error(`updateScheduledTask: invalid cron expression "${data.cron}"`);
    }
    nextRunAt = getNextRun(data.cron);
  }

  const effectiveType = data.type ?? existing.type;

  let missionTemplate = existing.missionTemplate;
  if (effectiveType === 'mission') {
    const currentTemplate = existing.missionTemplate
      ? (JSON.parse(existing.missionTemplate) as Record<string, unknown>)
      : {};
    missionTemplate = JSON.stringify({
      briefing: data.briefing ?? currentTemplate.briefing ?? '',
      assetId: data.assetId ?? currentTemplate.assetId ?? null,
      priority: data.priority ?? currentTemplate.priority ?? 'normal',
    });
  }

  const record = db
    .update(scheduledTasks)
    .set({
      name: data.name ?? existing.name,
      cron: updatedCron,
      type: effectiveType,
      missionTemplate: effectiveType === 'mission' ? missionTemplate : null,
      campaignId: effectiveType === 'campaign' ? (data.campaignId ?? existing.campaignId) : null,
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
