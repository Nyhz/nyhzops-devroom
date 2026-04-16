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
  tacticalOverride,
  acceptMergeOverride,
  answerEscalation,
} from '@/actions/mission';
import { skipMission } from '@/actions/campaign-overrides';
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
  escalationQuestion?: string | null;
}

export function MissionActions({
  missionId,
  status,
  battlefieldId,
  sessionId,
  campaignId,
  briefing,
  compromiseReason,
  escalationQuestion,
}: MissionActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [continueBriefing, setContinueBriefing] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [overrideBriefing, setOverrideBriefing] = useState('');
  const [escalationAnswer, setEscalationAnswer] = useState('');
  const [confirm, ConfirmDialog] = useConfirm();

  const canDeploy = status === 'standby';
  const canAbandon =
    status === 'standby' ||
    status === 'queued' ||
    status === 'deploying' ||
    status === 'in_combat' ||
    status === 'compromised';
  const canContinue =
    (status === 'accomplished' || status === 'compromised') && sessionId != null;
  const canTacticalOverride = status === 'compromised' || status === 'abandoned';
  const canAcceptMerge = status === 'compromised';
  const canSkipMission = status === 'compromised' && !!campaignId;
  const isEscalated =
    status === 'compromised' && compromiseReason === 'escalated' && !!escalationQuestion;

  const handleAbandon = async () => {
    const result = await confirm({
      title: 'CONFIRM ABANDON',
      description: 'Abandon this mission — all comms and debrief are preserved.',
      actions: [
        { label: 'ABANDON', variant: 'danger' },
      ],
    });

    if (result !== 0) return;
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

  const handleAnswerEscalation = async () => {
    if (!escalationAnswer.trim()) return;
    setIsPending(true);
    try {
      await answerEscalation(missionId, escalationAnswer.trim());
      toast.success('Escalation answered — mission re-queued');
      setEscalationAnswer('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Escalation answer panel */}
        {isEscalated && (
          <div className="border border-dr-amber/40 bg-dr-amber/5 p-3 sm:p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-dr-amber text-sm">⚠</span>
              <h3 className="text-sm font-tactical text-dr-amber uppercase tracking-wider">
                OVERSEER ESCALATION — COMMANDER INPUT REQUIRED
              </h3>
            </div>
            <p className="font-data text-sm text-dr-text whitespace-pre-wrap">
              {escalationQuestion}
            </p>
            <TacTextarea
              placeholder="Your answer to the Overseer's question..."
              value={escalationAnswer}
              onChange={(e) => setEscalationAnswer(e.target.value)}
              rows={4}
              className="w-full"
            />
            <TacButton
              variant="primary"
              onClick={handleAnswerEscalation}
              disabled={isPending || !escalationAnswer.trim()}
            >
              {isPending ? 'SUBMITTING...' : 'SUBMIT ANSWER'}
            </TacButton>
          </div>
        )}

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
              {...tacTooltip('Abandon this mission. Records are preserved.')}
            >
              {isPending ? 'PROCESSING...' : 'ABANDON'}
            </TacButton>
          )}
          {canAcceptMerge && !showOverride && (
            <TacButton
              variant="success"
              {...tacTooltip('Force-merge the worktree branch regardless of failure reason. You accept responsibility for the state of the code.')}
              onClick={async () => {
                const result = await confirm({
                  title: 'ACCEPT & MERGE',
                  description: 'Force-merge this mission\'s worktree branch into the target branch.',
                  body: (
                    <p>
                      This merges the work branch even though the mission is{' '}
                      <span className="text-dr-red font-tactical">COMPROMISED</span>. Use when
                      you&apos;ve reviewed the work and it&apos;s acceptable.
                    </p>
                  ),
                  actions: [{ label: 'ACCEPT & MERGE', variant: 'success' }],
                });
                if (result !== 0) return;
                setIsPending(true);
                try {
                  await acceptMergeOverride(missionId);
                  toast.success('Merge accepted — mission accomplished');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Merge failed');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
            >
              ACCEPT & MERGE
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
