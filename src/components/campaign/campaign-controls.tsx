'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { useConfirm } from '@/hooks/use-confirm';
import {
  launchCampaign,
  abandonCampaign,
  completeCampaign,
  deleteCampaign,
  backToDraft,
} from '@/actions/campaign';

interface CampaignControlsProps {
  campaignId: string;
  battlefieldId: string;
  status: string;
  className?: string;
}

export function CampaignControls({
  campaignId,
  battlefieldId,
  status,
  className,
}: CampaignControlsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, ConfirmDialog] = useConfirm();

  async function run(action: string, fn: () => Promise<void>, successMessage?: string) {
    setLoading(action);
    setError(null);
    try {
      await fn();
      if (successMessage) toast.success(successMessage);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed: ${action}`;
      setError(message);
      toast.error(message);
    } finally {
      setLoading(null);
    }
  }

  async function handleGreenLight() {
    const result = await confirm({
      title: 'GREEN LIGHT CAMPAIGN',
      description: 'All Phase 1 missions will be deployed immediately.',
      actions: [{ label: 'GREEN LIGHT', variant: 'primary' }],
    });
    if (result !== 0) return;
    await run('launch', () => launchCampaign(campaignId), 'Campaign launched — Phase 1 active');
  }

  async function handleBackToDraft() {
    await run('backToDraft', () => backToDraft(campaignId), 'Campaign returned to draft');
  }

  async function handleAbandon() {
    const result = await confirm({
      title: 'ABANDON CAMPAIGN',
      description: 'This will stop all active missions and mark the campaign as abandoned.',
      body: <p>This action cannot be undone. All in-progress missions will be terminated.</p>,
      actions: [{ label: 'ABANDON', variant: 'danger' }],
    });
    if (result !== 0) return;
    await run('abandon', () => abandonCampaign(campaignId), 'Campaign abandoned');
  }

  async function handleComplete() {
    await run('complete', () => completeCampaign(campaignId), 'Campaign accomplished');
  }

  async function handleDelete() {
    const result = await confirm({
      title: 'DELETE CAMPAIGN',
      description: 'This will permanently delete this campaign and all its phases.',
      body: <p>This action cannot be undone.</p>,
      actions: [{ label: 'DELETE', variant: 'danger' }],
    });
    if (result !== 0) return;
    setLoading('delete');
    setError(null);
    try {
      await deleteCampaign(campaignId);
      toast.success('Campaign deleted');
      router.push(`/battlefields/${battlefieldId}/campaigns`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete';
      setError(message);
      toast.error(message);
      setLoading(null);
    }
  }

  const disabled = loading !== null;

  return (
    <div className={className}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* DRAFT: DELETE only */}
        {status === 'draft' && (
          <TacButton onClick={handleDelete} disabled={disabled} variant="danger">
            {loading === 'delete' ? 'DELETING...' : 'DELETE'}
          </TacButton>
        )}

        {/* PLANNING: GREEN LIGHT, BACK TO BRIEFING, DELETE */}
        {status === 'planning' && (
          <>
            <TacButton onClick={handleGreenLight} disabled={disabled} variant="primary">
              {loading === 'launch' ? 'LAUNCHING...' : 'GREEN LIGHT'}
            </TacButton>
            <TacButton onClick={handleBackToDraft} disabled={disabled} variant="ghost">
              {loading === 'backToDraft' ? 'REVERTING...' : 'BACK TO BRIEFING'}
            </TacButton>
            <TacButton onClick={handleDelete} disabled={disabled} variant="danger">
              {loading === 'delete' ? 'DELETING...' : 'DELETE'}
            </TacButton>
          </>
        )}

        {/* ACTIVE: MISSION ACCOMPLISHED, ABANDON */}
        {status === 'active' && (
          <>
            <TacButton onClick={handleComplete} disabled={disabled} variant="success">
              {loading === 'complete' ? 'COMPLETING...' : 'MISSION ACCOMPLISHED'}
            </TacButton>
            <TacButton onClick={handleAbandon} disabled={disabled} variant="danger">
              {loading === 'abandon' ? 'ABANDONING...' : 'ABANDON'}
            </TacButton>
          </>
        )}

        {/* COMPROMISED: ABANDON */}
        {status === 'compromised' && (
          <TacButton onClick={handleAbandon} disabled={disabled} variant="danger">
            {loading === 'abandon' ? 'ABANDONING...' : 'ABANDON'}
          </TacButton>
        )}
      </div>

      {/* COMPROMISED guidance */}
      {status === 'compromised' && (
        <div className="mt-3 font-tactical text-xs text-dr-amber">
          Commander, review the compromised mission below. Use TACTICAL OVERRIDE or SKIP on the failed mission to proceed.
        </div>
      )}

      {error && (
        <div className="mt-2 font-tactical text-xs text-dr-red">
          {error}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
