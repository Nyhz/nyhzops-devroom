import { getDatabase } from '@/lib/db';
import { missions, missionAttempts, battlefields } from '@/lib/db/schema';
import { eq, and, inArray, lt } from 'drizzle-orm';
import { removeMissionWorktree, sanitizeBranchForPath } from './worktree';
import { emitComm } from './comms';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ulid } from 'ulid';

export interface WatchdogDeps {
  /** Map of missionId -> pid for live in-memory processes. */
  livePids: Map<string, number>;
  /** Clock injection (testable). */
  now: () => number;
  /** How long a mission may remain in a transient state without pid before healing. */
  staleThresholdMs: number;
}

const TRANSIENT_STATES = ['deploying', 'in_combat', 'merging'] as const;
const TERMINAL_STATES = ['accomplished', 'abandoned'] as const;

/**
 * Watchdog sweep (L6):
 *  (a) stale missions in transient states with no live pid → mark last attempt as
 *      `infrastructure` and return to `queued` for INFRASTRUCTURE backoff retry.
 *  (b) terminal missions whose worktree artifacts still exist → call removeMissionWorktree.
 *
 * Pure side-effect module driven by injected dependencies. Safe to run periodically.
 */
export async function sweepStaleMissions(
  deps: WatchdogDeps,
): Promise<{ healed: number; cleaned: number }> {
  const db = getDatabase();
  const cutoff = deps.now() - deps.staleThresholdMs;

  // (a) Heal stale transient missions.
  const stale = db
    .select()
    .from(missions)
    .where(
      and(
        inArray(missions.status, TRANSIENT_STATES as unknown as string[]),
        lt(missions.updatedAt, cutoff),
      ),
    )
    .all();

  let healed = 0;
  for (const m of stale) {
    if (deps.livePids.has(m.id)) continue;
    const existing = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, m.id))
      .all();
    const attemptNumber = existing.length + 1;
    db.insert(missionAttempts)
      .values({
        id: ulid(),
        missionId: m.id,
        attemptNumber,
        startedAt: m.updatedAt,
        endedAt: deps.now(),
        endReason: 'infrastructure',
        classification: JSON.stringify({ reason: 'watchdog-heal: no live pid' }),
      })
      .run();
    db.update(missions)
      .set({ status: 'queued', updatedAt: deps.now() })
      .where(eq(missions.id, m.id))
      .run();
    emitComm({
      missionId: m.id,
      message: `Watchdog healed stale mission (was ${m.status}).`,
      level: 'warn',
    });
    healed++;
  }

  // (b) Post-resolution sweep: clean orphaned worktree artifacts for terminal missions.
  const terminal = db
    .select()
    .from(missions)
    .where(inArray(missions.status, TERMINAL_STATES as unknown as string[]))
    .all();

  let cleaned = 0;
  for (const m of terminal) {
    if (!m.worktreeBranch) continue;
    const bf = db
      .select()
      .from(battlefields)
      .where(eq(battlefields.id, m.battlefieldId))
      .get();
    if (!bf) continue;
    const wtDir = path.join(
      bf.repoPath,
      '.worktrees',
      sanitizeBranchForPath(m.worktreeBranch),
    );
    if (existsSync(wtDir)) {
      await removeMissionWorktree({
        repoPath: bf.repoPath,
        worktreePath: wtDir,
        branch: m.worktreeBranch,
        deleteBranch: true,
      });
      emitComm({
        missionId: m.id,
        message: 'Watchdog cleaned orphaned worktree.',
      });
      cleaned++;
    }
  }

  return { healed, cleaned };
}
