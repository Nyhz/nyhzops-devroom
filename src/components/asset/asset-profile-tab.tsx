'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import {
  TacSelect,
  TacSelectContent,
  TacSelectItem,
  TacSelectTrigger,
  TacSelectValue,
} from '@/components/ui/tac-select';
import { updateAsset, toggleAssetStatus } from '@/actions/asset';
import type { Asset } from '@/types';

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Opus' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku' },
] as const;

const EFFORT_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
] as const;

interface AssetProfileTabProps {
  asset: Asset;
}

export function AssetProfileTab({ asset }: AssetProfileTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [specialty, setSpecialty] = useState(asset.specialty);
  const [model, setModel] = useState(asset.model ?? 'claude-sonnet-4-6');
  const [effort, setEffort] = useState(asset.effort ?? 'default');
  const [maxTurns, setMaxTurns] = useState<string>(
    asset.maxTurns != null ? String(asset.maxTurns) : '',
  );

  function handleSave() {
    startTransition(async () => {
      try {
        await updateAsset(asset.id, {
          specialty,
          model,
          effort: effort === 'default' ? null : effort,
          maxTurns: maxTurns ? Number(maxTurns) : null,
        });
        toast.success('Asset profile updated');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update asset');
      }
    });
  }

  function handleToggleStatus() {
    startTransition(async () => {
      try {
        await toggleAssetStatus(asset.id);
        toast.success('Asset status changed');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to toggle status');
      }
    });
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-widest uppercase mb-1">
          Specialty
        </label>
        <TacInput
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          placeholder="e.g. System architecture and scaffolding"
        />
      </div>

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-widest uppercase mb-1">
          Model
        </label>
        <TacSelect value={model} onValueChange={(val) => { if (val) setModel(val); }}>
          <TacSelectTrigger>
            <TacSelectValue />
          </TacSelectTrigger>
          <TacSelectContent>
            {MODEL_OPTIONS.map((opt) => (
              <TacSelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </TacSelectItem>
            ))}
          </TacSelectContent>
        </TacSelect>
      </div>

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-widest uppercase mb-1">
          Effort
        </label>
        <TacSelect value={effort} onValueChange={(val) => setEffort(val ?? '')}>
          <TacSelectTrigger>
            <TacSelectValue placeholder="Default" />
          </TacSelectTrigger>
          <TacSelectContent>
            {EFFORT_OPTIONS.map((opt) => (
              <TacSelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </TacSelectItem>
            ))}
          </TacSelectContent>
        </TacSelect>
      </div>

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-widest uppercase mb-1">
          Max Turns
        </label>
        <TacInput
          type="number"
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
          placeholder="Unlimited"
          min={1}
        />
      </div>

      <div className="pt-2">
        <TacButton
          type="button"
          variant="success"
          size="sm"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? 'SAVING...' : 'SAVE PROFILE'}
        </TacButton>
      </div>
    </div>
  );
}
