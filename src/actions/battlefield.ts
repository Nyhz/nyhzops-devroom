'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, count, inArray, and, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { getDatabase } from '@/lib/db/index';
import {
  battlefields,
  missions,
  campaigns,
  phases,
  assets,
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
// createBootstrapMission — helper to create the bootstrap mission for a new battlefield
// ---------------------------------------------------------------------------
function createBootstrapMission(
  battlefieldId: string,
  codename: string,
  briefing: string,
): string {
  const db = getDatabase();

  // Find ARCHITECT asset, fall back to any active asset
  let asset = db
    .select()
    .from(assets)
    .where(eq(assets.codename, 'ARCHITECT'))
    .get();

  if (!asset) {
    asset = db
      .select()
      .from(assets)
      .where(eq(assets.status, 'active'))
      .limit(1)
      .get();
  }

  if (!asset) {
    throw new Error('createBootstrapMission: no active assets available');
  }

  const missionId = generateId();
  const now = Date.now();

  db.insert(missions)
    .values({
      id: missionId,
      battlefieldId,
      type: 'bootstrap',
      title: `Bootstrap: ${codename}`,
      briefing,
      priority: 'critical',
      status: 'queued',
      assetId: asset.id,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return missionId;
}

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

  // Determine status and bootstrap mission
  let status: 'initializing' | 'active' = 'active';
  let bootstrapMissionId: string | null = null;
  let claudeMdPath: string | null = null;
  let specMdPath: string | null = null;

  if (data.skipBootstrap) {
    status = 'active';
    claudeMdPath = data.claudeMdPath ?? null;
    specMdPath = data.specMdPath ?? null;
  } else if (data.initialBriefing?.trim()) {
    status = 'initializing';
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
      claudeMdPath,
      specMdPath,
      status,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  // Create bootstrap mission if not skipping and briefing provided
  if (!data.skipBootstrap && data.initialBriefing?.trim()) {
    bootstrapMissionId = createBootstrapMission(id, data.codename, data.initialBriefing.trim());

    db.update(battlefields)
      .set({ bootstrapMissionId, updatedAt: Date.now() })
      .where(eq(battlefields.id, id))
      .run();

    // If no scaffold command, trigger orchestrator immediately
    // If there IS a scaffold command, the scaffold route will trigger after completion
    if (!data.scaffoldCommand) {
      globalThis.orchestrator?.onMissionQueued(bootstrapMissionId);
    }
  }

  revalidatePath('/battlefields');
  revalidatePath(`/battlefields/${id}`);

  return { ...record, bootstrapMissionId };
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

  revalidatePath('/battlefields');
  revalidatePath(`/battlefields/${id}`);

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

  revalidatePath('/battlefields');
}

// ---------------------------------------------------------------------------
// approveBootstrap — commit generated files and activate battlefield
// ---------------------------------------------------------------------------
export async function approveBootstrap(battlefieldId: string): Promise<void> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield || battlefield.status !== 'initializing') {
    throw new Error('Battlefield not found or not in initializing state');
  }

  const git = simpleGit(battlefield.repoPath);
  await git.add(['CLAUDE.md', 'SPEC.md']);
  await git.commit('Bootstrap: add CLAUDE.md and SPEC.md');

  db.update(battlefields)
    .set({
      claudeMdPath: path.join(battlefield.repoPath, 'CLAUDE.md'),
      specMdPath: path.join(battlefield.repoPath, 'SPEC.md'),
      status: 'active',
      updatedAt: Date.now(),
    })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  revalidatePath(`/battlefields/${battlefieldId}`);
  revalidatePath('/battlefields');
}

// ---------------------------------------------------------------------------
// regenerateBootstrap — delete generated files and re-run bootstrap with new briefing
// ---------------------------------------------------------------------------
export async function regenerateBootstrap(
  battlefieldId: string,
  briefing: string,
): Promise<void> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield || battlefield.status !== 'initializing') {
    throw new Error('Battlefield not found or not in initializing state');
  }

  // Delete generated files
  try { fs.unlinkSync(path.join(battlefield.repoPath, 'CLAUDE.md')); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(battlefield.repoPath, 'SPEC.md')); } catch { /* ignore */ }

  // Update briefing on battlefield
  db.update(battlefields)
    .set({ initialBriefing: briefing, updatedAt: Date.now() })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  // Increment iterations on old bootstrap mission
  if (battlefield.bootstrapMissionId) {
    const oldMission = db
      .select()
      .from(missions)
      .where(eq(missions.id, battlefield.bootstrapMissionId))
      .get();

    if (oldMission) {
      db.update(missions)
        .set({ iterations: (oldMission.iterations ?? 0) + 1, updatedAt: Date.now() })
        .where(eq(missions.id, battlefield.bootstrapMissionId))
        .run();
    }
  }

  // Create new bootstrap mission
  const newMissionId = createBootstrapMission(
    battlefieldId,
    battlefield.codename,
    briefing,
  );

  // Update battlefield with new bootstrap mission
  db.update(battlefields)
    .set({ bootstrapMissionId: newMissionId, updatedAt: Date.now() })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  // Trigger orchestrator
  globalThis.orchestrator?.onMissionQueued(newMissionId);

  revalidatePath(`/battlefields/${battlefieldId}`);
  revalidatePath('/battlefields');
}

// ---------------------------------------------------------------------------
// abandonBootstrap — delete generated files and remove the battlefield
// ---------------------------------------------------------------------------
export async function abandonBootstrap(battlefieldId: string): Promise<void> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield || battlefield.status !== 'initializing') {
    throw new Error('Battlefield not found or not in initializing state');
  }

  // Delete generated files from disk
  try { fs.unlinkSync(path.join(battlefield.repoPath, 'CLAUDE.md')); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(battlefield.repoPath, 'SPEC.md')); } catch { /* ignore */ }

  // Cascade delete the battlefield
  await deleteBattlefield(battlefieldId);

  revalidatePath('/battlefields');
}

// ---------------------------------------------------------------------------
// writeBootstrapFile — write CLAUDE.md or SPEC.md content during bootstrap review
// ---------------------------------------------------------------------------
export async function writeBootstrapFile(
  battlefieldId: string,
  filename: string,
  content: string,
): Promise<void> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield || battlefield.status !== 'initializing') {
    throw new Error('Battlefield not found or not in initializing state');
  }

  if (filename !== 'CLAUDE.md' && filename !== 'SPEC.md') {
    throw new Error('writeBootstrapFile: only CLAUDE.md and SPEC.md are allowed');
  }

  fs.writeFileSync(path.join(battlefield.repoPath, filename), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// readBootstrapFile — read CLAUDE.md or SPEC.md content during bootstrap review
// ---------------------------------------------------------------------------
export async function readBootstrapFile(
  battlefieldId: string,
  filename: string,
): Promise<string> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield) {
    throw new Error(`readBootstrapFile: battlefield ${battlefieldId} not found`);
  }

  if (filename !== 'CLAUDE.md' && filename !== 'SPEC.md') {
    throw new Error('readBootstrapFile: only CLAUDE.md and SPEC.md are allowed');
  }

  try {
    return fs.readFileSync(path.join(battlefield.repoPath, filename), 'utf-8');
  } catch {
    return '';
  }
}
