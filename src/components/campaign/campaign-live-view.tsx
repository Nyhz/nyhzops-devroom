'use client';

import { useMemo, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaignComms } from '@/hooks/use-campaign-comms';
import { PhaseTimeline } from '@/components/campaign/phase-timeline';
import { TacButton } from '@/components/ui/tac-button';
import { retryPhaseDebrief, skipPhaseDebrief } from '@/actions/campaign-overrides';
import { toast } from 'sonner';
import { tacTooltip } from '@/components/ui/tac-tooltip';
import type { CampaignStatus } from '@/types';

interface CampaignLiveViewProps {
  campaignId: string;
  initialStatus: string;
  initialPhases: Array<{
    id: string;
    phaseNumber: number;
    name: string;
    objective: string | null;
    status: string | null;
    debrief: string | null;
    totalTokens: number | null;
    durationMs: number | null;
    missions: Array<{
      id: string;
      title: string | null;
      status: string | null;
      assetCodename: string | null;
      priority: string | null;
      durationMs: number | null;
      costInput: number | null;
      costOutput: number | null;
      compromiseReason?: string | null;
      mergeRetryAt?: number | null;
    }>;
  }>;
  battlefieldId: string;
  stallReason?: string | null;
}

const TERMINAL_STATUSES: CampaignStatus[] = ['accomplished', 'compromised'];

export function CampaignLiveView({
  campaignId,
  initialStatus,
  initialPhases,
  battlefieldId,
  stallReason: initialStallReason,
}: CampaignLiveViewProps) {
  const router = useRouter();
  const [stallReason, setStallReason] = useState(initialStallReason ?? null);
  const [isPending, setIsPending] = useState(false);

  const { status, phaseStatuses, phaseDebriefs, missionStatuses, socket } =
    useCampaignComms(campaignId, initialStatus);

  // Listen for stall events
  useEffect(() => {
    if (!socket) return;
    const onStalled = (data: { reason: string }) => {
      setStallReason(data.reason);
    };
    socket.on('campaign:stalled', onStalled);
    return () => { socket.off('campaign:stalled', onStalled); };
  }, [socket]);

  // Clear stall reason when campaign becomes active again
  useEffect(() => {
    if (status === 'active') {
      setStallReason(null);
    }
  }, [status]);

  // Merge live statuses onto initial phase data
  const mergedPhases = useMemo(() => {
    return initialPhases.map((phase) => ({
      ...phase,
      status: phaseStatuses[phase.id] ?? phase.status,
      debrief: phaseDebriefs[phase.id] ?? phase.debrief,
      missions: phase.missions.map((mission) => ({
        ...mission,
        status: missionStatuses[mission.id] ?? mission.status,
      })),
    }));
  }, [initialPhases, phaseStatuses, phaseDebriefs, missionStatuses]);

  // On terminal status, refresh the page to get final server data
  useEffect(() => {
    if (TERMINAL_STATUSES.includes(status)) {
      router.refresh();
    }
  }, [status, router]);

  // Determine current phase number for banner
  const activePhase = mergedPhases.find(
    (p) => (p.status ?? '').toLowerCase().replace(/\s+/g, '_') === 'active',
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Campaign status banner */}
      {status === 'active' && (
        <div className="bg-dr-surface border border-dr-amber/30 px-4 py-2 font-tactical text-sm text-dr-amber">
          ACTIVE{activePhase ? ` — Phase ${activePhase.phaseNumber} in progress` : ''}
        </div>
      )}
      {status === 'paused' && stallReason && (
        <div className="bg-dr-surface border border-dr-amber/30 px-4 py-3 space-y-2">
          <div className="font-tactical text-sm text-dr-amber">
            STALLED — {stallReason}
          </div>
          <div className="flex gap-3">
            <TacButton
              variant="primary"
              size="sm"
              onClick={async () => {
                setIsPending(true);
                try {
                  await retryPhaseDebrief(campaignId);
                  toast.success('Resubmitting debrief generation...');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Resubmit failed');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
              {...tacTooltip('Re-generate the phase summary report. Use when the AI summary failed or was incomplete.')}
            >
              {isPending ? 'RESUBMITTING...' : 'RESUBMIT DEBRIEF'}
            </TacButton>
            <TacButton
              variant="ghost"
              size="sm"
              onClick={async () => {
                setIsPending(true);
                try {
                  await skipPhaseDebrief(campaignId);
                  toast('Debrief skipped — advancing to next phase');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Skip failed');
                } finally {
                  setIsPending(false);
                }
              }}
              disabled={isPending}
            >
              SKIP DEBRIEF
            </TacButton>
          </div>
        </div>
      )}
      {status === 'paused' && !stallReason && (
        <div className="bg-dr-surface border border-dr-amber/30 px-4 py-2 font-tactical text-sm text-dr-amber">
          PAUSED
        </div>
      )}
      {status === 'compromised' && (
        <div className="bg-dr-surface border border-dr-red/30 px-4 py-2 font-tactical text-sm text-dr-red">
          COMPROMISED — Awaiting Commander orders
        </div>
      )}

      <PhaseTimeline phases={mergedPhases} battlefieldId={battlefieldId} />
    </div>
  );
}
