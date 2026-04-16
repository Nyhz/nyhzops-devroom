import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import { sweepStaleMissions, WatchdogDeps } from '@/control/watchdog';
import { createMissionWorktree } from '@/control/worktree';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, missionAttempts, comms } from '@/lib/db/schema';
import {
  materializeRepo,
  MaterializedRepo,
} from '@/../tests/control/fixtures/repos/materialize';

const db = getDatabase();

function insertBattlefield(id: string, repoPath: string) {
  db.insert(battlefields)
    .values({
      id,
      name: 'TEST',
      codename: 'TEST',
      repoPath,
      defaultBranch: 'master',
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function insertMission(row: Partial<typeof missions.$inferInsert> & { id: string; battlefieldId: string; status: string; updatedAt: number }) {
  db.insert(missions)
    .values({
      title: 'test mission',
      briefing: 'do a thing',
      type: 'combat',
      createdAt: row.updatedAt,
      ...row,
    } as typeof missions.$inferInsert)
    .run();
}

describe('sweepStaleMissions', () => {
  let repo: MaterializedRepo;

  beforeEach(async () => {
    db.delete(missionAttempts).run();
    db.delete(comms).run();
    db.delete(missions).run();
    db.delete(battlefields).run();
    repo = await materializeRepo('ts-with-tests');
  });

  afterEach(async () => {
    if (repo) await repo.cleanup();
  });

  it('heals IN_COMBAT mission with no live pid → queued + infra attempt row', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    insertMission({
      id: 'm1',
      battlefieldId: 'bf-1',
      status: 'in_combat',
      updatedAt: now - 60 * 60 * 1000, // 1h stale
    });

    const res = await sweepStaleMissions({
      livePids: new Map(),
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    } as WatchdogDeps);

    expect(res.healed).toBe(1);
    expect(res.cleaned).toBe(0);

    const m = db.select().from(missions).where(eq(missions.id, 'm1')).get();
    expect(m?.status).toBe('queued');

    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, 'm1'))
      .all();
    expect(attempts.length).toBe(1);
    expect(attempts[0].endReason).toBe('infrastructure');
    expect(attempts[0].attemptNumber).toBe(1);

    const events = db.select().from(comms).where(eq(comms.missionId, 'm1')).all();
    expect(events.some((e) => e.message.includes('Watchdog healed'))).toBe(true);
  });

  it('skips stale transient mission when its pid is still live', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    insertMission({
      id: 'm-live',
      battlefieldId: 'bf-1',
      status: 'in_combat',
      updatedAt: now - 60 * 60 * 1000,
    });

    const livePids = new Map<string, number>([['m-live', 4242]]);
    const res = await sweepStaleMissions({
      livePids,
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    });

    expect(res.healed).toBe(0);
    const m = db.select().from(missions).where(eq(missions.id, 'm-live')).get();
    expect(m?.status).toBe('in_combat');
    const attempts = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, 'm-live'))
      .all();
    expect(attempts.length).toBe(0);
  });

  it('leaves fresh transient missions alone (updatedAt within threshold)', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    insertMission({
      id: 'm-fresh',
      battlefieldId: 'bf-1',
      status: 'deploying',
      updatedAt: now - 60 * 1000, // 60s ago — not stale
    });

    const res = await sweepStaleMissions({
      livePids: new Map(),
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    });

    expect(res.healed).toBe(0);
  });

  it('increments attemptNumber from existing attempts on heal', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    insertMission({
      id: 'm2',
      battlefieldId: 'bf-1',
      status: 'merging',
      updatedAt: now - 60 * 60 * 1000,
    });
    // Seed two prior attempts.
    for (let i = 1; i <= 2; i++) {
      db.insert(missionAttempts)
        .values({
          id: `att-${i}`,
          missionId: 'm2',
          attemptNumber: i,
          startedAt: now - 1000,
          endedAt: now,
          endReason: 'clean',
        } as typeof missionAttempts.$inferInsert)
        .run();
    }

    await sweepStaleMissions({
      livePids: new Map(),
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    });

    const all = db
      .select()
      .from(missionAttempts)
      .where(eq(missionAttempts.missionId, 'm2'))
      .all();
    expect(all.length).toBe(3);
    const infra = all.find((a) => a.endReason === 'infrastructure');
    expect(infra?.attemptNumber).toBe(3);
  });

  it('cleans orphaned worktree for ACCOMPLISHED mission', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    const branch = 'devroom/m-done/1';
    const wt = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: branch,
    });
    expect(existsSync(wt.path)).toBe(true);

    insertMission({
      id: 'm-done',
      battlefieldId: 'bf-1',
      status: 'accomplished',
      worktreeBranch: branch,
      updatedAt: now,
    });

    const res = await sweepStaleMissions({
      livePids: new Map(),
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    });

    expect(res.cleaned).toBe(1);
    expect(existsSync(wt.path)).toBe(false);

    const branches = await simpleGit(repo.path).branch();
    expect(branches.all).not.toContain(branch);

    const events = db.select().from(comms).where(eq(comms.missionId, 'm-done')).all();
    expect(events.some((e) => e.message.includes('orphaned worktree'))).toBe(true);
  });

  it('cleans orphaned worktree for ABANDONED mission', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    const branch = 'devroom/m-aband/1';
    const wt = await createMissionWorktree({
      repoPath: repo.path,
      targetBranch: 'master',
      missionBranch: branch,
    });

    insertMission({
      id: 'm-aband',
      battlefieldId: 'bf-1',
      status: 'abandoned',
      worktreeBranch: branch,
      updatedAt: now,
    });

    const res = await sweepStaleMissions({
      livePids: new Map(),
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    });

    expect(res.cleaned).toBe(1);
    expect(existsSync(wt.path)).toBe(false);
  });

  it('skips terminal missions that have no worktree artifacts', async () => {
    insertBattlefield('bf-1', repo.path);
    const now = Date.now();
    insertMission({
      id: 'm-clean',
      battlefieldId: 'bf-1',
      status: 'accomplished',
      worktreeBranch: 'devroom/never-existed/1',
      updatedAt: now,
    });
    const res = await sweepStaleMissions({
      livePids: new Map(),
      now: () => now,
      staleThresholdMs: 30 * 60 * 1000,
    });
    expect(res.cleaned).toBe(0);

    // Also confirm expected sanitized path was the one checked.
    const checked = path.join(repo.path, '.worktrees', 'devroom-never-existed-1');
    expect(existsSync(checked)).toBe(false);
  });
});
