import { eq, and, lte, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { scheduledTasks, battlefields, missions, campaigns, intelNotes, commandLogs } from '@/lib/db/schema';
import { getNextRun } from './cron';
import { generateId } from '@/lib/utils';
import { CronExpressionParser } from 'cron-parser';

export class Scheduler {
  private interval: NodeJS.Timeout | null = null;

  start(): void {
    console.log('[Scheduler] Starting — polling every 60s');
    this.tick();
    this.interval = setInterval(() => this.tick(), 60_000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[Scheduler] Stopped');
  }

  private tick(): void {
    const now = Date.now();
    const db = getDatabase();

    const dueTasks = db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.enabled, 1),
          lte(scheduledTasks.nextRunAt, now),
        ),
      )
      .all();

    // Group by dossierId (or fallback to name for legacy tasks)
    const groups = new Map<string, typeof dueTasks>();
    for (const task of dueTasks) {
      const key = task.dossierId ?? `legacy:${task.name}`;
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }

    for (const [key, tasks] of groups) {
      const battlefieldIds = tasks.map((t) => t.battlefieldId);

      try {
        this.executeDossier(key, battlefieldIds, tasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Dossier ${key} failed: ${message}`);
      }

      for (const task of tasks) {
        this.markExecuted(task, now);
      }
    }
  }

  private markExecuted(task: typeof scheduledTasks.$inferSelect, now: number): void {
    const db = getDatabase();
    try {
      const nextRun = getNextRun(task.cron);
      db.update(scheduledTasks)
        .set({
          lastRunAt: now,
          nextRunAt: nextRun,
          runCount: (task.runCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(scheduledTasks.id, task.id))
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Failed to update next run for task ${task.id}: ${message}`);
    }
  }

  private executeDossier(
    key: string,
    battlefieldIds: string[],
    tasks: (typeof scheduledTasks.$inferSelect)[],
  ): void {
    const dossierId = key.startsWith('legacy:') ? null : key;
    const legacyName = key.startsWith('legacy:') ? key.slice(7) : null;

    // Resolve which operation to run
    const operationId = dossierId ?? this.resolveLegacyDossier(legacyName);

    switch (operationId) {
      case 'worktree-sweep':
        this.runWorktreeSweep(battlefieldIds).catch((err: unknown) => {
          console.error(`[Scheduler] WORKTREE SWEEP failed:`, err);
        });
        break;
      case 'branch-sweep':
        this.runBranchSweep(battlefieldIds).catch((err: unknown) => {
          console.error(`[Scheduler] BRANCH SWEEP failed:`, err);
        });
        break;
      case 'activity-digest':
        this.runActivityDigest(battlefieldIds, tasks).catch((err: unknown) => {
          console.error(`[Scheduler] ACTIVITY DIGEST failed:`, err);
        });
        break;
      default:
        console.warn(`[Scheduler] Unknown dossier: ${key}`);
    }
  }

  /** Map legacy task names (no dossierId) to dossier IDs */
  private resolveLegacyDossier(name: string | null): string | null {
    if (!name) return null;
    switch (name) {
      case 'WORKTREE SWEEP': return 'worktree-sweep';
      default: return null;
    }
  }

  // ---------------------------------------------------------------------------
  // WORKTREE SWEEP (existing logic, moved from runMaintenance)
  // ---------------------------------------------------------------------------

  private async runWorktreeSweep(battlefieldIds: string[]): Promise<void> {
    const { cleanOrphanedWorktrees } = await import('@/lib/orchestrator/worktree');
    const db = getDatabase();
    const startTime = Date.now();

    const targetBattlefields = db
      .select()
      .from(battlefields)
      .where(inArray(battlefields.id, battlefieldIds))
      .all();

    const activeMissions = db
      .select({ id: missions.id })
      .from(missions)
      .where(
        inArray(missions.status, ['standby', 'queued', 'deploying', 'in_combat', 'reviewing', 'approved', 'merging']),
      )
      .all();
    const activeIds = activeMissions.map((m) => m.id);

    let totalCleaned = 0;
    const logLines: string[] = [`WORKTREE SWEEP — ${new Date().toISOString()}`];

    for (const bf of targetBattlefields) {
      const cleaned = await cleanOrphanedWorktrees(bf.repoPath, activeIds);
      const line = `  ${bf.codename}: ${cleaned} orphaned worktree${cleaned !== 1 ? 's' : ''} cleaned`;
      logLines.push(line);
      if (cleaned > 0) {
        console.log(`[Scheduler] WORKTREE SWEEP: cleaned ${cleaned} orphaned worktrees in ${bf.codename}`);
      }
      totalCleaned += cleaned;
    }

    const durationMs = Date.now() - startTime;
    logLines.push(`  Total: ${totalCleaned} cleaned in ${durationMs}ms`);
    const logOutput = logLines.join('\n');

    for (const bfId of battlefieldIds) {
      db.insert(commandLogs)
        .values({
          id: generateId(),
          battlefieldId: bfId,
          command: 'WORKTREE SWEEP',
          exitCode: 0,
          durationMs,
          output: logOutput,
          createdAt: Date.now(),
        })
        .run();
    }

    console.log(`[Scheduler] WORKTREE SWEEP complete: ${totalCleaned} total cleaned`);
  }

  // ---------------------------------------------------------------------------
  // BRANCH SWEEP
  // ---------------------------------------------------------------------------

  private async runBranchSweep(battlefieldIds: string[]): Promise<void> {
    const simpleGit = (await import('simple-git')).default;
    const db = getDatabase();
    const startTime = Date.now();

    const targetBattlefields = db
      .select()
      .from(battlefields)
      .where(inArray(battlefields.id, battlefieldIds))
      .all();

    const logLines: string[] = [`BRANCH SWEEP — ${new Date().toISOString()}`];
    let totalDeleted = 0;

    for (const bf of targetBattlefields) {
      const git = simpleGit(bf.repoPath);
      const defaultBranch = bf.defaultBranch || 'main';
      let bfDeleted = 0;

      try {
        // Prune remote tracking refs
        await git.fetch(['--prune']);

        // Get current branch to avoid deleting it
        const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

        // Delete merged branches
        const mergedRaw = await git.raw(['branch', '--merged', defaultBranch]);
        const mergedBranches = mergedRaw
          .split('\n')
          .map((b) => b.trim().replace(/^\*\s*/, ''))
          .filter((b) => b && b !== defaultBranch && b !== 'master' && b !== currentBranch);

        for (const branch of mergedBranches) {
          try {
            await git.branch(['-d', branch]);
            bfDeleted++;
          } catch {
            // Branch may be protected or already gone
          }
        }

        // Delete stale branches (no commits in 7+ days)
        const allBranchesRaw = await git.raw(['branch']);
        const allBranches = allBranchesRaw
          .split('\n')
          .map((b) => b.trim().replace(/^\*\s*/, ''))
          .filter((b) => b && b !== defaultBranch && b !== 'master' && b !== currentBranch && !mergedBranches.includes(b));

        const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const branch of allBranches) {
          try {
            const dateStr = (await git.raw(['log', '-1', '--format=%ci', branch])).trim();
            if (dateStr) {
              const commitDate = new Date(dateStr).getTime();
              if (commitDate < cutoffMs) {
                await git.branch(['-D', branch]);
                bfDeleted++;
              }
            }
          } catch {
            // Skip branches that can't be inspected
          }
        }

        logLines.push(`  ${bf.codename}: ${bfDeleted} branch${bfDeleted !== 1 ? 'es' : ''} deleted`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logLines.push(`  ${bf.codename}: ERROR — ${msg}`);
      }

      totalDeleted += bfDeleted;
    }

    const durationMs = Date.now() - startTime;
    logLines.push(`  Total: ${totalDeleted} deleted in ${durationMs}ms`);
    const logOutput = logLines.join('\n');

    for (const bfId of battlefieldIds) {
      db.insert(commandLogs)
        .values({
          id: generateId(),
          battlefieldId: bfId,
          command: 'BRANCH SWEEP',
          exitCode: 0,
          durationMs,
          output: logOutput,
          createdAt: Date.now(),
        })
        .run();
    }

    console.log(`[Scheduler] BRANCH SWEEP complete: ${totalDeleted} total deleted`);
  }

  // ---------------------------------------------------------------------------
  // ACTIVITY DIGEST
  // ---------------------------------------------------------------------------

  private async runActivityDigest(
    battlefieldIds: string[],
    tasks: (typeof scheduledTasks.$inferSelect)[],
  ): Promise<void> {
    const db = getDatabase();

    for (const bfId of battlefieldIds) {
      const bf = db
        .select()
        .from(battlefields)
        .where(eq(battlefields.id, bfId))
        .get();
      if (!bf) continue;

      // Compute report window from lastRunAt or cron interval
      const task = tasks.find((t) => t.battlefieldId === bfId);
      let windowStart: number;

      if (task?.lastRunAt) {
        windowStart = task.lastRunAt;
      } else {
        // Estimate from cron interval: find previous theoretical run
        try {
          const interval = CronExpressionParser.parse(task?.cron ?? '0 0 * * *');
          windowStart = interval.prev().getTime();
        } catch {
          windowStart = Date.now() - 24 * 60 * 60 * 1000; // fallback: 24h
        }
      }

      const now = Date.now();

      // Query missions in window
      const allMissions = db
        .select()
        .from(missions)
        .where(eq(missions.battlefieldId, bfId))
        .all()
        .filter((m) => m.createdAt >= windowStart);

      const accomplished = allMissions.filter((m) => m.status === 'accomplished').length;
      const compromised = allMissions.filter((m) => m.status === 'compromised').length;
      const totalMissions = allMissions.length;

      // Query campaigns completed in window
      const allCampaigns = db
        .select()
        .from(campaigns)
        .where(eq(campaigns.battlefieldId, bfId))
        .all()
        .filter((c) => c.updatedAt >= windowStart && (c.status === 'accomplished' || c.status === 'compromised'));
      const campaignsCompleted = allCampaigns.length;

      // Count open intel notes
      const openNotes = db
        .select()
        .from(intelNotes)
        .where(
          and(
            eq(intelNotes.battlefieldId, bfId),
            eq(intelNotes.column, 'tasked'),
          ),
        )
        .all().length;

      // Format window dates
      const startDate = new Date(windowStart).toISOString().slice(0, 16).replace('T', ' ');
      const endDate = new Date(now).toISOString().slice(0, 16).replace('T', ' ');

      const summary = [
        `ACTIVITY DIGEST — ${bf.codename}`,
        `Period: ${startDate} → ${endDate}`,
        '',
        `Missions: ${totalMissions} launched, ${accomplished} accomplished, ${compromised} compromised`,
        `Campaigns: ${campaignsCompleted} completed`,
        `Open Intel: ${openNotes} note${openNotes !== 1 ? 's' : ''} in tasked column`,
      ].join('\n');

      // Create notification via escalation system (handles DB + Telegram)
      const { escalate } = await import('@/lib/overseer/escalation');
      await escalate({
        level: 'info',
        title: `ACTIVITY DIGEST — ${bf.codename}`,
        detail: summary,
        entityType: undefined,
        entityId: undefined,
        battlefieldId: bfId,
      });

      console.log(`[Scheduler] ACTIVITY DIGEST sent for ${bf.codename}`);
    }
  }
}
