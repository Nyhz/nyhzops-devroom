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
  comms,
} from '@/lib/db/schema';
import { generateId, toKebabCase } from '@/lib/utils';
import { config } from '@/lib/config';
import { getGitIdentity } from '@/control/git-identity';
import { getNextRun } from '@/lib/scheduler/cron';
import { emitComm } from '@/control/comms';
import type { GateManifest, GateRunResults, RunGatesOptions } from '@/control/gates';
import { runGates as defaultRunGates } from '@/control/gates';
import {
  bootstrapBattlefield,
  type BootstrapOpts,
} from '@/control/bootstrap/bootstrap';
import type { SpawnAssetOpts, AssetRunResult } from '@/control/mission-runner';
import type {
  CreateBattlefieldInput,
  UpdateBattlefieldInput,
  BattlefieldWithCounts,
  Battlefield,
} from '@/types';

// ---------------------------------------------------------------------------
// Production spawnAsset adapter
//
// `bootstrapBattlefield` requires an `InjectedSpawnAsset` — a function typed
// as `(opts: SpawnAssetOpts) => Promise<AssetRunResult>`.  The real Claude
// subprocess launcher lives in `@/control/spawn-asset` and needs an expanded
// `SpawnAssetExtendedOpts` (including the full `asset` definition).  To avoid
// coupling this actions file to spawn internals at import time (and to let
// tests inject their own stub without vi.mock gymnastics), we load the real
// spawn lazily via a closure created once per call-site invocation.
//
// In production the adapter:
//   1. Looks up the INTEL asset record from the DB.
//   2. Forwards all base `SpawnAssetOpts` fields.
//   3. Fills in the extended fields from the asset row.
//
// Tests supply their own stub via `CreateBattlefieldDeps.spawnAsset`.
// ---------------------------------------------------------------------------
async function makeProductionSpawnAsset(): Promise<
  (opts: SpawnAssetOpts) => Promise<AssetRunResult>
> {
  // Dynamic import so the server bundle does not eagerly require the spawn
  // subprocess chain during page render.
  const { spawnAsset } = await import('@/control/spawn-asset');

  return async (opts: SpawnAssetOpts): Promise<AssetRunResult> => {
    const db = getDatabase();
    const assetRow = db
      .select()
      .from(assets)
      .where(eq(assets.codename, opts.assetCodename))
      .get();

    if (!assetRow) {
      throw new Error(
        `makeProductionSpawnAsset: asset "${opts.assetCodename}" not found`,
      );
    }

    const asset = {
      codename: assetRow.codename,
      model: assetRow.model ?? 'claude-sonnet-4-6',
      maxTurns: assetRow.maxTurns ?? 30,
      effort: assetRow.effort ?? 'medium',
      isSystem: assetRow.isSystem ?? 0,
      systemPrompt: assetRow.systemPrompt ?? '',
      skills: assetRow.skills ? (JSON.parse(assetRow.skills) as string[]) : [],
      mcpServers: assetRow.mcpServers
        ? (JSON.parse(assetRow.mcpServers) as unknown[])
        : [],
    };

    // rulesOfEngagement is empty for bootstrap scaffold — no mission context.
    return spawnAsset({
      ...opts,
      asset,
      rulesOfEngagement: '',
    });
  };
}

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
// Dependency injection interfaces
// ---------------------------------------------------------------------------

export interface CreateBattlefieldDeps {
  /** Injected bootstrap runner — defaults to the real bootstrapBattlefield.
   *  Tests pass a stub that records calls without running the pipeline. */
  runBootstrap?: (opts: BootstrapOpts) => Promise<void>;
}

export interface EstablishGatesDeps {
  runBootstrap?: (opts: BootstrapOpts) => Promise<void>;
}

export interface UpdateGateManifestDeps {
  runGates?: (opts: RunGatesOptions) => Promise<GateRunResults>;
}

// ---------------------------------------------------------------------------
// createBattlefield
// ---------------------------------------------------------------------------
export async function createBattlefield(
  data: CreateBattlefieldInput,
  deps: CreateBattlefieldDeps = {},
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
    // Ensure the default branch has a HEAD so later worktree operations can
    // resolve it. Without this, an empty repo fails `git worktree add <path>
    // main` with "fatal: invalid reference: main". If a scaffold command
    // runs it will commit its own files on top; if not, this empty commit
    // is all that exists until bootstrap commits CLAUDE.md / SPEC.md.
    {
      const id = getGitIdentity();
      await git.raw([
        '-c',
        `user.name=${id.name}`,
        '-c',
        `user.email=${id.email}`,
        'commit',
        '--allow-empty',
        '-m',
        'chore: initialize battlefield',
      ]);
    }
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

  let claudeMdPath: string | null = null;
  let specMdPath: string | null = null;

  if (data.skipBootstrap) {
    claudeMdPath = data.claudeMdPath ?? null;
    specMdPath = data.specMdPath ?? null;
  }

  // Commander-supplied CLAUDE.md / SPEC.md content — write to repo root so
  // bootstrap can detect them and skip (or narrow) the INTEL authoring step.
  // The files are NOT committed here; the Commander reviews via
  // <BootstrapReview /> and `approveBootstrap` commits both together.
  if (data.claudeMdContent && data.claudeMdContent.trim().length > 0) {
    fs.writeFileSync(path.join(repoPath, 'CLAUDE.md'), data.claudeMdContent, 'utf-8');
  }
  if (data.specMdContent && data.specMdContent.trim().length > 0) {
    fs.writeFileSync(path.join(repoPath, 'SPEC.md'), data.specMdContent, 'utf-8');
  }

  // Determine initial status: 'initializing' when bootstrap will run,
  // 'active' when skipped.
  const status: 'initializing' | 'active' = data.skipBootstrap ? 'active' : 'initializing';
  const needsGateManifest: number = data.skipBootstrap ? 0 : 1;

  const record = db.transaction(() => {
    return db
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
        needsGateManifest,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });

  emitComm({
    battlefieldId: id,
    actor: 'CONTROL',
    message: `Battlefield ${data.codename} created.${data.skipBootstrap ? ' Bootstrap skipped.' : ' Bootstrap queued.'}`,
    level: 'info',
  });

  // Fire-and-forget bootstrap unless explicitly skipped.
  if (!data.skipBootstrap) {
    const runBootstrap = deps.runBootstrap ?? _fireAndForgetBootstrap;
    runBootstrap({ battlefieldId: id, spawnAsset: async (opts) => (await makeProductionSpawnAsset())(opts) }).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[createBattlefield] background bootstrap failed for ${id}:`,
          err,
        );
        emitComm({
          battlefieldId: id,
          actor: 'CONTROL',
          level: 'error',
          message: `Bootstrap failed: ${msg}`,
        });
      },
    );
  }

  // Seed default maintenance tasks
  seedMaintenanceTasks(id);

  revalidatePath('/');
  revalidatePath(`/battlefields/${id}`);

  return record;
}

/** Internal no-op wrapper so the default bootstrap path is not imported at
 *  module evaluation time in Next.js pages that import this actions file. */
async function _fireAndForgetBootstrap(opts: BootstrapOpts): Promise<void> {
  await bootstrapBattlefield(opts);
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
  // CONTROL picks up DB status changes automatically — mark missions/campaigns
  // abandoned here; any running subprocesses will be cleaned up by the watchdog.
  if (battlefield) {
    const ACTIVE_MISSION_STATUSES = ['queued', 'deploying', 'in_combat', 'reviewing', 'approved', 'merging'] as const;
    db.update(missions).set({ status: 'abandoned', updatedAt: Date.now() })
      .where(and(eq(missions.battlefieldId, id), inArray(missions.status, [...ACTIVE_MISSION_STATUSES])))
      .run();

    const ACTIVE_CAMPAIGN_STATUSES = ['planning', 'active', 'paused'] as const;
    db.update(campaigns).set({ status: 'abandoned', updatedAt: Date.now() })
      .where(and(eq(campaigns.battlefieldId, id), inArray(campaigns.status, [...ACTIVE_CAMPAIGN_STATUSES])))
      .run();

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

    // Comms are battlefield-scoped (no FK constraint but cleanup for hygiene).
    tx.delete(comms).where(eq(comms.battlefieldId, id)).run();

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
// establishGates — re-run bootstrap detection + scaffold for a battlefield.
//
// Sets needsGateManifest=1 immediately (signals UI that work is pending),
// kicks off bootstrapBattlefield fire-and-forget, and returns.  The bootstrap
// pipeline itself clears needsGateManifest=0 when it completes.
// ---------------------------------------------------------------------------
export async function establishGates(
  battlefieldId: string,
  deps: EstablishGatesDeps = {},
): Promise<void> {
  const db = getDatabase();

  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!bf) {
    throw new Error(`establishGates: battlefield ${battlefieldId} not found`);
  }

  db.update(battlefields)
    .set({ needsGateManifest: 1, updatedAt: Date.now() })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  emitComm({
    battlefieldId,
    actor: 'CONTROL',
    message: 'Gate establishment ordered — bootstrap pipeline starting.',
    level: 'info',
  });

  const runBootstrap = deps.runBootstrap ?? _fireAndForgetBootstrap;
  runBootstrap({
    battlefieldId,
    spawnAsset: async (opts) => (await makeProductionSpawnAsset())(opts),
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[establishGates] background bootstrap failed for ${battlefieldId}:`,
      err,
    );
    emitComm({
      battlefieldId,
      actor: 'CONTROL',
      level: 'error',
      message: `Gate scaffold/detection failed: ${msg}`,
    });
  });

  revalidatePath(`/battlefields/${battlefieldId}`);
}

// ---------------------------------------------------------------------------
// updateGateManifest — persist a new gate manifest, optionally verifying
// against HEAD before saving.
//
// When verify=true: runs all gates; only persists if all-green.
// When verify=false (default): persists unconditionally.
// Returns { persisted, verifyResults? }.
// ---------------------------------------------------------------------------
export async function updateGateManifest(
  battlefieldId: string,
  manifest: GateManifest,
  opts?: { verify?: boolean },
  deps: UpdateGateManifestDeps = {},
): Promise<{ persisted: boolean; verifyResults?: GateRunResults }> {
  const db = getDatabase();

  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!bf) {
    throw new Error(`updateGateManifest: battlefield ${battlefieldId} not found`);
  }

  const runner = deps.runGates ?? defaultRunGates;

  if (opts?.verify) {
    const verifyResults = await runner({
      manifest,
      workingDir: bf.repoPath,
      perCommandTimeoutMs: 120_000,
      suiteTimeoutMs: 300_000,
    });

    const allGreen = verifyResults.overallStatus === 'pass';

    if (allGreen) {
      db.update(battlefields)
        .set({
          gateManifest: JSON.stringify(manifest),
          needsGateManifest: 0,
          updatedAt: Date.now(),
        })
        .where(eq(battlefields.id, battlefieldId))
        .run();

      emitComm({
        battlefieldId,
        actor: 'COMMANDER',
        message: 'Gate manifest updated and verified — all gates green on HEAD.',
        level: 'info',
      });

      revalidatePath(`/battlefields/${battlefieldId}`);
      return { persisted: true, verifyResults };
    }

    // One or more gates failed — do not persist.
    const failedGates = verifyResults.results
      .filter((r) => r.status !== 'pass' && r.status !== 'skipped')
      .map((r) => r.gate)
      .join(', ');

    emitComm({
      battlefieldId,
      actor: 'COMMANDER',
      message: `Gate manifest verify failed on: ${failedGates}. Manifest not saved.`,
      level: 'warn',
    });

    return { persisted: false, verifyResults };
  }

  // No verify requested — force-save.
  db.update(battlefields)
    .set({
      gateManifest: JSON.stringify(manifest),
      needsGateManifest: 0,
      updatedAt: Date.now(),
    })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  emitComm({
    battlefieldId,
    actor: 'COMMANDER',
    message: 'Gate manifest saved (no verification requested).',
    level: 'info',
  });

  revalidatePath(`/battlefields/${battlefieldId}`);
  return { persisted: true };
}

// ---------------------------------------------------------------------------
// toggleMainRedOverride — enable/disable the override_main_red_guard flag.
// ---------------------------------------------------------------------------
export async function toggleMainRedOverride(
  battlefieldId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDatabase();

  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!bf) {
    throw new Error(
      `toggleMainRedOverride: battlefield ${battlefieldId} not found`,
    );
  }

  db.update(battlefields)
    .set({
      overrideMainRedGuard: enabled ? 1 : 0,
      updatedAt: Date.now(),
    })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  emitComm({
    battlefieldId,
    actor: 'COMMANDER',
    message: `Main-red override ${enabled ? 'enabled' : 'disabled'}.`,
    level: enabled ? 'warn' : 'info',
  });

  revalidatePath(`/battlefields/${battlefieldId}`);
}

// ---------------------------------------------------------------------------
// pruneForensicBranches — delete local `forensic/*` branches older than
// `daysOld` days.
//
// Uses simple-git:
//   1. List branches matching `forensic/*`.
//   2. Get commit date via `git log -1 --format=%ct <branch>`.
//   3. Delete if older than cutoff.
//
// Returns { pruned: string[] }.
// ---------------------------------------------------------------------------
export async function pruneForensicBranches(
  battlefieldId: string,
  daysOld: number,
): Promise<{ pruned: string[] }> {
  const db = getDatabase();

  const bf = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!bf) {
    throw new Error(
      `pruneForensicBranches: battlefield ${battlefieldId} not found`,
    );
  }

  const git = simpleGit(bf.repoPath);
  const branches = await git.branchLocal();
  const forensicBranches = branches.all.filter((b) =>
    b.startsWith('forensic/'),
  );
  const currentBranch = branches.current;

  const cutoffMs = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const pruned: string[] = [];
  const skipped: string[] = [];

  for (const branch of forensicBranches) {
    if (branch === currentBranch) {
      skipped.push(branch);
      continue;
    }
    try {
      const output = await git.raw([
        'log',
        '-1',
        '--format=%ct',
        branch,
      ]);
      const commitTimestampSec = parseInt(output.trim(), 10);
      if (isNaN(commitTimestampSec)) continue;

      const commitMs = commitTimestampSec * 1000;
      if (commitMs < cutoffMs) {
        try {
          await git.raw(['branch', '-D', branch]);
          pruned.push(branch);
        } catch (err) {
          console.error(
            `[pruneForensicBranches] Failed to delete ${branch}:`,
            err,
          );
          skipped.push(branch);
        }
      }
    } catch (err) {
      console.error(
        `[pruneForensicBranches] Failed to read commit date for ${branch}:`,
        err,
      );
    }
  }

  if (skipped.length > 0) {
    emitComm({
      battlefieldId,
      actor: 'CONTROL',
      message: `Forensic prune skipped branch(es): ${skipped.join(', ')} (checked out or delete failed).`,
      level: 'warn',
    });
  }

  emitComm({
    battlefieldId,
    actor: 'COMMANDER',
    message:
      pruned.length > 0
        ? `Forensic branches pruned (>${daysOld}d): ${pruned.join(', ')}.`
        : `Forensic branch prune: no branches older than ${daysOld} days found.`,
    level: 'info',
  });

  revalidatePath(`/battlefields/${battlefieldId}`);
  return { pruned };
}

// ---------------------------------------------------------------------------
// approveBootstrap — commit generated files and activate battlefield.
//
// No orchestrator calls; git + DB only. Kept as-is for UI compatibility.
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
// regenerateBootstrap — delete generated files and re-run bootstrap pipeline.
//
// Replaces the old mission-creation flow with a direct bootstrapBattlefield
// call.  This means no bootstrap mission is created; the CONTROL bootstrap
// pipeline handles all detection + scaffold + verify directly.
// ---------------------------------------------------------------------------
export async function regenerateBootstrap(
  battlefieldId: string,
  briefing: string,
  deps: EstablishGatesDeps = {},
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

  // Update briefing and flag as needing bootstrap.
  db.update(battlefields)
    .set({
      initialBriefing: briefing,
      needsGateManifest: 1,
      status: 'initializing',
      updatedAt: Date.now(),
    })
    .where(eq(battlefields.id, battlefieldId))
    .run();

  emitComm({
    battlefieldId,
    actor: 'CONTROL',
    message: 'Bootstrap regeneration ordered — re-running pipeline.',
    level: 'info',
  });

  const runBootstrap = deps.runBootstrap ?? _fireAndForgetBootstrap;
  runBootstrap({
    battlefieldId,
    spawnAsset: async (opts) => (await makeProductionSpawnAsset())(opts),
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[regenerateBootstrap] background bootstrap failed for ${battlefieldId}:`,
      err,
    );
    emitComm({
      battlefieldId,
      actor: 'CONTROL',
      level: 'error',
      message: `Bootstrap regeneration failed: ${msg}`,
    });
  });

  revalidatePath(`/battlefields/${battlefieldId}`);
  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// abandonBootstrap — delete generated files and remove the battlefield.
//
// No orchestrator calls. Delegates to deleteBattlefield for cascade.
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
