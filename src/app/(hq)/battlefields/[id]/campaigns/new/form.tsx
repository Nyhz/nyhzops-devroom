'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';
import { createCampaign } from '@/actions/campaign';
import { linkNotesToCampaign } from '@/actions/intel';

interface NewCampaignFormProps {
  battlefieldId: string;
  initialObjective?: string;
  noteIds?: string;
}

export function NewCampaignForm({ battlefieldId, initialObjective, noteIds }: NewCampaignFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState(initialObjective ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !objective.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const campaign = await createCampaign(battlefieldId, name.trim(), objective.trim());
      if (noteIds) {
        const ids = noteIds.split(',').filter(Boolean);
        if (ids.length > 0) {
          await linkNotesToCampaign(ids, campaign.id);
        }
      }
      router.push(`/battlefields/${battlefieldId}/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block font-tactical text-xs text-dr-dim uppercase tracking-wider mb-2">
          CAMPAIGN NAME
        </label>
        <TacInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Operation Clean Sweep"
          required
          disabled={submitting}
        />
      </div>

      <div>
        <label className="block font-tactical text-xs text-dr-dim uppercase tracking-wider mb-2">
          OBJECTIVE
        </label>
        <TacTextarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Describe the campaign objective in detail. What needs to be achieved? What are the key deliverables?"
          required
          disabled={submitting}
          className="min-h-[160px]"
        />
      </div>

      {error && (
        <div className="font-tactical text-xs text-dr-red">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <TacButton
          type="submit"
          disabled={submitting || !name.trim() || !objective.trim()}
          variant="primary"
        >
          {submitting ? 'PLANNING...' : 'PLAN CAMPAIGN'}
        </TacButton>
        <TacButton
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={submitting}
        >
          CANCEL
        </TacButton>
      </div>
    </form>
  );
}
