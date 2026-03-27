'use client';

import { useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCampaignComms } from '@/hooks/use-campaign-comms';
import { PhaseTimeline } from '@/components/campaign/phase-timeline';
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
    }>;
  }>;
  battlefieldId: string;
}

const TERMINAL_STATUSES: CampaignStatus[] = ['accomplished', 'compromised'];

export function CampaignLiveView({
  campaignId,
  initialStatus,
  initialPhases,
  battlefieldId: _battlefieldId,
}: CampaignLiveViewProps) {
  const router = useRouter();
  const { status, phaseStatuses, phaseDebriefs, missionStatuses } =
    useCampaignComms(campaignId, initialStatus);

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
      {status === 'compromised' && (
        <div className="bg-dr-surface border border-dr-red/30 px-4 py-2 font-tactical text-sm text-dr-red">
          COMPROMISED — Awaiting Commander orders
        </div>
      )}

      <PhaseTimeline phases={mergedPhases} />
    </div>
  );
}
