'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import {
  launchCampaign,
  abandonCampaign,
  completeCampaign,
  redeployCampaign,
  deleteCampaign,
  generateBattlePlan,
  resumeCampaign,
  skipAndContinueCampaign,
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

  async function handleLaunch() {
    if (!window.confirm('Confirm: Launch this campaign? All Phase 1 missions will be deployed.')) return;
    await run('launch', () => launchCampaign(campaignId), 'Campaign launched — Phase 1 active');
  }

  async function handleAbandon() {
    if (!window.confirm('Confirm: Abandon this campaign? This action cannot be undone.')) return;
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
    if (!window.confirm('Confirm: Delete this campaign? This action cannot be undone.')) return;
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

  async function handleResume() {
    await run('resume', () => resumeCampaign(campaignId), 'Campaign resumed');
  }

  async function handleSkip() {
    if (!window.confirm('Confirm: Skip the current phase and continue to the next?')) return;
    await run('skip', () => skipAndContinueCampaign(campaignId), 'Phase skipped — continuing');
  }

  async function handleRegenerate() {
    await run('regenerate', () => generateBattlePlan(campaignId), 'Battle plan regenerated');
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

        {!isTemplate && status === 'planning' && (
          <>
            <TacButton
              onClick={handleLaunch}
              disabled={disabled}
              variant="primary"
            >
              {loading === 'launch' ? 'LAUNCHING...' : 'LAUNCH OPERATION'}
            </TacButton>
            <TacButton
              onClick={handleRegenerate}
              disabled={disabled}
              variant="ghost"
            >
              {loading === 'regenerate' ? 'REGENERATING...' : 'REGENERATE PLAN'}
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

        {!isTemplate && status === 'paused' && (
          <>
            <TacButton
              onClick={handleResume}
              disabled={disabled}
              variant="primary"
            >
              {loading === 'resume' ? 'RESUMING...' : 'RESUME'}
            </TacButton>
            <TacButton
              onClick={handleSkip}
              disabled={disabled}
              variant="ghost"
            >
              {loading === 'skip' ? 'SKIPPING...' : 'SKIP & CONTINUE'}
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

        {!isTemplate && (status === 'accomplished' || status === 'compromised') && (
          <TacButton
            onClick={handleRedeploy}
            disabled={disabled}
            variant="ghost"
          >
            {loading === 'redeploy' ? 'REDEPLOYING...' : 'REDEPLOY'}
          </TacButton>
        )}

        {!isTemplate && status === 'draft' && (
          <TacButton
            onClick={handleDelete}
            disabled={disabled}
            variant="danger"
          >
            {loading === 'delete' ? 'DELETING...' : 'DELETE'}
          </TacButton>
        )}

        {/* SAVE AS TEMPLATE — available for accomplished or planning campaigns (non-template) */}
        {!isTemplate && (status === 'accomplished' || status === 'planning') && (
          <TacButton
            onClick={handleSaveAsTemplate}
            disabled={disabled}
            variant="ghost"
          >
            {loading === 'saveTemplate' ? 'SAVING...' : 'SAVE AS TEMPLATE'}
          </TacButton>
        )}
      </div>

      {error && (
        <div className="mt-2 font-tactical text-xs text-dr-red">
          {error}
        </div>
      )}
    </div>
  );
}
