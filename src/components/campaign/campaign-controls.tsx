'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

  async function run(action: string, fn: () => Promise<void>) {
    setLoading(action);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed: ${action}`);
    } finally {
      setLoading(null);
    }
  }

  async function handleLaunch() {
    if (!window.confirm('Confirm: Launch this campaign? All Phase 1 missions will be deployed.')) return;
    await run('launch', () => launchCampaign(campaignId));
  }

  async function handleAbandon() {
    if (!window.confirm('Confirm: Abandon this campaign? This action cannot be undone.')) return;
    await run('abandon', () => abandonCampaign(campaignId));
  }

  async function handleComplete() {
    await run('complete', () => completeCampaign(campaignId));
  }

  async function handleRedeploy() {
    setLoading('redeploy');
    setError(null);
    try {
      const newCampaign = await redeployCampaign(campaignId);
      router.push(`/battlefields/${battlefieldId}/campaigns/${newCampaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to redeploy');
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Confirm: Delete this campaign? This action cannot be undone.')) return;
    setLoading('delete');
    setError(null);
    try {
      await deleteCampaign(campaignId);
      router.push(`/battlefields/${battlefieldId}/campaigns`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setLoading(null);
    }
  }

  async function handleResume() {
    await run('resume', () => resumeCampaign(campaignId));
  }

  async function handleSkip() {
    if (!window.confirm('Confirm: Skip the current phase and continue to the next?')) return;
    await run('skip', () => skipAndContinueCampaign(campaignId));
  }

  async function handleRegenerate() {
    await run('regenerate', () => generateBattlePlan(campaignId));
  }

  async function handleSaveAsTemplate() {
    await run('saveTemplate', () => saveAsTemplate(campaignId));
  }

  async function handleRunTemplate() {
    setLoading('runTemplate');
    setError(null);
    try {
      const newCampaign = await runTemplate(campaignId);
      router.push(`/battlefields/${battlefieldId}/campaigns/${newCampaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run template');
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
