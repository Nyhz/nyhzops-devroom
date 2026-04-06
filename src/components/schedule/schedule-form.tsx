'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { TacCard } from '@/components/ui/tac-card';
import {
  TacSelect,
  TacSelectTrigger,
  TacSelectContent,
  TacSelectItem,
  TacSelectValue,
} from '@/components/ui/tac-select';
import { createScheduledTask, updateScheduledTask } from '@/actions/schedule';
import { formatCronHuman, validateCron } from '@/lib/scheduler/cron';
import {
  SCHEDULE_DOSSIERS,
  SCHEDULE_TASK_TYPES,
  type ScheduleTaskType,
} from '@/lib/scheduler/dossiers';
import type { ScheduledTask } from '@/types';

interface ScheduleFormProps {
  battlefieldId: string;
  editTask?: ScheduledTask;
  onClose: () => void;
}

const CRON_PRESETS = [
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 3am', cron: '0 3 * * *' },
  { label: 'Weekly Mon 9am', cron: '0 9 * * 1' },
  { label: 'Monthly 1st', cron: '0 0 1 * *' },
] as const;

export function ScheduleForm({
  battlefieldId,
  editTask,
  onClose,
}: ScheduleFormProps) {
  const isEdit = !!editTask;

  const [name, setName] = useState(editTask?.name ?? '');
  const [type, setType] = useState<ScheduleTaskType>(
    (editTask?.type as ScheduleTaskType) ?? 'maintenance',
  );
  const [dossierId, setDossierId] = useState(editTask?.dossierId ?? '');
  const [cron, setCron] = useState(editTask?.cron ?? '0 3 * * *');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const cronValid = validateCron(cron);
  const cronHuman = cronValid ? formatCronHuman(cron) : 'Invalid expression';

  const dossiersForType = SCHEDULE_DOSSIERS.filter((d) => d.type === type);

  function handleTypeChange(newType: ScheduleTaskType) {
    setType(newType);
    setDossierId('');
  }

  function handleDossierChange(newDossierId: string) {
    setDossierId(newDossierId);
    const dossier = SCHEDULE_DOSSIERS.find((d) => d.id === newDossierId);
    if (dossier) {
      setCron(dossier.defaultCron);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!cronValid) {
      setError('Invalid cron expression');
      return;
    }
    if (!dossierId) {
      setError('Dossier is required');
      return;
    }

    startTransition(async () => {
      try {
        if (isEdit) {
          await updateScheduledTask(editTask.id, {
            name: name.trim(),
            cron,
            type,
            dossierId,
          });
        } else {
          await createScheduledTask({
            battlefieldId,
            name: name.trim(),
            type,
            dossierId,
            cron,
          });
        }
        toast.success(isEdit ? 'Task updated' : 'Task scheduled');
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <TacCard status="amber" className="space-y-4">
      <h3 className="text-dr-amber font-tactical text-sm uppercase tracking-wider">
        {isEdit ? 'Edit Scheduled Task' : 'New Scheduled Task'}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Name
          </label>
          <TacInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nightly worktree sweep"
            disabled={isPending}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Type
          </label>
          <TacSelect
            value={type}
            onValueChange={(v) => { if (v) handleTypeChange(v as ScheduleTaskType); }}
          >
            <TacSelectTrigger>
              <TacSelectValue />
            </TacSelectTrigger>
            <TacSelectContent>
              {SCHEDULE_TASK_TYPES.map((t) => (
                <TacSelectItem key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </TacSelectItem>
              ))}
            </TacSelectContent>
          </TacSelect>
        </div>

        {/* Task (dossier selector) */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Task
          </label>
          <TacSelect
            value={dossierId}
            onValueChange={(v) => { if (v) handleDossierChange(v); }}
          >
            <TacSelectTrigger>
              <TacSelectValue placeholder="Select task..." />
            </TacSelectTrigger>
            <TacSelectContent>
              {dossiersForType.length === 0 ? (
                <TacSelectItem value="_none" disabled>
                  No dossiers for this type
                </TacSelectItem>
              ) : (
                dossiersForType.map((d) => (
                  <TacSelectItem key={d.id} value={d.id}>
                    {d.name}
                  </TacSelectItem>
                ))
              )}
            </TacSelectContent>
          </TacSelect>
          {dossierId && (
            <p className="mt-1 text-dr-muted font-tactical text-xs">
              {SCHEDULE_DOSSIERS.find((d) => d.id === dossierId)?.description}
            </p>
          )}
        </div>

        {/* Cron */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Schedule (cron)
          </label>
          <TacInput
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 3 * * *"
            disabled={isPending}
          />
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`font-tactical text-xs ${
                cronValid ? 'text-dr-green' : 'text-dr-red'
              }`}
            >
              {cronHuman}
            </span>
          </div>
          {/* Presets */}
          <div className="flex flex-wrap gap-2 mt-2">
            {CRON_PRESETS.map((preset) => (
              <TacButton
                key={preset.cron}
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => setCron(preset.cron)}
                disabled={isPending}
              >
                {preset.label}
              </TacButton>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-dr-red font-tactical text-xs border border-dr-red/30 bg-dr-red/5 px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <TacButton type="submit" variant="success" className="min-h-[44px]" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </TacButton>
          <TacButton
            type="button"
            variant="ghost"
            className="min-h-[44px]"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </TacButton>
        </div>
      </form>
    </TacCard>
  );
}
