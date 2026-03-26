'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, count, inArray, and, sql } from 'drizzle-orm';
import fs from 'fs';
import simpleGit from 'simple-git';
import { getDatabase } from '@/lib/db/index';
import {
  battlefields,
  missions,
  campaigns,
  phases,
  missionLogs,
  scheduledTasks,
  commandLogs,
} from '@/lib/db/schema';
import { generateId, toKebabCase } from '@/lib/utils';
import { config } from '@/lib/config';
import type {
  CreateBattlefieldInput,
  UpdateBattlefieldInput,
  BattlefieldWithCounts,
  Battlefield,
} from '@/types';

// ---------------------------------------------------------------------------
// createBattlefield
// ---------------------------------------------------------------------------
export async function createBattlefield(
  data: CreateBattlefieldInput,
): Promise<Battlefield> {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  let repoPath = data.repoPath ?? '';
  let defaultBranch = data.defaultBranch ?? 'main';
  let scaffoldStatus: string | null = null;

  if (!data.repoPath) {
    // New project flow — create directory and init git
    const dirPath = `${config.devBasePath}/${toKebabCase(data.name)}`;

    if (fs.existsSync(dirPath)) {
      throw new Error(
        `createBattlefield: directory already exists at ${dirPath}`,
      );
    }

    fs.mkdirSync(dirPath, { recursive: true });
    await simpleGit(dirPath).init();
    repoPath = dirPath;

    if (data.scaffoldCommand) {
      scaffoldStatus = 'running';
    }
  } else {
    // Link flow — validate existing repo
    const gitDir = `${data.repoPath}/.git`;
    if (!fs.existsSync(data.repoPath) || !fs.existsSync(gitDir)) {
      throw new Error(
        `createBattlefield: path ${data.repoPath} is not a valid git repository`,
      );
    }

    const git = simpleGit(data.repoPath);
    const branches = await git.branchLocal();
    defaultBranch = branches.current || 'main';
    repoPath = data.repoPath;
  }

  const record = db
    .insert(battlefields)
    .values({
      id,
      name: data.name,
      codename: data.codename,
      description: data.description ?? null,
      initialBriefing: data.initialBriefing ?? null,
      repoPath,
      defaultBranch,
      scaffoldCommand: data.scaffoldCommand ?? null,
      scaffoldStatus,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);

  return record;
}

// ---------------------------------------------------------------------------
// getBattlefield
// ---------------------------------------------------------------------------
export async function getBattlefield(
  id: string,
): Promise<BattlefieldWithCounts | null> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  if (!battlefield) return null;

  const [missionCountResult] = db
    .select({ value: count() })
    .from(missions)
    .where(eq(missions.battlefieldId, id))
    .all();

  const [campaignCountResult] = db
    .select({ value: count() })
    .from(campaigns)
    .where(eq(campaigns.battlefieldId, id))
    .all();

  const [activeMissionCountResult] = db
    .select({ value: count() })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, id),
        inArray(missions.status, ['queued', 'deploying', 'in_combat']),
      ),
    )
    .all();

  return {
    ...battlefield,
    missionCount: missionCountResult.value,
    campaignCount: campaignCountResult.value,
    activeMissionCount: activeMissionCountResult.value,
  };
}

// ---------------------------------------------------------------------------
// listBattlefields
// ---------------------------------------------------------------------------
export async function listBattlefields(): Promise<Battlefield[]> {
  const db = getDatabase();
  return db
    .select()
    .from(battlefields)
    .orderBy(desc(battlefields.updatedAt))
    .all();
}

// ---------------------------------------------------------------------------
// updateBattlefield
// ---------------------------------------------------------------------------
export async function updateBattlefield(
  id: string,
  data: Partial<UpdateBattlefieldInput>,
): Promise<Battlefield> {
  const db = getDatabase();

  // Build the update payload, converting boolean to integer for SQLite
  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (data.name !== undefined) updates.name = data.name;
  if (data.codename !== undefined) updates.codename = data.codename;
  if (data.description !== undefined) updates.description = data.description;
  if (data.initialBriefing !== undefined)
    updates.initialBriefing = data.initialBriefing;
  if (data.devServerCommand !== undefined)
    updates.devServerCommand = data.devServerCommand;
  if (data.autoStartDevServer !== undefined)
    updates.autoStartDevServer = data.autoStartDevServer ? 1 : 0;
  if (data.defaultBranch !== undefined)
    updates.defaultBranch = data.defaultBranch;

  const record = db
    .update(battlefields)
    .set(updates)
    .where(eq(battlefields.id, id))
    .returning()
    .get();

  if (!record) {
    throw new Error(`updateBattlefield: battlefield ${id} not found`);
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);

  return record;
}

// ---------------------------------------------------------------------------
// deleteBattlefield
// ---------------------------------------------------------------------------
export async function deleteBattlefield(id: string): Promise<void> {
  const db = getDatabase();

  // Wrap everything in a transaction for FK-safe deletion order
  db.transaction((tx) => {
    // 1. Get all mission IDs for this battlefield
    const missionRows = tx
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.battlefieldId, id))
      .all();

    const missionIds = missionRows.map((r) => r.id);

    // 2. Delete mission logs
    if (missionIds.length > 0) {
      tx.delete(missionLogs)
        .where(inArray(missionLogs.missionId, missionIds))
        .run();
    }

    // 3. Delete missions
    tx.delete(missions).where(eq(missions.battlefieldId, id)).run();

    // 4. Get all campaign IDs for this battlefield
    const campaignRows = tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.battlefieldId, id))
      .all();

    const campaignIds = campaignRows.map((r) => r.id);

    // 5. Delete phases
    if (campaignIds.length > 0) {
      tx.delete(phases).where(inArray(phases.campaignId, campaignIds)).run();
    }

    // 6. Delete campaigns
    tx.delete(campaigns).where(eq(campaigns.battlefieldId, id)).run();

    // 7. Delete scheduled tasks
    tx.delete(scheduledTasks)
      .where(eq(scheduledTasks.battlefieldId, id))
      .run();

    // 8. Delete command logs
    tx.delete(commandLogs).where(eq(commandLogs.battlefieldId, id)).run();

    // 9. Delete the battlefield
    tx.delete(battlefields).where(eq(battlefields.id, id)).run();
  });

  revalidatePath('/projects');
}
