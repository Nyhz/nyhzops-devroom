import { eq, and, lte, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { scheduledTasks, battlefields, missions, commandLogs } from '@/lib/db/schema';
import { getNextRun } from './cron';
import { generateId } from '@/lib/utils';
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

    // Batch maintenance tasks by name — run once, mark all
    const maintenanceBatches = new Map<string, typeof dueTasks>();
    const regularTasks: typeof dueTasks = [];

    for (const task of dueTasks) {
      if (task.type === 'maintenance') {
        const batch = maintenanceBatches.get(task.name) ?? [];
        batch.push(task);
        maintenanceBatches.set(task.name, batch);
      } else {
        regularTasks.push(task);
      }
    }

    // Execute regular tasks individually
    for (const task of regularTasks) {
      try {
        this.executeTask(task);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Task ${task.id} (${task.name}) failed: ${message}`);
      }
      this.markExecuted(task, now);
    }

    // Execute batched maintenance — run once per name, mark all tasks
    for (const [name, tasks] of maintenanceBatches) {
      // Collect the battlefield IDs that have this maintenance enabled
      const enabledBattlefieldIds = tasks.map((t) => t.battlefieldId);

      try {
        this.runMaintenance(name, enabledBattlefieldIds);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Maintenance ${name} failed: ${message}`);
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
        priority: (template.priority as 'low' | 'routine' | 'high' | 'critical') || 'routine',
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] Failed to create mission for task ${task.name}: ${message}`);
      });
    } else if (task.type === 'campaign' && task.campaignId) {
      import('@/actions/campaign').then(({ runTemplate }) => {
        runTemplate(task.campaignId!).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[Scheduler] Failed to run template for task ${task.name}: ${message}`);
        });
      });
    }
  }

  private async runMaintenance(name: string, battlefieldIds: string[]): Promise<void> {
    if (name === 'WORKTREE SWEEP') {
      const { cleanOrphanedWorktrees } = await import('@/lib/orchestrator/worktree');
      const db = getDatabase();
      const startTime = Date.now();

      // Only sweep battlefields that have this task enabled
      const targetBattlefields = db
        .select()
        .from(battlefields)
        .where(inArray(battlefields.id, battlefieldIds))
        .all();

      // Get active (non-terminal) mission IDs
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

      // Log result to commandLogs for each battlefield
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
  }
}
