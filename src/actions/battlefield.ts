'use server';

import { revalidatePath } from 'next/cache';
import { eq, desc, count, inArray, and } from 'drizzle-orm';
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
  briefingSessions,
  briefingMessages,
  overseerLogs,
  notifications,
  generalSessions,
  generalMessages,
  testRuns,
  followUpSuggestions,
  intelNotes,
} from '@/lib/db/schema';
import { generateId, toKebabCase } from '@/lib/utils';
import { config } from '@/lib/config';
import { getNextRun } from '@/lib/scheduler/cron';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
import type {
  CreateBattlefieldInput,
  UpdateBattlefieldInput,
  BattlefieldWithCounts,
  Battlefield,
} from '@/types';

// ---------------------------------------------------------------------------
// seedMaintenanceTasks — create default maintenance tasks for a battlefield
// ---------------------------------------------------------------------------
function seedMaintenanceTasks(battlefieldId: string): void {
  const db = getDatabase();

  const existing = db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.battlefieldId, battlefieldId),
        eq(scheduledTasks.name, 'WORKTREE SWEEP'),
      ),
    )
    .get();

  if (!existing) {
    db.insert(scheduledTasks)
      .values({
        id: generateId(),
        battlefieldId,
        name: 'WORKTREE SWEEP',
        type: 'maintenance',
        cron: '0 3 * * *',
        enabled: 1,
        nextRunAt: getNextRun('0 3 * * *'),
        runCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }
}

// ---------------------------------------------------------------------------
// createBootstrapMission — helper to create the bootstrap mission for a new battlefield
// ---------------------------------------------------------------------------
function createBootstrapMission(
  battlefieldId: string,
  codename: string,
  briefing: string,
): string {
  const db = getDatabase();

  const asset = db
    .select()
    .from(assets)
    .where(eq(assets.codename, 'INTEL'))
    .get();

  if (!asset) {
    throw new Error('INTEL asset required for bootstrap — no fallback to other assets');
  }

  const missionId = generateId();
  const now = Date.now();

  db.insert(missions)
    .values({
      id: missionId,
      battlefieldId,
      type: 'combat',
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
    const git = simpleGit(dirPath);
    await git.init();
    await git.raw(['branch', '-m', defaultBranch]);
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

  const record = db.transaction(() => {
    const inserted = db
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
    }

    return inserted;
  });

  // Trigger orchestrator after transaction — outside DB writes
  if (bootstrapMissionId && !data.scaffoldCommand) {
    safeQueueMission(bootstrapMissionId);
  }

  // Seed default maintenance tasks
  seedMaintenanceTasks(id);

  revalidatePath('/');
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

  revalidatePath('/');
  revalidatePath(`/battlefields/${id}`);

  return record;
}

// ---------------------------------------------------------------------------
// archiveBattlefield
// ---------------------------------------------------------------------------
export async function archiveBattlefield(id: string): Promise<void> {
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  if (!battlefield) {
    throw new Error(`archiveBattlefield: battlefield ${id} not found`);
  }

  if (battlefield.status === 'archived') {
    throw new Error(`archiveBattlefield: battlefield ${id} is already archived`);
  }

  db.update(battlefields)
    .set({ status: 'archived', updatedAt: Date.now() })
    .where(eq(battlefields.id, id))
    .run();

  revalidatePath('/');
  revalidatePath(`/battlefields/${id}`);
}

// ---------------------------------------------------------------------------
// deleteBattlefield — obliterate every trace of a battlefield.
//
// Order of operations:
//   1. Abort running missions and campaigns so no child process is still
//      writing to the worktree/repo while we tear it down.
//   2. Stop the battlefield's dev server if DEVROOM launched one.
//   3. DB cascade delete (descendants first — see schema.ts for FK graph).
//   4. Filesystem cleanup — worktrees, generated docs, and (for new-project
//      flow) the repo directory itself.
// ---------------------------------------------------------------------------
export async function deleteBattlefield(id: string): Promise<void> {
  const db = getDatabase();

  // Snapshot what we need from the row before the cascade removes it.
  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  // --- Step 1: abort in-flight work ---------------------------------------
  if (battlefield) {
    const orchestrator = globalThis.orchestrator;
    if (orchestrator) {
      const ACTIVE_MISSION_STATUSES = ['queued', 'deploying', 'in_combat', 'reviewing', 'approved', 'merging'] as const;
      const activeMissions = db
        .select({ id: missions.id })
        .from(missions)
        .where(and(eq(missions.battlefieldId, id), inArray(missions.status, [...ACTIVE_MISSION_STATUSES])))
        .all();
      for (const m of activeMissions) {
        try { await orchestrator.onMissionAbort(m.id); } catch (err) {
          console.error(`[deleteBattlefield] Failed to abort mission ${m.id}:`, err);
        }
      }

      const ACTIVE_CAMPAIGN_STATUSES = ['planning', 'active', 'paused'] as const;
      const activeCampaigns = db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.battlefieldId, id), inArray(campaigns.status, [...ACTIVE_CAMPAIGN_STATUSES])))
        .all();
      for (const c of activeCampaigns) {
        try { await orchestrator.abortCampaign(c.id); } catch (err) {
          console.error(`[deleteBattlefield] Failed to abort campaign ${c.id}:`, err);
        }
      }
    }

    // --- Step 2: stop dev server ------------------------------------------
    try { globalThis.devServerManager?.stop(id); } catch (err) {
      console.error(`[deleteBattlefield] Failed to stop dev server for ${id}:`, err);
    }
  }

  // --- Step 3: DB cascade -------------------------------------------------
  // Wrap everything in a transaction for FK-safe deletion order.
  // Order: descendants before ancestors. See schema.ts for the FK graph.
  db.transaction((tx) => {
    // Gather ids we'll need for cascades
    const missionIds = tx
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.battlefieldId, id))
      .all()
      .map((r) => r.id);

    const campaignIds = tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.battlefieldId, id))
      .all()
      .map((r) => r.id);

    const briefingIds =
      campaignIds.length > 0
        ? tx
            .select({ id: briefingSessions.id })
            .from(briefingSessions)
            .where(inArray(briefingSessions.campaignId, campaignIds))
            .all()
            .map((r) => r.id)
        : [];

    const generalSessionIds = tx
      .select({ id: generalSessions.id })
      .from(generalSessions)
      .where(eq(generalSessions.battlefieldId, id))
      .all()
      .map((r) => r.id);

    // Deepest leaves first ---------------------------------------------------
    if (briefingIds.length > 0) {
      tx.delete(briefingMessages)
        .where(inArray(briefingMessages.briefingId, briefingIds))
        .run();
    }

    if (generalSessionIds.length > 0) {
      tx.delete(generalMessages)
        .where(inArray(generalMessages.sessionId, generalSessionIds))
        .run();
    }

    if (missionIds.length > 0) {
      tx.delete(missionLogs)
        .where(inArray(missionLogs.missionId, missionIds))
        .run();
    }

    // Tables that reference missions/campaigns/intel_notes/battlefield ------
    // follow_up_suggestions references intel_notes, so it goes first.
    tx.delete(followUpSuggestions)
      .where(eq(followUpSuggestions.battlefieldId, id))
      .run();

    tx.delete(overseerLogs)
      .where(eq(overseerLogs.battlefieldId, id))
      .run();

    tx.delete(intelNotes).where(eq(intelNotes.battlefieldId, id)).run();

    tx.delete(testRuns).where(eq(testRuns.battlefieldId, id)).run();

    if (briefingIds.length > 0) {
      tx.delete(briefingSessions)
        .where(inArray(briefingSessions.id, briefingIds))
        .run();
    }

    if (generalSessionIds.length > 0) {
      tx.delete(generalSessions)
        .where(inArray(generalSessions.id, generalSessionIds))
        .run();
    }

    // notifications.battlefieldId has no FK, but still scope-delete for hygiene
    tx.delete(notifications)
      .where(eq(notifications.battlefieldId, id))
      .run();

    // Missions reference phases via phase_id — drop missions before phases.
    // Missions also reference campaigns via campaign_id — so missions first,
    // then phases, then campaigns.
    tx.delete(missions).where(eq(missions.battlefieldId, id)).run();

    if (campaignIds.length > 0) {
      tx.delete(phases).where(inArray(phases.campaignId, campaignIds)).run();
    }

    // scheduled_tasks.campaign_id references campaigns — drop tasks first.
    tx.delete(scheduledTasks)
      .where(eq(scheduledTasks.battlefieldId, id))
      .run();

    tx.delete(campaigns).where(eq(campaigns.battlefieldId, id)).run();

    tx.delete(commandLogs).where(eq(commandLogs.battlefieldId, id)).run();

    tx.delete(battlefields).where(eq(battlefields.id, id)).run();
  });

  // --- Step 4: filesystem obliteration ------------------------------------
  if (battlefield?.repoPath) {
    const repoPath = battlefield.repoPath;
    const devBase = path.resolve(config.devBasePath);
    const resolvedRepo = path.resolve(repoPath);
    const isDevroomOwned =
      resolvedRepo === devBase ? false : resolvedRepo.startsWith(`${devBase}${path.sep}`);

    if (isDevroomOwned) {
      // New-project flow: DEVROOM created this directory — nuke the whole repo.
      try {
        if (fs.existsSync(repoPath)) {
          fs.rmSync(repoPath, { recursive: true, force: true });
        }
      } catch (err) {
        console.error(`[deleteBattlefield] Failed to remove repo ${repoPath}:`, err);
      }
    } else {
      // Linked flow: user owns the repo. Only remove DEVROOM artifacts.
      const worktreesDir = path.join(repoPath, '.worktrees');
      try {
        if (fs.existsSync(worktreesDir)) {
          fs.rmSync(worktreesDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.error(`[deleteBattlefield] Failed to remove ${worktreesDir}:`, err);
      }

      // Tell git the worktrees are gone, then delete every branch that was
      // tracked by one. Names are generated as `mission/<id>` / `campaign/<id>`
      // by createWorktree, so scoped prefix deletion is safe.
      try {
        if (fs.existsSync(path.join(repoPath, '.git'))) {
          const git = simpleGit(repoPath);
          await git.raw(['worktree', 'prune']);
          const branches = await git.branchLocal();
          for (const name of branches.all) {
            if (name.startsWith('mission/') || name.startsWith('campaign/')) {
              try { await git.raw(['branch', '-D', name]); } catch { /* ignore */ }
            }
          }
        }
      } catch (err) {
        console.error(`[deleteBattlefield] Git cleanup failed for ${repoPath}:`, err);
      }

      // Remove bootstrap-generated docs if they were produced by DEVROOM.
      if (battlefield.claudeMdPath) {
        try { fs.unlinkSync(battlefield.claudeMdPath); } catch { /* ignore */ }
      }
      if (battlefield.specMdPath) {
        try { fs.unlinkSync(battlefield.specMdPath); } catch { /* ignore */ }
      }
    }
  }

  revalidatePath('/');
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
  revalidatePath('/');
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
  safeQueueMission(newMissionId);

  revalidatePath(`/battlefields/${battlefieldId}`);
  revalidatePath('/');
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

  revalidatePath('/');
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
