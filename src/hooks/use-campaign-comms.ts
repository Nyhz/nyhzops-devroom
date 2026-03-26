'use client';

import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';
import type { CampaignStatus, PhaseStatus, MissionStatus } from '@/types';

export function useCampaignComms(campaignId: string, initialStatus: string) {
  const socket = useSocket();
  const [status, setStatus] = useState<CampaignStatus>(initialStatus as CampaignStatus);
  const [phaseStatuses, setPhaseStatuses] = useState<Record<string, PhaseStatus>>({});
  const [phaseDebriefs, setPhaseDebriefs] = useState<Record<string, string>>({});
  const [missionStatuses, setMissionStatuses] = useState<Record<string, MissionStatus>>({});

  useEffect(() => {
    if (!socket) return;
    socket.emit('campaign:subscribe', campaignId);

    // Listen for 4 event types, filter by campaignId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onStatus = (d: any) => { if (d.campaignId === campaignId) setStatus(d.status); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onPhaseStatus = (d: any) => { if (d.campaignId === campaignId) setPhaseStatuses(p => ({ ...p, [d.phaseId]: d.status })); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onPhaseDebrief = (d: any) => { if (d.campaignId === campaignId) setPhaseDebriefs(p => ({ ...p, [d.phaseId]: d.debrief })); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onMissionStatus = (d: any) => { if (d.campaignId === campaignId) setMissionStatuses(p => ({ ...p, [d.missionId]: d.status })); };

    socket.on('campaign:status', onStatus);
    socket.on('campaign:phase-status', onPhaseStatus);
    socket.on('campaign:phase-debrief', onPhaseDebrief);
    socket.on('campaign:mission-status', onMissionStatus);

    return () => {
      socket.off('campaign:status', onStatus);
      socket.off('campaign:phase-status', onPhaseStatus);
      socket.off('campaign:phase-debrief', onPhaseDebrief);
      socket.off('campaign:mission-status', onMissionStatus);
      socket.emit('campaign:unsubscribe', campaignId);
    };
  }, [socket, campaignId]);

  return { status, phaseStatuses, phaseDebriefs, missionStatuses };
}
