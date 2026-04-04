'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextarea } from '@/components/ui/tac-input';
import { useConfirm } from '@/hooks/use-confirm';
import {
  abandonMission,
  continueMission,
  deployMission,
  removeMission,
  retryMerge,
  retryReview,
} from '@/actions/mission';
import { tacticalOverride, skipMission, commanderOverride } from '@/actions/campaign';
import { tacTooltip } from '@/components/ui/tac-tooltip';

interface MissionActionsProps {
  missionId: string;
  status: string;
  battlefieldId: string;
  sessionId: string | null;
  campaignId?: string | null;
  briefing?: string;
  worktreeBranch?: string | null;
  debrief?: string | null;
  compromiseReason?: string | null;
}

export function MissionActions({
  missionId,
  status,
  battlefieldId,
  sessionId,
  campaignId,
  briefing,
  worktreeBranch,
  debrief,
  compromiseReason,
}: MissionActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [continueBriefing, setContinueBriefing] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [overrideBriefing, setOverrideBriefing] = useState('');
  const [confirm, ConfirmDialog] = useConfirm();

  const canDeploy = status === 'standby';
  const canAbandon = status === 'standby' || status === 'queued' || status === 'in_combat' || status === 'reviewing' || (status === 'compromised' && !campaignId);
  const canContinue =
    (status === 'accomplished' || status === 'compromised') && sessionId != null;
  const canTacticalOverride = status === 'compromised' || status === 'abandoned';
  const canRetryReview = status === 'compromised' && (compromiseReason === 'escalated' || compromiseReason === 'review-failed') && !!debrief;
  const canRetryMerge = (status === 'compromised' || status === 'abandoned') && !!worktreeBranch && compromiseReason === 'merge-failed';
  const canSkipMission = status === 'compromised' && !!campaignId;

  const handleAbandon = async () => {
    const result = await confirm({
      title: 'CONFIRM ABANDON',
      description: 'Choose how to handle this mission.',
      body: (
        <div className="space-y-3">
          <p>
            <span className="text-dr-amber font-tactical">ABANDON</span>{' '}
            — marks the mission as abandoned. The briefing, comms, and debrief
            are preserved for reference.
          </p>
          <p>
            <span className="text-dr-red font-tactical">ABANDON &amp; REMOVE</span>{' '}
            — permanently deletes the mission and all associated records
            (comms, logs, overseer&apos;s log). This cannot be undone.
          </p>
        </div>
      ),
      actions: [
        { label: 'ABANDON', variant: 'danger' },
        { label: 'ABANDON & REMOVE', variant: 'danger', className: 'bg-dr-red/10' },
      ],
    });

    if (result === 0) {
      // Abandon
      setIsPending(true);
      try {
        await abandonMission(missionId);
        toast('Mission abandoned');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to abandon mission');
      } finally {
        setIsPending(false);
      }
    } else if (result === 1) {
      // Abandon & Remove
      setIsPending(true);
      try {
        const { battlefieldId: bfId } = await removeMission(missionId);
        toast('Mission removed');
        router.push(`/battlefields/${bfId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove mission');
      } finally {
        setIsPending(false);
      }
    }
  };

  const handleContinueDeploy = async () => {
    if (!continueBriefing.trim()) return;
    setIsPending(true);
    try {
      const newMission = await continueMission(missionId, continueBriefing.trim());
      toast.success('Continued mission deployed');
      setIsPending(false);
      setShowContinue(false);
      setContinueBriefing('');
      router.push(`/battlefields/${battlefieldId}/missions/${newMission.id}`);
      router.refresh();
      return;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to continue mission');
    } finally {
      setIsPending(false);
    }
  };

  const handleDeploy = async () => {
    setIsPending(true);
    try {
      await deployMission(missionId);
      toast.success('Mission deployed');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deploy mission');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {canDeploy && (
            <TacButton
              variant="primary"
              onClick={handleDeploy}
              disabled={isPending}
              {...tacTooltip('Queue this mission for execution')}
            >
              {isPending ? 'DEPLOYING...' : 'DEPLOY'}
            </TacButton>
          )}
          {canAbandon && (
            <TacButton
              variant="danger"
              onClick={handleAbandon}
              disabled={isPending}
              {...tacTooltip('Stop this mission. Can abandon or permanently remove.')}
            >
              {isPending ? 'PROCESSING...' : 'ABANDON'}
            </TacButton>
          )}
          {canContinue && !showContinue && !showOverride && (
            <TacButton
              variant="primary"
              onClick={() => setShowContinue(true)}
              disabled={isPending}
              {...tacTooltip('Resume the same session with follow-up instructions. Agent keeps full context of previous work.')}
            >
              CONTINUE MISSION
            </TacButton>
          )}
          {canTacticalOverride && !showOverride && !showContinue && (
            <TacButton
              variant="primary"
              onClick={() => {
                setShowOverride(true);
                setOverrideBriefing(briefing ?? '');
              }}
              disabled={isPending}
              {...tacTooltip('Edit the briefing and redeploy. Agent keeps session context + receives your corrected orders.')}
            >
              TACTICAL OVERRIDE
            </TacButton>
          )}
          {status === 'compromised' && (
            <TacButton
              variant="success"
              {...tacTooltip("Override the Overseer's rejection. Mark this mission as accomplished — you outrank the Overseer.")}
              onClick={async () => {
                const result = await confirm({
                  title: 'COMMANDER OVERRIDE',
                  description: 'Override the Overseer and approve this mission as accomplished.',
                  body: <p>This marks the mission as accomplished regardless of the Overseer&apos;s assessment. Use when you&apos;ve reviewed the work and deem it acceptable.</p>,
                  actions: [{ label: 'APPROVE', variant: 'success' }],
                });
                if (result !== 0) return;
                setIsPending(true);
                try {
                  await commanderOverride(missionId);
                  toast.success('Mission approved by Commander');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Override failed');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
            >
              APPROVE
            </TacButton>
          )}
          {canRetryReview && (
            <TacButton
              variant="primary"
              {...tacTooltip('Re-run the Overseer review. Use when the review process failed (not the work itself).')}
              onClick={async () => {
                setIsPending(true);
                try {
                  await retryReview(missionId);
                  toast.success('Overseer review re-initiated');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Retry review failed');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
            >
              {isPending ? 'REVIEWING...' : 'RETRY REVIEW'}
            </TacButton>
          )}
          {canRetryMerge && (
            <TacButton
              variant="primary"
              {...tacTooltip('Retry merging the worktree branch into the target branch.')}
              onClick={async () => {
                setIsPending(true);
                try {
                  await retryMerge(missionId);
                  toast.success('Branch merged — mission accomplished');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Merge failed');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
            >
              {isPending ? 'MERGING...' : 'RETRY MERGE'}
            </TacButton>
          )}
          {canSkipMission && (
            <TacButton
              variant="ghost"
              {...tacTooltip('Abandon this mission and cascade-abandon any missions that depend on it. Campaign continues without it.')}
              onClick={async () => {
                const result = await confirm({
                  title: 'SKIP MISSION',
                  description: 'This will abandon the mission and cascade-abandon any missions that depend on it.',
                  actions: [{ label: 'SKIP', variant: 'danger' }],
                });
                if (result !== 0) return;
                setIsPending(true);
                try {
                  await skipMission(missionId);
                  toast('Mission skipped');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to skip');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
            >
              SKIP MISSION
            </TacButton>
          )}
        </div>

        {canContinue && showContinue && (
          <div className="space-y-3">
            <h3 className="text-sm font-tactical text-dr-amber tracking-wider">
              CONTINUE MISSION
            </h3>
            <TacTextarea
              placeholder="Describe what to do next..."
              value={continueBriefing}
              onChange={(e) => setContinueBriefing(e.target.value)}
              rows={4}
              className="w-full"
            />
            <div className="flex gap-3">
              <TacButton
                variant="primary"
                onClick={handleContinueDeploy}
                disabled={isPending || !continueBriefing.trim()}
              >
                {isPending ? 'DEPLOYING...' : 'DEPLOY'}
              </TacButton>
              <TacButton
                variant="ghost"
                onClick={() => {
                  setShowContinue(false);
                  setContinueBriefing('');
                }}
                disabled={isPending}
              >
                CANCEL
              </TacButton>
            </div>
          </div>
        )}

        {canTacticalOverride && showOverride && (
          <div className="space-y-3">
            <h3 className="text-sm font-tactical text-dr-amber tracking-wider">
              TACTICAL OVERRIDE
            </h3>
            <p className="text-dr-muted font-data text-sm">
              Edit the briefing below. The agent will receive this updated briefing with its previous session context preserved.
            </p>
            <TacTextarea
              value={overrideBriefing}
              onChange={(e) => setOverrideBriefing(e.target.value)}
              rows={8}
              className="w-full"
            />
            <div className="flex gap-3">
              <TacButton
                variant="primary"
                onClick={async () => {
                  if (!overrideBriefing.trim()) return;
                  setIsPending(true);
                  try {
                    await tacticalOverride(missionId, overrideBriefing.trim());
                    toast.success('Tactical override — mission redeployed');
                    router.refresh();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Override failed');
                  } finally {
                    setIsPending(false);
                  }
                }}
                disabled={isPending || !overrideBriefing.trim()}
              >
                {isPending ? 'DEPLOYING...' : 'DEPLOY WITH OVERRIDE'}
              </TacButton>
              <TacButton
                variant="ghost"
                onClick={() => {
                  setShowOverride(false);
                  setOverrideBriefing('');
                }}
                disabled={isPending}
              >
                CANCEL
              </TacButton>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog />
    </>
  );
}
