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
  redeployMission,
  removeMission,
} from '@/actions/mission';

interface MissionActionsProps {
  missionId: string;
  status: string;
  battlefieldId: string;
  sessionId: string | null;
  worktreeBranch: string | null;
}

export function MissionActions({
  missionId,
  status,
  battlefieldId,
  sessionId,
  worktreeBranch,
}: MissionActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [continueBriefing, setContinueBriefing] = useState('');
  const [confirm, ConfirmDialog] = useConfirm();

  const canDeploy = status === 'standby';
  const canAbandon = status === 'standby' || status === 'queued' || status === 'in_combat' || status === 'reviewing';
  const isTerminal = status === 'accomplished' || status === 'compromised' || status === 'abandoned';
  const canContinue =
    (status === 'accomplished' || status === 'compromised') && sessionId != null;
  const canRedeploy = isTerminal;

  const handleAbandon = async () => {
    const result = await confirm({
      title: 'CONFIRM ABANDON',
      description: 'Choose how to handle this mission.',
      body: (
        <div className="space-y-3">
          <p>
            <span className="text-dr-amber font-tactical">ABANDON</span>{' '}
            — marks the mission as abandoned. The briefing, comms, and debrief
            are preserved for reference. The mission can be redeployed later.
          </p>
          <p>
            <span className="text-dr-red font-tactical">ABANDON &amp; REMOVE</span>{' '}
            — permanently deletes the mission and all associated records
            (comms, logs, captain&apos;s log). This cannot be undone.
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

  const handleRedeploy = async () => {
    setIsPending(true);
    try {
      const newMission = await redeployMission(missionId);
      toast.success('Mission redeployed');
      router.push(`/battlefields/${battlefieldId}/missions/${newMission.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to redeploy mission');
    } finally {
      setIsPending(false);
    }
  };

  const handleContinueDeploy = async () => {
    if (!continueBriefing.trim()) return;
    setIsPending(true);
    try {
      const newMission = await continueMission(missionId, continueBriefing.trim());
      toast.success('Continued mission deployed');
      router.push(`/battlefields/${battlefieldId}/missions/${newMission.id}`);
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
        <div className="flex gap-3">
          {canDeploy && (
            <TacButton
              variant="primary"
              onClick={handleDeploy}
              disabled={isPending}
            >
              {isPending ? 'DEPLOYING...' : 'DEPLOY'}
            </TacButton>
          )}
          {canAbandon && (
            <TacButton
              variant="danger"
              onClick={handleAbandon}
              disabled={isPending}
            >
              {isPending ? 'PROCESSING...' : 'ABANDON'}
            </TacButton>
          )}
          {canRedeploy && (
            <TacButton
              variant="danger"
              onClick={handleRedeploy}
              disabled={isPending}
            >
              {isPending ? 'REDEPLOYING...' : 'REDEPLOY'}
            </TacButton>
          )}
          {canContinue && !showContinue && (
            <TacButton
              variant="primary"
              onClick={() => setShowContinue(true)}
              disabled={isPending}
            >
              CONTINUE MISSION
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
      </div>

      <ConfirmDialog />
    </>
  );
}
