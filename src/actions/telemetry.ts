'use server';

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { eq, and, desc, inArray, sql, gte, like } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields, scheduledTasks, overseerLogs, notifications, missionLogs, assets } from '@/lib/db/schema';
import { getRepoPath } from '@/actions/_helpers';
import { config } from '@/lib/config';
import type {
  ProcessEntry,
  ResourceMetrics,
  ExitEntry,
  FailureType,
  ServiceHealthStatus,
  MissionStatus,
} from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get directory size in bytes using `du -sk`.
 * Returns 0 on error.
 */
function getDirSize(dirPath: string): number {
  try {
    const output = execSync(`du -sk "${dirPath}" 2>/dev/null`, {
      encoding: 'utf-8',
    }).trim();
    const kb = parseInt(output.split('\t')[0], 10);
    return isNaN(kb) ? 0 : kb * 1024;
  } catch {
    return 0;
  }
}

/**
 * Classify a mission failure type based on status, compromiseReason, and debrief text.
 * Returns null for non-failures or unclassifiable exits.
 */
function classifyFailure(
  status: string,
  compromiseReason: string | null,
  debrief: string | null,
): FailureType | null {
  if (status === 'accomplished') return null;

  if (compromiseReason === 'timeout') return 'timeout';
  if (compromiseReason === 'escalated') return 'stall_killed';
  if (compromiseReason === 'merge-failed') return null;

  // Text-based auth failure detection
  const text = (debrief ?? '').toLowerCase();
  if (text.includes('auth') || text.includes('token') || text.includes('unauthorized')) {
    return 'auth_failure';
  }

  if (status === 'abandoned') return 'killed';
  if (status === 'compromised') return 'cli_error';

  return null;
}

// ---------------------------------------------------------------------------
// Active Processes
// ---------------------------------------------------------------------------

const ACTIVE_PROCESS_STATUSES: MissionStatus[] = ['deploying', 'in_combat', 'reviewing'];

export async function getActiveProcesses(battlefieldId: string): Promise<ProcessEntry[]> {
  if (!globalThis.orchestrator) return [];

  const db = getDatabase();

  const rows = db
    .select({
      id: missions.id,
      title: missions.title,
      assetId: missions.assetId,
      status: missions.status,
      startedAt: missions.startedAt,
      updatedAt: missions.updatedAt,
    })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        inArray(missions.status, ACTIVE_PROCESS_STATUSES),
      ),
    )
    .all();

  // Fetch asset codenames in batch
  const assetIds = rows
    .map((r) => r.assetId)
    .filter((id): id is string => id !== null);

  const assetRows =
    assetIds.length > 0
      ? db
          .select({ id: assets.id, codename: assets.codename })
          .from(assets)
          .where(inArray(assets.id, assetIds))
          .all()
      : [];

  const assetMap = new Map(assetRows.map((a) => [a.id, a.codename]));

  return rows.map((row) => ({
    missionId: row.id,
    missionCodename: row.title,
    asset: assetMap.get(row.assetId ?? '') ?? 'unknown',
    pid: 0, // PIDs not tracked per-mission by the current orchestrator
    startedAt: row.startedAt ?? row.updatedAt,
    status: row.status as MissionStatus,
    memoryRss: 0, // not tracked
    lastOutputAt: row.updatedAt,
  }));
}

export async function killProcess(battlefieldId: string, missionId: string): Promise<void> {
  // Validate the mission belongs to this battlefield
  const db = getDatabase();
  const mission = db
    .select({ id: missions.id })
    .from(missions)
    .where(and(eq(missions.id, missionId), eq(missions.battlefieldId, battlefieldId)))
    .get();

  if (!mission) {
    throw new Error(`killProcess: mission ${missionId} not found in battlefield ${battlefieldId}`);
  }

  await globalThis.orchestrator?.onMissionAbort(missionId);
}

export async function killAllProcesses(battlefieldId: string): Promise<{ killed: number }> {
  const active = await getActiveProcesses(battlefieldId);
  let killed = 0;

  for (const proc of active) {
    try {
      await globalThis.orchestrator?.onMissionAbort(proc.missionId);
      killed++;
    } catch {
      // Continue — partial kill is acceptable
    }
  }

  return { killed };
}

// ---------------------------------------------------------------------------
// Resource Usage
// ---------------------------------------------------------------------------

export async function getResourceUsage(battlefieldId: string): Promise<ResourceMetrics> {
  const repoPath = await getRepoPath(battlefieldId);

  // Agent slots
  const active = globalThis.orchestrator?.getWorkingCount() ?? 0;
  const max = config.maxAgents;

  // Worktree disk
  const worktreesDir = path.join(repoPath, '.worktrees');
  const worktreeDisk = fs.existsSync(worktreesDir) ? getDirSize(worktreesDir) : 0;

  // Temp disk
  const tempDisk = getDirSize('/tmp/claude-config');

  // DB size (main + WAL)
  let dbSize = 0;
  try {
    const stat = fs.statSync(config.dbPath);
    dbSize = stat.size;
    // Include WAL file if present
    try {
      const walStat = fs.statSync(`${config.dbPath}-wal`);
      dbSize += walStat.size;
    } catch {
      // WAL may not exist
    }
  } catch {
    dbSize = 0;
  }

  // Socket connections
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketConnections = (globalThis.io as any)?.engine?.clientsCount ?? 0;

  return {
    agentSlots: { active, max },
    worktreeDisk,
    tempDisk,
    dbSize,
    socketConnections,
  };
}

// ---------------------------------------------------------------------------
// Recent Exits
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: MissionStatus[] = ['accomplished', 'compromised', 'abandoned'];

export async function getRecentExits(
  battlefieldId: string,
  filter?: 'accomplished' | 'compromised' | 'abandoned',
): Promise<ExitEntry[]> {
  const db = getDatabase();

  const statusFilter = filter
    ? [filter as MissionStatus]
    : TERMINAL_STATUSES;

  const rows = db
    .select({
      id: missions.id,
      title: missions.title,
      status: missions.status,
      compromiseReason: missions.compromiseReason,
      debrief: missions.debrief,
      startedAt: missions.startedAt,
      completedAt: missions.completedAt,
      durationMs: missions.durationMs,
    })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        inArray(missions.status, statusFilter),
      ),
    )
    .orderBy(desc(missions.completedAt))
    .limit(20)
    .all();

  return rows.map((row) => {
    // Approximate exit code: 0 = accomplished, 1 = compromised/abandoned
    const exitCode = row.status === 'accomplished' ? 0 : 1;

    const failureType = classifyFailure(
      row.status ?? '',
      row.compromiseReason ?? null,
      row.debrief ?? null,
    );

    return {
      missionId: row.id,
      missionCodename: row.title,
      exitCode,
      duration: row.durationMs ?? 0,
      failureType,
      timestamp: row.completedAt ?? 0,
    };
  });
}

export async function getExitContext(missionId: string): Promise<string[]> {
  const db = getDatabase();

  const rows = db
    .select({ content: missionLogs.content })
    .from(missionLogs)
    .where(eq(missionLogs.missionId, missionId))
    .orderBy(desc(missionLogs.timestamp))
    .limit(20)
    .all();

  // Reverse to return in chronological order
  return rows.map((r) => r.content).reverse();
}

// ---------------------------------------------------------------------------
// Service Health
// ---------------------------------------------------------------------------

const STALL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getServiceHealth(battlefieldId: string): Promise<ServiceHealthStatus> {
  const db = getDatabase();
  const now = Date.now();

  // --- Scheduler ---
  const schedulerInstance = globalThis.scheduler;
  const schedulerRunning = !!schedulerInstance;

  // lastTick: Scheduler doesn't expose a public lastTick, treat as null
  const lastTick: number | null = null;

  // Next fire: earliest enabled scheduled task for this battlefield
  const nextTaskRow = db
    .select({ nextRunAt: scheduledTasks.nextRunAt })
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.battlefieldId, battlefieldId),
        eq(scheduledTasks.enabled, 1),
      ),
    )
    .orderBy(scheduledTasks.nextRunAt)
    .limit(1)
    .all();

  const nextFire: number | null = nextTaskRow[0]?.nextRunAt ?? null;

  // --- Overseer ---
  const [overseerCountRow] = db
    .select({ total: sql<number>`count(*)` })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        eq(missions.status, 'reviewing'),
      ),
    )
    .all();

  const pendingReviews = overseerCountRow?.total ?? 0;

  const lastOverseerLog = db
    .select({ timestamp: overseerLogs.timestamp })
    .from(overseerLogs)
    .where(eq(overseerLogs.battlefieldId, battlefieldId))
    .orderBy(desc(overseerLogs.timestamp))
    .limit(1)
    .all();

  const lastReview: number | null = lastOverseerLog[0]?.timestamp ?? null;

  // --- Quartermaster ---
  const [qmCountRow] = db
    .select({ total: sql<number>`count(*)` })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
        inArray(missions.status, ['approved', 'merging']),
      ),
    )
    .all();

  const pendingMerges = qmCountRow?.total ?? 0;

  const lastMergeRow = db
    .select({ mergeTimestamp: missions.mergeTimestamp })
    .from(missions)
    .where(
      and(
        eq(missions.battlefieldId, battlefieldId),
      ),
    )
    .orderBy(desc(missions.mergeTimestamp))
    .limit(1)
    .all();

  const lastMerge: number | null = lastMergeRow[0]?.mergeTimestamp ?? null;

  // --- Stall Detection ---
  const stallCutoff = now - STALL_WINDOW_MS;

  const [stallCountRow] = db
    .select({ total: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        like(notifications.title, '%stall%'),
        gte(notifications.createdAt, stallCutoff),
      ),
    )
    .all();

  const count24h = stallCountRow?.total ?? 0;

  const latestStallRows = db
    .select({
      title: notifications.title,
      detail: notifications.detail,
      entityId: notifications.entityId,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        like(notifications.title, '%stall%'),
        gte(notifications.createdAt, stallCutoff),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1)
    .all();

  const latestStall = latestStallRows[0] ?? null;

  // Fetch mission codename for stall entry if we have an entityId
  let lastStall: ServiceHealthStatus['stallDetection']['lastStall'] = null;
  if (latestStall) {
    let missionCodename = latestStall.title;
    if (latestStall.entityId) {
      const missionRow = db
        .select({ title: missions.title })
        .from(missions)
        .where(eq(missions.id, latestStall.entityId))
        .get();
      if (missionRow) {
        missionCodename = missionRow.title;
      }
    }

    lastStall = {
      missionCodename,
      timestamp: latestStall.createdAt,
      overseerDecision: latestStall.detail,
    };
  }

  return {
    scheduler: {
      status: schedulerRunning ? 'running' : 'stalled',
      lastTick,
      nextFire,
      missedRuns: 0, // not tracked
    },
    overseer: {
      pendingReviews,
      avgReviewTime: null, // not tracked in current schema
      lastReview,
    },
    quartermaster: {
      pendingMerges,
      lastMerge,
    },
    stallDetection: {
      count24h,
      lastStall,
    },
  };
}
