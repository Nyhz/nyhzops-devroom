'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';
import {
  TacSelect,
  TacSelectContent,
  TacSelectItem,
  TacSelectTrigger,
  TacSelectValue,
} from '@/components/ui/tac-select';
import { createAsset, updateAsset } from '@/actions/asset';
import type { Asset } from '@/types';

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Opus' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku' },
] as const;

interface AssetFormProps {
  editAsset?: Asset;
  onClose: () => void;
}

export function AssetForm({ editAsset, onClose }: AssetFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [codename, setCodename] = useState(editAsset?.codename ?? '');
  const [specialty, setSpecialty] = useState(editAsset?.specialty ?? '');
  const [systemPrompt, setSystemPrompt] = useState(editAsset?.systemPrompt ?? '');
  const [model, setModel] = useState(editAsset?.model ?? 'claude-sonnet-4-6');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        if (editAsset) {
          await updateAsset(editAsset.id, {
            codename,
            specialty,
            systemPrompt,
            model,
          });
        } else {
          await createAsset(codename, specialty, systemPrompt, model);
        }
        toast.success(editAsset ? 'Asset updated' : 'Asset recruited');
        router.refresh();
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Operation failed';
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
      {error && (
        <div className="bg-dr-red/10 border border-dr-red text-dr-red font-tactical text-xs p-3">
          {error}
        </div>
      )}

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-wider uppercase mb-1">
          Codename
        </label>
        <TacInput
          value={codename}
          onChange={(e) => setCodename(e.target.value.toUpperCase())}
          placeholder="e.g. OPERATIVE"
          required
        />
      </div>

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-wider uppercase mb-1">
          Specialty
        </label>
        <TacInput
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          placeholder="e.g. System architecture and scaffolding"
          required
        />
      </div>

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-wider uppercase mb-1">
          System Prompt
        </label>
        <TacTextarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Custom instructions for this agent..."
          className="min-h-[120px]"
        />
      </div>

      <div>
        <label className="block text-dr-muted font-tactical text-xs tracking-wider uppercase mb-1">
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

      <div className="flex items-center gap-3 pt-2">
        <TacButton type="submit" variant="success" size="sm" disabled={isPending}>
          {isPending ? 'DEPLOYING...' : editAsset ? 'UPDATE ASSET' : 'RECRUIT'}
        </TacButton>
        <TacButton type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
          CANCEL
        </TacButton>
      </div>
    </form>
  );
}
