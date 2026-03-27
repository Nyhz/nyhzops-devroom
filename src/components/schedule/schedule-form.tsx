'use client';

import { useState, useTransition, useMemo } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';
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
import type { ScheduledTask, Asset, Campaign } from '@/types';

interface ScheduleFormProps {
  battlefieldId: string;
  assets: Asset[];
  campaignTemplates: Campaign[];
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
  assets,
  campaignTemplates,
  editTask,
  onClose,
}: ScheduleFormProps) {
  const isEdit = !!editTask;

  // Parse existing mission template for edit mode
  const existingTemplate = useMemo(() => {
    if (editTask?.missionTemplate) {
      try {
        return JSON.parse(editTask.missionTemplate) as {
          briefing?: string;
          assetId?: string;
          priority?: string;
        };
      } catch {
        return {};
      }
    }
    return {};
  }, [editTask]);

  const [name, setName] = useState(editTask?.name ?? '');
  const [type, setType] = useState<'mission' | 'campaign'>(
    (editTask?.type as 'mission' | 'campaign') ?? 'mission',
  );
  const [cron, setCron] = useState(editTask?.cron ?? '0 3 * * *');
  const [briefing, setBriefing] = useState(existingTemplate.briefing ?? '');
  const [assetId, setAssetId] = useState(existingTemplate.assetId ?? '');
  const [priority, setPriority] = useState(existingTemplate.priority ?? 'normal');
  const [campaignId, setCampaignId] = useState(editTask?.campaignId ?? '');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const cronValid = validateCron(cron);
  const cronHuman = cronValid ? formatCronHuman(cron) : 'Invalid expression';

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
    if (type === 'mission' && !briefing.trim()) {
      setError('Briefing is required for mission tasks');
      return;
    }
    if (type === 'campaign' && !campaignId) {
      setError('Campaign template is required');
      return;
    }

    startTransition(async () => {
      try {
        if (isEdit) {
          await updateScheduledTask(editTask.id, {
            name: name.trim(),
            cron,
            type,
            briefing: type === 'mission' ? briefing : undefined,
            assetId: type === 'mission' && assetId ? assetId : undefined,
            priority: type === 'mission'
              ? (priority as 'low' | 'normal' | 'high' | 'critical')
              : undefined,
            campaignId: type === 'campaign' ? campaignId : undefined,
          });
        } else {
          await createScheduledTask({
            battlefieldId,
            name: name.trim(),
            type,
            cron,
            briefing: type === 'mission' ? briefing : undefined,
            assetId: type === 'mission' && assetId ? assetId : undefined,
            priority: type === 'mission'
              ? (priority as 'low' | 'normal' | 'high' | 'critical')
              : undefined,
            campaignId: type === 'campaign' ? campaignId : undefined,
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
            placeholder="e.g. Nightly test suite"
            disabled={isPending}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
            Type
          </label>
          <TacSelect value={type} onValueChange={(v) => { if (v) setType(v as 'mission' | 'campaign'); }}>
            <TacSelectTrigger>
              <TacSelectValue />
            </TacSelectTrigger>
            <TacSelectContent>
              <TacSelectItem value="mission">Mission</TacSelectItem>
              <TacSelectItem value="campaign">Campaign</TacSelectItem>
            </TacSelectContent>
          </TacSelect>
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
                onClick={() => setCron(preset.cron)}
                disabled={isPending}
              >
                {preset.label}
              </TacButton>
            ))}
          </div>
        </div>

        {/* Mission-specific fields */}
        {type === 'mission' && (
          <>
            <div>
              <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
                Briefing
              </label>
              <TacTextarea
                value={briefing}
                onChange={(e) => setBriefing(e.target.value)}
                placeholder="Mission briefing for the scheduled task..."
                rows={4}
                disabled={isPending}
              />
            </div>

            <div>
              <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
                Asset
              </label>
              <TacSelect value={assetId} onValueChange={(v) => setAssetId(v ?? '')}>
                <TacSelectTrigger>
                  <TacSelectValue placeholder="Select asset (optional)" />
                </TacSelectTrigger>
                <TacSelectContent>
                  {assets
                    .filter((a) => a.status === 'active')
                    .map((asset) => (
                      <TacSelectItem key={asset.id} value={asset.id}>
                        {asset.codename} -- {asset.specialty}
                      </TacSelectItem>
                    ))}
                </TacSelectContent>
              </TacSelect>
            </div>

            <div>
              <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
                Priority
              </label>
              <TacSelect value={priority} onValueChange={(v) => setPriority(v ?? 'normal')}>
                <TacSelectTrigger>
                  <TacSelectValue />
                </TacSelectTrigger>
                <TacSelectContent>
                  <TacSelectItem value="low">Low</TacSelectItem>
                  <TacSelectItem value="normal">Normal</TacSelectItem>
                  <TacSelectItem value="high">High</TacSelectItem>
                  <TacSelectItem value="critical">Critical</TacSelectItem>
                </TacSelectContent>
              </TacSelect>
            </div>
          </>
        )}

        {/* Campaign-specific fields */}
        {type === 'campaign' && (
          <div>
            <label className="block text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1">
              Campaign Template
            </label>
            <TacSelect value={campaignId} onValueChange={(v) => setCampaignId(v ?? '')}>
              <TacSelectTrigger>
                <TacSelectValue placeholder="Select campaign template" />
              </TacSelectTrigger>
              <TacSelectContent>
                {campaignTemplates.length === 0 ? (
                  <TacSelectItem value="_none" disabled>
                    No campaign templates available
                  </TacSelectItem>
                ) : (
                  campaignTemplates.map((c) => (
                    <TacSelectItem key={c.id} value={c.id}>
                      {c.name}
                    </TacSelectItem>
                  ))
                )}
              </TacSelectContent>
            </TacSelect>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-dr-red font-tactical text-xs border border-dr-red/30 bg-dr-red/5 px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <TacButton type="submit" variant="success" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </TacButton>
          <TacButton
            type="button"
            variant="ghost"
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
