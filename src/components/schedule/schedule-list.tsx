'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacCard } from '@/components/ui/tac-card';
import { useConfirm } from '@/hooks/use-confirm';
import { toggleScheduledTask, deleteScheduledTask } from '@/actions/schedule';
import { formatCronHuman } from '@/lib/scheduler/cron';
import { formatRelativeTime } from '@/lib/utils';
import type { ScheduledTask, Asset, Campaign } from '@/types';
import { ScheduleForm } from './schedule-form';

interface ScheduleListProps {
  tasks: ScheduledTask[];
  battlefieldId: string;
  assets: Asset[];
  campaignTemplates: Campaign[];
}

export function ScheduleList({
  tasks,
  battlefieldId,
  assets,
  campaignTemplates,
}: ScheduleListProps) {
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirm, ConfirmDialog] = useConfirm();

  function handleToggle(task: ScheduledTask) {
    startTransition(async () => {
      try {
        await toggleScheduledTask(task.id, !task.enabled);
        toast.success(task.enabled ? 'Task disabled' : 'Task enabled');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to toggle task');
      }
    });
  }

  async function handleDelete(task: ScheduledTask) {
    const result = await confirm({
      title: 'DELETE SCHEDULED TASK',
      description: `Delete "${task.name}"? This cannot be undone.`,
      actions: [{ label: 'DELETE', variant: 'danger' }],
    });
    if (result !== 0) return;
    startTransition(async () => {
      try {
        await deleteScheduledTask(task.id);
        toast.success('Task deleted');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete task');
      }
    });
  }

  function formatNextRun(task: ScheduledTask): string {
    if (!task.enabled) return 'DISABLED';
    if (!task.nextRunAt) return 'PENDING';
    const date = new Date(task.nextRunAt);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    });
  }

  function getTypeBadgeColor(type: string): 'amber' | 'green' | 'blue' {
    switch (type) {
      case 'mission':
        return 'amber';
      case 'campaign':
        return 'green';
      case 'maintenance':
        return 'blue';
      default:
        return 'amber';
    }
  }

  if (editingTask) {
    return (
      <ScheduleForm
        battlefieldId={battlefieldId}
        assets={assets}
        campaignTemplates={campaignTemplates}
        editTask={editingTask}
        onClose={() => setEditingTask(null)}
      />
    );
  }

  if (showCreate) {
    return (
      <ScheduleForm
        battlefieldId={battlefieldId}
        assets={assets}
        campaignTemplates={campaignTemplates}
        onClose={() => setShowCreate(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <TacButton size="sm" className="min-h-[44px] min-w-[44px]" onClick={() => setShowCreate(true)}>
          + New Task
        </TacButton>
      </div>

      {/* Empty state */}
      {tasks.length === 0 && (
        <TacCard className="text-center py-8">
          <p className="text-dr-dim font-tactical text-sm">
            No scheduled tasks. Create your first automated operation.
          </p>
        </TacCard>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map((task) => (
          <TacCard
            key={task.id}
            status={task.enabled ? 'green' : undefined}
            className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4"
          >
            <div className="flex-1 min-w-0">
              {/* Row 1: status dot + name + type badge */}
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    task.enabled ? 'bg-dr-green' : 'bg-dr-dim'
                  }`}
                />
                <span className="text-dr-text font-tactical text-sm truncate">
                  {task.name}
                </span>
                <span
                  className={`font-tactical text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ${
                    getTypeBadgeColor(task.type) === 'amber'
                      ? 'border-dr-amber text-dr-amber'
                      : getTypeBadgeColor(task.type) === 'green'
                        ? 'border-dr-green text-dr-green'
                        : 'border-dr-blue text-dr-blue'
                  }`}
                >
                  {task.type}
                </span>
              </div>

              {/* Row 2: cron description + stats */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1">
                <span className="text-dr-muted font-tactical text-xs break-all">
                  {formatCronHuman(task.cron)}
                </span>
                <span className="text-dr-dim font-tactical text-xs" suppressHydrationWarning>
                  {task.lastRunAt
                    ? `Last: ${formatRelativeTime(task.lastRunAt)}`
                    : 'Last: never'}
                  {' | '}
                  Runs: {task.runCount ?? 0}
                </span>
              </div>

              {/* Row 3: next run */}
              <div className="mt-1">
                <span className="text-dr-dim font-tactical text-[10px] uppercase tracking-wider">
                  Next:{' '}
                </span>
                <span
                  className={`font-tactical text-[10px] uppercase tracking-wider ${
                    task.enabled ? 'text-dr-green' : 'text-dr-dim'
                  }`}
                  suppressHydrationWarning
                >
                  {formatNextRun(task)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <TacButton
                size="sm"
                className="min-h-[44px] min-w-[44px]"
                variant="ghost"
                onClick={() => setEditingTask(task)}
                disabled={isPending}
              >
                Edit
              </TacButton>
              <TacButton
                size="sm"
                className="min-h-[44px] min-w-[44px]"
                variant={task.enabled ? 'danger' : 'success'}
                onClick={() => handleToggle(task)}
                disabled={isPending}
              >
                {task.enabled ? 'Disable' : 'Enable'}
              </TacButton>
              <TacButton
                size="sm"
                className="min-h-[44px] min-w-[44px]"
                variant="danger"
                onClick={() => handleDelete(task)}
                disabled={isPending}
              >
                Delete
              </TacButton>
            </div>
          </TacCard>
        ))}
      </div>

      <ConfirmDialog />
    </div>
  );
}
