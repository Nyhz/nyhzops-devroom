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
  redeployCampaign,
  deleteCampaign,
  backToDraft,
  saveAsTemplate,
  runTemplate,
} from '@/actions/campaign';

interface CampaignControlsProps {
  campaignId: string;
  battlefieldId: string;
  status: string;
  isTemplate?: boolean;
  className?: string;
}

export function CampaignControls({
  campaignId,
  battlefieldId,
  status,
  isTemplate = false,
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

  async function handleRedeploy() {
    setLoading('redeploy');
    setError(null);
    try {
      const newCampaign = await redeployCampaign(campaignId);
      toast.success('Campaign redeployed');
      router.push(`/battlefields/${battlefieldId}/campaigns/${newCampaign.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to redeploy';
      setError(message);
      toast.error(message);
      setLoading(null);
    }
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

  async function handleSaveAsTemplate() {
    await run('saveTemplate', () => saveAsTemplate(campaignId), 'Saved as template');
  }

  async function handleRunTemplate() {
    setLoading('runTemplate');
    setError(null);
    try {
      const newCampaign = await runTemplate(campaignId);
      toast.success('Template deployed');
      router.push(`/battlefields/${battlefieldId}/campaigns/${newCampaign.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run template';
      setError(message);
      toast.error(message);
      setLoading(null);
    }
  }

  const disabled = loading !== null;

  return (
    <div className={className}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Template: show RUN TEMPLATE instead of status-based controls */}
        {isTemplate && (
          <TacButton
            onClick={handleRunTemplate}
            disabled={disabled}
            variant="primary"
          >
            {loading === 'runTemplate' ? 'DEPLOYING...' : 'RUN TEMPLATE'}
          </TacButton>
        )}

        {/* DRAFT: DELETE only */}
        {!isTemplate && status === 'draft' && (
          <TacButton
            onClick={handleDelete}
            disabled={disabled}
            variant="danger"
          >
            {loading === 'delete' ? 'DELETING...' : 'DELETE'}
          </TacButton>
        )}

        {/* PLANNING: GREEN LIGHT, BACK TO BRIEFING, DELETE */}
        {!isTemplate && status === 'planning' && (
          <>
            <TacButton
              onClick={handleGreenLight}
              disabled={disabled}
              variant="primary"
            >
              {loading === 'launch' ? 'LAUNCHING...' : 'GREEN LIGHT'}
            </TacButton>
            <TacButton
              onClick={handleBackToDraft}
              disabled={disabled}
              variant="ghost"
            >
              {loading === 'backToDraft' ? 'REVERTING...' : 'BACK TO BRIEFING'}
            </TacButton>
            <TacButton
              onClick={handleDelete}
              disabled={disabled}
              variant="danger"
            >
              {loading === 'delete' ? 'DELETING...' : 'DELETE'}
            </TacButton>
          </>
        )}

        {/* ACTIVE: MISSION ACCOMPLISHED, ABANDON */}
        {!isTemplate && status === 'active' && (
          <>
            <TacButton
              onClick={handleComplete}
              disabled={disabled}
              variant="success"
            >
              {loading === 'complete' ? 'COMPLETING...' : 'MISSION ACCOMPLISHED'}
            </TacButton>
            <TacButton
              onClick={handleAbandon}
              disabled={disabled}
              variant="danger"
            >
              {loading === 'abandon' ? 'ABANDONING...' : 'ABANDON'}
            </TacButton>
          </>
        )}

        {/* COMPROMISED: ABANDON + guidance message */}
        {!isTemplate && status === 'compromised' && (
          <>
            <TacButton
              onClick={handleAbandon}
              disabled={disabled}
              variant="danger"
            >
              {loading === 'abandon' ? 'ABANDONING...' : 'ABANDON'}
            </TacButton>
          </>
        )}

        {/* ACCOMPLISHED: REDEPLOY, SAVE AS TEMPLATE */}
        {!isTemplate && status === 'accomplished' && (
          <>
            <TacButton
              onClick={handleRedeploy}
              disabled={disabled}
              variant="ghost"
            >
              {loading === 'redeploy' ? 'REDEPLOYING...' : 'REDEPLOY'}
            </TacButton>
            <TacButton
              onClick={handleSaveAsTemplate}
              disabled={disabled}
              variant="ghost"
            >
              {loading === 'saveTemplate' ? 'SAVING...' : 'SAVE AS TEMPLATE'}
            </TacButton>
          </>
        )}

        {/* ABANDONED: REDEPLOY */}
        {!isTemplate && status === 'abandoned' && (
          <TacButton
            onClick={handleRedeploy}
            disabled={disabled}
            variant="ghost"
          >
            {loading === 'redeploy' ? 'REDEPLOYING...' : 'REDEPLOY'}
          </TacButton>
        )}
      </div>

      {/* COMPROMISED guidance — direct Commander to the failed mission */}
      {!isTemplate && status === 'compromised' && (
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
