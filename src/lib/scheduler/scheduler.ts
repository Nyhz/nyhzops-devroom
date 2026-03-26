import { eq, and, lte, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { scheduledTasks, battlefields, missions } from '@/lib/db/schema';
import { getNextRun } from './cron';
import { createAndDeployMission } from '@/actions/mission';

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

    for (const task of dueTasks) {
      try {
        this.executeTask(task);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Task ${task.id} (${task.name}) failed: ${message}`);
      }

      // Update lastRunAt, nextRunAt, runCount
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
  }

  private executeTask(task: typeof scheduledTasks.$inferSelect): void {
    if (task.type === 'mission' && task.missionTemplate) {
      const template = JSON.parse(task.missionTemplate) as {
        title?: string;
        briefing?: string;
        assetId?: string;
        priority?: string;
      };

      createAndDeployMission({
        battlefieldId: task.battlefieldId,
        title: `[Scheduled] ${template.title || task.name}`,
        briefing: template.briefing || task.name,
        assetId: template.assetId,
        priority: (template.priority as 'low' | 'normal' | 'high' | 'critical') || 'normal',
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Failed to create mission for task ${task.name}: ${message}`);
      });
    } else if (task.type === 'campaign' && task.campaignId) {
      // Import runTemplate dynamically to avoid circular deps
      import('@/actions/campaign').then(({ runTemplate }) => {
        runTemplate(task.campaignId!).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[Scheduler] Failed to run template for task ${task.name}: ${message}`);
        });
      });
    } else if (task.type === 'maintenance') {
      // Internal maintenance tasks like WORKTREE SWEEP
      this.runMaintenance(task);
    }
  }

  private async runMaintenance(task: typeof scheduledTasks.$inferSelect): Promise<void> {
    if (task.name === 'WORKTREE SWEEP') {
      const { cleanOrphanedWorktrees } = await import('@/lib/orchestrator/worktree');
      const db = getDatabase();

      const allBattlefields = db.select().from(battlefields).all();

      // Get active (non-terminal) mission IDs
      const activeMissions = db
        .select({ id: missions.id })
        .from(missions)
        .where(
          inArray(missions.status, ['standby', 'queued', 'deploying', 'in_combat']),
        )
        .all();
      const activeIds = activeMissions.map((m) => m.id);

      let totalCleaned = 0;
      for (const bf of allBattlefields) {
        const cleaned = await cleanOrphanedWorktrees(bf.repoPath, activeIds);
        if (cleaned > 0) {
          console.log(`[Scheduler] WORKTREE SWEEP: cleaned ${cleaned} orphaned worktrees in ${bf.codename}`);
          totalCleaned += cleaned;
        }
      }
      console.log(`[Scheduler] WORKTREE SWEEP complete: ${totalCleaned} total cleaned`);
    }
  }
}
