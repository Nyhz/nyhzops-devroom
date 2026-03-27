'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextarea } from '@/components/ui/tac-input';
import { abandonMission, continueMission, redeployMission } from '@/actions/mission';

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

  const canAbandon = status === 'standby' || status === 'queued' || status === 'in_combat';
  const isTerminal = status === 'accomplished' || status === 'compromised' || status === 'abandoned';
  const canContinue =
    (status === 'accomplished' || status === 'compromised') && sessionId != null;
  const canRedeploy = isTerminal;

  const handleAbandon = async () => {
    if (!confirm('Abandon this mission?')) return;
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

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        {canAbandon && (
          <TacButton
            variant="danger"
            onClick={handleAbandon}
            disabled={isPending}
          >
            {isPending ? 'ABANDONING...' : 'ABANDON'}
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
      </div>

      {canContinue && (
        <div className="space-y-3">
          {!showContinue ? (
            <TacButton
              variant="primary"
              onClick={() => setShowContinue(true)}
              disabled={isPending}
            >
              CONTINUE MISSION
            </TacButton>
          ) : (
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
      )}
    </div>
  );
}
